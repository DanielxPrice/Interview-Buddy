"use strict";

const {
  WINDOW_MS,
  RETENTION_MS,
  API_RATE_LIMITS,
} = require("../../config/apiRateLimits");

class FirestoreApiRateLimitRepository {
  constructor({ db, limits = API_RATE_LIMITS, now = () => Date.now() } = {}) {
    if (!db || typeof db.runTransaction !== "function") {
      throw new Error("FirestoreApiRateLimitRepository requires a Firestore db.");
    }
    if (!limits || !Number.isSafeInteger(limits.global) || limits.global < 1) {
      throw new Error("API rate limits must define a positive global limit.");
    }
    this.db = db;
    this.limits = limits;
    this.now = now;
  }

  /** Atomically charge ALL applicable windows, or charge NONE. */
  async consume({ userId, buckets }) {
    if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(userId)) {
      throw new Error("Rate limit requires a valid authenticated UID.");
    }
    if (!Array.isArray(buckets) || buckets.length < 1 ||
        buckets.length > 5 || new Set(buckets).size !== buckets.length ||
        !buckets.includes("global") ||
        buckets.some((name) => !Object.prototype.hasOwnProperty.call(this.limits, name) ||
          !Number.isSafeInteger(this.limits[name]) || this.limits[name] < 1)) {
      throw new Error("Invalid rate-limit bucket configuration.");
    }

    // Freeze time/keys before Firestore transaction retries.
    const currentMs = this.now();
    if (!Number.isSafeInteger(currentMs) || currentMs < 0) {
      throw new Error("Rate-limit clock is invalid.");
    }
    const windowStartMs = Math.floor(currentMs / WINDOW_MS) * WINDOW_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil((windowStartMs + WINDOW_MS - currentMs) / 1000));
    const docs = buckets.map((name) => ({
      name,
      limit: this.limits[name],
      ref: this.db.collection("users").doc(userId)
        .collection("apiRateLimits").doc(`${name}_${windowStartMs}`),
    }));

    return this.db.runTransaction(async (tx) => {
      // Firestore transaction rules: all reads must precede all writes.
      const snapshots = await Promise.all(docs.map(({ ref }) => tx.get(ref)));
      const current = docs.map((doc, index) => {
        const data = snapshots[index].exists ? snapshots[index].data() : null;
        if (snapshots[index].exists && (!data || typeof data !== "object")) {
          throw new Error("API rate-limit counter is corrupt.");
        }
        const count = data ? data.count : 0;
        if (!Number.isSafeInteger(count) || count < 0 ||
            (data && (data.bucket !== doc.name || data.windowStartMs !== windowStartMs))) {
          throw new Error("API rate-limit counter is corrupt.");
        }
        return { ...doc, count };
      });

      // No writes on rejection, including to the global counter.
      const exhausted = current.find(({ count, limit }) => count >= limit);
      if (exhausted) {
        return {
          allowed: false,
          bucket: exhausted.name,
          limit: exhausted.limit,
          remaining: 0,
          retryAfterSeconds,
        };
      }

      for (const { name, ref, count } of current) {
        tx.set(ref, {
          bucket: name,
          windowStartMs,
          count: count + 1,
          // Configure Firestore TTL on this collection-group field. TTL
          // deletion is asynchronous, not a replacement for these checks.
          expiresAt: new Date(windowStartMs + RETENTION_MS),
        });
      }
      const remaining = Math.min(...current.map(({ count, limit }) => limit - count - 1));
      return { allowed: true, remaining };
    });
  }
}

module.exports = FirestoreApiRateLimitRepository;

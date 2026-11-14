"use strict";

const { createHash } = require("node:crypto");
const FriendshipRepository = require("../contracts/FriendshipRepository");
const { rankProfiles } = require("../../services/leaderboardRanking");

const COLLECTION = "friendRelationships";
const VALID_STATES = new Set(["pending", "accepted", "declined"]);
const PROFILE_BATCH_SIZE = 100;

function friendshipError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizedUid(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 128 ||
    value.includes("/") ||
    value.split("").some((char) => {
      const code = char.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw friendshipError(
      "invalid-friend-uid",
      "A valid Firebase user ID is required.",
      400
    );
  }
  // Firebase UIDs are case sensitive. Never lowercase or hash the UID itself.
  return value.trim();
}

function pairFor(firstUid, secondUid) {
  const first = normalizedUid(firstUid);
  const second = normalizedUid(secondUid);
  if (first === second) {
    throw friendshipError("self-friend-request", "A user cannot befriend themselves.", 400);
  }
  const participants = [first, second].sort();
  // Length-prefixed encoding prevents ambiguous concatenation or separator collisions.
  const payload = participants.map((uid) => `${Buffer.byteLength(uid, "utf8")}:${uid}`).join("");
  const id = createHash("sha256").update(payload).digest("hex");
  return { id, participants };
}

function validateRelationship(document, expectedParticipants) {
  const data = document.data() || {};
  if (!VALID_STATES.has(data.status) || !Array.isArray(data.participants) ||
      data.participants.length !== 2 ||
      data.participants[0] !== expectedParticipants[0] ||
      data.participants[1] !== expectedParticipants[1] ||
      !expectedParticipants.includes(data.requesterUid) ||
      !expectedParticipants.includes(data.recipientUid) ||
      data.requesterUid === data.recipientUid) {
    throw friendshipError("friendship-data-invalid", "Stored friendship data is inconsistent.", 503);
  }
  return { ...data, id: document.id };
}

class FirestoreFriendshipRepository extends FriendshipRepository {
  constructor({ db, admin }) {
    super();
    if (!db) throw new Error("FirestoreFriendshipRepository requires a Firestore db instance.");
    this.db = db;
    this.admin = admin;
  }

  timestamp() {
    return this.admin?.firestore?.FieldValue?.serverTimestamp
      ? this.admin.firestore.FieldValue.serverTimestamp()
      : new Date().toISOString();
  }

  relationshipRef(firstUid, secondUid) {
    return this.db.collection(COLLECTION).doc(pairFor(firstUid, secondUid).id);
  }

  async findRelationship(firstUid, secondUid) {
    const { id, participants } = pairFor(firstUid, secondUid);
    const doc = await this.db.collection(COLLECTION).doc(id).get();
    return doc.exists ? validateRelationship(doc, participants) : null;
  }

  async assertActiveUsers(transaction, firstUid, secondUid) {
    const users = this.db.collection("users");
    const [first, second] = await Promise.all([
      transaction.get(users.doc(firstUid)),
      transaction.get(users.doc(secondUid)),
    ]);
    for (const user of [first, second]) {
      if (!user.exists) {
        throw friendshipError("friend-user-not-found", "One or both user profiles do not exist.", 404);
      }
      if (user.data()?.deleting === true || user.data()?.status === "deleting") {
        throw friendshipError("friend-user-unavailable", "An account is being deleted.", 409);
      }
    }
  }

  /** A repeated request from the same sender is a no-op. Reverse requests conflict. */
  async createRequest(requesterUid, recipientUid) {
    const { id, participants } = pairFor(requesterUid, recipientUid);
    const requester = normalizedUid(requesterUid);
    const recipient = normalizedUid(recipientUid);
    const ref = this.db.collection(COLLECTION).doc(id);

    return this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(ref);
      if (current.exists) {
        const record = validateRelationship(current, participants);
        if (record.status === "pending" && record.requesterUid === requester) return record;
        if (record.status === "accepted") {
          throw friendshipError("already-friends", "These users are already friends.");
        }
        if (record.status === "declined") {
          throw friendshipError("friend-request-declined", "A declined request cannot be reopened automatically.");
        }
        throw friendshipError("friend-request-pending", "A request from the other user is already pending.");
      }
      await this.assertActiveUsers(transaction, requester, recipient);
      const now = this.timestamp();
      const data = {
        participants,
        requesterUid: requester,
        recipientUid: recipient,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        respondedAt: null,
        acceptedAt: null,
      };
      transaction.create(ref, data);
      return { id, ...data };
    });
  }

  async respondToRequest(requesterUid, recipientUid, actorUid, nextState) {
    const { id, participants } = pairFor(requesterUid, recipientUid);
    const actor = normalizedUid(actorUid);
    const ref = this.db.collection(COLLECTION).doc(id);
    if (actor !== normalizedUid(recipientUid)) {
      throw friendshipError("friend-request-forbidden", "Only the request recipient may respond.", 403);
    }

    return this.db.runTransaction(async (transaction) => {
      const document = await transaction.get(ref);
      if (!document.exists) {
        throw friendshipError("friend-request-not-found", "The friend request does not exist.", 404);
      }
      const current = validateRelationship(document, participants);
      if (current.requesterUid !== normalizedUid(requesterUid) ||
          current.recipientUid !== normalizedUid(recipientUid)) {
        throw friendshipError("friend-request-forbidden", "The request direction does not match.", 403);
      }
      if (current.status === nextState) return current;
      if (current.status !== "pending") {
        throw friendshipError("friend-request-finalized", "A finalized request cannot change status.");
      }
      if (nextState === "accepted") {
        await this.assertActiveUsers(transaction, current.requesterUid, current.recipientUid);
      }
      const now = this.timestamp();
      const changes = {
        status: nextState,
        updatedAt: now,
        respondedAt: now,
        ...(nextState === "accepted" ? { acceptedAt: now } : {}),
      };
      transaction.update(ref, changes);
      return { ...current, ...changes };
    });
  }

  async acceptRequest(requesterUid, recipientUid, actorUid) {
    return this.respondToRequest(requesterUid, recipientUid, actorUid, "accepted");
  }

  async declineRequest(requesterUid, recipientUid, actorUid) {
    return this.respondToRequest(requesterUid, recipientUid, actorUid, "declined");
  }

  /** Only an accepted relationship can be removed. Either participant may remove it. */
  async removeFriendship(firstUid, secondUid) {
    const { id, participants } = pairFor(firstUid, secondUid);
    const ref = this.db.collection(COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const document = await transaction.get(ref);
      if (!document.exists) return false;
      const current = validateRelationship(document, participants);
      if (current.status !== "accepted") {
        throw friendshipError("friendship-not-accepted", "Only an accepted friendship can be removed.");
      }
      transaction.delete(ref);
      return true;
    });
  }

  async listRequests(field, uid, status = "pending") {
    const userUid = normalizedUid(uid);
    if (status !== null && !VALID_STATES.has(status)) {
      throw friendshipError("invalid-friend-status", "Unsupported friend request status.", 400);
    }
    let query = this.db.collection(COLLECTION).where(field, "==", userUid);
    if (status !== null) query = query.where("status", "==", status);
    const snapshot = await query.get();
    return snapshot.docs.map((document) => {
      const data = document.data() || {};
      const pair = pairFor(data.requesterUid, data.recipientUid);
      if (document.id !== pair.id || data[field] !== userUid ||
          (status !== null && data.status !== status)) {
        throw friendshipError("friendship-data-invalid", "Stored friend request is inconsistent.", 503);
      }
      return validateRelationship(document, pair.participants);
    });
  }

  async listIncomingRequests(recipientUid, status = "pending") {
    return this.listRequests("recipientUid", recipientUid, status);
  }

  async listOutgoingRequests(requesterUid, status = "pending") {
    return this.listRequests("requesterUid", requesterUid, status);
  }

  /** Canonical record represents both sides; there is never a one-way friendship. */
  async listFriends(userUid) {
    const uid = normalizedUid(userUid);
    const snapshot = await this.db.collection(COLLECTION)
      .where("participants", "array-contains", uid)
      .where("status", "==", "accepted")
      .get();

    return snapshot.docs.map((document) => {
      const data = document.data() || {};
      const pair = pairFor(data.requesterUid, data.recipientUid);
      const record = validateRelationship(document, pair.participants);
      if (document.id !== pair.id || !record.participants.includes(uid) ||
          record.status !== "accepted") {
        throw friendshipError("friendship-data-invalid", "Stored accepted friendship is inconsistent.", 503);
      }
      return { ...record, friendUid: record.participants.find((entry) => entry !== uid) };
    });
  }

  /**
   * Fetch ONLY accepted friends' public ranking fields; never scan every user.
   * Use the same ELO ordering and competition ranks as the global board.
   */
  async listFriendsLeaderboard(userUid) {
    const friends = await this.listFriends(userUid);
    if (friends.length === 0) return [];
    const friendUids = [...new Set(friends.map(({ friendUid }) => friendUid))];
    const users = this.db.collection("users");
    const profiles = [];
    for (let start = 0; start < friendUids.length; start += PROFILE_BATCH_SIZE) {
      const chunk = friendUids.slice(start, start + PROFILE_BATCH_SIZE);
      const refs = chunk.map((uid) => users.doc(uid));
      // Firebase Admin SDK supports getAll with a field projection. A bounded
      // fallback supports simpler repository test doubles without a full scan.
      const snapshots = typeof this.db.getAll === "function"
        ? await this.db.getAll(...refs, { fieldMask: ["username", "ranking", "deleting", "status"] })
        : await Promise.all(refs.map((ref) => ref.get()));
      for (const doc of snapshots) {
        if (doc.exists) profiles.push({ ...doc.data(), uid: doc.id });
      }
    }
    return rankProfiles(profiles);
  }
}

module.exports = FirestoreFriendshipRepository;
module.exports.pairFor = pairFor;

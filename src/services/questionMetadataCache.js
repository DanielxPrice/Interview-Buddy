import bundledMetadata from "../data/questionMetadata.json";
import { auth } from "../config/firebase";

const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || "http://localhost:5001/api").replace(/\/$/, "");
const VALID_MODES = ["Quiz Style", "Code Style", "Theoretical Style"];
const normalize = (value) => String(value || "").trim().toLowerCase();
const empty = () => ({ jobRoles: [], experienceLevels: [], tags: [] });

let metadata = bundledMetadata;
let revision = null;
let verified = false;
let pendingRefresh = null;
const listeners = new Set();

export function getCachedSetupOptions(mode, { jobRole = "", experienceLevel = "" } = {}) {
  if (!VALID_MODES.includes(mode)) throw new Error(`Invalid interview mode: ${mode || "none"}`);
  const entry = metadata?.modes?.[mode];
  if (!entry) return empty();
  const role = jobRole ? entry.byRole?.[normalize(jobRole)] : null;
  const experienceLevels = jobRole ? (role?.experienceLevels || []) : entry.all.experienceLevels;
  let tags;
  if (jobRole && experienceLevel) tags = role?.byLevel?.[normalize(experienceLevel)] || [];
  else if (jobRole) tags = role?.tags || [];
  else if (experienceLevel) tags = entry.byLevel?.[normalize(experienceLevel)] || [];
  else tags = entry.all.tags;
  return { jobRoles: entry.all.jobRoles, experienceLevels, tags };
}

/**
 * Count the entire active matching pool using the bundled/refreshable index.
 * This mirrors the server's role + level + ANY-selected-tag matching.
 * Each grouped record contributes its number of unique questions just once.
 * Returns null when a legacy metadata response has no count index, so the
 * page can fall back to the existing /questions/count endpoint.
 */
export function getCachedAvailableQuestionCount({
  mode, jobRole = "", experienceLevel = "", tags = [],
} = {}) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid interview mode: ${mode || "none"}`);
  }

  const countIndex = metadata?.modes?.[mode]?.countIndex;
  if (!Array.isArray(countIndex)) return null;

  const selectedTags = new Set(
    (Array.isArray(tags) ? tags : [tags])
      .flatMap((value) => String(value || "").split(","))
      .map(normalize)
      .filter(Boolean)
  );
  const role = normalize(jobRole);
  const level = normalize(experienceLevel);
  if (!role || !level || selectedTags.size === 0) return null;

  return countIndex.reduce((total, group) => {
    if (!group.jobRoles.includes(role) ||
        !group.experienceLevels.includes(level) ||
        !group.tags.some((tag) => selectedTags.has(tag))) {
      return total;
    }
    return total + group.count;
  }, 0);
}

export function subscribeSetupMetadata(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function request(url) {
  const user = auth.currentUser;
  if (!user) throw new Error("Authenticated Firebase user is required.");
  const token = await user.getIdToken();
  const response = await fetch(`${API_BASE_URL}/questions/metadata${url}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Metadata request failed (${response.status}).`);
  return response.json();
}

export function refreshSetupMetadata() {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    const { version } = await request("/version");
    // Bundled metadata may be out of date even if Firestore revision is zero.
    if (verified && revision === version) return false;
    const fresh = await request("");
    // Support old backend responses during a rolling frontend/backend deploy.
    // Schema 1 has no index; counting falls back to the existing API.
    if (![1, 2].includes(fresh.schemaVersion) || !fresh.modes || fresh.version !== version) {
      throw new Error("Incompatible or changed metadata revision; retry on next refresh.");
    }
    metadata = fresh;
    revision = fresh.version;
    verified = true;
    listeners.forEach((listener) => listener());
    return true;
  })().finally(() => { pendingRefresh = null; });
  return pendingRefresh;
}

// Keep bundled metadata for the next signed-in user, but always revalidate.
export function resetMetadataVerification() {
  verified = false;
}

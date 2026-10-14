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
    if (fresh.schemaVersion !== 1 || !fresh.modes || fresh.version !== version) {
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

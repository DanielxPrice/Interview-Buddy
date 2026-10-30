/** Safe, compact setup metadata; never send full questions or grading rubrics. */
const { buildQuestionSetupOptions } = require("./questionSelection");

const MODES = ["Quiz Style", "Code Style", "Theoretical Style"];
const key = (value) => String(value || "").trim().toLowerCase();
const empty = () => ({ jobRoles: [], experienceLevels: [], tags: [] });
const matches = (entries, selected) =>
  Array.isArray(entries) && entries.some((entry) => key(entry) === key(selected));

// The same normalized fields are used by countEligibleQuestions. Grouping
// identical combinations keeps the public index small and avoids exposing IDs.
const normalizedValues = (entries) =>
  [...new Set((Array.isArray(entries) ? entries : []).map(key).filter(Boolean))].sort();

function buildCountIndex(questions) {
  const groups = new Map();
  for (const question of questions) {
    const jobRoles = normalizedValues(question.jobRoles);
    const experienceLevels = normalizedValues(question.experienceLevels);
    const tags = normalizedValues(question.tags);
    if (!jobRoles.length || !experienceLevels.length || !tags.length) continue;

    const signature = JSON.stringify([jobRoles, experienceLevels, tags]);
    const existing = groups.get(signature);
    if (existing) existing.count += 1;
    else groups.set(signature, { jobRoles, experienceLevels, tags, count: 1 });
  }
  return [...groups.values()];
}

function buildQuestionMetadata(questions) {
  const modes = {};
  for (const mode of MODES) {
    const byMode = questions.filter((q) =>
      q && q.mode === mode && q.active !== false
    );
    const all = buildQuestionSetupOptions(byMode);
    const byRole = {};
    const byLevel = {};

    for (const level of all.experienceLevels) {
      byLevel[key(level)] = buildQuestionSetupOptions(
        byMode.filter((q) => matches(q.experienceLevels, level))
      ).tags;
    }
    for (const role of all.jobRoles) {
      const roleQuestions = byMode.filter((q) => matches(q.jobRoles, role));
      const roleOptions = buildQuestionSetupOptions(roleQuestions);
      const roleLevels = {};
      for (const level of roleOptions.experienceLevels) {
        roleLevels[key(level)] = buildQuestionSetupOptions(
          roleQuestions.filter((q) => matches(q.experienceLevels, level))
        ).tags;
      }
      byRole[key(role)] = {
        experienceLevels: roleOptions.experienceLevels,
        tags: roleOptions.tags,
        byLevel: roleLevels,
      };
    }
    modes[mode] = { all, byRole, byLevel, countIndex: buildCountIndex(byMode) };
  }
  return { schemaVersion: 2, modes };
}

function getOptionsFromMetadata(metadata, mode, { jobRole = "", experienceLevel = "" } = {}) {
  const entry = metadata?.modes?.[mode];
  if (!entry) return empty();
  const role = jobRole ? entry.byRole?.[key(jobRole)] : null;
  const all = entry.all;
  const levels = jobRole ? (role?.experienceLevels || []) : all.experienceLevels;
  let tags;
  if (jobRole && experienceLevel) tags = role?.byLevel?.[key(experienceLevel)] || [];
  else if (jobRole) tags = role?.tags || [];
  else if (experienceLevel) tags = entry.byLevel?.[key(experienceLevel)] || [];
  else tags = all.tags;
  return { jobRoles: all.jobRoles, experienceLevels: levels, tags };
}


/**
 * Count question groups from the already cached public metadata index.
 * Each group represents disjoint questions, so ANY selected tag counts a
 * group at most once even when several selected tags match.
 */
function countIndexedQuestions(metadata, mode, { jobRole, experienceLevel, tags } = {}) {
  const groups = metadata?.modes?.[mode]?.countIndex;
  if (!Array.isArray(groups)) return null;
  const role = key(jobRole);
  const level = key(experienceLevel);
  const selected = new Set((Array.isArray(tags) ? tags : [tags])
    .flatMap((value) => String(value || "").split(","))
    .map(key).filter(Boolean));
  if (!role || !level || selected.size === 0) return 0;
  return groups.reduce((sum, group) => {
    if (!Array.isArray(group.jobRoles) || !group.jobRoles.includes(role) ||
        !Array.isArray(group.experienceLevels) || !group.experienceLevels.includes(level) ||
        !Array.isArray(group.tags) || !group.tags.some((tag) => selected.has(tag))) {
      return sum;
    }
    return sum + group.count;
  }, 0);
}

module.exports = { MODES, buildQuestionMetadata, getOptionsFromMetadata, countIndexedQuestions };

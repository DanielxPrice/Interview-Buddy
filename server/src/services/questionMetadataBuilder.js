/** Safe, compact setup metadata; never send full questions or grading rubrics. */
const { buildQuestionSetupOptions } = require("./questionSelection");

const MODES = ["Quiz Style", "Code Style", "Theoretical Style"];
const key = (value) => String(value || "").trim().toLowerCase();
const empty = () => ({ jobRoles: [], experienceLevels: [], tags: [] });
const matches = (entries, selected) =>
  Array.isArray(entries) && entries.some((entry) => key(entry) === key(selected));

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
    modes[mode] = { all, byRole, byLevel };
  }
  return { schemaVersion: 1, modes };
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

module.exports = { MODES, buildQuestionMetadata, getOptionsFromMetadata };

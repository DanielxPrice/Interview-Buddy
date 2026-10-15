const USER_ROLES = Object.freeze({
  USER: "user",
  ADMIN: "admin",
});

const DEFAULT_USER_ROLE = USER_ROLES.USER;

const VALID_USER_ROLES = new Set(
  Object.values(USER_ROLES)
);

function normalizeUserRole(role) {
  const normalizedRole = String(role || "")
    .trim()
    .toLowerCase();

  return VALID_USER_ROLES.has(normalizedRole)
    ? normalizedRole
    : DEFAULT_USER_ROLE;
}

module.exports = {
  USER_ROLES,
  DEFAULT_USER_ROLE,
  VALID_USER_ROLES,
  normalizeUserRole,
};
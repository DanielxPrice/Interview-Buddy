/**
 * Frontend ELO -> badge display rules.
 *
 * These ranges are provisional UX defaults. The current backend does not
 * define rank tiers, so update the `minElo` boundaries when the team
 * approves an official progression. This module is display-only and never
 * invents or modifies a user's ELO.
 *
 * The badge images already exist under public/ in Interview Buddy.
 */
export const ELO_BADGE_TIERS = Object.freeze([
  { minElo: 0, name: "Janitor", image: "Cheerful Janitor Mascot Badge.png" },
  { minElo: 400, name: "Unpaid Intern", image: "Unpaid Intern Buddy Badge.png" },
  { minElo: 700, name: "Paid Intern", image: "Paid Intern Money Maker.png" },
  { minElo: 1000, name: "Graduate", image: "Cheerful Graduate Mascot Badge.png" },
  { minElo: 1300, name: "Junior Developer", image: "Cheerful Junior Developer Mascot Badge.png" },
  { minElo: 1600, name: "Senior Developer", image: "Senior Developer Mascot Badge.png" },
  { minElo: 1900, name: "Meta Keynote", image: "Meta Mascot Tech Keynote Badge.png" },
  { minElo: 2200, name: "NVIDIA Keynote", image: "NVIDIA Keynote Mascot Badge.png" },
  { minElo: 2500, name: "Tech CEO", image: "Tech CEO Mascot Innovation Badge.png" },
]);

/** Returns null when the server has not supplied a valid ELO. */
export function getEloRankBadge(elo) {
  if (typeof elo !== "number" || !Number.isFinite(elo) || elo < 0) return null;
  const tier = [...ELO_BADGE_TIERS].reverse().find(({ minElo }) => elo >= minElo);
  return tier ? { ...tier, src: `/${encodeURIComponent(tier.image)}` } : null;
}

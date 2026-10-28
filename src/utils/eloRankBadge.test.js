import { ELO_BADGE_TIERS, getEloRankBadge } from "./eloRankBadge";

test("unavailable or invalid ELO never invents a rank badge", () => {
  [undefined, null, "2150", NaN, Infinity, -1].forEach((value) => {
    expect(getEloRankBadge(value)).toBeNull();
  });
});

test("selects the correct badge at each provisional ELO boundary", () => {
  ELO_BADGE_TIERS.forEach((tier) => {
    const atBoundary = getEloRankBadge(tier.minElo);
    expect(atBoundary.name).toBe(tier.name);
    expect(atBoundary.src).toBe(`/${encodeURIComponent(tier.image)}`);
  });

  ELO_BADGE_TIERS.slice(0, -1).forEach((tier, index) => {
    const next = ELO_BADGE_TIERS[index + 1];
    expect(getEloRankBadge(next.minElo - 1).name).toBe(tier.name);
  });

  expect(getEloRankBadge(100000).name).toBe("Tech CEO");
});

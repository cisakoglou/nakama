import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_LIMITATIONS, FEATURE_REQUIREMENTS } from "./feature-catalog";

describe("public feature catalog contract", () => {
  it("provides unique readable anchors and one leading featured entry", () => {
    expect(new Set(FEATURES.map((feature) => feature.id)).size).toBe(FEATURES.length);
    for (const feature of FEATURES) expect(feature.id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
    const featured = FEATURES.filter((feature) => feature.featured);
    expect(featured).toHaveLength(1);
    expect(FEATURES[0]).toBe(featured[0]);
    expect(featured[0]).toMatchObject({ id: "post-workout-reports", status: "new" });
  });

  it("keeps entries within presentation limits and resolves every requirement", () => {
    for (const feature of FEATURES) {
      expect(feature.title.length).toBeGreaterThan(0);
      expect(feature.title.length).toBeLessThanOrEqual(48);
      expect(feature.summary.length).toBeGreaterThan(0);
      expect(feature.summary.length).toBeLessThanOrEqual(160);
      expect(feature.details.length).toBeGreaterThanOrEqual(2);
      expect(feature.details.length).toBeLessThanOrEqual(4);
      expect(feature.details.every((detail) => detail.trim().length > 0 && detail.length <= 180)).toBe(true);
      expect(new Set(feature.requirements).size).toBe(feature.requirements.length);
      for (const requirement of feature.requirements) {
        expect(FEATURE_REQUIREMENTS[requirement].label.trim()).not.toBe("");
        expect(FEATURE_REQUIREMENTS[requirement].description.trim()).not.toBe("");
      }
    }
  });

  it("makes setup requirements explicit rather than treating a public page as public app access", () => {
    for (const feature of FEATURES) expect(feature.requirements).toContain("invite");
    expect(FEATURES[0].requirements).toEqual(["invite", "hevy-pro", "hevy-connection", "webhook-setup"]);
    expect(FEATURE_REQUIREMENTS.invite.description).toContain("invite-only");
    expect(FEATURE_LIMITATIONS.join(" ")).toContain("Everyone can browse this page");
  });

  it("describes shipped in-app reports without promising unshipped channels or guaranteed outcomes", () => {
    const copy = FEATURES.flatMap((feature) => [feature.title, feature.summary, ...feature.details]).join(" ");
    expect(copy).not.toMatch(/\b(?:push|email) notifications?\b|\boffline\b|\bguaranteed\b|\bsubscription tiers?\b/i);
    expect(FEATURES[0].details.join(" ")).toContain("in-app chat");
    expect(FEATURE_LIMITATIONS.join(" ")).toContain("not push or email notifications");
    expect(FEATURE_LIMITATIONS.join(" ")).toContain("not medical assessments");
  });
});

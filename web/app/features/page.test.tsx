import React from "react";
import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FEATURE_LIMITATIONS, FEATURE_REQUIREMENTS, FEATURES } from "@/lib/feature-catalog";
import FeaturesPage, { dynamic, metadata } from "./page";

const html = renderToStaticMarkup(<FeaturesPage />);
const decode = (text: string) => text.replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

describe("public features page", () => {
  it("is statically rendered with its own metadata", () => {
    expect(dynamic).toBe("force-static");
    expect(metadata.title).toBe("Features · Nakama");
  });

  it("renders every catalog feature as a linkable section, featured first", () => {
    const featured = FEATURES.find((feature) => feature.featured)!;
    for (const feature of FEATURES) {
      expect(html).toContain(`id="${feature.id}"`);
      expect(html).toContain(`href="#${feature.id}"`);
      expect(decode(html)).toContain(feature.summary);
      for (const detail of feature.details) expect(decode(html)).toContain(detail);
    }
    expect(html.indexOf(`id="${featured.id}"`)).toBeLessThan(
      Math.min(...FEATURES.filter((f) => f !== featured).map((f) => html.indexOf(`id="${f.id}"`))),
    );
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  it("states requirements and honest limits, and links to sign-in", () => {
    for (const requirement of Object.values(FEATURE_REQUIREMENTS)) expect(decode(html)).toContain(requirement.label);
    for (const limit of FEATURE_LIMITATIONS) expect(decode(html)).toContain(limit);
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Illustration with sample data");
  });

  it("depends on no session, cookies, or private data", async () => {
    const sources = await Promise.all([
      "./page.tsx", "../../components/features/feature-sections.tsx", "../../components/features/feature-illustrations.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
    for (const source of sources) {
      expect(source).not.toMatch(/supabase|next\/headers|cookies\(|requireBetaUser|server-only|use client|fetch\(/);
      expect(source).not.toMatch(/https?:\/\//);
    }
  });
});

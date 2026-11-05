import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HevyConnectionForm } from "./hevy-connection-form";

describe("guided Hevy connection", () => {
  it("explains browser-only setup and links directly to Hevy before asking for a key", () => {
    const html = renderToStaticMarkup(
      <HevyConnectionForm connection={{ connected: false }} onChanged={() => {}} />,
    );

    expect(html).toContain("Hevy Pro is required.");
    expect(html).toContain("Use your browser, not the Hevy mobile app");
    expect(html).toContain('href="https://hevy.com/settings?developer" target="_blank" rel="noopener noreferrer"');
    expect(html.indexOf("Open Hevy website")).toBeLessThan(html.indexOf('id="hevy-key"'));
    expect(html).toContain("Illustration only.");
    expect(html).toContain("Revoke API Key");
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-describedby="hevy-setup-help hevy-key-help"');
    expect(html).toContain("<details open=");
    expect(html).not.toContain("Disconnect Hevy");
  });

  it("shows a saved connection without asking the user to enter their key again", () => {
    const html = renderToStaticMarkup(
      <HevyConnectionForm
        connection={{
          connected: true,
          revision: "00000000-0000-4000-8000-000000000001",
          connected_at: "2026-11-05T00:00:00Z",
        }}
        onChanged={() => {}}
      />,
    );

    expect(html).toContain("Hevy connected");
    expect(html).toContain("Setup complete.");
    expect(html).toContain("Replace key");
    expect(html).toContain("Disconnect Hevy");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("Open Hevy website");
    expect(html).not.toContain("<details open=");
  });
});

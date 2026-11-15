import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CopyField, WebhookSetupView, describeWebhookStatus, type WebhookStatus } from "./workout-report-webhook";

const url = "https://nakama.example/api/hevy/webhook";
const noop = () => {};
function view(status: WebhookStatus | null, extra: Partial<Parameters<typeof WebhookSetupView>[0]> = {}) {
  return renderToStaticMarkup(
    <WebhookSetupView status={status} created={null} busy={false} error={null}
      onGenerate={noop} onTurnOff={noop} onRefresh={noop} {...extra} />,
  );
}

describe("describeWebhookStatus", () => {
  it("covers the three states", () => {
    expect(describeWebhookStatus({ configured: false })).toEqual({ state: "not-set-up", text: "Not set up" });
    expect(describeWebhookStatus({ configured: true, last_received_at: null }).state).toBe("waiting");
    expect(describeWebhookStatus({ configured: true }).text).toContain("waiting for your first workout");
    expect(describeWebhookStatus({ configured: true, last_received_at: "2026-11-10T10:00:00Z" }, (iso) => `<${iso}>`))
      .toEqual({ state: "working", text: "Working, last workout received <2026-11-10T10:00:00Z>" });
  });
});

describe("WebhookSetupView", () => {
  it("shows the six numbered steps and the Hevy link when not set up", () => {
    const html = view({ configured: false, url });
    expect(html).toContain("Not set up");
    for (const title of ["Generate your webhook details", "Open Hevy developer settings", "Paste the Webhook URL",
      "Paste the Authorization header", "Save in Hevy", "Log your next workout"]) expect(html).toContain(title);
    expect(html).toContain("Use your browser, not the Hevy mobile app");
    expect(html).toContain('href="https://hevy.com/settings?developer" target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain("Turn off workout reports");
  });

  it("shows both values with a shown-once warning after generating", () => {
    const html = view({ configured: true, url }, { created: { configured: true, url, authorization: "Bearer nkwh_abc" } });
    expect(html).toContain(url);
    expect(html).toContain("Bearer nkwh_abc");
    expect(html).toContain("Shown only once.");
    expect(html).toContain('aria-live="polite"');
  });

  it("shows waiting and working states without the steps", () => {
    const waiting = view({ configured: true, url, last_received_at: null });
    expect(waiting).toContain("waiting for your first workout");
    expect(waiting).toContain("Lost it? Create a new header");
    expect(waiting).toContain("Turn off workout reports");
    expect(waiting).toContain("Check again");
    expect(waiting).not.toContain("Save in Hevy");
    expect(view({ configured: true, url, last_received_at: "2026-11-10T10:00:00Z" })).toContain("Working, last workout received");
  });

  it("renders errors as alerts", () => {
    expect(view({ configured: false, url }, { error: "Boom" })).toContain('role="alert"');
  });
});

describe("CopyField", () => {
  it("renders a labelled read-only field with a live region", () => {
    const html = renderToStaticMarkup(<CopyField label="Webhook URL" value={url} />);
    expect(html).toContain("readOnly");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Copy");
  });
});

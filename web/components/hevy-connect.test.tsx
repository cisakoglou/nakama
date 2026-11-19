import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HevyConnectionForm, HevyConnectView } from "./hevy-connection-form";
import { HevyReportsView } from "./hevy-reports";
import { WebhookSetupView } from "./workout-report-webhook";
import type { HevyConnection } from "@/lib/hevy-types";
import type { ReportsState } from "@/lib/hevy-connect-client";

const base = { revision: "00000000-0000-4000-8000-000000000001", connected_at: "2026-11-05T00:00:00Z" };
const disconnected: HevyConnection = { connected: false };
const oauth = (state: "active" | "reconnect_required" = "active"): HevyConnection => ({
  connected: true, ...base, method: "oauth", state, hevy_user_id: "00000000-0000-4000-8000-000000000002", hevy_username: "lifter42",
});
const legacy: HevyConnection = { connected: true, ...base };

const view = (connection: HevyConnection, extra: Partial<React.ComponentProps<typeof HevyConnectView>> = {}) =>
  renderToStaticMarkup(
    <HevyConnectView connection={connection} busy={false} error={null} oauthReturn={null}
      onConnect={() => {}} onDisconnect={() => {}} legacy={<p>LEGACY-FORM</p>} {...extra} />,
  );

describe("Connect Hevy (disconnected)", () => {
  it("shows one primary Connect Hevy button, access and report copy, and the API key path as secondary", () => {
    const html = view(disconnected);
    expect(html).toContain(">Connect Hevy</button>");
    expect(html.match(/>Connect Hevy<\/button>/g)).toHaveLength(1);
    expect(html).toContain("read your workouts and exercises");
    expect(html).toContain("only when you approve each change");
    expect(html).toContain("Automatic workout reports will be turned on");
    expect(html).toContain("turn them off later");
    expect(html).toContain("Use an API key instead");
    expect(html.indexOf("Connect Hevy</button>")).toBeLessThan(html.indexOf("Use an API key instead"));
    expect(html).not.toContain("Disconnect Hevy");
  });

  it("the real form keeps the legacy key form reachable but collapsed", () => {
    const html = renderToStaticMarkup(<HevyConnectionForm connection={disconnected} onChanged={() => {}} />);
    expect(html).toContain("Use an API key instead");
    expect(html).toContain('id="hevy-key"');
    expect(html).not.toContain("<details open=");
  });

  it("shows busy state and inline start errors (incl. migration_required) with live regions and 44px targets", () => {
    const busy = view(disconnected, { busy: true });
    expect(busy).toContain("Opening Hevy...");
    expect(busy).toContain("disabled");
    const failed = view(disconnected, { error: "Moving an existing API-key connection to a Hevy login is not available yet. Your current connection keeps working." });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('aria-live="polite"');
    expect(failed).toContain("not available yet");
    expect(failed).toContain("min-h-11");
  });
});

describe("OAuth return states", () => {
  it("confirms success only when the reloaded account is really an active OAuth connection", () => {
    expect(view(oauth(), { oauthReturn: { kind: "connected" } })).toContain("Hevy is connected.");
    const unconfirmed = view(disconnected, { oauthReturn: { kind: "connected" } });
    expect(unconfirmed).not.toContain("Hevy is connected.");
    expect(unconfirmed).toContain("could not confirm");
    expect(view(oauth("reconnect_required"), { oauthReturn: { kind: "connected" } })).toContain("could not confirm");
  });

  it("explains cancellation as no change and offers a safe Try again", () => {
    const html = view(disconnected, { oauthReturn: { kind: "error", code: "access_denied" } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("nothing changed");
    expect(html).toContain("Try again");
    expect(html).toContain('tabindex="-1"');
  });

  it("handles known and unknown error codes without leaking the code", () => {
    expect(view(disconnected, { oauthReturn: { kind: "error", code: "invalid_state" } })).toContain("expired");
    const unknown = view(disconnected, { oauthReturn: { kind: "error", code: "unknown" } });
    expect(unknown).toContain("Something went wrong");
    expect(unknown).not.toContain("unknown<");
    const migration = view(disconnected, { oauthReturn: { kind: "error", code: "migration_required" } });
    expect(migration).toContain("keeps working");
    expect(migration).not.toContain("Try again");
  });
});

describe("OAuth connected", () => {
  it("shows the Hevy username, Connected state, Reconnect and Disconnect", () => {
    const html = view(oauth());
    expect(html).toContain("lifter42");
    expect(html).toContain(">Connected<");
    expect(html).toContain(">Reconnect</button>");
    expect(html).toContain(">Disconnect Hevy</button>");
    expect(html).not.toContain("API key");
    expect(html).not.toContain("LEGACY-FORM");
  });

  it("shows a prominent Reconnect action for reconnect_required", () => {
    const html = view(oauth("reconnect_required"));
    expect(html).toContain("Reconnect required");
    expect(html).toContain(">Reconnect Hevy</button>");
    expect(html).toContain("approve Nakama again");
  });
});

describe("legacy API-key users", () => {
  it("keep the existing controls and webhook UI, with no forced upgrade", () => {
    const html = renderToStaticMarkup(<HevyConnectionForm connection={legacy} onChanged={() => {}} />);
    expect(html).toContain("Replace key");
    expect(html).toContain("Disconnect Hevy");
    expect(html).not.toContain(">Connect Hevy<");
    expect(html).toContain("simpler way to connect Hevy is coming");
    const webhook = renderToStaticMarkup(
      <WebhookSetupView status={{ configured: false, url: "https://x.test/hook" }} created={null} busy={false} error={null}
        onGenerate={() => {}} onTurnOff={() => {}} onRefresh={() => {}} />,
    );
    expect(webhook).toContain("Generate webhook details");
  });
});

describe("OAuth report controls", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  const state = (over: Partial<ReportsState>): ReportsState => ({ enabled: true, status: "waiting", last_received_at: null, last_report: null, ...over });
  const reports = (s: ReportsState | null, extra: Partial<React.ComponentProps<typeof HevyReportsView>> = {}) =>
    renderToStaticMarkup(
      <HevyReportsView state={s} unavailable={false} busy={false} error={null} reconnectRequired={false} now={now}
        onToggle={() => {}} onRetry={() => {}} {...extra} />,
    );

  it("has no webhook copy/paste controls", () => {
    const html = reports(state({}));
    expect(html).not.toContain("Authorization header");
    expect(html).not.toContain("Webhook URL");
  });

  it("shows the waiting state with an on switch", () => {
    const html = reports(state({}));
    expect(html).toContain("Waiting for your next workout");
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("whether or not you turn on notifications");
  });

  it("shows the working state with relative last-received time and the delivered report link", () => {
    const html = reports(state({
      status: "working", last_received_at: "2026-11-19T10:00:00Z",
      last_report: { status: "delivered", at: "2026-11-19T10:01:00Z", conversation_id: "11111111-1111-4111-8111-111111111111" },
    }));
    expect(html).toContain("Last workout received 2 hours ago");
    expect(html).toContain("Last report delivered");
    expect(html).toContain('href="/?chat=11111111-1111-4111-8111-111111111111"');
  });

  it("shows the off state and never claims delivery for pending or failed reports", () => {
    const off = reports(state({ enabled: false, status: "off" }));
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain("Off. No new reports");
    const pending = reports(state({ status: "working", last_received_at: "2026-11-19T11:59:00Z",
      last_report: { status: "pending", at: "2026-11-19T11:59:30Z", conversation_id: null } }));
    expect(pending).toContain("being prepared");
    expect(pending).not.toContain("delivered");
    expect(pending).not.toContain("Open the report");
    const failed = reports(state({ status: "working", last_received_at: "2026-11-19T11:59:00Z",
      last_report: { status: "failed", at: "2026-11-19T11:59:30Z", conversation_id: "11111111-1111-4111-8111-111111111111" } }));
    expect(failed).toContain("could not be created");
    expect(failed).not.toContain("Open the report");
  });

  it("says status is unavailable (and keeps a retry) when the reports fetch fails, instead of hiding silently", () => {
    const html = reports(null, { unavailable: true });
    expect(html).toContain("Report status is unavailable");
    expect(html).toContain("Check again");
    expect(html).not.toContain('role="switch"');
  });

  it("shows save errors in an alert and a reconnect note", () => {
    const html = reports(state({}), { error: "Could not save that change.", reconnectRequired: true });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Reports pause until you reconnect");
  });
});

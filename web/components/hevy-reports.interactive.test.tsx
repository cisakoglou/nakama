// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HevyReports } from "./hevy-reports";

const state = (enabled: boolean) => ({
  enabled, status: enabled ? "waiting" : "off", last_received_at: null, last_report: null,
});
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** A fake server holding the real preference; `onPut` decides what the client sees. */
function fakeServer(initial: boolean, onPut: "ok" | "commit-then-fail" | "fail-without-commit", getFails: () => boolean = () => false) {
  let enabled = initial;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(method);
    if (method === "PUT") {
      const wanted = (JSON.parse(String(init?.body)) as { enabled: boolean }).enabled;
      if (onPut === "fail-without-commit") return json({ error: "boom" }, 500);
      enabled = wanted;
      return onPut === "ok" ? json(state(enabled)) : json({ error: "unavailable" }, 503);
    }
    if (getFails()) throw new TypeError("network down");
    return json(state(enabled));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, get enabled() { return enabled; } };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const toggle = () => screen.findByRole("switch");

describe("report toggle save (interactive)", () => {
  it("success path: the switch follows the saved value", async () => {
    const server = fakeServer(true, "ok");
    render(<HevyReports reconnectRequired={false} />);
    const user = userEvent.setup();
    expect((await toggle()).getAttribute("aria-checked")).toBe("true");
    await user.click(await toggle());
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(server.enabled).toBe(false);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("committed write with a failed response: re-fetches and shows the server's new value", async () => {
    const server = fakeServer(true, "commit-then-fail");
    render(<HevyReports reconnectRequired={false} />);
    const user = userEvent.setup();
    await user.click(await toggle());
    await waitFor(() => expect(server.calls).toEqual(["GET", "PUT", "GET"]));
    // Server turned it off even though the PUT failed: the UI must show Off, not the stale On.
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect(screen.queryByText(/unchanged/i)).toBeNull();
    expect(screen.queryByText(/couldn.t confirm/i)).toBeNull();
  });

  it("uncommitted failure: says unchanged only because the re-fetch proves it", async () => {
    const server = fakeServer(true, "fail-without-commit");
    render(<HevyReports reconnectRequired={false} />);
    const user = userEvent.setup();
    await user.click(await toggle());
    expect(await screen.findByText(/unchanged/i)).toBeTruthy();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
    expect(server.calls).toEqual(["GET", "PUT", "GET"]);
  });

  it("failed save AND failed re-fetch: explicit unconfirmed state, switch disabled until Check again confirms", async () => {
    let failGets = false;
    const server = fakeServer(true, "commit-then-fail", () => failGets);
    render(<HevyReports reconnectRequired={false} />);
    const user = userEvent.setup();
    await toggle();
    failGets = true;
    await user.click(screen.getByRole("switch"));
    expect(await screen.findByText("We couldn't confirm whether your change was saved.")).toBeTruthy();
    expect(screen.queryByText(/unchanged/i)).toBeNull();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);

    failGets = false;
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false"));
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/couldn.t confirm/i)).toBeNull();
    expect(server.enabled).toBe(false);
  });

  it("stays unconfirmed when Check again also fails", async () => {
    let failGets = false;
    fakeServer(true, "fail-without-commit", () => failGets);
    render(<HevyReports reconnectRequired={false} />);
    const user = userEvent.setup();
    await toggle();
    failGets = true;
    await user.click(screen.getByRole("switch"));
    await screen.findByText(/couldn.t confirm/i);
    await user.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Check again" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText(/couldn.t confirm/i)).toBeTruthy();
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });
});


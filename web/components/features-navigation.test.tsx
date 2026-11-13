import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignInForm } from "./sign-in-form";
import { ChatPanel } from "./chat-panel";

const mocks = vi.hoisted(() => ({ client: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.client }));
vi.mock("@/components/conversation-chat", () => ({ ConversationChat: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockImplementation(() => { throw new Error("Feature navigation must not require a signed-in session."); });
  mocks.fetch.mockImplementation(() => { throw new Error("Feature navigation must render without private API data."); });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("public feature discoverability", () => {
  it.each([undefined, "Your sign-in link expired."])("renders the public Features link without account or connection data (%#)", (message) => {
    const html = renderToStaticMarkup(<SignInForm message={message} onRefresh={() => {}} />);
    expect(html).toMatch(/<a\b[^>]*href="\/features"[^>]*>See what Nakama can do<\/a>/);
    expect(html).toContain("Invited email address");
    expect(html).toContain("Hevy Pro API key");
    expect(mocks.client).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps Features available in the account menu without navigating away from an active training space", () => {
    const html = renderToStaticMarkup(<ChatPanel
      onSettings={() => {}} onSignOut={() => {}} signingOut={true} accountError={null}
      userId="00000000-0000-4000-8000-000000000001"
    />);
    const menu = html.match(/<details class="account-menu">[\s\S]*?<\/details>/)?.[0];
    expect(menu).toBeDefined();
    const link = menu?.match(/<a\b[^>]*href="\/features"[^>]*>[\s\S]*?<\/a>/)?.[0];
    expect(link).toContain('target="_blank"');
    expect(link).toContain('rel="noopener noreferrer"');
    expect(link).toContain("Features");
    expect(link).toContain("opens in a new tab");
    expect(link).not.toContain("disabled");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatSearchTitle } from "./chat-search-title";

it("highlights every case-insensitive literal title match without interpreting markup", () => {
  const html = renderToStaticMarkup(<ChatSearchTitle title={'<Session> + session.*'} query="session" />);
  expect(html).toBe("&lt;<mark>Session</mark>&gt; + <mark>session</mark>.*");
  expect(renderToStaticMarkup(<ChatSearchTitle title="Plan.*next" query=".*" />)).toBe("Plan<mark>.*</mark>next");
  expect(renderToStaticMarkup(<ChatSearchTitle title="İ session" query="SESSION" />)).toBe("İ <mark>session</mark>");
});

it("preserves unmatched titles and an empty query", () => {
  for (const query of ["", "nothing"]) {
    expect(renderToStaticMarkup(<ChatSearchTitle title="Plan my next session" query={query} />)).toBe("Plan my next session");
  }
});

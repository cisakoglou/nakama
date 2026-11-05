import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CoachingText } from "./coaching-text";
it("formats coaching headings and emphasis", () => {
 const html = renderToStaticMarkup(<CoachingText text={'## Your progress\n\n**Stronger** this week.\n\n1. Keep going'} />);
 expect(html).toContain('<h2>Your progress</h2>');
 expect(html).toContain('<strong>Stronger</strong>');
 expect(html).toContain('<ol>');
});
it("does not execute HTML or load remote images from responses", () => {
 const html = renderToStaticMarkup(<CoachingText text={'<script>alert(1)</script>\n\n![image](https://example.com/track)\n\n[unsafe](javascript:alert)'} />);
 expect(html).not.toContain('<script');
 expect(html).not.toContain('<img');
 expect(html).not.toContain('javascript:');
});

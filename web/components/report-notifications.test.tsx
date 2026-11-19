import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportNotifications } from "./report-notifications";

describe("device notifications", () => {
  it("is a separate optional block that says reports exist without notifications", () => {
    const html = renderToStaticMarkup(<ReportNotifications />);
    expect(html).toContain("Notify me when a report is ready");
    expect(html).toContain("Optional.");
    expect(html).toContain("whether or not you turn this on");
  });
});

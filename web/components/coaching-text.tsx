import React from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ReportChart } from "@/components/report-chart";
import { ReportGuide } from "@/components/report-guide";

type Element = NonNullable<ExtraProps["node"]>;
type ElementContent = Element["children"][number];

const CHART_LANGUAGE = "language-nakama-chart";
const CHART_FENCE = /^ {0,3}(`{3,}|~{3,})\s*nakama-chart\s*$/m;

function textOf(nodes: ElementContent[]): string {
  return nodes.map((n) => n.type === "text" ? n.value : n.type === "element" ? textOf(n.children) : "").join("");
}

// A fenced ```nakama-chart block arrives as <pre><code class="language-nakama-chart">…</code></pre>.
function chartSource(pre: Element | undefined): string | null {
  const code = pre?.children.find((c): c is Element => c.type === "element");
  if (!code || code.tagName !== "code") return null;
  const className = code.properties?.className;
  const classes = Array.isArray(className) ? className.map(String) : className == null ? [] : String(className).split(" ");
  return classes.includes(CHART_LANGUAGE) ? textOf(code.children) : null;
}

// Only used for assistant messages (see conversation-chat.tsx); chart data is zod-validated and inert.
export function CoachingText({ text }: { text: string }) {
  return <div className="coaching-text"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Never load model-supplied remote images into a private conversation.
    img: ({ alt }) => <span>{alt}</span>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
    pre: ({ node, children }) => {
      const source = chartSource(node);
      return source === null ? <pre>{children}</pre> : <ReportChart text={source} />;
    },
  }}>{text}</Markdown>{CHART_FENCE.test(text) && <ReportGuide />}</div>;
}

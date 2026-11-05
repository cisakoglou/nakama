import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function CoachingText({ text }: { text: string }) {
  return <div className="coaching-text"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    // Never load model-supplied remote images into a private conversation.
    img: ({ alt }) => <span>{alt}</span>,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
}

import type { ReactNode } from "react";

const paths = {
  chat: <path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5Z" />,
  pencil: <path d="m16 3 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-5-3L4 16l-1 5Z" />,
  trash: <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v6M14 10v6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m7 10 5 5 5-5" />,
  dots: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
  settings: <><path d="m9 3-.8 2.2-2.3.5L4 8l1 2-1 2 1.9 2.3 2.3.5L9 17h3l.8-2.2 2.3-.5L17 12l-1-2 1-2-1.9-2.3-2.3-.5L12 3Z" transform="translate(1 2)" /><circle cx="11.5" cy="12" r="2.5" /></>,
  features: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4" />,
  logout: <path d="M10 4H4v16h6M10 12h11m-4-4 4 4-4 4" />,
} satisfies Record<string, ReactNode>;

export function ChatIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="chat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

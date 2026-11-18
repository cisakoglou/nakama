export function ChatSearchTitle({ title, query }: { title: string; query: string }) {
  if (!query) return title;
  const parts = [];
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  let start = 0;
  for (const match of title.matchAll(pattern)) {
    parts.push(title.slice(start, match.index), <mark key={match.index}>{match[0]}</mark>);
    start = match.index + match[0].length;
  }
  parts.push(title.slice(start));
  return parts;
}

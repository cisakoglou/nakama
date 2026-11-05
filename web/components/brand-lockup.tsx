export function BrandMark({ className = "" }: { className?: string }) {
  return <span className={`brand-glyph ${className}`} aria-hidden="true" />;
}

export function BrandLockup({ className = "" }: { className?: string }) {
  return <div className={`brand-lockup ${className}`} aria-label="Nakama">
    <BrandMark />
    <span>Nakama</span>
  </div>;
}

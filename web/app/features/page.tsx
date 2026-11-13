import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { AccessSteps, FeatureRow, FeatureSpotlight } from "@/components/features/feature-sections";
import { FEATURE_LIMITATIONS, FEATURES } from "@/lib/feature-catalog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Features · Nakama",
  description: "What Nakama can do today: post-workout reports, coaching grounded in your Hevy history, approved Hevy changes, saved chats, and private settings.",
};

export default function FeaturesPage() {
  const featured = FEATURES.find((feature) => feature.featured);
  const rest = FEATURES.filter((feature) => feature !== featured);
  return (
    <div className="fx-page">
      <a href="#main" className="fx-skip">Skip to content</a>
      <header className="fx-header">
        <Link href="/" aria-label="Nakama home"><BrandLockup /></Link>
        <nav aria-label="Primary">
          <Link href="/features" aria-current="page" className="fx-nav-current">Features</Link>
          <Link href="/" className="fx-cta fx-cta-small">Sign in</Link>
        </nav>
      </header>

      <main id="main">
        <section aria-labelledby="features-title" className="fx-hero fx-reveal">
          <div>
            <p className="eyebrow">Features</p>
            <h1 id="features-title">A training companion that knows <span>your workouts.</span></h1>
            <p className="fx-lead">
              Nakama reads your Hevy training history to coach you, reports on each new workout, and never changes
              your Hevy account without your approval. Here is everything that is live today.
            </p>
            <div className="fx-hero-actions">
              <Link href="/" className="fx-cta">Sign in with your invite</Link>
              {featured && <a href={`#${featured.id}`} className="fx-cta-ghost">See what&apos;s new</a>}
            </div>
            <p className="fx-note">Invite-only beta · Hevy Pro required · No pricing announced</p>
          </div>
          <div className="hero-orbit fx-hero-orbit" aria-hidden="true"><i /><i /><i /><span className="brand-glyph hero-companion-mark" /></div>
        </section>

        <nav aria-label="Features on this page" className="fx-index-nav fx-reveal">
          <ul>{FEATURES.map((feature) => <li key={feature.id}><a href={`#${feature.id}`}>{feature.title}</a></li>)}</ul>
        </nav>

        {featured && <FeatureSpotlight feature={featured} />}

        <section aria-labelledby="all-features-title" className="fx-list">
          <h2 id="all-features-title" className="fx-section-title">Also in Nakama</h2>
          {rest.map((feature, index) => <FeatureRow key={feature.id} feature={feature} index={index + 2} />)}
        </section>

        <AccessSteps />

        {FEATURE_LIMITATIONS.length > 0 && (
          <section aria-labelledby="limits-title" className="fx-limits fx-reveal">
            <p className="eyebrow">Honest limits</p>
            <h2 id="limits-title">Not available yet</h2>
            <ul>{FEATURE_LIMITATIONS.map((limit) => <li key={limit}>{limit}</li>)}</ul>
          </section>
        )}

        <section aria-labelledby="cta-title" className="fx-final fx-reveal">
          <h2 id="cta-title">Ready when you are.</h2>
          <p>Already invited? Sign in with the email on your invitation, then connect your Hevy Pro account.</p>
          <Link href="/" className="fx-cta">Sign in to Nakama</Link>
        </section>
      </main>

      <footer className="fx-footer">
        <span>Nakama · Your workouts. Your next step.</span>
        <Link href="/">Back to sign in</Link>
      </footer>
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { BrandLockup } from "@/components/brand-lockup";
import { AccessSteps, FeatureCard, FeatureRow, FeatureSpotlight, PrivacyAndReliability, WhyNakama } from "@/components/features/feature-sections";
import { FeatureIllustration } from "@/components/features/feature-illustrations";
import { FEATURE_LIMITATIONS, FEATURES } from "@/lib/feature-catalog";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Features · Nakama",
  description: "Turn your Hevy workouts into automatic progress reports, exercise charts and AI coaching grounded in your training history. Invite-only beta. Hevy Pro required.",
};

export default function FeaturesPage() {
  const featured = FEATURES.find((feature) => feature.featured);
  const coaching = FEATURES.find((feature) => feature.id === "grounded-coaching");
  const supporting = FEATURES.filter((feature) => feature !== featured && feature !== coaching);
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
            <p className="eyebrow">Nakama · AI strength companion</p>
            <h1 id="features-title">Every workout tells you something.<br /><span>Put it to work.</span></h1>
            <p className="fx-lead">
              Keep logging in Hevy. Get automatic workout reports that show what improved and what is worth watching.
              Then ask questions with AI coaching grounded in your training history and goals.
            </p>
            <div className="fx-hero-actions">
              <Link href="/" className="fx-cta">Sign in with your invite</Link>
              <a href="#sample-report" className="fx-cta-ghost">See a sample report</a>
            </div>
            <p className="fx-note">Invite-only beta · Hevy Pro required · One-time report setup</p>
            <p className="fx-trust">Your workouts stay in Hevy. You approve every Hevy change.</p>
          </div>
          <div id="sample-report"><FeatureIllustration kind="workout-report" /></div>
        </section>

        <nav aria-label="On this page" className="fx-index-nav fx-reveal">
          <ul>
            <li><a href="#post-workout-reports">Workout reports</a></li>
            <li><a href="#grounded-coaching">AI coaching</a></li>
            <li><a href="#why-nakama">Why Nakama?</a></li>
            <li><a href="#getting-started">Getting started</a></li>
          </ul>
        </nav>

        {featured && <FeatureSpotlight feature={featured} />}

        {coaching && <section aria-labelledby="coaching-section-title" className="fx-list">
          <h2 id="coaching-section-title" className="fx-section-title">When you want to go deeper</h2>
          <FeatureRow feature={coaching} index={2} />
        </section>}

        <WhyNakama />

        <section aria-labelledby="supporting-title" className="fx-supporting fx-reveal">
          <h2 id="supporting-title" className="fx-section-title">Made to fit your training</h2>
          <div className="fx-support-grid">{supporting.map((feature) => <FeatureCard key={feature.id} feature={feature} />)}</div>
        </section>

        <AccessSteps />

        <PrivacyAndReliability />

        {FEATURE_LIMITATIONS.length > 0 && (
          <section aria-labelledby="limits-title" className="fx-limits fx-reveal">
            <p className="eyebrow">Honest limits</p>
            <h2 id="limits-title">A little context before you start.</h2>
            <ul>{FEATURE_LIMITATIONS.map((limit) => <li key={limit}>{limit}</li>)}</ul>
          </section>
        )}

        <section aria-labelledby="cta-title" className="fx-final fx-reveal">
          <h2 id="cta-title">You do the work.<br />Bring the progress into focus.</h2>
          <p>Already invited? Connect Hevy, set up reports and find your next move with Nakama.</p>
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

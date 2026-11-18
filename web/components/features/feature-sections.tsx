import { FEATURE_RELIABILITY, FEATURE_REQUIREMENTS, type Feature } from "@/lib/feature-catalog";
import { FeatureIllustration } from "@/components/features/feature-illustrations";

function StatusBadge({ status }: { status: Feature["status"] }) {
  return <span className={`fx-badge fx-badge-${status}`}>{status === "new" ? "New" : "Available"}</span>;
}

export function FeatureSpotlight({ feature }: { feature: Feature }) {
  return (
    <article id={feature.id} aria-labelledby={`${feature.id}-title`} className="fx-spotlight fx-reveal">
      <div className="fx-spotlight-copy">
        <div className="fx-meta"><StatusBadge status={feature.status} /><span className="eyebrow">Automatic workout reports</span></div>
        <h2 id={`${feature.id}-title`}>{feature.title}</h2>
        <p className="fx-lead">{feature.summary}</p>
      </div>
      <ul className="fx-details">{feature.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
    </article>
  );
}

export function FeatureRow({ feature, index }: { feature: Feature; index: number }) {
  return (
    <article id={feature.id} aria-labelledby={`${feature.id}-title`} className="fx-row fx-reveal">
      <div className="fx-row-copy">
        <div className="fx-meta">
          <span className="fx-index" aria-hidden="true">{String(index).padStart(2, "0")}</span>
          <StatusBadge status={feature.status} />
        </div>
        <h3 id={`${feature.id}-title`}>{feature.title}</h3>
        <p className="fx-summary">{feature.summary}</p>
        <ul className="fx-details">{feature.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
      </div>
      <FeatureIllustration kind={feature.illustration} />
    </article>
  );
}

export function AccessSteps() {
  const steps = [
    { title: "Join the beta", description: "Already invited? Sign in with the email on your invitation and save your training preferences." },
    { title: "Connect Hevy", description: "Add your Hevy Pro API key. Follow the setup in Nakama to switch on automatic workout reports." },
    { title: "Keep training", description: "Log your workouts in Hevy as usual. Come back to your reports, ask questions and plan your next session." },
  ];
  return (
    <section id="getting-started" aria-labelledby="access-title" className="fx-access fx-reveal">
      <p className="eyebrow">Getting started</p>
      <h2 id="access-title">Connect once. Keep showing up.</h2>
      <ol>
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="fx-step" aria-hidden="true">{index + 1}</span>
            <strong>{step.title}</strong>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function FeatureCard({ feature }: { feature: Feature }) {
  return <article id={feature.id} aria-labelledby={`${feature.id}-title`} className="fx-support-card">
    <h3 id={`${feature.id}-title`}>{feature.title}</h3>
    <p>{feature.summary}</p>
    <ul className="fx-details">{feature.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
  </article>;
}

export function WhyNakama() {
  const reasons = [
    { title: "No prompt needed for every report", text: "Once reports are set up, saving your workout in Hevy starts the analysis. You do not have to ask for it each time." },
    { title: "Less explaining. More context.", text: "Ask for coaching with your workout history and saved goals in view, instead of copying your training into a blank conversation." },
    { title: "Keep the tracker you already use", text: "Hevy stays where you log your workouts. Nakama helps you interpret them, and asks before making any Hevy changes." },
  ];
  return <section id="why-nakama" aria-labelledby="why-title" className="fx-why fx-reveal">
    <p className="eyebrow">Why Nakama?</p>
    <h2 id="why-title">Hevy tracks the work.<br />Nakama helps you make sense of it.</h2>
    <div className="fx-why-grid">{reasons.map((reason) => <div key={reason.title}>
      <h3>{reason.title}</h3><p>{reason.text}</p>
    </div>)}</div>
  </section>;
}

export function PrivacyAndReliability() {
  return <details className="fx-reliability">
    <summary>Privacy, setup &amp; reliability<span>The details, when you want them.</span></summary>
    <div className="fx-reliability-content">
      <section aria-labelledby="setup-details-title">
        <h3 id="setup-details-title">What setup involves</h3>
        <dl>{Object.entries(FEATURE_REQUIREMENTS).map(([key, requirement]) => <div key={key}>
          <dt>{requirement.label}</dt><dd>{requirement.description}</dd>
        </div>)}</dl>
      </section>
      {FEATURE_RELIABILITY.map((section) => <section key={section.title}>
        <h3>{section.title}</h3><ul>{section.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
      </section>)}
    </div>
  </details>;
}

import {
  FEATURE_REQUIREMENTS, type Feature, type FeatureRequirement,
} from "@/lib/feature-catalog";
import { FeatureIllustration } from "@/components/features/feature-illustrations";

export function RequirementChips({ requirements }: { requirements: readonly FeatureRequirement[] }) {
  if (!requirements.length) return null;
  return (
    <div className="fx-requirements">
      <p className="eyebrow">Requires</p>
      <ul>{requirements.map((key) => <li key={key}>{FEATURE_REQUIREMENTS[key].label}</li>)}</ul>
    </div>
  );
}

function StatusBadge({ status }: { status: Feature["status"] }) {
  return <span className={`fx-badge fx-badge-${status}`}>{status === "new" ? "New" : "Available"}</span>;
}

export function FeatureSpotlight({ feature }: { feature: Feature }) {
  return (
    <article id={feature.id} aria-labelledby={`${feature.id}-title`} className="fx-spotlight fx-reveal">
      <div className="fx-spotlight-copy">
        <div className="fx-meta"><StatusBadge status={feature.status} /><span className="eyebrow">Featured</span></div>
        <h2 id={`${feature.id}-title`}>{feature.title}</h2>
        <p className="fx-lead">{feature.summary}</p>
        <ul className="fx-details">{feature.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>
        <RequirementChips requirements={feature.requirements} />
      </div>
      <FeatureIllustration kind={feature.illustration} />
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
        <RequirementChips requirements={feature.requirements} />
      </div>
      <FeatureIllustration kind={feature.illustration} />
    </article>
  );
}

export function AccessSteps() {
  const steps = Object.entries(FEATURE_REQUIREMENTS) as [FeatureRequirement, { label: string; description: string }][];
  return (
    <section aria-labelledby="access-title" className="fx-access fx-reveal">
      <p className="eyebrow">Before you start</p>
      <h2 id="access-title">What you need</h2>
      <ol>
        {steps.map(([key, step], index) => (
          <li key={key}>
            <span className="fx-step" aria-hidden="true">{index + 1}</span>
            <strong>{step.label}</strong>
            <p>{step.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

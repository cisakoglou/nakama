import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-lockup";
import { ReportChart, type ChartBlock } from "@/components/report-chart";
import type { FeatureIllustration as IllustrationKind } from "@/lib/feature-catalog";

function ChatMessage({ children }: { children: ReactNode }) {
  return <div className="fx-message"><BrandMark className="fx-message-mark" />{children}</div>;
}

function WorkoutReport() {
  const chart: ChartBlock = {
    v: 1, title: "Bench Press", current_date: "2026-11-18",
    series: [{
      key: "max_weight", label: "Max weight", unit: "kg",
      points: [
        { date: "2026-10-28", value: 57.5 }, { date: "2026-11-04", value: 60 },
        { date: "2026-11-11", value: 60 }, { date: "2026-11-18", value: 62.5 },
      ],
    }],
  };
  return (
    <div className="fx-window fx-report-example">
      <div className="fx-window-bar"><span>Push Day · Example report</span><BrandMark className="fx-message-mark" /></div>
      <div>
        <p className="eyebrow">What went well</p>
        <p className="fx-report-title">Bench press moved up.</p>
        <p className="fx-muted">Three sets of eight, with more on the bar.</p>
        <dl className="fx-report-comparison">
          <div><dt>Previous session</dt><dd>60 <span>kg</span></dd></div>
          <div><dt>This session</dt><dd>62.5 <span>kg</span></dd></div>
        </dl>
        <ReportChart text={JSON.stringify(chart)} />
      </div>
      <div className="fx-report-watch">
        <p className="eyebrow">Worth watching</p>
        <p>Overhead press has stayed at the same load and reps for three sessions. A pattern to review, not a verdict.</p>
      </div>
    </div>
  );
}

function GroundedCoaching() {
  return (
    <div className="fx-window">
      <div className="fx-bubble">How should I progress squats this week?</div>
      <span className="fx-tool">✓ Read your recent Hevy workouts</span>
      <ChatMessage>
        <p>Your last three squat sessions were 3 × 5 at 100 kg with every set completed.</p>
        <p className="fx-muted">A small step, such as 102.5 kg for the same sets, keeps the pattern you have built.</p>
      </ChatMessage>
    </div>
  );
}

function WriteApproval() {
  return (
    <div className="fx-window">
      <div className="fx-approval">
        <p className="eyebrow">Your approval needed</p>
        <p className="fx-approval-title">Create routine: Upper A</p>
        <p className="fx-muted">This will change your Hevy account. Review the proposed change before approving.</p>
        <div className="fx-actions"><span className="fx-primary">Approve change</span><span className="fx-secondary">Decline</span></div>
      </div>
    </div>
  );
}

function SavedChats() {
  const chats = [["Workout report: Legs", "Today"], ["Deload week plan", "Yesterday"], ["Shoulder-friendly pressing", "Mon"]];
  return (
    <div className="fx-window">
      <div className="fx-window-bar"><span>Your chats</span><strong>New chat</strong></div>
      <ul className="fx-chat-list">
        {chats.map(([title, when], index) => (
          <li key={title} className={index === 0 ? "fx-active" : undefined}><span>{title}</span><span className="fx-muted">{when}</span></li>
        ))}
      </ul>
      <div className="fx-actions"><span className="fx-secondary">Rename chat</span><span className="fx-secondary">Delete chat</span></div>
    </div>
  );
}

function PrivateSettings() {
  const rows = [["Weight units", "kg"], ["Hevy", "Connected · key encrypted"], ["Workout reports", "Set up"]];
  return (
    <div className="fx-window">
      <dl className="fx-settings">
        {rows.map(([label, value]) => <div key={label}><dt className="fx-muted">{label}</dt><dd>{value}</dd></div>)}
      </dl>
      <div className="fx-actions"><span className="fx-secondary">Edit preferences</span><span className="fx-secondary">Disconnect Hevy</span></div>
    </div>
  );
}

function Fallback() {
  return <div className="fx-window fx-fallback"><div className="hero-orbit"><i /><i /><i /><BrandMark className="hero-companion-mark" /></div></div>;
}

const ILLUSTRATIONS: Record<IllustrationKind, () => ReactNode> = {
  "workout-report": WorkoutReport,
  "grounded-coaching": GroundedCoaching,
  "write-approval": WriteApproval,
  "saved-chats": SavedChats,
  "private-settings": PrivateSettings,
};

export function FeatureIllustration({ kind }: { kind?: IllustrationKind }) {
  const Illustration = kind ? ILLUSTRATIONS[kind] : Fallback;
  return (
    <figure className="fx-figure">
      <div aria-hidden={kind === "workout-report" ? undefined : true}><Illustration /></div>
      {kind && <figcaption>Illustration with sample data</figcaption>}
    </figure>
  );
}

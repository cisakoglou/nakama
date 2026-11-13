import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-lockup";
import type { FeatureIllustration as IllustrationKind } from "@/lib/feature-catalog";

function ChatMessage({ children }: { children: ReactNode }) {
  return <div className="fx-message"><BrandMark className="fx-message-mark" />{children}</div>;
}

function WorkoutReport() {
  return (
    <div className="fx-window">
      <div className="fx-window-bar"><span>Chats</span><strong>Workout report: Push Day</strong></div>
      <ChatMessage>
        <p className="fx-report-title">Push Day</p>
        <p className="fx-muted">Compared with your recent sessions of the same exercises.</p>
        <p className="fx-heading">What went well</p>
        <ul><li><b className="fx-up">▲</b> Bench Press: 3 × 8 at 62.5 kg, up from 60 kg</li></ul>
        <p className="fx-heading">Notable observations</p>
        <ul><li><b className="fx-flat">●</b> Overhead Press: same load and reps for three sessions</li></ul>
        <p className="fx-heading">Comparison limits</p>
        <ul><li className="fx-muted">Only matching exercises and set layouts are compared.</li></ul>
      </ChatMessage>
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
      <div aria-hidden="true"><Illustration /></div>
      {kind && <figcaption>Illustration with sample data</figcaption>}
    </figure>
  );
}

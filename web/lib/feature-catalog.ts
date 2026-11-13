export type FeatureRequirement = "invite" | "hevy-pro" | "hevy-connection" | "webhook-setup";
export type FeatureIllustration =
  | "workout-report" | "grounded-coaching" | "write-approval" | "saved-chats" | "private-settings";

export type Feature = {
  id: string;
  title: string;
  summary: string;
  details: readonly string[];
  status: "new" | "available";
  requirements: readonly FeatureRequirement[];
  illustration?: FeatureIllustration;
  featured?: true;
};

export const FEATURE_REQUIREMENTS: Record<FeatureRequirement, { label: string; description: string }> = {
  invite: {
    label: "Nakama invitation",
    description: "Nakama is an invite-only beta. Sign in with your invited email; your Nakama account is separate from your Hevy login.",
  },
  "hevy-pro": {
    label: "Hevy Pro",
    description: "Hevy-powered features require a Hevy Pro subscription and your own API key from Hevy developer settings.",
  },
  "hevy-connection": {
    label: "Connected Hevy account",
    description: "Connect your own Hevy API key in Nakama settings and save your training preferences to open your training space.",
  },
  "webhook-setup": {
    label: "Workout reports setup",
    description: "Set up reports in Nakama, then copy its webhook URL and authorization header into Webhooks in Hevy developer settings.",
  },
};

export const FEATURES: readonly Feature[] = [
  {
    id: "post-workout-reports",
    title: "Your workout, put in perspective",
    summary: "Save a workout in Hevy. With reports set up, Nakama adds a grounded look at what changed to your saved chats.",
    details: [
      "A Hevy webhook triggers a report delivered as an in-app chat, not a separate notification channel.",
      "Compares recorded exercise metrics with recent comparable sets, rather than unrelated workout totals.",
      "Distinguishes a one-session change from a repeated trend and explains missing or unsupported data.",
      "One report per workout: duplicate saves do not create extra report chats.",
    ],
    status: "new",
    requirements: ["invite", "hevy-pro", "hevy-connection", "webhook-setup"],
    illustration: "workout-report",
    featured: true,
  },
  {
    id: "grounded-coaching",
    title: "Coaching with your training in view",
    summary: "Ask about progress, your next session or a new routine, with guidance informed by your Hevy history and saved preferences.",
    details: [
      "Nakama can read your Hevy workouts through connected tools when you ask for coaching.",
      "Your goal, experience, schedule, equipment and preferred weight units provide training context.",
      "Ask for next-session targets or routine ideas; coaching is guidance, not a promise of results.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "grounded-coaching",
  },
  {
    id: "write-approval",
    title: "Your approval. Your next move.",
    summary: "Review a proposed Hevy change before it runs. Reading your training history does not require the same write approval.",
    details: [
      "Creating or changing Hevy records requires an explicit approval in chat.",
      "You can approve or decline a proposed change before the connected tool executes.",
      "Interrupted actions and failed writes are not blindly retried; check Hevy before repeating an uncertain change.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "write-approval",
  },
  {
    id: "saved-chats",
    title: "Pick up where you left off",
    summary: "Keep coaching conversations and workout reports in your account, with saved drafts and a history you can return to.",
    details: [
      "Open saved conversation text from your chat history across visits.",
      "Drafts save to your account, with browser recovery when available.",
      "Start, rename or delete chats from your training space.",
      "Old tool results and approvals are not replayed when a conversation is restored.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "saved-chats",
  },
  {
    id: "private-settings",
    title: "A training space of your own",
    summary: "Save preferences to your Nakama account and manage your own Hevy connection without sharing a Hevy password.",
    details: [
      "Set your goal, experience, training days, equipment and kg or lb display preference.",
      "Your saved Hevy API key is encrypted on the server and is not included in the coaching prompt.",
      "Disconnect removes the key from Nakama, not your Hevy workouts; revoke the key in Hevy to disable it elsewhere.",
      "Turn reports off in Nakama; remove the webhook in Hevy to stop Hevy sending events.",
    ],
    status: "available",
    requirements: ["invite"],
    illustration: "private-settings",
  },
];

export const FEATURE_LIMITATIONS: readonly string[] = [
  "Everyone can browse this page. Using Nakama still requires an invitation; Hevy-powered features also require Hevy Pro and a connected API key.",
  "Automatic workout reports appear in saved chats, not push or email notifications, and require webhook setup.",
  "Reports and coaching reflect available training data. They are not medical assessments or guarantees of progress.",
];

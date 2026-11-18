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
    title: "Know what changed after every workout",
    summary: "Finish a workout in Hevy. After a one-time report setup, get a clear look at what improved and which patterns are worth watching.",
    details: [
      "See progress and repeated dips against recent sessions of the same exercises.",
      "Follow exercise charts for volume, maximum weight or total reps, when enough history is available.",
      "Revisit each report in your saved chats, with optional browser notifications on supported devices.",
    ],
    status: "new",
    requirements: ["invite", "hevy-pro", "hevy-connection", "webhook-setup"],
    illustration: "workout-report",
    featured: true,
  },
  {
    id: "grounded-coaching",
    title: "Get coaching based on your actual training",
    summary: "Wondering what to aim for next? Ask questions with an AI companion that can use your Hevy history and saved training preferences.",
    details: [
      "Explore a plateau, talk through your progress or plan your next session.",
      "Your goals, experience, schedule and equipment give the conversation context.",
      "Get suggestions grounded in your recorded workouts, rather than retyping your history into a blank chat.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "grounded-coaching",
  },
  {
    id: "write-approval",
    title: "Improve your routine. Stay in control.",
    summary: "Turn a conversation into a new or updated Hevy routine. You review and approve the proposed change before it runs.",
    details: [
      "Build a routine around your goals and the equipment you have.",
      "Approve or decline Hevy changes in chat. Nothing is changed without your go-ahead.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "write-approval",
  },
  {
    id: "saved-chats",
    title: "Your training conversations, in one place",
    summary: "Your workout reports, coaching chats and saved drafts stay together, ready when you want to pick things up again.",
    details: [
      "Search saved chat names to find an earlier report or conversation.",
      "Rename or delete a chat straight from the list, without opening it.",
      "Return to your saved conversations and drafts across visits.",
    ],
    status: "available",
    requirements: ["invite", "hevy-pro", "hevy-connection"],
    illustration: "saved-chats",
  },
  {
    id: "private-settings",
    title: "Built around your goals and preferences",
    summary: "Set your training context once, so you do not have to explain your goals and setup at the start of every coaching chat.",
    details: [
      "Save your goals, experience, training days, equipment and preferred weight units.",
      "Manage your own Hevy connection without sharing your Hevy password.",
    ],
    status: "available",
    requirements: ["invite"],
    illustration: "private-settings",
  },
];

export const FEATURE_LIMITATIONS: readonly string[] = [
  "Everyone can browse this page. Nakama is an invite-only beta; Hevy-powered features require Hevy Pro and your own connected API key.",
  "Automatic reports need a one-time Hevy webhook setup and enough recorded history for meaningful comparisons. They are not instant or guaranteed for every exercise.",
  "Browser notifications are optional and require device support and permission. On iPhone, install Nakama on your Home Screen first. Report emails are not available.",
  "Reports and coaching reflect available training data. They are not medical assessments or guarantees of progress.",
];

export const FEATURE_RELIABILITY = [
  {
    title: "Your data and AI coaching",
    details: [
      "Your chats and preferences are private to your Nakama account. AI coaching sends your conversation and relevant training context to Anthropic.",
      "Your saved Hevy API key is encrypted on the server and is not included in the coaching prompt. Nakama does not ask for your Hevy password.",
    ],
  },
  {
    title: "How automatic reports work",
    details: [
      "Reports compare recorded exercise metrics and recent history in your preferred weight units. Your saved goals inform AI coaching, not the automatic report calculations.",
      "A report is saved as an in-app chat after Hevy sends a workout event. Duplicate events do not create extra report chats, and missing data can limit comparisons.",
      "Charts show supported metrics for each exercise when enough history is available. The examples on this page use illustrative data, not a real account.",
    ],
  },
  {
    title: "You stay in control",
    details: [
      "Reading your workouts does not need write approval. Creating or updating Hevy records requires your explicit approval in chat.",
      "Restoring a chat does not replay old tool actions. If a change is interrupted, check Hevy before repeating it.",
      "Disconnecting removes the saved key from Nakama, not your Hevy workouts. Revoke the key in Hevy to disable it elsewhere.",
      "Turn reports off in Nakama and remove the webhook in Hevy to stop workout events being sent.",
    ],
  },
] as const;

# Nakama

<p align="center">
  <img src="img/nakama-wordmark-readme.png" alt="Nakama wordmark" width="480">
</p>

**Your training companion, grounded in your workouts.**

Nakama is an AI fitness coach for people who track strength training in Hevy
and want help deciding what to do next. Powered by Claude, it connects to your
workout history to discuss progress, suggest next-session targets, and create
or update routines through conversation.

[Open Nakama](https://nakama-production-60d5.up.railway.app/) ·
[Project board](https://github.com/users/cisakoglou/projects/1) ·
[Track work](https://github.com/cisakoglou/nakama/issues)

## Why "Nakama"?

Nakama is a Japanese word meaning a companion, fellow member, or someone in
your group. It conveys belonging and working toward something together.

For this product, it represents a training companion: something in your corner
that helps you make sense of your workouts and take the next step. The goal is
not another place to log sets, but a useful conversation about the training
you already do.

## What you can do

- Ask about progress using your recorded workouts and exercise history.
- Get specific next-session targets informed by your previous performance.
- Create or update Hevy routines without manually looking up exercise IDs.
- Personalize coaching with your goals and preferences in `TRAINER.md`.

For example:

> "How has my squat progressed over my last few sessions?"
>
> "What should I aim for on bench press next time?"
>
> "Create a three-day routine focused on strength and hypertrophy."

## Product direction

Nakama is currently a **single-user prototype**, not a multi-user service.
It uses one configured Hevy account and a shared app password; there is no
individual account signup or separation between users' data.

The direction is a mobile-first training companion that turns workout data into
clear, actionable guidance. The first product milestones are stronger API
authentication, a better mobile chat experience, and home-screen installation.
These are planned improvements, not features available today; follow the
[project board](https://github.com/users/cisakoglou/projects/1) for progress.

## Run locally

You need Node.js with npm, an Anthropic API key, and a Hevy API key.

```sh
cd web
npm install
cp .env.local.example .env.local
```

Set these values in `web/.env.local`:

| Variable | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API access; usage is billed separately from Claude subscriptions. |
| `HEVY_API_KEY` | Access to your Hevy workout data and tools. |
| `APP_PASSWORD` | Password for the chat API. Set a strong, non-empty value. |

```sh
npm run dev
```

Open <http://localhost:3002>. The web app always uses Claude Haiku 4.5
(`claude-haiku-4-5-20251001`); it does not route requests between models.

Run the API regression tests from `web` with `npm test`. The tests mock Hevy
and AI streaming; they do not send provider requests or require API keys.

## Configuration and deployment

- Edit `TRAINER.md` to customize your training profile and coaching preferences.
  Restart or redeploy the app after changing it.
- Railway builds and runs the `web` app using `railway.json`. Configure the same
  three environment variables in the Railway service.
- **`APP_PASSWORD` is required.** If missing or empty, the chat API returns
  HTTP 503 without reading the chat request or calling Hevy or Anthropic.
  Missing or incorrect request credentials return HTTP 401. A valid password
  preserves normal chat streaming.
- Never commit API keys or local environment files.

## Hevy connection decision (2026-10-18)

**Continue development, but hold invitations to other users until the hosted
integration requirements are clarified and user isolation is implemented.**

The [official API documentation](https://api.hevyapp.com/docs/) currently limits
access to **Hevy Pro** users. Users obtain their own API key from
[Hevy developer settings](https://hevy.com/settings?developer); documented
requests authenticate with an `api-key` header. Do not ask for a Hevy password
or present a one-click OAuth flow that is not documented as supported.

The public API specification does not document an OAuth flow or a numeric
request-rate limit. Its pagination limits are not a rate-limit allowance.
It also warns that the API may change or be discontinued.

Before committing to hosted onboarding, resolve these items in
[issue #10](https://github.com/cisakoglou/nakama/issues/10):

- Confirm with Hevy whether hosted multi-user use, storing user-provided keys,
  and eventual commercial use are permitted, and whether a partner/OAuth
  connection option exists. Public API access alone does not establish this.
- Confirm rate limits and expected retry behavior. The official documentation
  lists `pavel@hevyapp.com` for API questions; no outreach has been sent.
- Test key creation and connection on a real phone with an eligible user.
  This authenticated mobile walkthrough has not yet been performed.

The provisional beta flow is guided, one-time API-key entry for invited Hevy
Pro users, subject to those checks. State this requirement before signup and
do not promise a frictionless connection until it has been tested.

## Phone access

Open Nakama in Safari on iPhone or Chrome on Android and choose **Add to Home
Screen** from the browser's share menu or main menu. Chat requires internet.
Installable PWA support and mobile layout improvements are tracked in
[issue #2](https://github.com/cisakoglou/nakama/issues/2) and
[issue #3](https://github.com/cisakoglou/nakama/issues/3).

## Branding

<img src="web/app/apple-icon.png" alt="Nakama chain icon" width="96" height="96">

Original artwork lives in `img/`. The sign-in screen uses the Nakama wordmark,
and the chat uses the chain mark; optimized versions are in `web/public/brand/`.
Browser and Apple home-screen icons live in `web/app/icon.png` and
`web/app/apple-icon.png`. The UI uses warm ivory, charcoal, and gold, with theme
colors defined in `web/tailwind.config.ts`.

## Code

- `web/app/page.tsx`: chat interface.
- `web/app/api/chat/route.ts`: authentication, Claude requests, and tool execution.
- `web/lib/mcp.ts`: connection to the Hevy MCP server.
- `web/lib/system-prompt.ts`: coaching instructions and loading `TRAINER.md`.
- `src/`: alternative command-line clients.

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

## Current status

**This version supports invite-only, per-user coaching.** Users sign in with
Google or an email link, save their own training preferences, and connect
their own Hevy Pro API key. Sign-in methods require provider configuration.
Each coaching request uses only that account's preferences and Hevy connection,
with no fallback to the owner's credentials or `TRAINER.md`.

The isolated preview target is
<https://nakama-preview-preview.up.railway.app>. The live Railway app above
still runs the previous single-user version; deploying the preview must not
replace it. Real hosted sign-in and coaching must be verified before inviting
testers. Google and external email delivery still need configuration.

## Coaching capabilities

- Ask about progress using your recorded workouts and exercise history.
- Get specific next-session targets informed by your previous performance.
- Create or update Hevy routines without manually looking up exercise IDs.
- Personalize coaching with your private, saved training preferences.
- Approve or decline proposed Hevy changes before they execute.

For example:

> "How has my squat progressed over my last few sessions?"
>
> "What should I aim for on bench press next time?"
>
> "Create a three-day routine focused on strength and hypertrophy."

## Product direction

The direction is a mobile-first training companion that turns workout data into
clear, actionable guidance. The next steps are hosted end-to-end validation,
per-user usage controls, a privacy/deletion process, and a small invited beta.
The preview is not a ready-to-announce product; follow the
[project board](https://github.com/users/cisakoglou/projects/1) for progress.

## Run locally

You need **Node.js 22.x**, npm, and a Supabase project configured as below.

```sh
cd web
npm install
cp .env.local.example .env.local
```

Set these values in `web/.env.local`:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The project's `sb_publishable_...` key. Never use a secret/service-role key. |
| `APP_ORIGIN` | Public app origin, e.g. `https://nakama-preview-preview.up.railway.app`; required behind Railway's proxy for origin checks and sign-in redirects. |
| `SUPABASE_SECRET_KEY` | Server-only Supabase secret key for encrypted credential storage. |
| `HEVY_CREDENTIAL_ENCRYPTION_KEY` | Server-only base64-encoded 32 random bytes; keep stable across deployments. |
| `ANTHROPIC_API_KEY` | Server-only Claude provider key. |

Generate the encryption key once with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Store it securely; rotating or losing it makes existing saved Hevy keys
unreadable and requires users to reconnect. Never prefix server secrets with
`NEXT_PUBLIC_`. Users enter their own Hevy keys in the authenticated app, not
in environment variables.

```sh
npm run dev
```

Open <http://localhost:3002>. Missing configuration produces an explicit
unavailable state rather than allowing unauthenticated access.

Run `npm test` and `npm run build` from `web`. Tests cover session and invitation
gates, profile validation, cookies, sign-in callbacks, encrypted credentials,
two-user coaching isolation, tool approvals, cancellation, and actual PostgreSQL
row-level-security policies using an isolated in-memory PGlite database.
They do not contact Supabase, Hevy, or Anthropic.

## Supabase setup

1. In the project's SQL Editor, run
   [`supabase/migrations/202610180001_invite_only_profiles.sql`](supabase/migrations/202610180001_invite_only_profiles.sql)
   once. This creates invitations, the signup hook, and private profiles.
   Then run
   [`supabase/migrations/202610180002_hevy_connections.sql`](supabase/migrations/202610180002_hevy_connections.sql)
   once to create server-only encrypted credential storage and an
   invitation-aware connection-status function.
2. Add each approved email through the SQL Editor, replacing the example:

   ```sql
   insert into public.beta_invitations (email)
   values (lower(trim('invited-person@example.com')));
   ```

3. In Authentication > Hooks, enable **Before User Created**, selecting the
   Postgres function `public.hook_enforce_beta_invite`. Creating the function
   does **not** enable it. Allow new user signups: the hook, not a blanket
   signup prohibition, admits first-time invited users.
4. Configure Authentication URL settings for the deployed preview: Site URL
   `https://nakama-preview-preview.up.railway.app`, with allowed redirect
   `https://nakama-preview-preview.up.railway.app/auth/callback`.
   For developer-only local testing, also allow
   `http://localhost:3002/auth/callback`. Avoid wildcard production redirects.
5. For email sign-in links, enable the Email provider and keep Supabase's
   default email templates containing `{{ .ConfirmationURL }}`. No template
   editing is needed. The browser requests a PKCE-protected link returning to
   `/auth/callback`; open it in the same browser and on the same device that
   requested it. Use `localhost` consistently for local testing rather than
   switching between it and `127.0.0.1`.
   Supabase's default sender only sends to project-team addresses and currently
   permits two emails per hour, so it is suitable only for the owner's test.
   Configure custom SMTP before emailing external beta users. New Free projects
   using the default sender cannot edit templates; custom SMTP unlocks editing
   without upgrading Supabase
   ([policy](https://github.com/orgs/supabase/discussions/46599)).
6. For Google, create a Google Cloud OAuth web client and configure the Google
   provider in Supabase. Use the callback URL shown in Supabase
   (`https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`) as the Google
   authorized redirect URI. Put the Google client secret only in Supabase,
   never in `NEXT_PUBLIC_` variables. Add beta testers to the Google consent
   screen's test users if the OAuth app is in Testing.
7. Configure all app variables, deploy the preview, then test invited sign-in,
   first setup, save/reload, Hevy connection, read-only coaching, disconnect,
   sign-out, and rejection of an uninvited account against the real project.
   Do not perform real Hevy writes without explicit user approval.

Google/email sign-in creates a **Nakama** account, not a Hevy connection.
Both methods must use an invited email, which does not have to match the
user's Hevy email. Sharing the website URL is not an invitation: the owner
must first allowlist the user's chosen Nakama sign-in email. No automated
invitation email is required. The server checks verified identity
and the invitation on every private API request; database policies also check
invitation status and ownership. Removing an invitation blocks future access
even for an already-created account. Only the owner administers invitations;
the browser cannot list or change them.

### Data saved in this version

Supabase Auth stores account identity and sessions. `public.profiles` stores
goal, experience, training days, equipment, weight units, and timestamps,
linked to the authenticated user ID. The owner also maintains the invitation
email list. `public.hevy_connections` stores each user's API key encrypted with
AES-256-GCM, bound to that user's ID. Only the server's Supabase role can read
or change that table; browsers receive connection metadata, never saved keys.
This version saves no chat history, workout copies, or Hevy passwords.

Coaching sends the conversation, preferences, and requested workout context
to Anthropic. The Hevy key is passed only to Hevy for validation and to a
request-isolated local `hevy-mcp` process for Hevy API calls, not to the model
prompt or a hosted MCP service. The MCP package is pinned to `6.2.1` and its
default-on third-party telemetry is explicitly disabled.

Disconnect deletes the saved credential and invalidates active coaching;
it does not delete workouts or revoke the API key at Hevy. Users must revoke
or rotate keys in Hevy developer settings to invalidate them elsewhere.
Database backups can retain older encrypted rows according to the project's
backup retention; deletion of the current row is not immediate backup erasure.

There is no self-service account deletion or automatic retention policy yet.
The owner can remove an account through Supabase Auth; its profile is deleted
along with its saved Hevy connection by database foreign keys. Remove its invitation separately if it should
not be able to sign up again. Define the beta privacy notice, contact, and
deletion process before bringing in testers. The old `TRAINER.md` and CLI
remain in the repository but are not used by the account web flow.

## Deployment

Both package manifests require Node 22. The existing production service uses
`railway.json`. New Railway services no longer honor that legacy format.
Upload only `web` as the preview's source root so Railway detects Next.js
and runs its build/start scripts rather than the root command-line app.
The preview domain targets port 3002, matching `web`'s start script.
Configure the public Supabase variables **before building**:
Next.js embeds `NEXT_PUBLIC_` values in the browser bundle, so changing them
requires a rebuild. Configure the three server secrets from the table above
only in the preview service, and set `APP_ORIGIN` to its exact public HTTPS
origin. Do not derive this trusted origin from incoming forwarded-host headers.
Retain installed `node_modules` relative to the app's working directory: the
app launches the pinned MCP CLI from that directory at runtime.

Use a separate preview before replacing the live coaching prototype. The
database migrations, active signup hook, provider configuration, and real
sign-in/profile/Hevy round trip must be verified before rollout. Production
dependency audits currently report no advisories; build/development
dependencies still have advisories, including Tailwind 3's dependency chain.
The legacy `APP_PASSWORD` and `HEVY_API_KEY` variables are not used and must
not be copied to the preview. Never commit credentials or local environment
files, or upload unrelated untracked files in deployment archives.

## Hevy connection decision (2026-10-18)

**Continue development, but hold invitations to other users until the hosted
integration requirements are clarified and hosted user isolation is verified.**

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
  lists `pavel@hevyapp.com` for API questions. An inquiry was sent on
  2026-10-18; a response is pending.
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

Original artwork lives in `img/`. The account screens use the Nakama wordmark;
optimized wordmark and chain-mark versions are in `web/public/brand/`.
Browser and Apple home-screen icons live in `web/app/icon.png` and
`web/app/apple-icon.png`. The UI uses warm ivory, charcoal, and gold, with theme
colors defined in `web/tailwind.config.ts`.

## Code

- `web/app/page.tsx`: sign-in, onboarding, settings, connection, and coaching routing.
- `web/components/`: sign-in, preferences, Hevy connection, and streamed chat UI.
- `web/lib/auth.ts`: verified-session and current-invitation gate.
- `web/app/api/account/route.ts`: load the current user's profile and connection metadata.
- `web/app/api/profile/route.ts`: validate and save their preferences.
- `web/app/auth/callback/route.ts`: Google and email-link PKCE callback.
- `supabase/migrations/`: invitation hook, private profiles, and credential storage.
- `web/app/api/hevy/route.ts`: validate, replace, or disconnect the user's key.
- `web/lib/hevy-connection.ts`: server-only encryption and owner-scoped storage.
- `web/lib/user-mcp.ts`: isolated local MCP process with telemetry disabled.
- `web/app/api/chat/route.ts`: authenticated private coaching and write approvals.
- `web/lib/mcp.ts`, `web/lib/system-prompt.ts`, `src/`: legacy Hevy integration,
  coaching instructions, and alternative command-line clients.

# Nakama

<p align="center">
  <img src="web/app/icon.png" alt="Nakama chain logo" width="160" height="160">
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

## Current status (2026-11-05)

**This version supports invite-only, per-user coaching.** Users sign in with
Google or an email link, save their own training preferences, and connect
their own Hevy Pro API key. Sign-in methods require provider configuration.
Each coaching request uses only that account's preferences and Hevy connection,
with no fallback to the owner's credentials or `TRAINER.md`.
Conversations and drafts are saved privately to each account. The Chats picker
can reopen, rename, or delete earlier conversations across devices.

The account-based release, saved history, and refreshed UI are merged into
`main`, replacing the shared-password prototype. Authentication
([#1](https://github.com/cisakoglou/nakama/issues/1)), mobile layout
([#3](https://github.com/cisakoglou/nakama/issues/3)), and invite-only account
implementation ([#9](https://github.com/cisakoglou/nakama/issues/9)) are complete.
Hosted and real-phone acceptance checks remain in
[#12](https://github.com/cisakoglou/nakama/issues/12); implementation completion
does not mean the external beta is ready.

Production is <https://nakama-production-60d5.up.railway.app>; preview is
<https://nakama-preview-preview.up.railway.app>. **Both environments share the
same Supabase project**, including accounts, invitations, preferences, Hevy
connections, and chats. Preview is not an isolated test-data sandbox.

The owner has verified invited-email sign-in, preferences, Hevy connection,
and read-only coaching on preview. Anonymous chat requests returned `401` on
both hosts on 2026-11-05. Google is enabled in Supabase, but signed-in production,
saved-history, two-account, and real-phone walkthroughs still need completion.
External email delivery requires custom SMTP. The prototype's browser-local
chat is not automatically imported into account history.

## Coaching capabilities

- Ask about progress using your recorded workouts and exercise history.
- Get specific next-session targets informed by your previous performance.
- Create or update Hevy routines without manually looking up exercise IDs.
- Personalize coaching with your private, saved training preferences.
- Approve or decline proposed Hevy changes before they execute.
- Reopen, rename, or delete saved chats and recover account-saved drafts.
- Read formatted coaching responses with collapsible tool activity and
  interrupted-response recovery that does not automatically replay actions.

For example:

> "How has my squat progressed over my last few sessions?"
>
> "What should I aim for on bench press next time?"
>
> "Create a three-day routine focused on strength and hypertrophy."

## Product direction

The direction is a mobile-first training companion that turns workout data into
clear, actionable guidance. The next milestone is a small, owner-approved
invite-only beta, not a public launch.

| Remaining work | Tracking |
| --- | --- |
| Verify production sign-in, saved chats, two-account isolation, and real-phone behavior; configure external email delivery. | [#12](https://github.com/cisakoglou/nakama/issues/12) |
| Resolve current dependency advisories or document a reviewed exception before external beta invitations. | [#11](https://github.com/cisakoglou/nakama/issues/11) |
| Obtain Hevy clarification on hosted use, encrypted key storage, commercial use, rate limits, and partner/OAuth options; test phone onboarding and finalize the beta decision. | [#10](https://github.com/cisakoglou/nakama/issues/10) |
| Add durable per-user quotas, provider usage/cost accounting, and an owner-controlled stop mechanism. | [#7](https://github.com/cisakoglou/nakama/issues/7) |
| Finish confirmed account-data deletion, privacy/retention information, and backup/restore procedures; validate hosted connection and isolation behavior. | [#5](https://github.com/cisakoglou/nakama/issues/5), [#6](https://github.com/cisakoglou/nakama/issues/6), [#8](https://github.com/cisakoglou/nakama/issues/8) |
| Run an observed three-user cohort and record friction, usefulness, and return visits after the release gates pass. | [#8](https://github.com/cisakoglou/nakama/issues/8) |
| Add a PWA manifest and install icons, then verify standalone launch; optional for the first cohort. | [#2](https://github.com/cisakoglou/nakama/issues/2) |

Existing Anthropic spending limits and request-level guardrails do not replace
application-level quotas or cross-instance usage accounting. Follow the
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
| `HEVY_OAUTH_CLIENT_ID` | Optional Hevy OAuth app ID; required for the OAuth backend routes. |
| `HEVY_OAUTH_CLIENT_SECRET` | Optional, server-only Hevy OAuth app secret. Never expose it to browsers. |
| `ANTHROPIC_API_KEY` | Server-only Claude provider key. |
| `VAPID_PUBLIC_KEY` | Optional. Web Push public key for "report ready" notifications (sent to browsers). |
| `VAPID_PRIVATE_KEY` | Optional, server-only. Web Push private key; keep stable across deployments. |
| `VAPID_SUBJECT` | Optional. Contact for push services: `mailto:you@example.com` or an `https://` URL. |

Generate the encryption key once with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`.
Store it securely; rotating or losing it makes existing saved Hevy keys
unreadable and requires users to reconnect. Generate the VAPID pair once with
`npx web-push generate-vapid-keys` (from `web`). If any VAPID variable is
missing, notifications are disabled: settings say they are unavailable and
reports are still delivered to chats. Rotating the pair silently invalidates
every saved device; users must turn notifications on again. Never prefix server
secrets with `NEXT_PUBLIC_`. Users enter their own Hevy keys in the authenticated app, not
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
They also cover owned conversations, optimistic concurrency, draft recovery,
stream checkpoints, and cancellation without replaying Hevy actions.
They do not contact Supabase, Hevy, or Anthropic.

## Supabase setup

1. In the project's SQL Editor, run
   [`supabase/migrations/202610180001_invite_only_profiles.sql`](supabase/migrations/202610180001_invite_only_profiles.sql)
   once. This creates invitations, the signup hook, and private profiles.
   Then run
   [`supabase/migrations/202610180002_hevy_connections.sql`](supabase/migrations/202610180002_hevy_connections.sql)
   once to create server-only encrypted credential storage and an
   invitation-aware connection-status function.
   Then run
   [`supabase/migrations/202611040001_chat_conversations.sql`](supabase/migrations/202611040001_chat_conversations.sql)
   once, before deploying chat history. It adds private conversations and
   account-deletion cascading without changing existing profiles or credentials.
   Then run
   [`supabase/migrations/202611130001_workout_reports.sql`](supabase/migrations/202611130001_workout_reports.sql)
   once, before enabling post-workout reports. It adds hashed per-connection
   webhook tokens, a server-only report job queue, and lets the server role
   insert report chats.
   Then run
   [`supabase/migrations/202611150001_push_subscriptions.sql`](supabase/migrations/202611150001_push_subscriptions.sql)
   once, before enabling report notifications. It adds server-only Web Push
   subscriptions, capped at the ten newest per account.
   Then run
   [`supabase/migrations/202611190001_hevy_oauth.sql`](supabase/migrations/202611190001_hevy_oauth.sql)
   before deploying the OAuth backend. It preserves API-key connections and adds
   server-only OAuth state, encrypted token storage and fenced refresh operations.
   Key save/disconnect operations also use the new RPCs after this release.
   Then run
   [`supabase/migrations/202611190002_hevy_request_budget.sql`](supabase/migrations/202611190002_hevy_request_budget.sql)
   before deploying the shared Hevy client. It adds cross-instance request pacing
   and version-fenced handling of rejected OAuth access tokens. Both new
   migrations must precede deployment of the combined OAuth backend.
   Then run
   [`supabase/migrations/202611190003_hevy_app_webhook.sql`](supabase/migrations/202611190003_hevy_app_webhook.sql)
   before deploying signed app webhooks and report controls (#22). It adds the
   server-only report preference/receipt table and the RPCs used by
   `/api/hevy/app-webhook`, `/api/hevy/reports` and the report worker. The worker
   calls its eligibility RPC, so it must precede that code deployment too.
2. Add each approved email through the SQL Editor, replacing the example:

   ```sql
   insert into public.beta_invitations (email)
   values (lower(trim('invited-person@example.com')));
   ```

3. In Authentication > Hooks, enable **Before User Created**, selecting the
   Postgres function `public.hook_enforce_beta_invite`. Creating the function
   does **not** enable it. Allow new user signups: the hook, not a blanket
   signup prohibition, admits first-time invited users.
4. Configure Authentication URL settings: Site URL
   `https://nakama-production-60d5.up.railway.app`, with allowed redirects
   `https://nakama-production-60d5.up.railway.app/auth/callback` and
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
   For history, create two chats, send read-only prompts, switch between them,
   reload, visit Settings and return, and reopen from another device. Verify
   the draft and continued context, rename a chat, and confirm deletion.
   Interrupt a response and reopen it: partial text should return with a
   warning, and no Hevy action should run automatically. Check two invited
   accounts cannot see or change each other's history.
   Repeat the hosted acceptance checks on production and record results in
   [#12](https://github.com/cisakoglou/nakama/issues/12). Preview and production
   share data: do not delete real account data or perform Hevy writes as
   incidental testing.

Google/email sign-in creates a **Nakama** account, not a Hevy connection.
Both methods must use an invited email, which does not have to match the
user's Hevy email. Sharing the website URL is not an invitation: the owner
must first allowlist the user's chosen Nakama sign-in email. No automated
invitation email is required. The server checks verified identity
and the invitation on every private API request; database policies also check
invitation status and ownership. Removing an invitation blocks future access
even for an already-created account. Only the owner administers invitations;
the browser cannot list or change them.

### Hevy OAuth backend (#24)

The backend foundation is separate from the existing key-based UI. Register
`https://nakama-production-60d5.up.railway.app/api/hevy/oauth/callback`
in Hevy, and `http://localhost:3002/api/hevy/oauth/callback` for local development.
The callback is derived from the trusted `APP_ORIGIN`; there is no user-controlled
return URL. Set the two server-only OAuth variables above. Do not use the
Supabase `/auth/callback` or personal `/api/hevy/webhook` endpoint.

Contract for the onboarding work in #20:

- Authenticated same-origin `POST /api/hevy/oauth/start` returns
  `{ "authorization_url": "https://hevy.com/oauth/authorize?..." }`.
  Navigate the current browser to that URL. An HttpOnly, SameSite=Lax,
  ten-minute browser-binding cookie is scoped to `/api/hevy/oauth`.
- `GET /api/hevy/oauth/callback` checks the same signed-in, invited user
  and atomically consumes hashed state bound to that browser. Success returns
  `303` to `/?hevy_oauth=connected`. Failures return `303` to
  `/?hevy_oauth=error&code=<code>`, where `code` is one of the enum values in
  the shared reports contract (`access_denied`, `invalid_state`, ...) or
  `unknown`; no provider text or tokens reach the URL. A callback without a
  Nakama session in that browser (401/403, e.g. an iPhone home-screen app and
  Safari keep separate sessions) redirects with `code=signed_out`; other
  sign-in check failures use `unknown`.
  The cookie is cleared and responses prevent caching/referrer leakage.
- Existing `GET /api/account` keeps the legacy connection shape. OAuth adds
  `method: "oauth"`, `state: "active" | "reconnect_required"`, `hevy_user_id`
  and `hevy_username`; no tokens are returned. `connected: true` means a saved
  connection exists, not necessarily that authorization is still active.
- Existing `DELETE /api/hevy` immediately deletes the local connection and all
  pending OAuth attempts, including attempts started before a connection exists.
  Provider-side revocation is not assumed to be available.

`loadHevyCredentials(userId)` is server-only and works without a browser session.
It returns a typed API key or a valid bearer token for the client integration in
#19. Expiring tokens are refreshed under a database lease; a separate token
version fences stale refresh responses without changing the logical connection
revision used by report jobs. Replacement/disconnect and a newer authorization
cannot be overwritten by an older callback/refresh.

Hevy refresh tokens are single-use. If the process crashes or a request fails
after a token might have been consumed, Nakama requires reconnection rather
than replaying it. An explicit rate-limit/client-auth rejection can be retried
later. If the token-pair database save fails, the attempt remains fenced; another
caller may use a successfully committed pair, but must not retry a possibly
spent token. OAuth storage and RPCs are unavailable to browser roles.

The shared client in #19 enables OAuth reads and coaching tools, including
processing already-queued report jobs. This does **not** enable the connection
UI (#20), signed app-webhook ingestion (#22), or API-key migration (#21). Existing API-key
connections remain unchanged and OAuth start returns `migration_required`
for them until that migration exists. OAuth reauthorization only accepts the
same provider account. Set the app-webhook URL only once #22 is deployed (see below).
Non-Pro eligibility, PKCE support, refresh-token lifetime and provider revocation
still need verification in #25; do not change subscription claims yet.

### Shared Hevy client and coaching tools (#19)

`web/lib/hevy-client.ts` reloads the job/chat owner's credentials before each
request, including after rate-limit waits. It sends `api-key` for existing
connections and `Authorization: Bearer` for OAuth, never an access token as an
API key. Token refresh uses the lifecycle above; a logical connection change
stops further requests. HTTP 401 marks only that exact current OAuth token
version reconnect-required; an older rejection cannot revoke a newer grant
or interrupt a refresh already in flight. Permission/account-limit denials
(403) are reported without deleting a usable connection.

The client serves coaching, workout-report workout/history reads and longer-range
chart requests. `web/lib/hevy-tools.ts` supplies the same twelve allowed tool
names locally, with the three writes still requiring per-action AI SDK approval.
The web app no longer starts a Hevy MCP subprocess. Canonical inputs use
snake_case, including `routine`, `exercise_template_id` and `rep_range`.
Exercise searches share a paginated catalog only within the current chat
request; custom exercises are not cached across accounts.

Offline contract tests compare the ten tools still exposed by the pinned
`hevy-mcp` package against an in-memory server, including request payloads and
results. The allowed count/template-list tools are implemented directly.
One intentional correction normalizes Hevy's documented single-element
`POST /workouts` response array into the workout result; the upstream adapter
loses the workout fields for that response shape.

The database reserves request starts 350 ms apart across all app processes
sharing this database, conservatively below Hevy's documented 1,000 requests
per five minutes per IP. Reservations more than five seconds ahead fail with
429 rather than building an unbounded queue; unavailable scheduling fails
closed. This budget covers shared-client calls, not other applications sharing
the outbound IP or one-off connection-validation requests. Reads retry a 429
at most twice, waiting one and two seconds and reserving each retry. Writes
are never automatically retried, including after 429, network failures or
unreadable responses; check Hevy before approving an uncertain write again.
Requests have a fifteen-second network timeout and respect chat cancellation.

Local contract/database tests do not establish live Hevy OAuth eligibility
or a successful hosted authorization round trip.

### Signed Hevy app webhooks and report controls (#22)

OAuth users need no per-user webhook setup. In the Hevy developer portal, set the
app's webhook URL to `$APP_ORIGIN/api/hevy/app-webhook` (production:
`https://nakama-production-60d5.up.railway.app/api/hevy/app-webhook`) only after
this code and migration `202611190003_hevy_app_webhook.sql` are deployed.

Per Hevy's documentation (developers.hevy.com, Authentication > App webhooks),
Hevy POSTs `{"type":"workout.created","workoutId":"<uuid>","userId":"<uuid>"}`
whenever a connected user (with `read-workout` or `modify-workout`) saves a new
workout. `userId` is the `user_id` from the token response, stored as
`hevy_connections.hevy_user_id`. `Hevy-Signature` is `sha256=` plus the hex
HMAC-SHA256 of the raw body keyed with the OAuth client secret. Hevy expects 200
within five seconds and retries anything else up to five times.

The route reads at most 4 KB within a three-second deadline, verifies the
signature over the exact bytes with a timing-safe comparison, and only then
parses JSON. Missing/invalid signatures return 401, oversized bodies 413 and
malformed signed payloads 400. Other signed event types are acknowledged and
ignored. The owner comes only from the signed `userId` mapped to an OAuth
connection, never from email or an unsigned field. One database transaction
records the receipt and, if the user is invited, authorized (`active`) and has
reports on, inserts the job into the existing `workout_reports` queue. The
`(user_id, workout_id)` key means a workout delivered through both this route
and the personal `/api/hevy/webhook` produces one job. The route returns 200
only after that commit; storage failure or timeout returns a retryable 503.
Signed events for unknown, uninvited, reconnect-required or opted-out users are
acknowledged (200) without a job, so Hevy does not retry them; logs record the
reason, the Nakama user id and an 8-character prefix of the Hevy user id, never
the signature, secret or body values. Reports are never generated in the route.

**Client-secret rotation.** Verification uses `HEVY_OAUTH_CLIENT_SECRET`, and
Hevy signs with the new secret immediately after a rotation. Until Railway's
variable is updated (and the service restarted), every delivery fails
verification with 401 and is retried by Hevy up to five times. Hevy documents
no later redelivery, so workouts whose retries run out get no report. Rotate during a
quiet period, update the Railway variable immediately, and check the logs for
`mismatch_signature`. The same secret authenticates token exchange and refresh,
so a stale value breaks connecting and token refresh too. Nakama does not accept an old and a new secret
at the same time.

**Report preference and status** (`REPORTS-CONTRACT.md`): authenticated
`GET /api/hevy/reports` returns `{ enabled, status: "off" | "waiting" |
"working", last_received_at, last_report }`; same-origin `PUT` with
`{ "enabled": boolean }` changes it and returns the new status from the same
database transaction (one RPC), so a 503 means nothing was saved and a repeat
`PUT` is harmless. Both answer 404 `{ code: "not_oauth" }`
without an OAuth connection. API-key users keep `/api/hevy/webhook-token`.
Reports default to on for a new OAuth connection. The preference is stored per
Nakama user and Hevy account, outside `hevy_connections`, so it survives a
disconnect/reconnect of the same Hevy account and is never touched by token
refresh; a different Hevy account starts enabled. `last_received_at` counts
only signed events for the current connection revision. `last_report` is the
newest job for that revision that was not skipped (turning reports off or a
connection change is not a failure, so those jobs are never shown); `pending`
covers queued and retrying jobs.
`delivered` is reported only after the chat is saved.

Turning reports off stops new jobs at once. The worker re-checks the
preference and the connection revision before any Hevy call and again just
before saving the chat, so already-queued jobs end as `skipped`
(`reports_off` or `connection_changed`) without a report or notification.

### Data saved in this version

Supabase Auth stores account identity and sessions. `public.profiles` stores
goal, experience, training days, equipment, weight units, and timestamps,
linked to the authenticated user ID. The owner also maintains the invitation
email list. `public.hevy_connections` stores each user's API key encrypted with
AES-256-GCM, bound to that user's ID. Only the server's Supabase role can read
or change that table; browsers receive connection metadata, never saved keys.
`public.chat_conversations` stores each account's conversation titles, text,
unsent drafts, activity timestamps, and stream/version metadata. Database
policies require both ownership and an active invitation for every operation.
It saves no raw tool results, executable tool/approval state, or Hevy passwords.
Workout information mentioned in a conversation is retained as chat text.
`public.hevy_webhook_tokens` stores a SHA-256 hash of each account's Hevy
webhook token (never the token itself). `public.workout_reports` stores each
received workout ID with its delivery status, attempt count, next retry time,
and a short failure code; only the server role can access them. Delivered post-workout reports are saved as chat text.

Each conversation holds at most 40 text messages, stored as a bounded JSON
transcript in its row. The picker loads history in pages of 20. The server
saves a submitted prompt before generation, checkpoints response text during
streaming, and finalizes on completion or cancellation. A crashed worker's
stream lease expires after 150 seconds; the next open marks it interrupted
without resuming it. The final uncheckpointed fragment can be lost on a crash.
Concurrent response attempts and stale draft saves are rejected rather than
overwriting another device's changes. Reopen a changed chat to load its latest
text; use the saved-draft action to resolve a draft conflict.

The browser remembers the selected chat and caches unsent drafts under keys
scoped to the account and conversation. Account draft autosaving runs after
500 ms of inactivity; a local recovery copy covers the interval before that
save. These local drafts are not encrypted, can remain after sign-out, and
are accessible to anyone using that browser profile. No passwords, provider
keys, or full conversation transcripts are placed in browser storage by this
account flow. Browser storage failures are displayed; account saving can
still work without browser storage. The production prototype's browser-local
chat is not automatically imported into an account.

Coaching sends the conversation, preferences, and requested workout context
to Anthropic. Hevy credentials are used only for server-side requests to Hevy,
not sent to the model prompt, a hosted MCP service or a subprocess.
The pinned `hevy-mcp` package is used for offline tool-contract comparisons,
not the account web app's request transport.

Disconnect deletes the saved credential and invalidates active coaching;
it does not delete workouts or revoke the API key at Hevy. Users must revoke
or rotate keys in Hevy developer settings to invalidate them elsewhere.
Database backups can retain older encrypted rows according to the project's
backup retention; deletion of the current row is not immediate backup erasure.

Chats are retained until their owner deletes them or their account is removed;
there is no automatic expiry. Chat deletion removes the active database row
and its draft on this browser, but not copies in backups or other devices'
local draft caches. Backup copies follow the project's backup retention.
There is no self-service account deletion yet.
The owner can remove an account through Supabase Auth; its profile is deleted
along with its saved Hevy connection and conversations by database foreign
keys. Remove its invitation separately if it should not be able to sign up
again. Define the beta privacy notice, contact, and
deletion process before bringing in testers. The old `TRAINER.md` and CLI
remain in the repository but are not used by the account web flow.

## Deployment

Both package manifests require Node 22. The existing production service uses
`railway.json`. New Railway services no longer honor that legacy format.
Upload only `web` as the preview's source root so Railway detects Next.js
and runs its build/start scripts rather than the root command-line app.
The preview domain targets port 3002, matching `web`'s start script.
Configure the public Supabase variables **before building** each environment:
Next.js embeds `NEXT_PUBLIC_` values in the browser bundle, so changing them
requires a rebuild. Configure the three server secrets from the table above
in each account-app service, and set `APP_ORIGIN` to its exact public HTTPS
origin. Do not derive this trusted origin from incoming forwarded-host headers.
When both services use the same database, preserve the same
`HEVY_CREDENTIAL_ENCRYPTION_KEY`; generating a new one breaks saved connections.
Apply the OAuth, shared-request-budget and app-webhook migrations, in order,
before deploying code that calls their RPCs. Do not treat preview as a separate database sandbox.

Validate changes on preview before promoting them to production. The
database migrations, active signup hook, provider configuration, and real
sign-in/profile/Hevy round trip must be verified before rollout.

**Dependency remediation remains a beta blocker.** On 2026-11-05,
`npm audit --omit=dev` reported 2 high and 6 moderate entries for `web`, and
3 high and 1 moderate for the root/legacy CLI dependency tree; neither reported
critical entries. These are dependency-audit signals, not verified
exploitability or proof of the deployed lockfile. Track applicable advisory
review, targeted upgrades, and any explicit exceptions in
[#11](https://github.com/cisakoglou/nakama/issues/11); do not use
`npm audit fix --force` as a substitute for reviewing major migrations.

The legacy `APP_PASSWORD` and `HEVY_API_KEY` variables are not used by the
account app; retain production's old values only if needed for rollback.
Never commit credentials or local environment files, or upload unrelated
untracked files in deployment archives.

## Hevy connection decision (2026-10-18)

This is the historical API-key decision. Hevy's new
[developer portal](https://developers.hevy.com/authentication) documents OAuth;
the backend foundation and remaining rollout boundaries are described above.

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
  2026-10-18; no response is recorded in the issue yet.
- Test key creation and connection on a real phone with an eligible user.
  This authenticated mobile walkthrough remains unverified.

The provisional beta flow is guided, one-time API-key entry for invited Hevy
Pro users, subject to those checks. State this requirement before signup and
do not promise a frictionless connection until it has been tested.

## Post-workout reports

After a new workout is logged in Hevy, Nakama adds a **Workout report** chat
to that account. It lists what went well and notable positive or negative
patterns against recent comparable workouts (same exercise and matching set
layout), with stated limitations. It makes no medical or injury claims.

**Trigger: Hevy webhook.** Hevy Pro's developer settings
(<https://hevy.com/settings?developer>) offer a webhook: a URL plus an
authorization header. When a new workout is saved, Hevy POSTs
`{"workoutId":"<uuid>"}` and expects HTTP 200 within five seconds. Hevy's
public API specification does not document this feature, its retry policy, or
the exact header name; Nakama expects the configured value in
`Authorization`. Whether Hevy retries a non-200 response is unknown.

Set it up per account:

1. Connect Hevy in Nakama settings, then choose **Set up workout reports**.
   Nakama shows the webhook URL (`$APP_ORIGIN/api/hevy/webhook`) and a complete
   authorization header `Bearer nkwh_...` **once**; it stores only a hash.
2. In Hevy developer settings, under Webhooks, paste the URL and the
   authorization header value, then save.
3. **Create a new authorization header** rotates it (the old one stops
   working immediately; update Hevy). **Turn off workout reports** revokes it.
   Replacing or disconnecting the Hevy key also invalidates it.

Settings show whether Hevy has reached Nakama through the current header:
`last_received_at` is the time of the newest queued workout for the current
Hevy connection since the header was created (`null` while still waiting).

The token identifies the account; the payload never selects the owner. The
webhook route verifies the token, accepts at most 4 KB of JSON with a UUID
`workoutId`, durably inserts a queued job, and only then returns 200. Database
work and body reading share a three-second deadline; a storage failure or
timeout returns 503 so nothing is acknowledged without being saved. The route
makes no Hevy calls.

A worker inside the long-running Next.js server (started from
`web/instrumentation.ts`) processes jobs: it is woken right after a new job is
saved and also re-checks the **database queue** every 30 seconds. That sweep
only picks up already-received jobs (retries, missed wake-ups, or jobs left by
a restart); it never polls Hevy for new workouts. For each job it loads that
account's current Hevy credentials, fetches the workout and full history for
up to twenty distinct exercises (three concurrent history reads), and saves
the report chat. Earlier sessions supply comparisons and all-time PR evidence;
the shared client refreshes OAuth tokens when needed without a browser session.

**Deployment prerequisite:** this requires a persistent Node.js server
(`next start`, as on the current Railway service) with Railway's App
Sleeping/serverless mode turned off. On serverless or sleeping hosts, queued
jobs stay saved but are not processed until the server is running again. No
separate worker service or external queue is provisioned.

Behavior:

- **No backfill:** only workouts Hevy sends after the webhook is set up are
  reported.
- **Duplicates:** each account/workout pair is queued once, so repeated
  webhook deliveries return 200 without a second report; concurrent workers
  claim jobs with `FOR UPDATE SKIP LOCKED`.
- **Failures:** Hevy, report, or delivery failures are recorded with a failure
  code and retried after 1, 5, 30, and 120 minutes (five attempts in total),
  then logged as exhausted. Jobs abandoned mid-run are reclaimed after ten
  minutes. Workouts no longer in Hevy, or jobs for a replaced or removed
  connection, are marked skipped.
- **Delivery:** reports appear in the in-app chat list. New report chats get a
  **New** badge and an "Open" banner (tracked per account in this browser's
  local storage); the list refreshes when the tab regains focus.
- **Notifications:** in Settings, **Notify me when a report is ready** turns on
  Web Push for that device (requires the VAPID variables above). After the job
  is marked delivered, the worker sends `{conversationId, title}` (the workout
  title only) to each saved device in the background; tapping the notification
  opens that report. Push failures never fail or retry the report. Each report
  notifies once: delivered jobs are never reclaimed, and a retry only happens
  if the earlier attempt stopped before it notified. Devices that the push
  service reports as gone (404/410), or that fail five times in a row, are
  removed. Signing out turns notifications off for that device (best effort,
  never blocks sign-out). **iPhone/iPad:** Web Push works only after **Add to Home Screen**
  and opening Nakama from that icon (iOS 16.4+).

## Phone access

Open Nakama in Safari on iPhone or Chrome on Android. The mobile layout
implementation is complete: dynamic viewport and safe-area handling,
keyboard-aware chat sizing, and accessible zoom are in place. Real-device
keyboard, scrolling, tap-target, overflow, and rotation checks remain in
[#12](https://github.com/cisakoglou/nakama/issues/12).

For a home-screen shortcut, choose **Add to Home Screen** from the browser's
share menu or main menu where available. Nakama ships a web app manifest
(standalone display) and a minimal service worker used only for notifications;
a full install-icon set and verified standalone launch are still tracked in
[#2](https://github.com/cisakoglou/nakama/issues/2). Chat requires internet;
offline chat is not supported.

## Branding

<img src="web/app/apple-icon.png" alt="Nakama chain icon" width="96" height="96">

The README and app icons use the current apricot chain mark on a dark espresso
background. Account screens pair the chain mark with the Nakama name. The UI
uses dark espresso surfaces, warm ivory text, apricot accents, and sage details,
with theme colors defined in `web/tailwind.config.ts` and `web/app/globals.css`.

Browser and Apple home-screen icons live in `web/app/icon.png` and
`web/app/apple-icon.png`. Original artwork and the earlier gold wordmark live
in `img/`; optimized source artwork remains in `web/public/brand/`.

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
- `web/lib/hevy-client.ts`, `web/lib/hevy-rate-limit.ts`: shared, owner-scoped OAuth/API-key transport and database-backed pacing.
- `web/lib/hevy-tools.ts`: local coaching tool schemas, result adapters and write approvals.
- `web/app/api/chat/route.ts`: authenticated private coaching and write approvals.
- `web/app/api/conversations/`: owner-scoped chat history, drafts, rename, and deletion.
- `web/lib/conversations.ts`, `web/lib/conversation-stream.ts`: versioned storage and response checkpoints.
- `web/app/api/hevy/webhook/route.ts`, `web/lib/hevy-webhook.ts`: token-authenticated Hevy webhook that durably queues workouts.
- `web/app/api/hevy/webhook-token/route.ts`, `web/components/workout-report-webhook.tsx`: webhook token setup, rotation, and revocation.
- `web/lib/workout-report-worker.ts`, `web/instrumentation.ts`: in-process queue worker with retries and report delivery.
- `web/lib/workout-report.ts`: deterministic comparison against recent comparable workouts and report rendering.
- `web/lib/mcp.ts`, `web/lib/system-prompt.ts`, `src/`: legacy Hevy integration,
  coaching instructions, and alternative command-line clients.

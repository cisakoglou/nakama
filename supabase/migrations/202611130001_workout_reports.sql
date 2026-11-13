begin;

grant execute on function public.valid_chat_messages(jsonb) to service_role;
grant select, insert on public.chat_conversations to service_role;
grant select on public.profiles to service_role;

-- One Hevy webhook credential per connection. Only its SHA-256 hash is stored;
-- disconnecting deletes it and replacing the Hevy key invalidates it (revision mismatch).
create table public.hevy_webhook_tokens (
  user_id uuid primary key references public.hevy_connections(user_id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  connection_revision uuid not null,
  created_at timestamptz not null default now()
);

alter table public.hevy_webhook_tokens enable row level security;
revoke all on public.hevy_webhook_tokens from public, anon, authenticated;
grant select, insert, update, delete on public.hevy_webhook_tokens to service_role;

-- Durable post-workout report queue; the primary key suppresses duplicate webhook deliveries.
create table public.workout_reports (
  user_id uuid not null references auth.users(id) on delete cascade,
  workout_id text not null check (length(workout_id) between 1 and 128),
  connection_revision uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'delivered', 'failed', 'skipped')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  conversation_id uuid not null default gen_random_uuid(),
  last_error text check (length(last_error) <= 200),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, workout_id)
);

create index workout_reports_pending on public.workout_reports (available_at)
  where status in ('queued', 'processing', 'failed');

alter table public.workout_reports enable row level security;
revoke all on public.workout_reports from public, anon, authenticated;
grant select, insert, update on public.workout_reports to service_role;

-- Resolves a webhook credential to its owner only while the same Hevy connection
-- is saved and the owner still holds a beta invitation.
create function public.hevy_webhook_owner(p_token_hash text)
returns table (user_id uuid, connection_revision uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select t.user_id, t.connection_revision
  from public.hevy_webhook_tokens t
  join public.hevy_connections c on c.user_id = t.user_id and c.revision = t.connection_revision
  join auth.users u on u.id = t.user_id
  join public.beta_invitations i on i.email = lower(u.email)
  where t.token_hash = p_token_hash;
$$;

revoke all on function public.hevy_webhook_owner(text) from public, anon, authenticated;
grant execute on function public.hevy_webhook_owner(text) to service_role;

-- Claims the next due job. Delivered/skipped jobs and exhausted failures are never reclaimed;
-- jobs abandoned by a crashed worker become claimable again after ten minutes.
create function public.claim_next_workout_report(p_max_attempts integer)
returns table (user_id uuid, workout_id text, connection_revision uuid, conversation_id uuid, attempts integer)
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.workout_reports r
  set status = 'processing', attempts = r.attempts + 1, claimed_at = now(), updated_at = now()
  from (
    select q.user_id, q.workout_id from public.workout_reports q
    where (q.status = 'queued' and q.available_at <= now())
      or (q.status = 'failed' and q.attempts < p_max_attempts and q.available_at <= now())
      or (q.status = 'processing' and q.claimed_at < now() - interval '10 minutes'
        and q.attempts < p_max_attempts)
    order by q.available_at
    limit 1
    for update skip locked
  ) next
  where r.user_id = next.user_id and r.workout_id = next.workout_id
  returning r.user_id, r.workout_id, r.connection_revision, r.conversation_id, r.attempts;
$$;

revoke all on function public.claim_next_workout_report(integer) from public, anon, authenticated;
grant execute on function public.claim_next_workout_report(integer) to service_role;

commit;

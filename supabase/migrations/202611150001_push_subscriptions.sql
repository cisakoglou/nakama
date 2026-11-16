begin;

-- Web Push subscriptions for "your workout report is ready" notifications.
-- Server-role only, like hevy_webhook_tokens: the endpoint is a bearer capability for
-- the push service, so browsers never read it back; the API validates and caps writes.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1024),
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth text not null check (length(auth) between 1 and 64),
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);

create index push_subscriptions_owner on public.push_subscriptions (user_id, created_at desc);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

-- Keeps only the ten newest subscriptions per account.
create function public.cap_push_subscriptions()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.push_subscriptions s
  where s.user_id = new.user_id
    and s.id not in (
      select k.id from public.push_subscriptions k
      where k.user_id = new.user_id
      order by k.created_at desc, k.id desc
      limit 10
    );
  return null;
end;
$$;

revoke all on function public.cap_push_subscriptions() from public, anon, authenticated;

create trigger push_subscriptions_cap
after insert or update of user_id, created_at on public.push_subscriptions
for each row execute function public.cap_push_subscriptions();

commit;

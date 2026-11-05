begin;

create function public.valid_chat_messages(messages jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(messages) = 'array' then
    jsonb_array_length(messages) <= 40
    and octet_length(messages::text) <= 262144
    and not exists (
      select 1 from jsonb_array_elements(messages) as entry
      where jsonb_typeof(entry) is distinct from 'object'
        or jsonb_typeof(entry->'id') is distinct from 'string'
        or length(entry->>'id') not between 1 and 128
        or entry->>'role' is null
        or entry->>'role' not in ('user', 'assistant')
        or jsonb_typeof(entry->'content') is distinct from 'string'
        or entry - array['id', 'role', 'content'] <> '{}'::jsonb
    )
  else false end;
$$;

revoke all on function public.valid_chat_messages(jsonb) from public, anon;
grant execute on function public.valid_chat_messages(jsonb) to authenticated;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat' check (length(btrim(title)) between 1 and 80),
  messages jsonb not null default '[]'::jsonb check (public.valid_chat_messages(messages)),
  draft text not null default '' check (length(draft) <= 8000),
  draft_version integer not null default 0 check (draft_version >= 0),
  revision integer not null default 0 check (revision >= 0),
  status text not null default 'ready' check (status in ('ready', 'streaming', 'interrupted')),
  run_id uuid,
  run_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'streaming' and run_id is not null and run_expires_at is not null)
    or (status <> 'streaming' and run_id is null and run_expires_at is null)
  )
);

create index chat_conversations_owner_activity
on public.chat_conversations (user_id, updated_at desc, id desc);

alter table public.chat_conversations enable row level security;
revoke all on public.chat_conversations from public, anon, authenticated;
grant select, insert, update, delete on public.chat_conversations to authenticated;

create policy "Invited users read their own chats"
on public.chat_conversations for select to authenticated
using ((select auth.uid()) = user_id and (select public.has_beta_access()));

create policy "Invited users create their own chats"
on public.chat_conversations for insert to authenticated
with check ((select auth.uid()) = user_id and (select public.has_beta_access()));

create policy "Invited users update their own chats"
on public.chat_conversations for update to authenticated
using ((select auth.uid()) = user_id and (select public.has_beta_access()))
with check ((select auth.uid()) = user_id and (select public.has_beta_access()));

create policy "Invited users delete their own chats"
on public.chat_conversations for delete to authenticated
using ((select auth.uid()) = user_id and (select public.has_beta_access()));

create trigger chat_conversations_updated_at
before update on public.chat_conversations
for each row execute function public.touch_profile_updated_at();

commit;

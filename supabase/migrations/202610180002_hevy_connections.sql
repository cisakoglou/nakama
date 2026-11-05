begin;

grant usage on schema public to service_role;

create table public.hevy_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_key text not null,
  revision uuid not null,
  updated_at timestamptz not null default now()
);

alter table public.hevy_connections enable row level security;
revoke all on public.hevy_connections from public, anon, authenticated;
grant select, insert, update, delete on public.hevy_connections to service_role;

create function public.hevy_connection_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'connected', true,
        'revision', revision,
        'connected_at', updated_at
      )
      from public.hevy_connections
      where user_id = (select auth.uid())
        and (select public.has_beta_access())
    ),
    jsonb_build_object('connected', false)
  );
$$;

revoke all on function public.hevy_connection_status() from public, anon;
grant execute on function public.hevy_connection_status() to authenticated;

commit;

begin;

grant usage on schema public to supabase_auth_admin;

create table public.beta_invitations (
  email text primary key check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now()
);

alter table public.beta_invitations enable row level security;
revoke all on public.beta_invitations from public, anon, authenticated;
grant select on public.beta_invitations to supabase_auth_admin;

create policy "Auth may check invitations"
on public.beta_invitations for select
to supabase_auth_admin using (true);

create function public.hook_enforce_beta_invite(event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.beta_invitations
    where email = lower(event->'user'->>'email')
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Nakama is invite-only. Please use your invited email address.'
    )
  );
end;
$$;

revoke all on function public.hook_enforce_beta_invite(jsonb) from public, anon, authenticated;
grant execute on function public.hook_enforce_beta_invite(jsonb) to supabase_auth_admin;

create function public.has_beta_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.beta_invitations
    where email = lower(auth.jwt()->>'email')
  );
$$;

revoke all on function public.has_beta_access() from public, anon;
grant execute on function public.has_beta_access() to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  goal text not null check (goal in ('strength', 'muscle', 'general-fitness')),
  experience text not null check (experience in ('beginner', 'intermediate', 'experienced')),
  training_days integer not null check (training_days between 1 and 7),
  equipment text not null check (equipment in ('gym', 'home', 'bodyweight')),
  units text not null check (units in ('kg', 'lb')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select, insert, update on public.profiles to authenticated;

create policy "Invited users read their own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id and (select public.has_beta_access()));

create policy "Invited users create their own profile"
on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id and (select public.has_beta_access()));

create policy "Invited users update their own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id and (select public.has_beta_access()))
with check ((select auth.uid()) = user_id and (select public.has_beta_access()));

create function public.touch_profile_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_profile_updated_at() from public, anon, authenticated;

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.touch_profile_updated_at();

commit;

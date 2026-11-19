begin;

-- Kept apart from hevy_connections so the preference survives a disconnect/reconnect of the same Hevy account.
create table public.hevy_report_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  hevy_user_id uuid not null,
  reports_enabled boolean not null default true,
  last_received_at timestamptz,
  last_received_revision uuid,
  updated_at timestamptz not null default now()
);
alter table public.hevy_report_settings enable row level security;
revoke all on public.hevy_report_settings from public, anon, authenticated;
grant select, insert, update on public.hevy_report_settings to service_role;

-- API-key connections have no preference (their personal webhook token is the switch); a new Hevy account starts enabled.
create function public.hevy_reports_enabled(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when c.credential_method = 'oauth' then coalesce(s.reports_enabled, true) else true end
    from public.hevy_connections c
    left join public.hevy_report_settings s on s.user_id = c.user_id and s.hevy_user_id = c.hevy_user_id
    where c.user_id = p_user_id
  ), true);
$$;

create function public.accept_hevy_app_webhook(p_hevy_user_id uuid, p_workout_id text, p_available_at timestamptz)
returns table (result text, user_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  connection public.hevy_connections;
  enabled boolean;
begin
  select * into connection from public.hevy_connections c
    where c.hevy_user_id = p_hevy_user_id and c.credential_method = 'oauth' for share;
  if not found then return query select 'unknown_user'::text, null::uuid; return; end if;
  if not exists (
    select 1 from auth.users u join public.beta_invitations i on i.email = lower(u.email) where u.id = connection.user_id
  ) then return query select 'not_eligible'::text, connection.user_id; return; end if;

  insert into public.hevy_report_settings as s (user_id, hevy_user_id, last_received_at, last_received_revision)
    values (connection.user_id, p_hevy_user_id, clock_timestamp(), connection.revision)
    on conflict (user_id) do update set
      reports_enabled = case when s.hevy_user_id = excluded.hevy_user_id then s.reports_enabled else true end,
      hevy_user_id = excluded.hevy_user_id,
      last_received_at = excluded.last_received_at, last_received_revision = excluded.last_received_revision
    returning s.reports_enabled into enabled;

  if connection.oauth_status <> 'active' then return query select 'reconnect_required'::text, connection.user_id; return; end if;
  if not enabled then return query select 'reports_off'::text, connection.user_id; return; end if;

  insert into public.workout_reports (user_id, workout_id, connection_revision, available_at)
    values (connection.user_id, p_workout_id, connection.revision, p_available_at)
    on conflict on constraint workout_reports_pkey do nothing;
  return query select (case when found then 'queued' else 'duplicate' end)::text, connection.user_id;
end;
$$;

-- Null when the user has no OAuth connection (the contract's not_oauth).
create function public.hevy_report_status(p_user_id uuid, p_max_attempts integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', enabled,
    'status', case when not enabled then 'off' when received_at is null then 'waiting' else 'working' end,
    'last_received_at', received_at,
    'last_report', (
      select jsonb_build_object(
        'status', case
          when r.status = 'delivered' then 'delivered'
          when r.status = 'skipped' or (r.status = 'failed' and r.attempts >= p_max_attempts) then 'failed'
          else 'pending' end,
        'at', r.updated_at,
        'conversation_id', case when r.status = 'delivered' then r.conversation_id end)
      from public.workout_reports r
      where r.user_id = p_user_id and r.connection_revision = current_connection.revision
      order by r.created_at desc limit 1)
  )
  from (
    select c.revision,
      coalesce(s.reports_enabled, true) as enabled,
      case when s.last_received_revision = c.revision then s.last_received_at end as received_at
    from public.hevy_connections c
    left join public.hevy_report_settings s on s.user_id = c.user_id and s.hevy_user_id = c.hevy_user_id
    where c.user_id = p_user_id and c.credential_method = 'oauth'
  ) current_connection;
$$;

create function public.set_hevy_reports_enabled(p_user_id uuid, p_enabled boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare connection public.hevy_connections;
begin
  select * into connection from public.hevy_connections where user_id = p_user_id and credential_method = 'oauth' for share;
  if not found then return false; end if;
  insert into public.hevy_report_settings as s (user_id, hevy_user_id, reports_enabled, updated_at)
    values (p_user_id, connection.hevy_user_id, p_enabled, clock_timestamp())
    on conflict (user_id) do update set
      reports_enabled = excluded.reports_enabled, updated_at = excluded.updated_at,
      last_received_at = case when s.hevy_user_id = excluded.hevy_user_id then s.last_received_at end,
      last_received_revision = case when s.hevy_user_id = excluded.hevy_user_id then s.last_received_revision end,
      hevy_user_id = excluded.hevy_user_id;
  return true;
end;
$$;

-- The worker's last check before delivering: same connection and reports still enabled.
create function public.workout_report_eligibility(p_user_id uuid, p_revision uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.hevy_connections where user_id = p_user_id and revision = p_revision)
      then 'connection_changed'
    when not public.hevy_reports_enabled(p_user_id) then 'reports_off'
    else 'eligible' end;
$$;

revoke all on function public.hevy_reports_enabled(uuid) from public, anon, authenticated;
revoke all on function public.accept_hevy_app_webhook(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.hevy_report_status(uuid, integer) from public, anon, authenticated;
revoke all on function public.set_hevy_reports_enabled(uuid, boolean) from public, anon, authenticated;
revoke all on function public.workout_report_eligibility(uuid, uuid) from public, anon, authenticated;
grant execute on function public.hevy_reports_enabled(uuid) to service_role;
grant execute on function public.accept_hevy_app_webhook(uuid, text, timestamptz) to service_role;
grant execute on function public.hevy_report_status(uuid, integer) to service_role;
grant execute on function public.set_hevy_reports_enabled(uuid, boolean) to service_role;
grant execute on function public.workout_report_eligibility(uuid, uuid) to service_role;

commit;

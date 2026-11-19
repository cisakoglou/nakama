begin;

alter table public.hevy_connections
  alter column encrypted_key drop not null,
  add column credential_method text not null default 'api_key'
    check (credential_method in ('api_key', 'oauth')),
  add column encrypted_oauth text,
  add column hevy_user_id uuid unique,
  add column hevy_username text,
  add column access_expires_at timestamptz,
  add column oauth_status text not null default 'active'
    check (oauth_status in ('active', 'reconnect_required')),
  add column token_version bigint not null default 0 check (token_version >= 0),
  add column refresh_attempt_id uuid,
  add column refresh_started_at timestamptz,
  add constraint hevy_credential_shape check (
    (credential_method = 'api_key' and encrypted_key is not null and encrypted_oauth is null
      and hevy_user_id is null and hevy_username is null and access_expires_at is null
      and refresh_attempt_id is null and refresh_started_at is null and oauth_status = 'active')
    or
    (credential_method = 'oauth' and encrypted_key is null and encrypted_oauth is not null
      and hevy_user_id is not null and hevy_username is not null
      and length(hevy_username) between 1 and 100 and access_expires_at is not null
      and ((refresh_attempt_id is null) = (refresh_started_at is null)))
  );

create table public.hevy_oauth_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state_hash text not null unique check (state_hash ~ '^[0-9a-f]{64}$'),
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  expected_revision uuid,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  consumed_at timestamptz
);
alter table public.hevy_oauth_states enable row level security;
revoke all on public.hevy_oauth_states from public, anon, authenticated;
grant select, insert, update, delete on public.hevy_oauth_states to service_role;

create function public.save_hevy_api_key(p_user_id uuid, p_encrypted_key text, p_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.hevy_connections;
begin
  perform 1 from auth.users where id = p_user_id for update;
  if exists (select 1 from public.hevy_connections where user_id = p_user_id and credential_method = 'oauth') then
    return null;
  end if;
  delete from public.hevy_oauth_states where user_id = p_user_id;
  insert into public.hevy_connections (user_id, encrypted_key, revision, updated_at)
    values (p_user_id, p_encrypted_key, p_revision, clock_timestamp())
    on conflict (user_id) do update set encrypted_key = excluded.encrypted_key,
      revision = excluded.revision, updated_at = excluded.updated_at
    returning * into saved;
  return jsonb_build_object('connected', true, 'revision', saved.revision, 'connected_at', saved.updated_at);
end;
$$;

create function public.disconnect_hevy(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users where id = p_user_id for update;
  delete from public.hevy_oauth_states where user_id = p_user_id;
  delete from public.hevy_connections where user_id = p_user_id;
end;
$$;

create function public.begin_hevy_oauth(p_user_id uuid, p_state_hash text, p_browser_hash text)
returns text language plpgsql security definer set search_path = '' as $$
declare connection public.hevy_connections;
begin
  perform 1 from auth.users where id = p_user_id for update;
  if not exists (
    select 1 from auth.users u join public.beta_invitations i on i.email = lower(u.email) where u.id = p_user_id
  ) then return 'not_eligible'; end if;
  select * into connection from public.hevy_connections where user_id = p_user_id for update;
  if connection.credential_method = 'api_key' then return 'migration_required'; end if;
  delete from public.hevy_oauth_states where user_id = p_user_id;
  insert into public.hevy_oauth_states (user_id, state_hash, browser_hash, expected_revision)
    values (p_user_id, p_state_hash, p_browser_hash, connection.revision);
  return 'started';
end;
$$;

create function public.consume_hevy_oauth_state(p_user_id uuid, p_state_hash text, p_browser_hash text)
returns boolean language sql security definer set search_path = '' as $$
  with consumed as (
    update public.hevy_oauth_states set consumed_at = clock_timestamp()
    where user_id = p_user_id and state_hash = p_state_hash and browser_hash = p_browser_hash
      and consumed_at is null and expires_at > clock_timestamp()
    returning user_id
  ) select exists (select 1 from consumed);
$$;

create function public.complete_hevy_oauth(
  p_user_id uuid, p_state_hash text, p_hevy_user_id uuid, p_username text,
  p_encrypted_oauth text, p_expires_at timestamptz
)
returns text language plpgsql security definer set search_path = '' as $$
declare
  attempt public.hevy_oauth_states;
  connection public.hevy_connections;
begin
  perform 1 from auth.users where id = p_user_id for update;
  select * into attempt from public.hevy_oauth_states where user_id = p_user_id and state_hash = p_state_hash for update;
  if not found or attempt.consumed_at is null or attempt.expires_at <= clock_timestamp() then return 'invalid_state'; end if;
  if not exists (
    select 1 from auth.users u join public.beta_invitations i on i.email = lower(u.email) where u.id = p_user_id
  ) then return 'not_eligible'; end if;
  select * into connection from public.hevy_connections where user_id = p_user_id for update;
  if connection.revision is distinct from attempt.expected_revision then return 'connection_changed'; end if;
  if connection.credential_method = 'api_key' then return 'migration_required'; end if;
  if connection.hevy_user_id is not null and connection.hevy_user_id <> p_hevy_user_id then return 'account_mismatch'; end if;
  if p_expires_at <= clock_timestamp() then return 'invalid_tokens'; end if;
  begin
    insert into public.hevy_connections (
      user_id, revision, credential_method, encrypted_oauth, hevy_user_id, hevy_username, access_expires_at
    ) values (
      p_user_id, gen_random_uuid(), 'oauth', p_encrypted_oauth, p_hevy_user_id, p_username, p_expires_at
    ) on conflict (user_id) do update set
      encrypted_oauth = excluded.encrypted_oauth, access_expires_at = excluded.access_expires_at,
      hevy_username = excluded.hevy_username, oauth_status = 'active', token_version = public.hevy_connections.token_version + 1,
      refresh_attempt_id = null, refresh_started_at = null, updated_at = clock_timestamp();
  exception when unique_violation then
    return 'account_in_use';
  end;
  delete from public.hevy_oauth_states where user_id = p_user_id;
  return 'saved';
end;
$$;

create function public.claim_hevy_oauth_refresh(
  p_user_id uuid, p_revision uuid, p_token_version bigint, p_attempt_id uuid
)
returns text language plpgsql security definer set search_path = '' as $$
declare connection public.hevy_connections;
begin
  select * into connection from public.hevy_connections where user_id = p_user_id for update;
  if not found or connection.credential_method <> 'oauth' or connection.revision <> p_revision then return 'connection_changed'; end if;
  if not exists (
    select 1 from auth.users u join public.beta_invitations i on i.email = lower(u.email) where u.id = p_user_id
  ) then return 'not_eligible'; end if;
  if connection.oauth_status <> 'active' then return 'reconnect_required'; end if;
  if connection.token_version <> p_token_version
    or connection.access_expires_at > clock_timestamp() + interval '60 seconds' then return 'updated'; end if;
  if connection.refresh_attempt_id is not null then
    if connection.refresh_started_at > clock_timestamp() - interval '60 seconds' then return 'busy'; end if;
    -- A crashed caller may have spent the single-use token. Never try that token again.
    update public.hevy_connections set oauth_status = 'reconnect_required' where user_id = p_user_id;
    return 'reconnect_required';
  end if;
  update public.hevy_connections set refresh_attempt_id = p_attempt_id, refresh_started_at = clock_timestamp()
    where user_id = p_user_id;
  return 'claimed';
end;
$$;

create function public.finish_hevy_oauth_refresh(
  p_user_id uuid, p_revision uuid, p_token_version bigint, p_attempt_id uuid,
  p_encrypted_oauth text, p_expires_at timestamptz
)
returns boolean language sql security definer set search_path = '' as $$
  with saved as (
    update public.hevy_connections set
      encrypted_oauth = p_encrypted_oauth, access_expires_at = p_expires_at,
      token_version = token_version + 1, refresh_attempt_id = null, refresh_started_at = null
    where user_id = p_user_id and credential_method = 'oauth' and revision = p_revision
      and token_version = p_token_version and refresh_attempt_id = p_attempt_id and oauth_status = 'active'
      and refresh_started_at > clock_timestamp() - interval '60 seconds' and p_expires_at > clock_timestamp()
      and exists (
        select 1 from auth.users u join public.beta_invitations i on i.email = lower(u.email) where u.id = p_user_id
      )
    returning user_id
  ) select exists (select 1 from saved);
$$;

create function public.fail_hevy_oauth_refresh(
  p_user_id uuid, p_revision uuid, p_token_version bigint, p_attempt_id uuid, p_retryable boolean
)
returns boolean language sql security definer set search_path = '' as $$
  with changed as (
    update public.hevy_connections set
      oauth_status = case when p_retryable then 'active' else 'reconnect_required' end,
      refresh_attempt_id = null, refresh_started_at = null
    where user_id = p_user_id and credential_method = 'oauth' and revision = p_revision
      and token_version = p_token_version and refresh_attempt_id = p_attempt_id and oauth_status = 'active'
    returning user_id
  ) select exists (select 1 from changed);
$$;

create or replace function public.hevy_connection_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object('connected', true, 'revision', revision, 'connected_at', updated_at)
      || case when credential_method = 'oauth' then jsonb_build_object(
        'method', 'oauth', 'state', oauth_status, 'hevy_user_id', hevy_user_id, 'hevy_username', hevy_username
      ) else '{}'::jsonb end
    from public.hevy_connections
    where user_id = (select auth.uid()) and (select public.has_beta_access())
  ), jsonb_build_object('connected', false));
$$;

revoke all on function public.save_hevy_api_key(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.disconnect_hevy(uuid) from public, anon, authenticated;
revoke all on function public.begin_hevy_oauth(uuid, text, text) from public, anon, authenticated;
revoke all on function public.consume_hevy_oauth_state(uuid, text, text) from public, anon, authenticated;
revoke all on function public.complete_hevy_oauth(uuid, text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_hevy_oauth_refresh(uuid, uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.finish_hevy_oauth_refresh(uuid, uuid, bigint, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_hevy_oauth_refresh(uuid, uuid, bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.save_hevy_api_key(uuid, text, uuid) to service_role;
grant execute on function public.disconnect_hevy(uuid) to service_role;
grant execute on function public.begin_hevy_oauth(uuid, text, text) to service_role;
grant execute on function public.consume_hevy_oauth_state(uuid, text, text) to service_role;
grant execute on function public.complete_hevy_oauth(uuid, text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.claim_hevy_oauth_refresh(uuid, uuid, bigint, uuid) to service_role;
grant execute on function public.finish_hevy_oauth_refresh(uuid, uuid, bigint, uuid, text, timestamptz) to service_role;
grant execute on function public.fail_hevy_oauth_refresh(uuid, uuid, bigint, uuid, boolean) to service_role;

commit;

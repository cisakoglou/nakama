begin;

create table public.hevy_request_budget (
  id boolean primary key default true check (id),
  next_at timestamptz not null default '-infinity'
);
insert into public.hevy_request_budget (id) values (true);
alter table public.hevy_request_budget enable row level security;
revoke all on public.hevy_request_budget from public, anon, authenticated;

create function public.reserve_hevy_request()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  reserved_at timestamptz;
  current_time_at timestamptz;
begin
  select next_at into reserved_at from public.hevy_request_budget where id for update;
  if not found then raise exception 'Hevy request budget missing'; end if;
  current_time_at := clock_timestamp();
  reserved_at := greatest(reserved_at, current_time_at);
  if reserved_at > current_time_at + interval '5 seconds' then return -1; end if;
  -- At most ~858 starts per five minutes across instances, leaving headroom below Hevy's 1,000/IP limit.
  update public.hevy_request_budget set next_at = reserved_at + interval '350 milliseconds' where id;
  return ceil(extract(epoch from reserved_at - current_time_at) * 1000)::integer;
end;
$$;

create function public.reject_hevy_oauth_token(p_user_id uuid, p_revision uuid, p_token_version bigint)
returns void language sql security definer set search_path = '' as $$
  update public.hevy_connections set oauth_status = 'reconnect_required'
  where user_id = p_user_id and credential_method = 'oauth' and revision = p_revision
    and token_version = p_token_version and refresh_attempt_id is null and oauth_status = 'active';
$$;

revoke all on function public.reserve_hevy_request() from public, anon, authenticated;
revoke all on function public.reject_hevy_oauth_token(uuid, uuid, bigint) from public, anon, authenticated;
grant execute on function public.reserve_hevy_request() to service_role;
grant execute on function public.reject_hevy_oauth_token(uuid, uuid, bigint) to service_role;

commit;

-- v16.5.3: serialize payment-attempt creation with request archival and atomically audit archive/restore.
create or replace function public.guard_payment_request_not_archived()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  archived timestamptz;
begin
  if new.request_id is not null then
    select archived_at into archived from public.paper_requests where id = new.request_id for update;
  elsif new.result_request_id is not null then
    select archived_at into archived from public.result_requests where id = new.result_request_id for update;
  elsif new.refer_request_id is not null then
    select archived_at into archived from public.refer_requests where id = new.refer_request_id for update;
  end if;
  if archived is not null then
    raise exception 'Archived requests cannot accept new payment attempts' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists payments_guard_request_not_archived on public.payments;
create trigger payments_guard_request_not_archived
before insert on public.payments
for each row execute function public.guard_payment_request_not_archived();

create or replace function public.set_request_archive_state(
  p_type text,
  p_id uuid,
  p_actor_id uuid,
  p_action text,
  p_reason text default ''
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role text;
  owner_id uuid;
  record_status text;
  previous_archive timestamptz;
  entity_name text;
begin
  if p_type not in ('paper', 'results', 'refer', 'payment') or p_action not in ('archive', 'restore') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_action');
  end if;
  select role into actor_role from public.profiles where id = p_actor_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'actor_not_found'); end if;

  if p_type = 'paper' then
    select user_id, status, archived_at into owner_id, record_status, previous_archive
    from public.paper_requests where id = p_id for update;
    entity_name := 'paper_request';
  elsif p_type = 'results' then
    select user_id, status, archived_at into owner_id, record_status, previous_archive
    from public.result_requests where id = p_id for update;
    entity_name := 'result_request';
  elsif p_type = 'refer' then
    select user_id, status, archived_at into owner_id, record_status, previous_archive
    from public.refer_requests where id = p_id for update;
    entity_name := 'refer_request';
  else
    select user_id, status, archived_at into owner_id, record_status, previous_archive
    from public.payments where id = p_id for update;
    entity_name := 'payment';
  end if;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if actor_role <> 'admin' and owner_id <> p_actor_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;

  if p_action = 'archive' then
    if p_type = 'payment' and record_status in ('initiated', 'pending') then
      return jsonb_build_object('ok', false, 'reason', 'pending_payment');
    end if;
    if p_type = 'paper' and exists (
      select 1 from public.payments where request_id = p_id and status in ('initiated', 'pending')
    ) then return jsonb_build_object('ok', false, 'reason', 'pending_payment'); end if;
    if p_type = 'results' and exists (
      select 1 from public.payments where result_request_id = p_id and status in ('initiated', 'pending')
    ) then return jsonb_build_object('ok', false, 'reason', 'pending_payment'); end if;
    if p_type = 'refer' and exists (
      select 1 from public.payments where refer_request_id = p_id and status in ('initiated', 'pending')
    ) then return jsonb_build_object('ok', false, 'reason', 'pending_payment'); end if;
  end if;

  if p_type = 'paper' then
    update public.paper_requests set archived_at = case when p_action = 'archive' then now() else null end,
      archived_by = case when p_action = 'archive' then p_actor_id else null end where id = p_id;
  elsif p_type = 'results' then
    update public.result_requests set archived_at = case when p_action = 'archive' then now() else null end,
      archived_by = case when p_action = 'archive' then p_actor_id else null end where id = p_id;
  elsif p_type = 'refer' then
    update public.refer_requests set archived_at = case when p_action = 'archive' then now() else null end,
      archived_by = case when p_action = 'archive' then p_actor_id else null end where id = p_id;
  else
    update public.payments set archived_at = case when p_action = 'archive' then now() else null end,
      archived_by = case when p_action = 'archive' then p_actor_id else null end,
      archive_reason = case when p_action = 'archive' then left(coalesce(p_reason, 'user_or_admin_archived'), 300) else null end
    where id = p_id;
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (p_actor_id, 'record.' || p_action, entity_name, p_id,
    jsonb_build_object('reason', left(coalesce(p_reason, ''), 300), 'previousArchivedAt', previous_archive));
  return jsonb_build_object('ok', true, 'type', p_type, 'id', p_id, 'archived', p_action = 'archive');
end;
$$;

revoke all on function public.set_request_archive_state(text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_request_archive_state(text, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';

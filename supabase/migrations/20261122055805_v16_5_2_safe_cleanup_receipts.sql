-- v16.5.2: protect payment evidence and make unpaid-request deletion atomic with its audit trail.
-- Preflights before applying:
-- select upper(btrim(receipt)), count(*) from public.payments where receipt is not null group by upper(btrim(receipt)) having count(*) > 1 limit 100;
-- select p.id, p.request_id from public.payments p left join public.paper_requests r on r.id = p.request_id where p.request_id is not null and r.id is null limit 100;

-- No request deletion may cascade-delete a payment attempt or financial record.
do $$
declare
  fk_name text;
begin
  for fk_name in
    select conname
    from pg_constraint
    where conrelid = 'public.payments'::regclass
      and confrelid = 'public.paper_requests'::regclass
      and contype = 'f'
  loop
    execute format('alter table public.payments drop constraint %I', fk_name);
  end loop;
end;
$$;

alter table public.payments
  add constraint payments_request_id_fkey
  foreign key (request_id) references public.paper_requests(id)
  on delete restrict not valid;
alter table public.payments validate constraint payments_request_id_fkey;

create unique index if not exists payments_receipt_normalized_unique_idx
  on public.payments (upper(btrim(receipt)))
  where receipt is not null;

create or replace function public.delete_unpaid_paper_request(
  p_request_id uuid,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.paper_requests%rowtype;
  actor_role text;
begin
  select role into actor_role
  from public.profiles
  where id = p_actor_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'actor_not_found');
  end if;

  select * into request_row
  from public.paper_requests
  where id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if actor_role <> 'admin' and request_row.user_id <> p_actor_id then
    return jsonb_build_object('ok', false, 'reason', 'forbidden');
  end if;
  if request_row.status = 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'paid');
  end if;
  if exists (select 1 from public.payments where request_id = p_request_id) then
    return jsonb_build_object('ok', false, 'reason', 'has_payment_attempt');
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    p_actor_id,
    'request.delete',
    'paper_request',
    p_request_id,
    jsonb_build_object(
      'title', request_row.title,
      'student', request_row.student_name,
      'previousStatus', request_row.status
    )
  );
  insert into public.request_deletion_logs(request_id, actor_id, title, previous_status)
  values (p_request_id, p_actor_id, request_row.title, request_row.status);
  delete from public.paper_requests where id = p_request_id;
  return jsonb_build_object('ok', true, 'deletedId', p_request_id);
end;
$$;

revoke all on function public.delete_unpaid_paper_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_unpaid_paper_request(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

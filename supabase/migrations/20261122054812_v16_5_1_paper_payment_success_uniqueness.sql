-- v16.5.1: prevent a delayed successful callback after a retry from double-confirming one paper request.
-- Apply only after confirming this preflight returns no groups:
-- select request_id, count(*) from public.payments where request_id is not null and status = 'success' group by request_id having count(*) > 1 limit 100;
create unique index if not exists payments_one_successful_paper_request_idx
  on public.payments(request_id)
  where request_id is not null and status = 'success';
notify pgrst, 'reload schema';

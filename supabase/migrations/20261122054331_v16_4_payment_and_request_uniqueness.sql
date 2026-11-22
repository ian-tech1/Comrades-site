-- v16.4 constraints: apply only after duplicate preflight and manual reconciliation.
create unique index if not exists result_requests_active_identity_unique_idx
  on public.result_requests (
    user_id,
    lower(btrim(institution_name)),
    lower(btrim(registration_number)),
    lower(btrim(admission_number))
  ) where status in ('requested', 'processing');
create unique index if not exists refer_requests_active_identity_unique_idx
  on public.refer_requests (
    user_id,
    lower(btrim(institution_name)),
    lower(btrim(registration_number)),
    lower(btrim(admission_number)),
    lower(btrim(exam_period))
  ) where status in ('requested', 'processing');
create unique index if not exists payments_one_active_paper_request_idx
  on public.payments(request_id)
  where request_id is not null and status in ('initiated', 'pending');
create unique index if not exists payments_one_active_results_request_idx
  on public.payments(result_request_id)
  where result_request_id is not null and status in ('initiated', 'pending');
create unique index if not exists payments_one_active_refer_request_idx
  on public.payments(refer_request_id)
  where refer_request_id is not null and status in ('initiated', 'pending');
create unique index if not exists payments_one_successful_results_request_idx
  on public.payments(result_request_id)
  where result_request_id is not null and status = 'success';
create unique index if not exists payments_one_successful_refer_request_idx
  on public.payments(refer_request_id)
  where refer_request_id is not null and status = 'success';
notify pgrst, 'reload schema';

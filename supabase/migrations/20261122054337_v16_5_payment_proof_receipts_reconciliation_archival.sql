-- v16.5 payment proof, receipts, reconciliation and reversible archival.
alter table public.payments
  add column if not exists paid_at timestamptz,
  add column if not exists paid_at_source text not null default 'unknown'
    check (paid_at_source in ('unknown', 'callback_transaction_date', 'callback_received_at', 'admin_verified', 'admin_recorded_at')),
  add column if not exists payer_name text,
  add column if not exists payer_name_source text not null default 'unavailable'
    check (payer_name_source in ('unavailable', 'provider_callback', 'admin_verified')),
  add column if not exists confirmation_source text not null default 'legacy'
    check (confirmation_source in ('legacy', 'daraja_callback', 'admin_verified')),
  add column if not exists reconciliation_status text not null default 'not_checked'
    check (reconciliation_status in ('not_checked', 'awaiting_callback', 'provider_success_pending_proof', 'provider_pending', 'proof_mismatch', 'verified', 'provider_failed')),
  add column if not exists provider_result_code integer,
  add column if not exists provider_result_description text,
  add column if not exists provider_checked_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

alter table public.paper_requests
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.result_requests
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;
alter table public.refer_requests
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null;

create index if not exists payments_reconciliation_queue_idx
  on public.payments(status, reconciliation_status, created_at desc)
  where checkout_request_id is not null and archived_at is null;
create index if not exists payments_paid_at_idx
  on public.payments(paid_at desc)
  where status = 'success';
create index if not exists paper_requests_active_archive_idx
  on public.paper_requests(archived_at, created_at desc);
create index if not exists result_requests_active_archive_idx
  on public.result_requests(archived_at, created_at desc);
create index if not exists refer_requests_active_archive_idx
  on public.refer_requests(archived_at, created_at desc);
create index if not exists payments_active_archive_idx
  on public.payments(archived_at, created_at desc);

notify pgrst, 'reload schema';

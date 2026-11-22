-- v16.4 setup: priced academic services, refer requests, profile images and resettable sessions.
-- This stage intentionally excludes the partial unique indexes. Run duplicate preflight before the index stage.
alter table public.profiles
  add column if not exists avatar_path text,
  add column if not exists session_version integer not null default 0,
  add column if not exists must_change_password boolean not null default false;

alter table public.portal_settings
  add column if not exists results_request_price numeric(10,2) not null default 0 check (results_request_price >= 0),
  add column if not exists refer_registration_price numeric(10,2) not null default 0 check (refer_registration_price >= 0);

alter table public.result_requests
  add column if not exists service_fee numeric(10,2) not null default 0 check (service_fee >= 0),
  add column if not exists payment_status text not null default 'paid';
alter table public.result_requests alter column payment_status set default 'pending';

create table if not exists public.refer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_name text not null,
  registration_number text not null,
  admission_number text not null,
  failed_units text[] not null default '{}',
  exam_period text not null,
  notes text not null default '',
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'registered', 'rejected')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed')),
  service_fee numeric(10,2) not null check (service_fee > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.refer_requests enable row level security;
drop policy if exists refer_requests_deny_direct_client_access on public.refer_requests;
create policy refer_requests_deny_direct_client_access
  on public.refer_requests as restrictive
  for all to anon, authenticated
  using (false)
  with check (false);

alter table public.payments alter column request_id drop not null;
alter table public.payments
  add column if not exists result_request_id uuid references public.result_requests(id) on delete cascade,
  add column if not exists refer_request_id uuid references public.refer_requests(id) on delete cascade;
create index if not exists payments_result_request_idx on public.payments(result_request_id, created_at desc);
create index if not exists payments_refer_request_idx on public.payments(refer_request_id, created_at desc);
create index if not exists refer_requests_user_created_idx on public.refer_requests(user_id, created_at desc);
create index if not exists refer_requests_status_created_idx on public.refer_requests(status, created_at desc);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Keep profile photos private; reads are authorized by the application and use short-lived signed URLs.
update storage.buckets
set public = false,
    file_size_limit = 3145728,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'avatars';

notify pgrst, 'reload schema';

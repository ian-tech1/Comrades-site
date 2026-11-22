-- Comreds Papers Portal v3 migration. Run in the same Supabase project used by Vercel.
create extension if not exists pgcrypto;
create table if not exists public.profiles(id uuid primary key default gen_random_uuid(),name text not null,email text not null unique,phone text default '',role text not null default 'student' check(role in('student','admin')),password_salt text not null,password_hash text not null,created_at timestamptz not null default now());
create table if not exists public.papers(id uuid primary key default gen_random_uuid(),title text not null,subject text not null,type text not null default 'Revision Paper',description text default '',price numeric(10,2) not null default 0 check(price>=0),available boolean not null default true,storage_path text not null,original_name text not null,created_at timestamptz not null default now());
create table if not exists public.paper_requests(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,student_name text not null,paper_id uuid references public.papers(id) on delete set null,title text not null,subject text not null,status text not null default 'requested',amount numeric(10,2) not null default 0,created_at timestamptz not null default now());
create table if not exists public.payments(id uuid primary key default gen_random_uuid(),request_id uuid not null references public.paper_requests(id) on delete restrict,user_id uuid not null references public.profiles(id) on delete cascade,amount numeric(10,2) not null,phone text not null,status text not null default 'initiated',checkout_request_id text unique,merchant_request_id text,result_code integer,result_description text,receipt text,paid_phone text,paid_amount numeric(10,2),error_message text,created_at timestamptz not null default now());
create table if not exists public.notices(id uuid primary key default gen_random_uuid(),title text not null,body text not null,created_at timestamptz not null default now());
create table if not exists public.portal_settings(id integer primary key check(id=1),portal_name text not null default 'Comreds Papers Portal',currency text not null default 'KES',paper_price numeric(10,2) not null default 50,support_phone text not null default '+254723278526');
alter table public.portal_settings add column if not exists login_design text not null default 'cdacc' check (login_design in ('cdacc', 'classic', 'navy'));
alter table public.papers add column if not exists level text default '',add column if not exists year text default '',add column if not exists semester text default '',add column if not exists tags text[] default '{}',add column if not exists download_count integer not null default 0,add column if not exists uploaded_by uuid references public.profiles(id);
alter table public.paper_requests add column if not exists level text default '';
alter table public.notices add column if not exists priority text not null default 'normal',add column if not exists expires_at timestamptz;
create table if not exists public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,title text not null,body text not null,type text not null default 'system',read_at timestamptz,created_at timestamptz not null default now());
create table if not exists public.favorites(user_id uuid not null references public.profiles(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,created_at timestamptz not null default now(),primary key(user_id,paper_id));
create table if not exists public.download_events(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,created_at timestamptz not null default now());
create table if not exists public.payment_events(id uuid primary key default gen_random_uuid(),payment_id uuid references public.payments(id) on delete cascade,checkout_request_id text unique,result_code integer,result_description text,payload jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists public.audit_logs(id uuid primary key default gen_random_uuid(),actor_id uuid references public.profiles(id) on delete set null,action text not null,entity_type text not null,entity_id uuid,metadata jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists paper_requests_user_idx on public.paper_requests(user_id,created_at desc);
create index if not exists payments_user_idx on public.payments(user_id,created_at desc);
create index if not exists payments_checkout_idx on public.payments(checkout_request_id);
create unique index if not exists payments_receipt_normalized_unique_idx on public.payments(upper(btrim(receipt))) where receipt is not null;
create index if not exists papers_available_idx on public.papers(available,created_at desc);
create index if not exists notifications_user_idx on public.notifications(user_id,read_at,created_at desc);
create index if not exists downloads_user_idx on public.download_events(user_id,created_at desc);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('papers','papers',false,52428800,array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream']) on conflict(id) do update set public=false;
update storage.buckets set allowed_mime_types=array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/octet-stream'] where id='papers';

-- v3.1 advanced feature foundations
create table if not exists public.support_tickets(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id) on delete cascade,subject text not null,message text not null,status text not null default 'open',priority text not null default 'normal',created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table if not exists public.paper_reviews(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,rating integer not null check(rating between 1 and 5),review text default '',created_at timestamptz not null default now(),unique(paper_id,user_id));
create table if not exists public.collections(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id) on delete cascade,name text not null,description text default '',visibility text not null default 'private',created_at timestamptz not null default now());
create table if not exists public.collection_items(collection_id uuid not null references public.collections(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,position integer not null default 0,primary key(collection_id,paper_id));
create table if not exists public.saved_searches(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,name text not null,query jsonb not null default '{}',created_at timestamptz not null default now());
create table if not exists public.paper_versions(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,version integer not null,storage_path text not null,original_name text not null,file_size bigint,checksum text,created_by uuid references public.profiles(id),created_at timestamptz not null default now(),unique(paper_id,version));
create table if not exists public.coupons(id uuid primary key default gen_random_uuid(),code text not null unique,discount_type text not null default 'fixed',discount_value numeric(10,2) not null check(discount_value>=0),max_uses integer,used_count integer not null default 0,expires_at timestamptz,active boolean not null default true);
create table if not exists public.coupon_redemptions(coupon_id uuid not null references public.coupons(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,request_id uuid references public.paper_requests(id) on delete set null,created_at timestamptz not null default now(),primary key(coupon_id,user_id,request_id));
create table if not exists public.study_plans(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,title text not null,start_date date,end_date date,status text not null default 'active',created_at timestamptz not null default now());
create table if not exists public.study_sessions(id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.study_plans(id) on delete cascade,paper_id uuid references public.papers(id) on delete set null,scheduled_for timestamptz,minutes integer not null default 30,completed_at timestamptz,notes text default '');
create table if not exists public.referrals(id uuid primary key default gen_random_uuid(),referrer_id uuid not null references public.profiles(id) on delete cascade,referred_email text not null,status text not null default 'invited',created_at timestamptz not null default now());
create table if not exists public.content_reports(id uuid primary key default gen_random_uuid(),reporter_id uuid references public.profiles(id) on delete set null,paper_id uuid references public.papers(id) on delete cascade,reason text not null,status text not null default 'open',created_at timestamptz not null default now());
create table if not exists public.message_threads(id uuid primary key default gen_random_uuid(),created_by uuid not null references public.profiles(id) on delete cascade,subject text not null,created_at timestamptz not null default now());
create table if not exists public.message_replies(id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.message_threads(id) on delete cascade,author_id uuid not null references public.profiles(id) on delete cascade,body text not null,created_at timestamptz not null default now());
create table if not exists public.device_tokens(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,token text not null unique,platform text not null default 'web',created_at timestamptz not null default now());
create table if not exists public.login_events(id uuid primary key default gen_random_uuid(),user_id uuid references public.profiles(id) on delete set null,email text,success boolean not null,ip_hash text,user_agent text,created_at timestamptz not null default now());
create index if not exists login_events_email_created_idx on public.login_events(email,created_at desc) where success=false;
create index if not exists login_events_ip_created_idx on public.login_events(ip_hash,created_at desc) where success=false;
create table if not exists public.paper_access_limits(user_id uuid not null references public.profiles(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,daily_limit integer not null default 10,download_count integer not null default 0,reset_at date not null default current_date,primary key(user_id,paper_id));
create index if not exists support_tickets_status_idx on public.support_tickets(status,priority,created_at desc);
create index if not exists paper_reviews_paper_idx on public.paper_reviews(paper_id,created_at desc);
create index if not exists study_sessions_plan_idx on public.study_sessions(plan_id,scheduled_for);
create index if not exists audit_logs_created_idx on public.audit_logs(created_at desc);


-- v3.2 reference-dashboard feature foundations
create table if not exists public.exam_calendars(id uuid primary key default gen_random_uuid(),title text not null,exam_date date not null,level text default '',subject text default '',created_by uuid references public.profiles(id),created_at timestamptz not null default now());
create table if not exists public.leaderboards(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,points integer not null default 0,rank integer,period_start date,period_end date,created_at timestamptz not null default now());
create table if not exists public.badges(id uuid primary key default gen_random_uuid(),name text not null unique,description text default '',icon text default '★',points integer not null default 0);
create table if not exists public.user_badges(user_id uuid not null references public.profiles(id) on delete cascade,badge_id uuid not null references public.badges(id) on delete cascade,awarded_at timestamptz not null default now(),primary key(user_id,badge_id));
create table if not exists public.referral_rewards(id uuid primary key default gen_random_uuid(),referral_id uuid references public.referrals(id) on delete cascade,recipient_id uuid references public.profiles(id) on delete cascade,reward_type text not null default 'credit',amount numeric(10,2) not null default 0,status text not null default 'pending',created_at timestamptz not null default now());
create table if not exists public.offline_downloads(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,device_token text,expires_at timestamptz,created_at timestamptz not null default now());
create table if not exists public.paper_annotations(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,paper_id uuid not null references public.papers(id) on delete cascade,page_number integer,selection text,note text not null,created_at timestamptz not null default now());
create table if not exists public.class_groups(id uuid primary key default gen_random_uuid(),owner_id uuid not null references public.profiles(id) on delete cascade,name text not null,level text default '',created_at timestamptz not null default now());
create table if not exists public.group_members(group_id uuid not null references public.class_groups(id) on delete cascade,user_id uuid not null references public.profiles(id) on delete cascade,role text not null default 'member',joined_at timestamptz not null default now(),primary key(group_id,user_id));
create table if not exists public.moderation_queue(id uuid primary key default gen_random_uuid(),paper_id uuid references public.papers(id) on delete cascade,assigned_to uuid references public.profiles(id),status text not null default 'pending',notes text default '',created_at timestamptz not null default now());
create table if not exists public.maintenance_windows(id uuid primary key default gen_random_uuid(),title text not null,message text not null,starts_at timestamptz not null,ends_at timestamptz not null,active boolean not null default true);
create index if not exists exam_calendar_date_idx on public.exam_calendars(exam_date);
create index if not exists leaderboard_points_idx on public.leaderboards(points desc);
create index if not exists annotations_user_paper_idx on public.paper_annotations(user_id,paper_id,created_at desc);
create index if not exists maintenance_active_idx on public.maintenance_windows(active,starts_at,ends_at);


-- v3.3 storage-efficient document support
alter table public.papers add column if not exists checksum text,add column if not exists file_size bigint,add column if not exists mime_type text default 'application/octet-stream';
create unique index if not exists papers_checksum_unique_idx on public.papers(checksum) where checksum is not null;
update storage.buckets set file_size_limit=26214400,allowed_mime_types=array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/csv','text/plain','application/rtf','application/vnd.oasis.opendocument.text','application/vnd.oasis.opendocument.spreadsheet','application/vnd.oasis.opendocument.presentation','application/octet-stream'] where id='papers';
create table if not exists public.storage_objects(id uuid primary key default gen_random_uuid(),checksum text not null unique,storage_path text not null unique,file_size bigint not null,mime_type text not null,reference_count integer not null default 1,created_at timestamptz not null default now(),last_referenced_at timestamptz not null default now());
create table if not exists public.storage_usage_daily(id uuid primary key default gen_random_uuid(),usage_date date not null unique,total_bytes bigint not null default 0,object_count integer not null default 0,duplicate_bytes_avoided bigint not null default 0,created_at timestamptz not null default now());
create table if not exists public.document_variants(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,variant_type text not null,storage_path text,checksum text,file_size bigint,mime_type text,created_at timestamptz not null default now(),unique(paper_id,variant_type));
create table if not exists public.document_previews(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,preview_path text,preview_status text not null default 'queued',page_count integer,created_at timestamptz not null default now());
create table if not exists public.document_text_index(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,extracted_text text not null default '',language text default 'en',word_count integer not null default 0,created_at timestamptz not null default now(),unique(paper_id));
create table if not exists public.virus_scan_results(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,checksum text not null,scanner text not null default 'pending',status text not null default 'queued',details text default '',scanned_at timestamptz,unique(paper_id));
create table if not exists public.compression_jobs(id uuid primary key default gen_random_uuid(),paper_id uuid not null references public.papers(id) on delete cascade,job_type text not null default 'optimize-preview',status text not null default 'queued',input_bytes bigint,output_bytes bigint,error_message text,created_at timestamptz not null default now());
create table if not exists public.retention_policies(id uuid primary key default gen_random_uuid(),name text not null unique,days_to_keep integer not null default 365,scope text not null default 'orphaned-objects',active boolean not null default true,created_at timestamptz not null default now());
create table if not exists public.upload_batches(id uuid primary key default gen_random_uuid(),created_by uuid references public.profiles(id),status text not null default 'processing',total_files integer not null default 0,successful_files integer not null default 0,duplicate_files integer not null default 0,failed_files integer not null default 0,created_at timestamptz not null default now());
create table if not exists public.upload_batch_items(id uuid primary key default gen_random_uuid(),batch_id uuid not null references public.upload_batches(id) on delete cascade,filename text not null,checksum text,file_size bigint,status text not null default 'queued',error_message text,paper_id uuid references public.papers(id),created_at timestamptz not null default now());
create index if not exists storage_usage_date_idx on public.storage_usage_daily(usage_date desc);
create index if not exists scan_status_idx on public.virus_scan_results(status,created_at desc);
create index if not exists upload_batch_idx on public.upload_batch_items(batch_id,status);

notify pgrst, 'reload schema';


-- v16 request lifecycle and receipt reference support
create table if not exists public.request_deletion_logs(
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  title text,
  previous_status text,
  reason text default 'user_or_admin_deleted',
  deleted_at timestamptz not null default now()
);
create or replace function public.delete_unpaid_paper_request(p_request_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare request_row public.paper_requests%rowtype; actor_role text;
begin
  select role into actor_role from public.profiles where id=p_actor_id;
  if not found then return jsonb_build_object('ok',false,'reason','actor_not_found'); end if;
  select * into request_row from public.paper_requests where id=p_request_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','not_found'); end if;
  if actor_role <> 'admin' and request_row.user_id <> p_actor_id then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;
  if request_row.status='paid' then return jsonb_build_object('ok',false,'reason','paid'); end if;
  if exists(select 1 from public.payments where request_id=p_request_id) then
    return jsonb_build_object('ok',false,'reason','has_payment_attempt');
  end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
  values(p_actor_id,'request.delete','paper_request',p_request_id,
    jsonb_build_object('title',request_row.title,'student',request_row.student_name,'previousStatus',request_row.status));
  insert into public.request_deletion_logs(request_id,actor_id,title,previous_status)
  values(p_request_id,p_actor_id,request_row.title,request_row.status);
  delete from public.paper_requests where id=p_request_id;
  return jsonb_build_object('ok',true,'deletedId',p_request_id);
end;
$$;
revoke all on function public.delete_unpaid_paper_request(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_unpaid_paper_request(uuid,uuid) to service_role;
create index if not exists request_deletion_logs_deleted_idx on public.request_deletion_logs(deleted_at desc);
notify pgrst, 'reload schema';


-- v16.2 advanced feature foundations (20)
create table if not exists public.student_goals(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  target_date date,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create table if not exists public.goal_progress(
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.student_goals(id) on delete cascade,
  progress numeric(5,2) not null default 0 check(progress between 0 and 100),
  note text default '',
  recorded_at timestamptz not null default now()
);
create table if not exists public.flashcard_decks(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  subject text default '',
  visibility text not null default 'private',
  created_at timestamptz not null default now()
);
create table if not exists public.flashcards(
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  prompt text not null,
  answer text not null,
  difficulty text not null default 'medium',
  review_due_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_sets(
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.profiles(id) on delete set null,
  title text not null,
  subject text default '',
  time_limit_minutes integer,
  published boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.quiz_questions(
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_sets(id) on delete cascade,
  prompt text not null,
  options jsonb not null default '[]',
  answer text,
  position integer not null default 0
);
create table if not exists public.quiz_attempts(
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quiz_sets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  score numeric(6,2),
  answers jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create table if not exists public.recommendation_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  paper_id uuid references public.papers(id) on delete cascade,
  reason text not null,
  action text,
  created_at timestamptz not null default now()
);
create table if not exists public.paper_share_links(
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references public.papers(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  access_count integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.scheduled_notifications(
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  audience text not null default 'all',
  title text not null,
  body text not null,
  send_at timestamptz not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);
create table if not exists public.email_queue(
  id uuid primary key default gen_random_uuid(),
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create table if not exists public.sms_queue(
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  message text not null,
  status text not null default 'queued',
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create table if not exists public.payment_disputes(
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  opened_by uuid references public.profiles(id) on delete set null,
  reason text not null,
  status text not null default 'open',
  resolution text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table if not exists public.refund_requests(
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(10,2) not null,
  reason text not null,
  status text not null default 'requested',
  created_at timestamptz not null default now()
);
create table if not exists public.subscription_plans(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  price numeric(10,2) not null default 0,
  period_days integer not null default 30,
  download_limit integer,
  active boolean not null default true
);
create table if not exists public.user_subscriptions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz
);
create table if not exists public.api_webhooks(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  endpoint text not null,
  secret_hash text,
  events text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.webhook_deliveries(
  id uuid primary key default gen_random_uuid(),
  webhook_id uuid not null references public.api_webhooks(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  status_code integer,
  status text not null default 'queued',
  attempts integer not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.system_feature_flags(
  key text primary key,
  enabled boolean not null default false,
  description text default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.consent_records(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null,
  version text not null,
  granted boolean not null,
  recorded_at timestamptz not null default now()
);
create index if not exists student_goals_user_idx on public.student_goals(user_id,status);
create index if not exists flashcards_due_idx on public.flashcards(review_due_at);
create index if not exists quiz_attempts_user_idx on public.quiz_attempts(user_id,completed_at desc);
create index if not exists notification_queue_idx on public.scheduled_notifications(status,send_at);
create index if not exists payment_disputes_status_idx on public.payment_disputes(status,created_at desc);
create index if not exists refund_requests_status_idx on public.refund_requests(status,created_at desc);
create index if not exists subscriptions_user_idx on public.user_subscriptions(user_id,status,ends_at);
create index if not exists webhook_delivery_status_idx on public.webhook_deliveries(status,created_at);
create index if not exists consent_user_idx on public.consent_records(user_id,consent_type,recorded_at desc);
notify pgrst, 'reload schema';


-- v16.3 student usernames and private academic results workflow
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(username))
  where username is not null and btrim(username) <> '';

create table if not exists public.result_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_name text not null,
  registration_number text not null,
  admission_number text not null,
  registered_units text[] not null default '{}',
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'rejected')),
  result_storage_path text,
  result_file_name text,
  result_file_size bigint,
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.result_requests enable row level security;
create index if not exists result_requests_user_created_idx
  on public.result_requests(user_id, created_at desc);
create index if not exists result_requests_status_created_idx
  on public.result_requests(status, created_at desc);
create index if not exists result_requests_uploaded_by_idx
  on public.result_requests(uploaded_by);
drop policy if exists result_requests_deny_direct_client_access
  on public.result_requests;
create policy result_requests_deny_direct_client_access
  on public.result_requests as restrictive
  for all to anon, authenticated
  using (false)
  with check (false);
notify pgrst, 'reload schema';


-- v16.4 priced academic services, failed-exam refer registration, profile images and resettable sessions
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
create unique index if not exists payments_one_successful_paper_request_idx
  on public.payments(request_id)
  where request_id is not null and status = 'success';
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


-- v16.5 payment proof, receipts, reconciliation and reversible archival
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

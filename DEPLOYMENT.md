# Vercel deployment — Comreds Papers Portal

## 1. Prepare Supabase

1. Confirm that the Supabase project URL matches the portal deployment. For this existing v16.3 portal, **do not run the complete `supabase/schema.sql` against production**. That file is a reference for fresh installations; production uses the versioned migrations below.
2. Apply `supabase/migrations/20261122054318_v16_4_priced_academic_services_setup.sql`. This additive setup stage creates the refer table and payment references but deliberately does not create the new partial unique indexes.
3. For an existing v16.3 portal, first execute only the v16.4 setup statements (now represented by that versioned migration). Then run these checks. Stop if any row is returned; reconcile duplicates without deleting payment records. The v16.4 stage introduces `refer_requests` and academic-service payment-reference columns, so their checks cannot run on an untouched v16.3 database.

```sql
select receipt, count(*)
from public.payments
where receipt is not null
group by receipt
having count(*) > 1 limit 100;

select user_id, lower(btrim(institution_name)), lower(btrim(registration_number)), lower(btrim(admission_number)), count(*)
from public.result_requests
where status in ('requested', 'processing')
group by 1,2,3,4 having count(*) > 1 limit 100;

select user_id, lower(btrim(institution_name)), lower(btrim(registration_number)), lower(btrim(admission_number)), lower(btrim(exam_period)), count(*)
from public.refer_requests
where status in ('requested', 'processing')
group by 1,2,3,4,5 having count(*) > 1 limit 100;

select request_id, count(*) from public.payments
where request_id is not null and status in ('initiated', 'pending')
group by request_id having count(*) > 1 limit 100;
select result_request_id, count(*) from public.payments
where result_request_id is not null and status in ('initiated', 'pending')
group by result_request_id having count(*) > 1 limit 100;
select refer_request_id, count(*) from public.payments
where refer_request_id is not null and status in ('initiated', 'pending')
group by refer_request_id having count(*) > 1 limit 100;
select result_request_id, count(*) from public.payments
where result_request_id is not null and status = 'success'
group by result_request_id having count(*) > 1 limit 100;
select refer_request_id, count(*) from public.payments
where refer_request_id is not null and status = 'success'
group by refer_request_id having count(*) > 1 limit 100;
```

4. If all eight checks return no rows, apply `supabase/migrations/20261122054331_v16_4_payment_and_request_uniqueness.sql`. The partial indexes enforce one active prompt per request and one successful payment per academic request, including manual-payment/callback races.
5. Apply `supabase/migrations/20261122054337_v16_5_payment_proof_receipts_reconciliation_archival.sql` to add payment provenance, provider reconciliation fields and reversible archive metadata.
6. Before applying v16.5.1, run this bounded read-only check. Stop and reconcile duplicates without deleting payment records if any rows are returned:

```sql
select request_id, count(*)
from public.payments
where request_id is not null and status = 'success'
group by request_id
having count(*) > 1 limit 100;
```

7. If the check returns no rows, apply `supabase/migrations/20261122054812_v16_5_1_paper_payment_success_uniqueness.sql`. It prevents a late successful callback after a retry from confirming a second payment against one paper request. The migration ledger records version `20261122054812`; its unique index was verified on 2026-11-22.
8. Before applying v16.5.2, run both bounded read-only checks below. Stop if either returns rows; reconcile the issue without deleting financial evidence.

```sql
select upper(btrim(receipt)), count(*) from public.payments
where receipt is not null group by upper(btrim(receipt))
having count(*) > 1 limit 100;

select p.id, p.request_id from public.payments p
left join public.paper_requests r on r.id = p.request_id
where p.request_id is not null and r.id is null limit 100;
```

9. If both checks return no rows, apply `supabase/migrations/20261122055805_v16_5_2_safe_cleanup_receipts.sql`. It adds case/whitespace-normalized receipt uniqueness, changes the paper-request payment FK from `ON DELETE CASCADE` to `ON DELETE RESTRICT`, and installs a service-role-only transaction that locks and authorizes an unpaid/no-attempt request, writes both deletion audit records, and deletes it atomically. The migration was applied as `v16_5_2_safe_cleanup_receipts` on 2026-11-22 after both preflights returned no rows. The FK, index, RPC privileges, and migration ledger entry were verified.
10. Apply `supabase/migrations/20261122060611_v16_5_3_atomic_archive_stk_guard.sql`. Its payment-insert trigger locks the referenced request and rejects new attempts after archival; a service-role-only function locks requests or payment rows, checks active attempts, updates archive metadata, and writes the audit row in one transaction. This serializes request archival against STK initiation, makes all request/payment archive and restore audits atomic, and provides learner archive/restore controls for results requests. It was applied to the confirmed project as migration version `20261122060611` on 2026-11-22; the ledger, trigger, service-role execution and authenticated-role denial were verified.
11. For a brand-new empty Supabase project only, `supabase/schema.sql` remains the full schema reference; do not use it as a shortcut for an existing production database.
12. Confirm the `papers` Storage bucket exists and remains **private**. The migration configures a 25 MB object limit and accepted document MIME types. Confirm the `avatars` bucket is private with a 3 MB limit and JPEG/PNG/WebP MIME types; profile photos are served only through authenticated short-lived signed URLs. Never make either bucket public or put results PDFs in the avatar bucket.
13. Copy the project URL from **Project Settings → Data API** (for example `https://PROJECT-REF.supabase.co`) and the server-side **Secret key** (`sb_secret_...`). Do not use a database connection string or publish the key.

## 2. Configure the Vercel project

Import the GitHub repository and set:

- **Root Directory:** repository root (the folder containing `package.json`, `vercel.json`, and `public/`).
- **Framework Preset:** Other.
- **Node.js Version:** 22.x. The application and its locked Supabase dependency are tested on Node 22; the Vercel project and package engine are pinned to this major.
- **Build Command:** `npm run build`.
- **Output Directory:** `vercel.json` pins this to `public/`, so no separate dashboard override is needed.

`vercel.json` pins the static output to `public/`, maps `/api/*` to `api/index.js`, and sets a 30-second function duration. Keep the Vercel Root Directory at the repository root; do not point it at an old Neon/pg-pool build or a nested ZIP folder.

## 3. Add environment variables

In **Project → Settings → Environment Variables**, add these for Production (and Preview only when using separate test credentials):

| Variable                    | Required          | Notes                                                                                                                                                             |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`              | Yes               | Supabase Project URL, not the `db.` host.                                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes               | Supabase server-side Secret key; never expose to browser code.                                                                                                    |
| `SUPABASE_STORAGE_BUCKET`   | Recommended       | `papers`.                                                                                                                                                         |
| `SESSION_SECRET`            | Yes               | Generate a unique random value of at least 32 characters, e.g. `openssl rand -hex 32`.                                                                            |
| `ADMIN_NAME`                | Recommended       | Name used when the initial administrator profile is created.                                                                                                      |
| `ADMIN_EMAIL`               | Yes for bootstrap | Initial administrator sign-in email.                                                                                                                              |
| `ADMIN_PASSWORD`            | Yes for bootstrap | Strong unique initial password; change it later in the portal's **Security** page. Changing this environment variable does not rotate an existing profile.        |
| `DEFAULT_PAPER_PRICE`       | Optional          | Defaults to `50` (KES).                                                                                                                                           |
| `DEFAULT_PAYMENT_PHONE`     | Optional          | Defaults to `+254723278526`; learners can provide a different phone.                                                                                              |
| `DARAJA_ENV`                | Optional          | Use `sandbox` during testing.                                                                                                                                     |
| `DARAJA_CONSUMER_KEY`       | For STK           | Daraja app consumer key.                                                                                                                                          |
| `DARAJA_CONSUMER_SECRET`    | For STK           | Daraja app consumer secret.                                                                                                                                       |
| `DARAJA_SHORTCODE`          | For STK           | Sandbox or production shortcode.                                                                                                                                  |
| `DARAJA_PASSKEY`            | For STK           | Matching Daraja passkey.                                                                                                                                          |
| `DARAJA_TRANSACTION_TYPE`   | For STK           | For example `CustomerPayBillOnline` for a Paybill; use the type matching the shortcode.                                                                           |
| `DARAJA_CALLBACK_URL`       | For STK           | Public HTTPS URL ending `/api/mpesa/callback`. The application appends the secret query token automatically. Set the stable Production domain, not a Preview URL. |
| `DARAJA_CALLBACK_TOKEN`     | For STK           | Independent high-entropy secret of at least 32 characters, e.g. `openssl rand -hex 32`. Never place it in source code or logs.                                    |

The complete placeholder template is `.env.example`. Do not configure `DATABASE_URL`, `NEON_DATABASE_URL`, or a raw Postgres connection string. The Publishable/anon Supabase key is not used by this server-only app. After the migration is applied and before inviting learners to use the new services, open **Admin → System Settings** and set the results-request and refer-registration prices. KSh 0 disables new requests for that service; each submitted request retains its fee snapshot.

## 4. Deploy and verify

1. Deploy the latest branch/commit after the environment variables have been saved.
2. Open `https://YOUR-VERCEL-DOMAIN/api/health`. Expect HTTP 200 and `ok: true`, `database: "Supabase"`, and `storage: true`. A 503 response includes missing schema objects; identify the missing migration and apply only the reviewed versioned migration to the same project identified by `SUPABASE_URL`—do not rerun the full schema on an existing portal.
3. Sign in to the initial admin account, then use **Security** to change its password (new passwords must be at least 12 characters).
4. Register a learner and smoke-test: sign-in, browse/request, small and large document upload, private download authorization, manual admin payment confirmation, and CSV export.
5. With Daraja in sandbox, test an STK prompt using a phone you control, callback confirmation, receipt display, and protected download. Do not switch to live credentials until these steps pass.

## Academic results workflow

Students register with a username and can continue using their existing email credentials; sign-in accepts either the username or email. Existing students can set a username from **My Profile** without recreating their account. Learners can request academic results or supplementary/refer registration and must pay the displayed service fee for each request before admin processing. Refer requests capture institution, student identifiers, failed units and exam period; learners can only see their own requests. Admins manage refer requests under **Refer Requests** and may record a verified manual receipt when needed. Learners can upload a JPEG, PNG or WebP profile photo up to 3 MB; server-side byte verification is required before it is linked to the profile. A student submits the institution name, registration number, admission number, and registered units in **Request Results**. The student can view only their own requests in **Check Results**. Admins review each request under **Results Requests**, move it through requested/processing/rejected, and upload a PDF to mark the request complete. Completed requests cannot be moved back to an open status, but their PDF can be replaced. Results requests require payment before uploading results; the portal notifies the student in-app when results are uploaded. Refer requests support requested, processing, registered and rejected states, with payment required before processing/registration.

Results PDFs are stored in the private `papers` bucket. RLS and a restrictive policy deny direct `anon`/`authenticated` table access; the server uses its private service key only after verifying the session and request owner/admin role. The download endpoint then returns a short-lived signed download URL. Do not make the bucket public or expose result storage paths in the client. After applying the schema, smoke-test that one student cannot see or download another student's result.

## Upload size and Vercel function limits

The primary upload path requests a short-lived Supabase signed upload URL and sends the raw file bytes directly to the private bucket. Supported file types are PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV, TXT, RTF, ODT, ODS, and ODP, up to 25 MB. A SHA-256 checksum is used for deduplication and object naming. The API's multipart fallback is capped at 4 MB to stay below Vercel's function request-body limit; files larger than 4 MB use the signed path.

If uploads fail, confirm the bucket is private, its 25 MB limit is applied, the function has the correct Supabase URL and Secret key, and the browser is sending raw file bytes rather than a multipart wrapper.

## M-Pesa callback security

The server builds the callback URL from `DARAJA_CALLBACK_URL` and `DARAJA_CALLBACK_TOKEN`. Keep both values in Vercel, use HTTPS, and never share the token. A callback without the matching token is rejected. Before marking a request paid, the API also compares callback amount and normalized payer phone with the stored payment and rejects a duplicate receipt. A Daraja status-query response by itself is not payment proof: the request remains locked until the authenticated callback supplies matching amount, phone, and receipt details. The payment-status reconciliation route queries Daraja using the stored checkout ID; checkout IDs are not included in learner-facing payment data.

Confirmed payments have an authenticated, dynamically generated PDF receipt available to the payment owner and administrators. Receipts distinguish registered learner details from the actual payer details. Callback names are shown only when a verified provider field is present; the STK prompt phone is never treated as a name. Safaricom callback transaction timestamps are stored in UTC after parsing the documented `YYYYMMDDHHmmss` EAT value and displayed in Africa/Nairobi time with provenance. When provider transaction time is missing, the receipt labels callback-received or administrator-recorded time rather than representing it as the transaction time.

Manual administrator verification requires a unique M-Pesa receipt, exact request/service amount, and normalized Kenyan payer phone. Payer name is optional and marked administrator-verified only when the administrator has checked independent M-Pesa evidence. A supplied transaction timestamp must include its timezone; otherwise the record stores the administrator record time with an explicit fallback source. Manual confirmations and archive/restore actions are audited. Requests with pending payment attempts and pending payment rows cannot be archived; confirmed payments are never hard-deleted. Use the transaction page's archive and restore controls to reduce clutter without discarding financial evidence.

For Preview deployments, use sandbox credentials and a separate callback token. For Production, set the canonical production callback URL and production credentials explicitly. Never use the sandbox shortcode/passkey with `DARAJA_ENV=production`.

## Local checks

```bash
npm ci
npm run build
```

For local interaction, install the Vercel CLI and run `npm run dev`; configure local variables in an ignored `.env.local` file. Never add a real secret to `.env.example` or commit a local env file.

## Forgotten-password recovery

Password reset is administrator-mediated because no email-delivery provider is configured. From **Manage Members**, an admin can issue a one-time temporary password to a learner. The action revokes existing sessions, records an audit event without storing the password in the audit log, and forces the learner to set a new password on sign-in. Share the temporary password through a private channel. The login page instructs learners who forget their password to contact the administrator.

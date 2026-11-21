# Vercel deployment — Comreds Papers Portal

## 1. Prepare Supabase

1. Open the Supabase project that will back this deployment.
2. In **SQL Editor**, run the complete `supabase/schema.sql` from this repository. Do not run only selected sections; the API readiness check requires the tables and columns in the full schema, including `login_events`.

Before applying this migration to an existing portal, check for duplicate receipt codes:

```sql
select receipt, count(*)
from public.payments
where receipt is not null
group by receipt
having count(*) > 1;
```

Resolve any returned duplicates before running the full schema; it creates a unique index so one M-Pesa receipt cannot confirm multiple payments.

3. Confirm the `papers` Storage bucket exists and remains **private**. The migration configures a 25 MB object limit and accepted document MIME types.
4. Copy the project URL from **Project Settings → Data API** (for example `https://PROJECT-REF.supabase.co`) and the server-side **Secret key** (`sb_secret_...`). Do not use a database connection string or publish the key.

## 2. Configure the Vercel project

Import the GitHub repository and set:

- **Root Directory:** repository root (the folder containing `package.json`, `vercel.json`, and `public/`).
- **Framework Preset:** Other.
- **Node.js Version:** 22.x or later. The package engine is `>=22` because the locked Supabase client dependency requires Node 22.
- **Build Command:** `npm run build`.
- **Output Directory:** leave the framework default; Vercel serves the repository's `public/` assets and deploys the `api/` functions.

`vercel.json` maps `/api/*` to `api/index.js` and sets a 30-second function duration. Do not point Vercel at an old Neon/pg-pool build or a nested ZIP folder.

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

The complete placeholder template is `.env.example`. Do not configure `DATABASE_URL`, `NEON_DATABASE_URL`, or a raw Postgres connection string. The Publishable/anon Supabase key is not used by this server-only app.

## 4. Deploy and verify

1. Deploy the latest branch/commit after the environment variables have been saved.
2. Open `https://YOUR-VERCEL-DOMAIN/api/health`. Expect HTTP 200 and `ok: true`, `database: "Supabase"`, and `storage: true`. A 503 response includes missing schema objects; rerun the full SQL in the same project identified by `SUPABASE_URL`.
3. Sign in to the initial admin account, then use **Security** to change its password (new passwords must be at least 12 characters).
4. Register a learner and smoke-test: sign-in, browse/request, small and large document upload, private download authorization, manual admin payment confirmation, and CSV export.
5. With Daraja in sandbox, test an STK prompt using a phone you control, callback confirmation, receipt display, and protected download. Do not switch to live credentials until these steps pass.

## Upload size and Vercel function limits

The primary upload path requests a short-lived Supabase signed upload URL and sends the raw file bytes directly to the private bucket. Supported file types are PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV, TXT, RTF, ODT, ODS, and ODP, up to 25 MB. A SHA-256 checksum is used for deduplication and object naming. The API's multipart fallback is capped at 4 MB to stay below Vercel's function request-body limit; files larger than 4 MB use the signed path.

If uploads fail, confirm the bucket is private, its 25 MB limit is applied, the function has the correct Supabase URL and Secret key, and the browser is sending raw file bytes rather than a multipart wrapper.

## M-Pesa callback security

The server builds the callback URL from `DARAJA_CALLBACK_URL` and `DARAJA_CALLBACK_TOKEN`. Keep both values in Vercel, use HTTPS, and never share the token. A callback without the matching token is rejected. Before marking a request paid, the API also compares callback amount and normalized payer phone with the stored payment and rejects a duplicate receipt. A Daraja status-query response by itself is not payment proof: the request remains locked until the authenticated callback supplies matching amount, phone, and receipt details. The payment-status reconciliation route queries Daraja using the stored checkout ID; checkout IDs are not included in learner-facing payment data.

For Preview deployments, use sandbox credentials and a separate callback token. For Production, set the canonical production callback URL and production credentials explicitly. Never use the sandbox shortcode/passkey with `DARAJA_ENV=production`.

## Local checks

```bash
npm ci
npm run build
```

For local interaction, install the Vercel CLI and run `npm run dev`; configure local variables in an ignored `.env.local` file. Never add a real secret to `.env.example` or commit a local env file.

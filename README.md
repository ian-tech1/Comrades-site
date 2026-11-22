# Comreds Papers Portal

A responsive revision-paper portal with learner and administrator accounts, paid results and supplementary/refer registration requests, profile photos, Supabase-backed catalog/storage, protected downloads, and a Daraja (M-Pesa) payment flow. The repository is configured for Vercel Functions and static assets.

## Project structure

- `public/` — portal UI, stylesheet, icon, and web manifest.
- `api/index.js` — canonical Vercel API handler; `vercel.json` routes `/api/*` through this handler.
- `api/db.js` — server-only Supabase client setup and URL validation.
- `api/request-path.js`, `api/security.js` — tested route and request-security helpers.
- `supabase/schema.sql` — idempotent database/storage setup and additive feature tables.
- `tests/` — Node built-in regression tests for route rewriting and security helpers.
- `.env.example`, `DEPLOYMENT.md` — deployment configuration and operator guide.

## Quick start

1. For a **new, empty Supabase project only**, use `supabase/schema.sql` as the full schema reference. For an existing portal, do **not** rerun the full schema; identify the applied migration history and follow the reviewed, versioned steps in [DEPLOYMENT.md](DEPLOYMENT.md). Confirm the private `papers` bucket is present. The schema creates a private `avatars` bucket for learner profile photos, served only through authenticated short-lived signed URLs; do not make either bucket public.
2. Configure the environment variables in Vercel as described in [DEPLOYMENT.md](DEPLOYMENT.md). Keep Supabase and Daraja credentials in server-side environment variables only.
3. Deploy the repository root to Vercel with Node.js 22 or later. The build command is `npm run build`; it runs syntax, regression, and formatting checks.
4. Visit `/api/health`. A successful response reports `ok: true`, `database: "Supabase"`, and `storage: true`.
5. Sign in using the configured initial administrator account and change its password in **Security**. Changing `ADMIN_PASSWORD` later does not change an already-created profile password.

For local checks, run `npm ci` followed by `npm run build`. `npm run dev` uses the Vercel CLI (`vercel dev`).

## Security and payment behavior

The Supabase bucket is private. Signed uploads go directly from the browser to Supabase, so the Vercel function request-size limit does not restrict files on the primary upload path. The UI accepts supported office/document formats up to 25 MB; its small-file server fallback is limited to 4 MB. Upload metadata uses a SHA-256 checksum, and duplicates are rejected.

Sessions use HttpOnly, Secure, SameSite=Lax cookies. Mutating API requests validate same-origin requests and expected content types. Failed logins are throttled using hashed IP/email attempt records in `login_events`. The API does not allow ordinary status updates to mark a request as paid; downloads unlock only after payment confirmation or a recorded administrator manual-payment confirmation.

Daraja callback requests include a high-entropy `DARAJA_CALLBACK_TOKEN` in the callback URL. The API checks that token and verifies the stored amount, payer phone, receipt uniqueness, and payment state before unlocking a request. A positive Daraja status-query response alone does not unlock a download; the authenticated callback must provide matching payment details. Keep Daraja in sandbox until the end-to-end callback and download test passes.

## Operational notes

- For existing installations, apply only the appropriate reviewed migration to the exact Supabase project named by `SUPABASE_URL`; use the full schema only for a new empty project. `/api/health` lists missing tables/columns.
- Do not set `DATABASE_URL` or `NEON_DATABASE_URL`; this version uses Supabase APIs only.
- Set production payment credentials only in the Vercel Production environment. Avoid live credentials in Preview deployments.
- See [DEPLOYMENT.md](DEPLOYMENT.md) for environment variables, Vercel project settings, health checks, and smoke-test steps.

## Academic services and password recovery

Learners submit results requests under **Request Results** and failed/supplementary exam registration requests under **Refer Registration**. Each request saves the service fee configured at submission and must be paid before staff can process it. M-Pesa confirmation relies on the same authenticated callback and amount/phone/receipt validation as paper purchases. Admins review requests under **Results Requests** and **Refer Requests** and can record a verified manual M-Pesa receipt. Learners can add a JPEG, PNG or WebP photo up to 3 MB in **My Profile**; the API verifies the stored bytes before attaching it.

Forgotten-password recovery is administrator-mediated. An administrator can issue a one-time temporary password from **Manage Members**. Existing sessions are revoked, and the learner is required to choose a new password at sign-in. Share temporary passwords privately; the portal does not send password-reset email.

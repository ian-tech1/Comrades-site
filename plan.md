# Comreds Papers Portal — Vercel Upgrade Plan

## Scope and approach

The supplied Comreds Papers Portal will remain a Vercel serverless application using Supabase PostgreSQL and a private Supabase Storage bucket. The existing student and administrator roles will remain in place. The update will repair the document-upload workflow, strengthen the Daraja STK Push lifecycle, add request-to-availability matching, and redesign the dashboard around a clearer mobile-first operations interface.

The Vercel deployment will remain the source of production configuration. Supabase and Daraja secrets will be referenced only from Vercel environment variables; no secret, access token, or Safaricom credential will be added to browser code or committed files. The requested phone number, `+254723278526`, will be the default **sandbox checkout prompt number**. No prompt will be sent during development. A working Daraja sandbox or live prompt requires the owner’s own Daraja app credentials, shortcode/passkey, callback URL, and the phone owner’s PIN confirmation.

## Upload repair

The upload path will use the exact signed URL returned by Supabase instead of reconstructing an object-upload URL in the browser. The UI will validate type and size before upload, show upload progress and clear errors, prevent duplicate submission, and only create a paper record after storage confirms success. The API will validate the proposed file metadata, generate a unique scoped object path, ensure the configured private bucket is reachable, and reject an incomplete upload record. A post-upload verification endpoint and actionable health check will make bucket/configuration failures visible in Vercel logs and the admin screen.

## M-Pesa STK Push

The payment implementation will retain Daraja’s server-side OAuth token and M-Pesa Express request flow. It will normalize Kenyan mobile numbers, store an initiated payment before the request, associate Daraja checkout and merchant IDs with that payment, and record a full callback result idempotently. A successful callback will verify the amount, change the linked paper request to paid, create an in-app receipt/notification, and unlock a signed document download. A failed/cancelled callback will be recorded without unlocking the paper. Students will be able to retry an eligible failed payment; administrators will see a reconciliation queue for payments awaiting callbacks.

## Requested core features

- Students can browse available revision materials, create an exact request, and track whether a requested item is unavailable, awaiting payment, processing, paid, or delivered.
- Payments use a secure M-Pesa STK request from the server. Till/Paybill details and Daraja transaction type remain configurable through environment variables and the secure server configuration.
- A confirmed successful payment unlocks a short-lived download link for the purchased paper.
- Administrators can upload, organize, publish, unpublish, archive, and revise paper metadata; student availability watches are matched when a new paper is published and generate in-app notices.
- Emergency papers and priority notices are available to students, with administrator controls for priority and expiry.
- Student and administrator dashboards present requests, payments, receipts, downloads, member activity, uploads, notices, and key operational metrics.

## Twenty additional advanced features

1. Subject, level, institution, year, semester, and document-type metadata for precise catalog filtering.
2. Full-text catalog search, sort, and saved filters.
3. Student paper-request form for unavailable papers, including title, subject, level, and description.
4. Automatic availability watch matching when an administrator publishes a relevant paper.
5. In-app notification center with unread count and mark-read action.
6. Admin paper lifecycle controls: draft, published, archived, and availability toggle.
7. Paper preview metadata: original filename, file type, size, upload date, price, and download count.
8. Upload-progress UI, duplicate-submit lock, retry option, and post-upload verification state.
9. Secure, short-lived download URLs plus a recorded download activity log.
10. Student favorites/bookmarks for papers.
11. Personal download library with receipt reference and last-download time.
12. Payment receipts with M-Pesa receipt, amount, phone, status, and linked paper.
13. Payment retry for failed/cancelled pending requests, with duplicate active-payment protection.
14. Admin payment reconciliation queue for initiated/pending payments and callback details.
15. Transaction export as CSV for admins.
16. Admin activity/audit feed for uploads, publication changes, request status edits, notices, and payment events.
17. Student/member management with search, status, request count, and spending summary.
18. Admin analytics for revenue, request conversion, popular subjects, popular papers, and download trends.
19. Priority/pinned notices with expiry and an emergency-materials tag.
20. Account profile completion, stored phone validation, and a privacy-safe session/security panel.
21. Dashboard quick actions, contextual empty states, responsive mobile navigation, and accessible status chips.
22. Backup/readiness health information for Supabase tables and private Storage configuration.

## Design

Three intentionally low-probability alternatives considered: a dense institutional registry style (0.06), a youth-oriented neon social feed (0.04), and a pure black-and-white document archive (0.03). The selected direction is a calm **academic command center** that retains the supplied blue base but turns the portal into a clearer, more trustworthy operations workspace.

**Core principles:** strong information hierarchy, clear payment/download states, mobile-first student workflows, and quiet visual confidence. **Color philosophy:** navy establishes academic trust; a saturated Kenyan-teal accent signals successful learning and payment progress; warm amber is reserved for action-required states. **Layout paradigm:** a slim vertical command rail opens into a fluid activity canvas with a catalog focus on student pages and operational summaries on administrator pages. **Signature elements:** a circular paper-status meter, a receipt-like payment panel, and a slim notification ribbon for emergency content. **Interaction:** every payment, upload, and request has a visible next step with feedback instead of silent background changes. **Animation:** restrained 160–220 ms transitions for panels, state chips, and upload progress; no motion that obscures transaction status. **Typography:** Inter for compact operational UI and a dignified serif display only for welcome/section headers. **Brand essence:** “Kenya’s dependable revision-materials desk—request, pay, receive, and prepare.” Personality: capable, warm, organized. **Brand voice:** “Your paper is ready when you are.” and “Payment confirmed—your download is unlocked.” **Wordmark:** a stacked page-and-compass mark beside “COMREDS” in a compact uppercase wordmark. **Signature brand color:** Comreds Teal `#0C8D79`.

## Technical structure

- `public/` contains the responsive application shell, catalog/dashboard UI, accessible style system, route manifest, web manifest, and browser-side API client.
- `api/index.js` is the canonical Vercel API handler for account sessions, catalog searches, requests, notifications, favorites, paper management, signed uploads, protected downloads, analytics, CSV export, and Daraja STK/callback handlers.
- `api/db.js` preserves a server-only Supabase service-role client; `api/payment-proof.js` enforces callback matching.
- `supabase/schema.sql` is the idempotent source of schema for local setup; production changes are delivered as separately named incremental migrations after target/history checks.
- `.env.example`, `README.md`, and `DEPLOYMENT.md` document environment variables, migration order, Daraja verification, deployment and health checks.
- `package.json` provides local development and lightweight validation scripts without embedding secrets.

## Build workflow

1. Continue in the existing `ian-tech1/Comrades-site` repository on `main` without changing GitHub identity or credentials.
2. Implement reviewed additive schema changes and server API changes, including signed upload, secure download, notifications, audit data, and Daraja callback reconciliation.
3. Rebuild the browser interface and responsive styling around the enhanced student and administrator workflows.
4. Add deployment documentation, Vercel environment templates, a route manifest, and local validation scripts.
5. Run syntax checks and a local Vercel development smoke check with placeholder configuration only. No production payment, Supabase data mutation, or M-Pesa STK prompt is attempted during that original phase.
6. Package the finished Vercel-ready project as a ZIP and provide the exact deployment steps for Vercel and Supabase.

## Constraints

No Daraja credentials or Vercel production configuration are available in this repository checkout, so this task cannot run a live M-Pesa prompt, deploy the application, or validate Safaricom delivery end to end. The linked Supabase project was confirmed as the intended Comreds portal by its matching `profiles`, `paper_requests`, `payments`, `payment_events`, `result_requests`, and portal migration history. Reviewed v16.4 setup/uniqueness and v16.5 provenance/archive migrations were applied; v16.5.1 and v16.5.2 were applied only after bounded duplicate/orphan preflights. The v16.5.3 archive/STK locking migration was applied and its ledger entry, payment guard trigger, and service-role-only RPC execution (with authenticated execution denied) were verified. Existing financial rows were not deleted or rewritten.

## 2026-11-22 — learner service, pricing, profile and account-recovery upgrade

### Scope and implementation approach

Keep the existing Vercel Functions + Supabase server-only service-role architecture and the existing Daraja STK/callback implementation. Add a separate supplementary/refer registration request record for failed exams, retain the existing private results-request workflow, and extend payment records with nullable references to academic service requests. Each academic request snapshots its configured fee when submitted; the server, not the browser, chooses the price and verifies owner, amount, payer phone and receipt before recording payment. Paper purchases keep their current request/payment behavior. Additive, idempotent Supabase SQL changes must be applied only to the confirmed project, in reviewed stages, before deploying this code.

Add administrator-controlled prices for paper defaults, results requests, and supplementary/refer registrations under System Settings. Learners can view and pay each service request through the same M-Pesa flow, see payment/request status, and retry eligible failures. Admins can review and progress each service request. Payment success and service-status changes produce notifications and audit entries.

Store learner profile photos in a dedicated Supabase Storage bucket. Generate user-scoped upload paths and short-lived signed upload URLs on the server, validate image bytes and size before accepting a profile photo, and show an avatar fallback when no image exists. Profile photo uploads use JPEG, PNG, or WebP, up to 3 MB.

Forgotten-password recovery will be administrator-mediated: admins can generate a one-time temporary password from Manage Members; the learner must change it immediately after signing in. Resetting a password increments a session version to revoke older sessions and writes an audit event. No email-based reset is added because the repository has no configured email-delivery provider; the sign-in view will clearly direct learners to the administrator.

### Additional advanced enhancements (25)

1. A learner-facing supplementary/refer registration form for failed exams, matching the existing results workflow's visual treatment.
2. Capture institution, registration/admission identifiers, failed units, exam period and optional learner notes.
3. Restrict each learner's refer-request list and status lookup to their own records.
4. Provide a clear refer-request lifecycle: requested, processing, registered or rejected.
5. Add a dedicated administrator queue with learner identity and refer-request details.
6. Add separate administrator prices for papers, results requests and refer registrations.
7. Snapshot each service fee at request creation so later price edits do not change existing requests.
8. Display the applicable fee and payment state beside each learner service request.
9. Reuse server-side Daraja STK checkout for results and refer services.
10. Validate service-request ownership on every payment attempt.
11. Prevent duplicate active STK prompts for the same service request.
12. Allow eligible failed service payments to be retried without duplicating the request.
13. Require a verified callback with matching amount, phone and unique receipt before marking an academic service paid.
14. Preserve service-specific receipts in payment history and the admin export.
15. Allow an administrator to record a verified manual M-Pesa receipt against an academic service request.
16. Notify administrators when a learner submits a paid academic service request.
17. Notify learners when a service payment is confirmed or its processing status changes.
18. Apply server-side validation, duplicate-submission protection and per-user rate limits to academic service requests.
19. Allow learners to upload a profile photo through a server-issued, user-scoped signed upload URL.
20. Restrict profile images to JPEG/PNG/WebP and 3 MB, verifying stored bytes and size server-side.
21. Replace the prior avatar only after the new one is verified and clean up the previous object.
22. Show learner photos in the application header and profile editor, with initials fallback and upload preview.
23. Add a clear forgotten-password recovery message on the sign-in screen.
24. Let admins generate a one-time temporary learner password and require the learner to set a new password at next sign-in.
25. Revoke old sessions and audit administrator password resets and profile-photo changes.

### Design and project structure

Reuse the current premium academic command-center style: keep the navy rail, bright teal/blue action palette, card surfaces and compact status pills. Reorganize learner task entry around clearly named service sections, improve mobile navigation and make form/payment states more visible. Preserve the current static frontend structure (`public/index.html`, `public/app.js`, `public/style.css`), the canonical API in `api/index.js`, helper tests in `tests/`, and the additive schema in `supabase/schema.sql`; update `README.md`, `DEPLOYMENT.md`, and `TODO.md` with the migration and operational requirements.

### Material constraints

No email provider, Daraja credentials, or Vercel production configuration are present in this checkout. The linked Supabase project has now been verified as the intended portal from its schema and migration history. Production readiness still requires Vercel configuration/deployment and a sandbox callback test; do not trigger a real M-Pesa payment.

## 2026-11-22 — payment proof, downloadable receipts and safe records hygiene

### Implementation approach

Extend each payment with the Safaricom callback transaction timestamp, actual payer phone, optional payer name plus its evidence source, confirmation source, reconciliation state, and archive metadata. Generate a small server-side PDF receipt for each confirmed payment using the existing session and payment-owner authorization; do not persist a duplicate receipt file or expose service-role credentials. Include the portal account identity, linked service/request, amount, M-Pesa receipt, payer phone/name provenance and transaction time. A payment name is shown as unavailable unless a verified external field or an administrator-verified M-Pesa record supplied it. Do not treat the prompted phone as the registered payer name.

Improve the callback path to preserve successful evidence, parse the callback's transaction date, report proof mismatches, prevent duplicate receipt assignment, and retain callback events for reconciliation. Add an administrator reconciliation action for pending STK requests that records the provider query result but does not mark a payment paid from a status query alone; full payment requires a matching receipt, amount and payer phone from an authenticated callback or an audited administrator verification. Let administrators enter an actual payer name, payer phone and transaction time only when they have checked an M-Pesa receipt/statement, and record that source in audit history.

Use archive/hide/restore metadata for paper, results and refer requests and payment records. The ordinary delete action can remove an unconfirmed request only when no payment attempt references it and must preserve a deletion audit record. Confirmed financial ledger rows are never hard-deleted. Add a visible refresh action, last-refreshed time, filter reset and an archived-record toggle. Keep archived state in the dashboard API and audit every archive/restore operation.

### Ten additional advanced upgrades

1. Automatically available downloadable PDF receipts for a confirmed payment, visible to its learner and portal administrators.
2. Transaction-date capture from the M-Pesa callback, with the source timezone retained and system-confirmation fallback clearly labeled.
3. Separate stored fields for registered learner identity and actual payer identity, including phone and a trustworthy name-source label.
4. Durable idempotent callback-event recording, duplicate-receipt prevention and visible review state when successful callback proof does not match the request.
5. An admin pending-payment reconciliation queue that checks Daraja STK Query and never treats a positive query result alone as payment proof.
6. Audited admin verification for payments whose callback was missed, capturing the real payer phone, optional verified name, receipt, amount and payment time.
7. Manual transaction refresh, periodic background refresh while a transaction page is open, last-refresh feedback and one-click filter reset.
8. Archive, restore and show-archived controls for requests and payments without deleting confirmed financial history.
9. Expanded admin CSV export with payment confirmation time, payer name/provenance, phone, receipt and archive state.
10. Operational audit/alerts for unmatched or mismatched callbacks and regression checks for receipt ownership, duplicate handling, archive safety and reconciliation safeguards.

## 2026-11-22 — receipt design, legacy-paper recovery and visual polish

### Implementation approach

Keep the established academic command-center identity, but deepen the page surfaces with layered blue/teal gradients, clearer color-coded states and more deliberate responsive spacing. Use a lightweight vector WhatsApp-style mark and normalize Kenyan mobile numbers to `254` plus nine digits before constructing `wa.me` links. Render a distinct, accessible rainbow loader for initial and dashboard loading states; honor reduced-motion preferences. Make dashboard errors retryable and visible rather than silently returning learners to sign-in.

Redesign the dependency-free PDF receipt as a branded, vector-drawn document with a strong amount hierarchy, readable transaction/account/payer sections, and explicit evidence-source labels. Keep the receipt private and role-scoped, and never imply that an M-Pesa prompt phone is the payer's verified name. Make learner name and paid service prominent in transaction rows, fixing the username fallback so an administrator's own username cannot appear as the learner's identity.

Treat `public.papers` as the canonical learner catalog. Restore only a verified legacy learning-paper object from the private `papers` bucket, at the configured paper price, while explicitly excluding result-file paths and any unverified objects. Keep normal catalog rendering metadata-driven; do not expose every Storage object as a paper. Current inspection found one orphaned KCSE paper file and one separate object under `results/`, which must remain excluded from the paper catalog.

### Design direction

Reuse and refine the existing premium academic command-center look: confident navy foundations, vivid teal/cyan/blue accents, warm high-contrast highlights, and clean white cards over a softly layered background. Keep text contrast high, forms compact but breathable, and mobile transaction/catalog views easy to scan. Use short transitions and an indeterminate rainbow sweep/spinner only for loading; support `prefers-reduced-motion` by removing nonessential animation. Preserve the existing DM Sans / Playfair Display pairing and current static frontend/API architecture.

### Twenty further advanced upgrades — proposals, not implemented here

1. Paper-file integrity scanner with checksum validation and broken-link alerts.
2. Versioned paper revisions with immutable edit history and restore points.
3. Safe bulk catalog import with preview, duplicate detection and rollback.
4. Syllabus/topic metadata and multi-facet paper search.
5. Full-text search across indexed paper text with OCR for scanned PDFs.
6. Learner bookmarks, annotations and synced study notes.
7. Practice quizzes generated from admin-approved question banks.
8. Topic-level learner progress and weak-area dashboards.
9. Personalized revision plans based on exam dates and completed topics.
10. Study timetable builder with optional reminders.
11. Offline/PWA access for already purchased materials.
12. Paper feedback/report queue for outdated or corrupt materials.
13. Verified learner ratings and moderated paper reviews.
14. Subject-based moderated study groups and discussion threads.
15. Tutor/teacher appointment requests and availability slots.
16. Exam countdown calendar with milestone checklist.
17. Accessibility controls for text scaling, contrast and dyslexia-friendly type.
18. Swahili/English interface localization and translated notices.
19. Admin audit-log search, export and retention controls.
20. Automated backup/restore drills and storage/database integrity reporting.

### Project structure and constraints

Keep the UI in `public/app.js` and `public/style.css`; add focused pure helpers for M-Pesa timestamps and PDF receipt bytes under `api/`; keep authorization, persistence, reconciliation, archive and callback routes in `api/index.js`; add additive payment/request columns and indexes to `supabase/schema.sql`; and extend focused tests and `DEPLOYMENT.md`. The callback format reviewed from a technical Daraja integration guide supplies `Amount`, `MpesaReceiptNumber`, `TransactionDate`, and `PhoneNumber`, but does not supply the payer's registered name. Safaricom's public API pages identify M-Pesa Express and Transaction Status as APIs without displaying full response schemas on the accessible page; live credentials and an end-to-end sandbox prompt are not present. Therefore no implementation can promise that no payment will ever be missed; the product must surface callback gaps and reconciliation work rather than falsely declaring a payment successful.

## 2026-11-22 — welcome page and selectable login presentation

Keep the current authentication routes, fields, session handling, learner registration, and administrator access toggle. Use the supplied CDACC sample image as the welcome-page visual and layer the real username/email and password form over its pictured sign-in area as live HTML controls; do not rely on or pretend that rasterized fields in the image work. Preserve the existing credentials, routes, session behavior, registration and administrator toggle. On small screens, keep the live form readable and operable while it overlaps the artwork. Add three presentation choices—CDACC sample, existing Comreds, and navy/teal—persisted as an allow-listed `portal_settings.login_design` value and selectable only by administrators in System Settings. Expose only the selected design through the public `/api/me` response so signed-out visitors see the admin-selected treatment; the dashboard settings also include it. Store the supplied image under `public/images/`, keep the CSS responsive and accessible, and retain the existing login layout as the `classic` option.

# Comreds Papers Portal — implementation status

- [x] Repair admin document uploads using Supabase-issued signed upload URLs, validation, progress, retry, and post-upload verification.
- [x] Preserve student paper requests, availability checks, payment tracking, protected downloads, emergency papers, student dashboard, and admin dashboard.
- [x] Add Daraja STK Push using the configured sandbox default phone `+254723278526`, with server-only credentials and callback handling.
- [x] Make M-Pesa callbacks idempotent and validate checkout ID, merchant ID, amount, phone, receipt, and guarded request/payment transitions.
- [x] Add request matching and in-app notifications when requested papers become available.
- [x] Add catalog metadata, filtering/search, favorites, download history, receipts, retries, reconciliation, CSV export, audit log, analytics, notice priority/expiry, profile completion, security panel, and health/readiness visibility.
- [x] Add Supabase migration fields/tables/indexes while retaining compatibility with existing six tables.
- [x] Add responsive polished academic command-center styling and route manifest.
- [x] Add Vercel deployment documentation and environment examples without committing secrets.
- [x] Run syntax, schema, and local smoke validation; package the final Vercel-ready ZIP.

- [ ] Run the Supabase v3.1 migration, add Vercel environment variables, configure Daraja sandbox credentials/callback, and perform a real sandbox upload/STK/download smoke test.
- [x] Make the M-Pesa default number editable and validated from Admin → System Settings, with saved settings taking precedence for new STK requests.
- [x] Add 20 further advanced feature foundations: support tickets, ratings, collections, saved searches, version history, coupons, study plans, referrals, reporting, messaging, device notifications, login events, download limits, analytics, CSV exports, archive controls, bulk status actions, profile updates, and notification access.
- [x] Match the supplied dashboard reference with navy navigation, blue command header, notification badge, colored metric cards, quick actions, transaction chart, and request-status visualization.
- [x] Add 10 more advanced feature foundations: exam calendars, learner leaderboards, achievement badges, referral rewards, offline downloads, paper annotations, class groups, group membership, moderation queues, and scheduled maintenance windows.

- [x] Expand uploads to PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, CSV, TXT, RTF, ODT, ODS, and ODP with a 25 MB limit.
- [x] Reduce duplicate storage with SHA-256 checksums, content-addressed paths, unique checksum indexes, and storage metadata.
- [x] Add 10 storage/document feature foundations: usage dashboard, duplicate-savings accounting, preview variants, text indexing, malware scan queue, compression jobs, retention policies, upload batches, batch items, and MIME/size governance.

- [x] Confirm verified M-Pesa callback automatically marks requests paid and unlocks protected downloads.
- [x] Display and retain M-Pesa receipt codes in learner receipts and admin transactions.
- [x] Allow deletion of unpaid requests with ownership/admin authorization and audit logging.
- [x] Add the v16.1 set of 25 payment, receipt, reconciliation, access-control, and request-lifecycle updates.

- [x] Upgrade the interface beyond the supplied reference with a premium command-center visual system, deeper hierarchy, richer surfaces, improved tables, and responsive mobile behavior.
- [x] Add 20 advanced feature foundations: goals, progress, flashcards, quizzes, recommendations, share links, scheduled notifications, email/SMS queues, disputes, refunds, subscriptions, webhooks, feature flags, and consent records.

## Learner service, pricing, profile and recovery update (2026-11-22)

- [x] **Paid results and supplementary/refer service requests.** Add a learner-facing section to request registration for supplementary/refer exams for failed exams using almost the same style as checking for results; capture institution, registration/admission identifiers, failed units, exam period and optional notes; let each learner see only their own requests and payment/status; provide admin review and status progress; let the admin set prices for each requested task under System Settings; snapshot each service's price at submission; require payment for each priced service request; reuse M-Pesa STK and the verified callback safeguards; prevent duplicate pending prompts, allow retry after eligible payment failure, and support audited manual M-Pesa receipt confirmation; retain service receipts and issue learner/admin notifications on payment and status changes.
- [x] **Learner profile photos.** Let learners add or replace a profile photo from My Profile; accept only JPEG, PNG or WebP up to 3 MB; use server-issued user-scoped signed uploads, verify stored image bytes and size before linking the photo to the profile, remove an old image only after a replacement succeeds, and show the photo in the app header/profile editor with an initials fallback and upload preview.
- [x] **Forgotten-password recovery and admin reset.** Add sign-in guidance for learners who forgot their password; allow an admin to generate a one-time temporary learner password; require the learner to change that temporary password at the next sign-in; revoke older sessions after reset; and audit administrator resets without logging the generated password.
- [x] **25 advanced feature upgrades.** Deliver the 25 capabilities enumerated in the 2026-11-22 scope in `plan.md`: (1) a results-style supplementary/refer form, (2) institution/registration/admission/failed-unit/exam-period/notes capture, (3) owner-only refer request visibility, (4) requested/processing/registered/rejected lifecycle, (5) admin review queue, (6) separate paper/results/refer prices, (7) request-time fee snapshots, (8) learner-facing fee/payment state, (9) Daraja service checkout, (10) payment ownership validation, (11) duplicate active-prompt prevention, (12) retry of eligible failed payments, (13) callback validation against amount/phone/unique receipt, (14) service receipts in history/export, (15) audited manual payment confirmation, (16) admin submission notifications, (17) learner payment/status notifications, (18) validation/duplicate protections/rate limits, (19) signed user-scoped avatar uploads, (20) image MIME/size verification, (21) safe photo replacement and cleanup, (22) header/profile avatar display with preview/fallback, (23) forgotten-password help text, (24) one-time admin reset with forced change, and (25) session revocation plus reset/photo audit events.
- [x] **Improved arrangement and display.** Improve the order and visual grouping of learner service actions, payment states and admin service settings; keep the existing academic command-center identity; make the learner/admin views adapt cleanly to phone, tablet and desktop widths; and preserve accessible, keyboard-usable form controls and status feedback.
- [x] **Deployment and migration guidance.** Update the full idempotent Supabase migration, health-check requirements and operator documentation for the new service fees, service-payment references, refer requests, profile-photo bucket and password/session fields; clearly state that production use requires applying the migration to the correct Supabase project before deploying the code.

- [ ] **Production migration and smoke test.** Apply the full `supabase/schema.sql` in the correct Supabase project, configure the Vercel environment and Daraja sandbox callback, deploy the updated code, and verify health, private avatar access, learner ownership isolation, service payment callbacks, and result downloads. This task has not used production credentials or performed remote writes.

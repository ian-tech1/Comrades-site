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

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

- `public/` will contain the responsive application shell, catalog/dashboard UI, accessible style system, route manifest, web manifest, and browser-side API client.
- `api/index.js` is the canonical Vercel API handler for account sessions, catalog searches, requests, notifications, favorites, paper management, signed uploads, protected downloads, analytics, CSV export, and Daraja STK/callback handlers; `vercel.json` rewrites `/api/*` requests into this handler.
- `api/db.js` will preserve a server-only Supabase service-role client.
- `supabase/schema.sql` will become an idempotent migration safe for an existing portal database, adding only the new fields/tables/indexes required by the upgrade.
- `.env.example`, `README.md`, and `DEPLOYMENT.md` will document every Vercel environment variable, the required Supabase migration, Daraja sandbox verification, production activation, and health checks.
- `package.json` will provide local Vercel development and lightweight validation scripts without embedding secrets.

## Build workflow

1. Copy the supplied Vercel/Supabase project into the managed workspace and retain the Vercel function layout.
2. Implement the database migration and server API changes, including signed upload, secure download, notifications, audit data, and Daraja callback reconciliation.
3. Rebuild the browser interface and responsive styling around the enhanced student and administrator workflows.
4. Add deployment documentation, Vercel environment templates, a route manifest, and local validation scripts.
5. Run syntax checks and a local Vercel development smoke check with placeholder configuration only. No production payment, Supabase write, or M-Pesa STK prompt will be attempted.
6. Package the finished Vercel-ready project as a ZIP and provide the exact deployment steps for Vercel and Supabase.

## Constraints

A live M-Pesa STK Push cannot be initiated or verified without actual Daraja credentials and an externally reachable deployed callback URL. Payment confirmation also relies on Safaricom’s asynchronous callback. Administrators must run the updated `supabase/schema.sql` in the selected Supabase project and add the documented environment variables in Vercel before production use.

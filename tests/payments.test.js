import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  formatDarajaTimestamp,
  formatMpesaTransactionDate,
  normalizeKenyanPhone,
  parseMpesaTransactionDate,
} from "../api/mpesa-transaction.js";
import { createReceiptPdf } from "../api/receipt-pdf.js";

const root = new URL("../", import.meta.url);

test("Safaricom transaction date is parsed as EAT, validated, and displayed in Nairobi time", () => {
  const timestamp = parseMpesaTransactionDate("20261122084015");
  assert.equal(timestamp, "2026-11-22T05:40:15.000Z");
  assert.match(formatMpesaTransactionDate(timestamp), /08:40:15/);
  assert.match(formatMpesaTransactionDate(timestamp), /EAT/);
  assert.equal(parseMpesaTransactionDate("20260230084015"), null);
  assert.equal(parseMpesaTransactionDate("202611220840"), null);
  assert.equal(formatMpesaTransactionDate("not-a-date"), "Not supplied");
});
test("Daraja request timestamps use Africa/Nairobi local time", async () => {
  assert.equal(
    formatDarajaTimestamp("2026-11-22T05:40:15.000Z"),
    "20261122084015",
  );
  assert.equal(formatDarajaTimestamp("invalid"), null);
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    queryStart = api.indexOf("async function queryStk(id)"),
    queryEnd = api.indexOf("async function notify", queryStart),
    pushStart = api.indexOf("async function startSTK(", queryEnd),
    pushEnd = api.indexOf(
      'if (method === "POST" && path === "/api/mpesa/callback")',
      pushStart,
    );
  assert.ok(queryStart >= 0 && queryEnd > queryStart);
  assert.ok(pushStart >= 0 && pushEnd > pushStart);
  assert.match(api.slice(queryStart, queryEnd), /formatDarajaTimestamp\(\)/);
  assert.match(api.slice(pushStart, pushEnd), /formatDarajaTimestamp\(\)/);
});

test("Kenyan payer phone normalization accepts local and international forms only", () => {
  assert.equal(normalizeKenyanPhone("0712 345 678"), "254712345678");
  assert.equal(normalizeKenyanPhone("0112 345 678"), "254112345678");
  assert.equal(normalizeKenyanPhone("+254 712 345 678"), "254712345678");
  assert.equal(normalizeKenyanPhone("25471234567"), null);
  assert.equal(normalizeKenyanPhone("0700"), null);
});

test("PDF receipt output carries payer provenance and registered-account details", () => {
  const pdf = createReceiptPdf({
    portalName: "Comreds Portal",
    receipt: "ABC1234567",
    status: "Confirmed",
    service: "Results request",
    requestReference: "REG-101",
    amount: 125,
    paidAt: "22 Nov 2026, 08:40:15 EAT",
    paidAtSource: "Safaricom callback transaction time (EAT)",
    studentName: "Amina Student",
    username: "amina_1",
    email: "amina@example.test",
    registeredPhone: "+254700000000",
    payerName: "John Payer",
    payerNameSource: "Administrator verified against M-Pesa evidence",
    paidPhone: "254711111111",
    confirmationSource: "Administrator verified M-Pesa evidence",
  });
  const body = pdf.toString("ascii");
  assert.ok(body.startsWith("%PDF-1.4"));
  for (const expected of [
    "ABC1234567",
    "Results request",
    "REG-101",
    "Amina Student",
    "amina_1",
    "John Payer",
    "254711111111",
    "Safaricom callback transaction time",
  ])
    assert.ok(body.includes(expected), `expected receipt content: ${expected}`);
});

test("PDF receipts label a request-submitted name separately from profile identity", () => {
  const body = createReceiptPdf({
    studentName: "",
    requestStudentName: "Amina Request Snapshot",
  }).toString("ascii");
  assert.ok(body.includes("Not available in profile"));
  assert.ok(body.includes("Name submitted on request"));
  assert.ok(body.includes("Amina Request Snapshot"));
});

test("receipt API only serves confirmed payments to the owner or an administrator", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf("const receiptMatch = path.match("),
    end = api.indexOf(
      'if (method === "GET" && path.startsWith("/api/payments/status/")',
      start,
    ),
    route = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireUser\(req, res\)/);
  assert.match(route, /\.eq\("status", "success"\)/);
  assert.match(route, /payment\.user_id !== u\.id/);
  assert.match(route, /application\/pdf/);
  assert.match(route, /private, no-store/);
  assert.match(route, /payerNameSource/);
  assert.match(route, /formatMpesaTransactionDate\(paidAt\)/);
  assert.match(route, /studentName: profileResult\.data\?\.name,/);
  assert.match(route, /requestStudentName: request\.student_name/);
  assert.doesNotMatch(
    route,
    /studentName: profileResult\.data\?\.name \|\| request\.student_name/,
  );
});

test("Daraja status queries are admin-only evidence notes and never mark a payment paid", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/reconcile")',
    ),
    end = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/verify")',
      start,
    ),
    route = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireUser\(req, res, "admin"\)/);
  assert.match(route, /provider_result_code/);
  assert.match(route, /provider_checked_at/);
  assert.match(route, /provider_success_pending_proof/);
  assert.match(route, /awaiting_callback/);
  assert.doesNotMatch(route, /markPaid\s*\(/);
  assert.doesNotMatch(route, /status:\s*["']success["']/);
});

test("callback uniqueness conflicts remain visible for manual review", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf(
      'if (method === "POST" && path === "/api/mpesa/callback")',
    ),
    end = api.indexOf("const receiptMatch = path.match(", start),
    route = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /updateError\?\.code === "23505"/);
  assert.match(route, /status: "review_required"/);
  assert.match(route, /payment\.callback\.unique_conflict/);
  assert.match(route, /await notifyAdmins\(/);
});

test("manual reconciliation verifies an existing payment with exact evidence and audit", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/verify")',
    ),
    end = api.indexOf(
      'if (method === "POST" && path === "/api/records/archive")',
      start,
    ),
    route = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /requireUser\(req, res, "admin"\)/);
  assert.match(route, /amount !== Number\(pay\.amount\)/);
  assert.match(route, /\.eq\("receipt", code\)/);
  assert.match(route, /status: "success"/);
  assert.match(route, /confirmation_source: "admin_verified"/);
  assert.match(route, /payment\.manual_reconciled/);
  assert.match(route, /await markPaid\(updated, code, amount\)/);
});

test("archived requests cannot start a new payment or accept manual confirmation", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    stkStart = api.indexOf(
      'if (method === "POST" && path === "/api/payments/stk")',
    ),
    stkEnd = api.indexOf(
      'if (method === "POST" && path === "/api/mpesa/callback")',
      stkStart,
    ),
    serviceStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/service-manual")',
    ),
    paperStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/manual")',
      serviceStart,
    ),
    paperEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/papers/upload")',
      paperStart,
    );
  assert.ok(stkStart >= 0 && stkEnd > stkStart);
  assert.match(api.slice(stkStart, stkEnd), /r\.archived_at/);
  assert.match(api.slice(serviceStart, paperStart), /request\.archived_at/);
  assert.match(api.slice(paperStart, paperEnd), /r\.archived_at/);
});

test("learner and admin transaction pages refresh automatically without query storms", async () => {
  const [api, app] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
  ]);
  assert.match(app, /"Payments",\s*"Transaction History"/);
  assert.match(app, /setInterval\(async \(\) =>/);
  assert.match(app, /data-archive-type="results"/);
  assert.match(app, /data-reconcile-payment/);
  assert.match(app, /\/api\/admin\/payments\/verify/);
  assert.match(api, /provider_checked_at\s*\|\|\s*servicePayment\.created_at/);
  assert.match(api, /provider_checked_at\s*\|\|\s*pay\.created_at/);
  assert.match(api, /30000/);
  assert.match(app, /payerPhone = x\.paidPhone \|\| "—"/);
  assert.match(app, /timeZone: "Africa\/Nairobi"/);
});

test("manual verification stores separate verified payer evidence and transaction-time source", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf("function manualPaymentEvidence(body)"),
    end = api.indexOf("async function markPaid", start),
    helper = api.slice(start, end),
    serviceStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/service-manual")',
    ),
    paperStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/manual")',
      serviceStart,
    ),
    paperEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/papers/upload")',
      paperStart,
    ),
    serviceRoute = api.slice(serviceStart, paperStart),
    paperRoute = api.slice(paperStart, paperEnd);
  assert.match(
    helper,
    /normalizeKenyanPhone\(body\.payerPhone \|\| body\.phone\)/,
  );
  assert.match(
    helper,
    /payerNameSource: payerName \? "admin_verified" : "unavailable"/,
  );
  assert.match(helper, /paidAtSource = "admin_recorded_at"/);
  assert.match(helper, /paidAtSource = "admin_verified"/);
  for (const route of [serviceRoute, paperRoute]) {
    assert.match(route, /confirmation_source: "admin_verified"/);
    assert.match(route, /payer_name_source: evidence\.payerNameSource/);
    assert.match(route, /payment_events/);
    assert.match(route, /payerName: evidence\.payerName/);
    assert.match(route, /error\?\.code === "23514"/);
  }
  assert.match(serviceRoute, /amount !== Number\(request\.service_fee\)/);
  assert.match(paperRoute, /amount !== Number\(r\.amount\)/);
});

test("archive route is reversible and preserves pending/successful payment history", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf(
      'if (method === "POST" && path === "/api/records/archive")',
    ),
    end = api.indexOf(
      'if (method === "POST" && path === "/api/admin/papers/update")',
      start,
    ),
    route = api.slice(start, end),
    requestDeleteStart = api.indexOf(
      'if (method === "DELETE" && path.startsWith("/api/requests/"))',
    ),
    requestDeleteEnd = api.indexOf(
      'if (method === "POST" && path === "/api/payment',
      requestDeleteStart,
    ),
    deleteRoute = api.slice(requestDeleteStart, requestDeleteEnd);
  assert.ok(start >= 0 && end > start);
  assert.match(route, /"archive", "restore"/);
  assert.match(route, /set_request_archive_state/);
  assert.doesNotMatch(route, /\.from\(target\.table\)\s*\.update/);
  assert.match(route, /This request has a pending payment attempt/);
  assert.doesNotMatch(route, /\.delete\s*\(/);
  assert.match(deleteRoute, /payment attempt/);
  assert.match(deleteRoute, /Archive it instead/);
  assert.match(deleteRoute, /delete_unpaid_paper_request/);
  assert.match(deleteRoute, /You can only delete your own requests/);
  assert.ok(
    deleteRoute.indexOf("q.data.user_id !== u.id") <
      deleteRoute.indexOf('q.data.status === "paid"'),
  );
  const cleanupMigration = await readFile(
    new URL(
      "supabase/migrations/20261122055805_v16_5_2_safe_cleanup_receipts.sql",
      root,
    ),
    "utf8",
  );
  assert.match(cleanupMigration, /on delete restrict/i);
  assert.match(cleanupMigration, /upper\(btrim\(receipt\)\)/i);
  assert.match(cleanupMigration, /for update/i);
  assert.match(cleanupMigration, /request_deletion_logs/i);
  assert.match(cleanupMigration, /payments where request_id = p_request_id/i);
  assert.match(cleanupMigration, /grant execute .* to service_role/i);
  const archiveMigration = await readFile(
    new URL(
      "supabase/migrations/20261122060611_v16_5_3_atomic_archive_stk_guard.sql",
      root,
    ),
    "utf8",
  );
  assert.match(archiveMigration, /before insert on public\.payments/i);
  assert.match(archiveMigration, /for update/i);
  assert.match(archiveMigration, /set_request_archive_state/i);
  assert.match(archiveMigration, /'paper', 'results', 'refer', 'payment'/i);
  assert.match(
    archiveMigration,
    /actor_role <> 'admin' and owner_id <> p_actor_id/i,
  );
  assert.match(
    archiveMigration,
    /record_status in \('initiated', 'pending'\)/i,
  );
  assert.match(archiveMigration, /insert into public\.audit_logs/i);
  assert.match(archiveMigration, /grant execute .* to service_role/i);
  assert.match(route, /set_request_archive_state/);
});

test("v16.5 schema is additive and includes source constraints plus archive indexes", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20261122054337_v16_5_payment_proof_receipts_reconciliation_archival.sql",
        root,
      ),
      "utf8",
    ),
  ]);
  for (const name of [
    "paid_at",
    "paid_at_source",
    "payer_name",
    "payer_name_source",
    "confirmation_source",
    "reconciliation_status",
    "provider_result_code",
    "provider_checked_at",
    "archived_at",
  ]) {
    assert.match(schema, new RegExp(`add column if not exists ${name}`));
    assert.match(migration, new RegExp(`add column if not exists ${name}`));
  }
  assert.match(migration, /payments_active_archive_idx/);
  assert.match(migration, /result_requests_active_archive_idx/);
  assert.doesNotMatch(migration, /\b(drop|truncate|delete from)\b/i);
});

test("health checks require v16.5 columns and avoid unsafe full-schema advice", async () => {
  const api = await readFile(new URL("api/index.js", root), "utf8"),
    start = api.indexOf('if (method === "GET" && path === "/api/health")'),
    end = api.indexOf(
      'if (method === "POST" && path === "/api/register")',
      start,
    ),
    health = api.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const column of [
    "paid_at",
    "paid_at_source",
    "payer_name",
    "payer_name_source",
    "confirmation_source",
    "reconciliation_status",
    "provider_checked_at",
    "archived_at",
    "archive_reason",
  ])
    assert.ok(
      health.includes(`"${column}"`),
      `health check requires ${column}`,
    );
  assert.match(health, /Do not run the full schema on an existing portal/);
  assert.doesNotMatch(health, /Run supabase\/schema\.sql/);
});

test("paper-payment uniqueness migration is additive and preflight documented", async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20261122054812_v16_5_1_paper_payment_success_uniqueness.sql",
        root,
      ),
      "utf8",
    ),
  ]);
  for (const sql of [schema, migration]) {
    assert.match(sql, /payments_one_successful_paper_request_idx/);
    assert.match(sql, /request_id is not null and status = 'success'/);
  }
  assert.match(migration, /having count\(\*\) > 1 limit 100/i);
  assert.doesNotMatch(migration, /\b(drop|truncate|delete from)\b/i);
});
test("PDF receipts use a branded visual hierarchy while retaining payment provenance", () => {
  const body = createReceiptPdf({
    portalName: "Comreds Papers Portal",
    receipt: "VISUAL123",
    status: "Confirmed",
    service: "Refer registration",
    requestReference: "REF-100",
    amount: 400,
    paidAt: "22 Nov 2026, 08:40 EAT",
    paidAtSource: "Safaricom callback transaction time (EAT)",
    studentName: "Amina Student",
    payerName: "Not supplied by M-Pesa",
    payerNameSource: "Unavailable",
    paidPhone: "254711111111",
    confirmationSource: "Safaricom callback",
  }).toString("ascii");
  for (const expected of [
    "COMREDS PAPERS PORTAL",
    "PAYMENT RECEIPT",
    "AMOUNT RECEIVED",
    "KSh 400",
    "TRANSACTION DETAILS",
    "REGISTERED LEARNER ACCOUNT",
    "M-PESA PAYER EVIDENCE",
    "VISUAL123",
    "Safaricom callback transaction time",
    "Helvetica-Bold",
  ])
    assert.ok(
      body.includes(expected),
      `expected redesigned receipt content: ${expected}`,
    );
});

test("WhatsApp support settings normalize Kenyan mobile contacts and link directly to the admin", async () => {
  const [api, app] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
  ]);
  const settingsStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/settings")',
    ),
    settingsEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/requests/status")',
      settingsStart,
    ),
    settingsRoute = api.slice(settingsStart, settingsEnd);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  assert.match(settingsRoute, /normalizeKenyanPhone\(rawPhone\)/);
  assert.match(settingsRoute, /support_phone: phone/);
  assert.match(app, /function normalizeKenyanWhatsApp\(value\)/);
  assert.match(app, /254\[17\]\\d\{8\}/);
  assert.match(app, /https:\/\/wa\.me\/\$\{number\}/);
  assert.match(app, /aria-label[\s\S]*WhatsApp/);
});

test("transaction rows identify the learner and exact service without borrowing an admin username", async () => {
  const app = await readFile(new URL("public/app.js", root), "utf8");
  assert.match(app, /learnerName =/);
  assert.match(
    app,
    /verifiedLearnerName =\s*learner\.name \|\|\s*\(selfPayment \? state\.user\?\.name : ""\)/,
  );
  assert.match(app, /learnerNameLabel = verifiedLearnerName/);
  assert.match(app, /Name submitted on request/);
  assert.match(
    app,
    /learnerUsername =\s*learner\.username \|\| \(selfPayment \? state\.user\.username : ""\)/,
  );
  assert.match(app, /<small class="muted payment-meta">Service paid<\/small>/);
  assert.match(app, /Academic results request/);
  assert.match(app, /Refer registration/);
  assert.match(app, /Name unavailable/);
});

test("initial rainbow loading is accessible, honors reduced motion, and dashboard failures offer retry", async () => {
  const [app, css, html] = await Promise.all([
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("public/style.css", root), "utf8"),
    readFile(new URL("public/index.html", root), "utf8"),
  ]);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(css, /conic-gradient\(\s*#ff3d71/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(app, /id="retryDashboard"/);
  assert.match(app, /Could not refresh portal data/);
});

test("admin-selectable welcome designs preserve existing sign-in behavior and expose only the public preference", async () => {
  const [api, app, css, schema, migration, image] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("public/style.css", root), "utf8"),
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20261122072000_configurable_login_design.sql",
        root,
      ),
      "utf8",
    ),
    readFile(new URL("public/images/cdacc-exam-portal-welcome.jpg", root)),
  ]);
  const meStart = api.indexOf('if (method === "GET" && path === "/api/me")'),
    meEnd = api.indexOf(
      'if (method === "GET" && path === "/api/dashboard")',
      meStart,
    ),
    settingsStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/settings")',
    ),
    settingsEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/requests/status")',
      settingsStart,
    ),
    meRoute = api.slice(meStart, meEnd),
    settingsRoute = api.slice(settingsStart, settingsEnd);

  assert.ok(meStart >= 0 && meEnd > meStart);
  assert.match(meRoute, /currentUser\(req\)/);
  assert.match(meRoute, /loginDesign:\s*settings\.login_design \|\| "cdacc"/);
  assert.doesNotMatch(meRoute, /supportPhone|paperPrice|password|secret/i);

  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  assert.match(settingsRoute, /requireUser\(req,\s*res,\s*"admin"\)/);
  assert.match(
    settingsRoute,
    /\["cdacc", "classic", "navy"\]\.includes\(loginDesign\)/,
  );
  assert.match(settingsRoute, /login_design:\s*loginDesign/);

  assert.match(app, /name="loginDesign"/);
  assert.match(app, /label for="loginDesign"/);
  assert.match(app, /select id="loginDesign" name="loginDesign"/);
  assert.match(app, /state\.loginDesign = x\.loginDesign \|\| "cdacc"/);
  assert.match(app, /state\.loginDesign = x\.settings\?\.loginDesign/);
  assert.match(
    app,
    /state\.mode === "register" \? "\/api\/register" : "\/api\/login"/,
  );
  assert.match(app, /Username or email/);
  assert.match(app, /name="password" type="password"/);
  assert.match(app, /Administrator access/);
  assert.match(app, /CDACC examination portal welcome sample/);

  for (const design of ["cdacc", "classic", "navy"])
    assert.match(css, new RegExp(`\\.auth-theme-${design}`));
  assert.match(schema, /login_design text not null default 'cdacc'/);
  assert.match(
    schema,
    /check \(login_design in \('cdacc', 'classic', 'navy'\)\)/,
  );
  assert.match(
    migration,
    /check \(login_design in \('cdacc', 'classic', 'navy'\)\)/,
  );
  assert.deepEqual([...image.subarray(0, 2)], [0xff, 0xd8]);
});

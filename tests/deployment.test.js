import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveRequestPath } from "../api/request-path.js";
import { isSameOriginRequest, safeEquals } from "../api/security.js";
import { isValidMpesaConfirmation } from "../api/payment-proof.js";

const root = new URL("../", import.meta.url);

test("Vercel rewritten API paths resolve to the original route", () => {
  assert.equal(resolveRequestPath("/api/index?__path=health"), "/api/health");
  assert.equal(
    resolveRequestPath("/api/index?__path=admin%2Fpapers%2Fupload"),
    "/api/admin/papers/upload",
  );
  assert.equal(resolveRequestPath("/api/health/"), "/api/health");
});

test("cross-origin mutations are rejected while same-origin and server callbacks work", () => {
  assert.equal(
    isSameOriginRequest({
      headers: { host: "portal.example", origin: "https://portal.example" },
    }),
    true,
  );
  assert.equal(
    isSameOriginRequest({
      headers: { host: "portal.example", origin: "https://attacker.example" },
    }),
    false,
  );
  assert.equal(
    isSameOriginRequest({ headers: { host: "portal.example" } }),
    true,
  );
});

test("callback secrets are compared without variable-length timing comparisons", () => {
  assert.equal(safeEquals("a-long-secret", "a-long-secret"), true);
  assert.equal(safeEquals("a-long-secret", "a-long-secreT"), false);
  assert.equal(safeEquals("short", "much-longer"), false);
});

test("M-Pesa callback proof requires a matching amount, payer phone, and receipt", () => {
  const proof = {
    resultCode: 0,
    amount: 50,
    expectedAmount: 50,
    payerPhone: "0712345678",
    expectedPhone: "254712345678",
    receipt: "ABC1234567",
  };
  assert.equal(isValidMpesaConfirmation(proof), true);
  assert.equal(isValidMpesaConfirmation({ ...proof, amount: 49 }), false);
  assert.equal(
    isValidMpesaConfirmation({ ...proof, payerPhone: "0711111111" }),
    false,
  );
  assert.equal(
    isValidMpesaConfirmation({ ...proof, receipt: undefined }),
    false,
  );
  assert.equal(isValidMpesaConfirmation({ ...proof, resultCode: 1 }), false);
});

test("status-query responses cannot unlock payments and receipts are unique", async () => {
  const [api, schema] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("supabase/schema.sql", root), "utf8"),
  ]);
  const statusStart = api.indexOf(
      'if (method === "GET" && path.startsWith("/api/payments/status/"))',
    ),
    statusEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/reconcile")',
      statusStart,
    ),
    statusRoute = api.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.doesNotMatch(statusRoute, /markPaid\s*\(/);
  assert.doesNotMatch(statusRoute, /status:\s*"success"/);
  assert.match(api, /if \(valid && updatedPayment\)/);
  assert.match(
    schema,
    /create unique index if not exists payments_receipt_normalized_unique_idx on public\.payments\(upper\(btrim\(receipt\)\)\) where receipt is not null;/i,
  );
});

test("academic results are account-scoped, admin-uploaded, and protected by RLS", async () => {
  const [api, schema] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("supabase/schema.sql", root), "utf8"),
  ]);
  const checkStart = api.indexOf(
      'if (method === "POST" && path === "/api/results/check")',
    ),
    checkEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/results/status")',
      checkStart,
    ),
    checkRoute = api.slice(checkStart, checkEnd),
    downloadStart = api.indexOf(
      'if (method === "GET" && path.startsWith("/api/results/download/"))',
    ),
    downloadEnd = api.indexOf(
      'if (method === "GET" && path === "/api/papers")',
      downloadStart,
    ),
    downloadRoute = api.slice(downloadStart, downloadEnd);
  assert.ok(checkStart >= 0 && checkEnd > checkStart);
  assert.match(checkRoute, /bodyJson\(req\)/);
  assert.match(checkRoute, /requireUser\(req, res, "student"\)/);
  assert.match(checkRoute, /\.eq\("user_id", u\.id\)/);
  assert.ok(downloadStart >= 0 && downloadEnd > downloadStart);
  assert.match(downloadRoute, /request\.user_id !== u\.id/);
  assert.match(
    downloadRoute,
    /createSignedUrl\(request\.result_storage_path, 120/,
  );
  assert.match(api, /requireUser\(req, res, "admin"\)/);
  assert.match(api, /pdfHeader !== "%PDF-"/);
  assert.match(
    schema,
    /alter table public\.result_requests enable row level security;/i,
  );
  assert.match(schema, /result_requests_deny_direct_client_access/i);
  assert.match(schema, /result_requests_uploaded_by_idx/i);
  assert.match(schema, /profiles_username_lower_unique_idx/i);
});

test("legacy students can set usernames and completed results remain closed in the UI", async () => {
  const [api, app] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
  ]);
  assert.match(api, /usernameInput && !isValidUsername\(username\)/);
  assert.match(api, /updates\.username = username/);
  assert.match(api, /That username is already in use\./);
  assert.match(app, /id="profileForm"/);
  assert.match(app, /r\.status === "completed" \? "disabled" : ""/);
});

test("deployment configuration targets the canonical API and Node 22 runtime", async () => {
  const [vercel, pkg] = await Promise.all([
    readFile(new URL("vercel.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  ]);
  assert.equal(vercel.functions["api/index.js"].maxDuration, 30);
  assert.equal(vercel.buildCommand, "npm run build");
  assert.equal(vercel.outputDirectory, "public");
  assert.equal(vercel.rewrites[0].destination, "/api/index?__path=:path*");
  assert.equal(pkg.engines.node, "22.x");
});

test("academic service payments reject closed requests and prevent duplicate confirmations", async () => {
  const [api, app, schema, deployment] = await Promise.all([
    readFile(new URL("api/index.js", root), "utf8"),
    readFile(new URL("public/app.js", root), "utf8"),
    readFile(new URL("supabase/schema.sql", root), "utf8"),
    readFile(new URL("DEPLOYMENT.md", root), "utf8"),
  ]);
  assert.match(
    api,
    /if \(u\.mustChangePassword\) return json\(res, 200, \{ user: u \}\);/,
  );
  const manualStart = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/service-manual")',
    ),
    manualEnd = api.indexOf(
      'if (method === "POST" && path === "/api/admin/payments/manual")',
      manualStart,
    ),
    manualRoute = api.slice(manualStart, manualEnd);
  assert.ok(manualStart >= 0 && manualEnd > manualStart);
  assert.match(manualRoute, /request\.status === "rejected"/);
  assert.match(manualRoute, /amount !== Number\(request\.service_fee\)/);
  assert.match(manualRoute, /paid_phone: phone/);
  assert.match(manualRoute, /error\?\.code === "23505"/);
  assert.match(
    schema,
    /payments_one_successful_results_request_idx[\s\S]*?status = 'success'/,
  );
  assert.match(
    schema,
    /payments_one_successful_refer_request_idx[\s\S]*?status = 'success'/,
  );
  assert.ok(
    (
      app.match(/r\.paymentStatus !== "paid" && r\.status !== "rejected"/g) ||
      []
    ).length >= 2,
  );
  assert.match(api, /createSignedUrl\(profile\.avatar_path, 120\)/);
  assert.match(
    deployment,
    /first execute only the v16\.4 setup statements[\s\S]*?Then run these checks/,
  );
});

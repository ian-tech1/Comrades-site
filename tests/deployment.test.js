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
      'if (method === "POST" && path === "/api/admin/papers/update")',
      statusStart,
    ),
    statusRoute = api.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.doesNotMatch(statusRoute, /markPaid\s*\(/);
  assert.doesNotMatch(statusRoute, /status:\s*"success"/);
  assert.match(api, /if \(valid && updatedPayment\)/);
  assert.match(
    schema,
    /create unique index if not exists payments_receipt_unique_idx on public\.payments\(receipt\) where receipt is not null;/i,
  );
});

test("deployment configuration targets the canonical API and Node 22 runtime", async () => {
  const [vercel, pkg] = await Promise.all([
    readFile(new URL("vercel.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
  ]);
  assert.equal(vercel.functions["api/index.js"].maxDuration, 30);
  assert.equal(vercel.rewrites[0].destination, "/api/index?__path=:path*");
  assert.equal(pkg.engines.node, ">=22");
});

import crypto from "node:crypto";
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";
import { db, supabaseUrl } from "./db.js";
import { resolveRequestPath } from "./request-path.js";
import { isSameOriginRequest, safeEquals } from "./security.js";
import { isValidMpesaConfirmation } from "./payment-proof.js";
import {
  formatDarajaTimestamp,
  formatMpesaTransactionDate,
  normalizeKenyanPhone,
  parseMpesaTransactionDate,
} from "./mpesa-transaction.js";
import { createReceiptPdf } from "./receipt-pdf.js";
import {
  isValidUsername,
  normalizeUsername,
  validateResultsRequest,
} from "./results.js";
import { detectAvatarMime, validateReferRequest } from "./service-requests.js";
export const config = { api: { bodyParser: false }, maxDuration: 30 };
const _clean = (v) =>
    typeof v === "string"
      ? v
          .trim()
          .split(/\s+/)[0]
          .replace(/^["']|["']$/g, "")
      : v,
  env = { ...process.env, SUPABASE_URL: supabaseUrl };
for (const k of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_STORAGE_BUCKET",
  "SESSION_SECRET",
  "DARAJA_CONSUMER_KEY",
  "DARAJA_CONSUMER_SECRET",
  "DARAJA_PASSKEY",
  "DARAJA_SHORTCODE",
  "DARAJA_PARTY_B",
  "DARAJA_TRANSACTION_TYPE",
  "DARAJA_ENV",
  "DARAJA_CALLBACK_URL",
  "DARAJA_CALLBACK_TOKEN",
])
  if (env[k]) env[k] = _clean(env[k]);
if (String(env.DARAJA_ENV || "").toLowerCase() === "production") {
  env.DARAJA_SHORTCODE = env.DARAJA_SHORTCODE || "1402050";
  env.DARAJA_PARTY_B = env.DARAJA_PARTY_B || "1869939";
  env.DARAJA_TRANSACTION_TYPE =
    env.DARAJA_TRANSACTION_TYPE || "CustomerBuyGoodsOnline";
}
if (
  !/^https:\/\//.test(env.DARAJA_CALLBACK_URL || "") ||
  /YOUR-|REPLACE/i.test(env.DARAJA_CALLBACK_URL || "")
) {
  const h = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (h) env.DARAJA_CALLBACK_URL = "https://" + h + "/api/mpesa/callback";
}
const supabase = createClient(
  env.SUPABASE_URL || "https://placeholder.supabase.co",
  env.SUPABASE_SERVICE_ROLE_KEY || "placeholder",
);
const BUCKET = env.SUPABASE_STORAGE_BUCKET || "papers",
  AVATAR_BUCKET = "avatars",
  now = () => new Date().toISOString();
const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".txt",
  ".rtf",
  ".odt",
  ".ods",
  ".odp",
];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/octet-stream",
];
process.on("unhandledRejection", (e) =>
  console.error("Unhandled rejection:", e),
);
process.on("uncaughtException", (e) => console.error("Uncaught exception:", e));
const _reqPath = (req) => resolveRequestPath(req.url);
const json = (res, status, data) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(JSON.stringify(data));
};
const fail = (res, status, message) => json(res, status, { error: message });
const cookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => {
        const i = x.indexOf("=");
        return [
          decodeURIComponent(x.slice(0, i)),
          decodeURIComponent(x.slice(i + 1)),
        ];
      }),
  );
const b64 = (x) => Buffer.from(x).toString("base64url"),
  sign = (x) =>
    crypto
      .createHmac("sha256", env.SESSION_SECRET || "")
      .update(x)
      .digest("base64url");
function setSession(res, u) {
  const p = b64(
    JSON.stringify({
      id: u.id,
      role: u.role,
      sessionVersion: Number(u.session_version || 0),
      exp: Date.now() + 604800000,
    }),
  );
  res.setHeader(
    "Set-Cookie",
    `comreds_session=${p}.${sign(p)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=604800`,
  );
}
function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    "comreds_session=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0",
  );
}
function session(req) {
  try {
    const [p, s] = (cookies(req).comreds_session || "").split(".");
    if (!p || s !== sign(p)) return null;
    const v = JSON.parse(Buffer.from(p, "base64url").toString());
    return v.exp > Date.now() ? v : null;
  } catch {
    return null;
  }
}
const safeUser = (u) => ({
  id: u.id,
  name: u.name,
  username: u.username || "",
  email: u.email,
  phone: u.phone || "",
  role: u.role,
  avatarUrl: u.avatar_path
    ? `/api/profile/avatar?userId=${encodeURIComponent(u.id)}`
    : "",
  mustChangePassword: Boolean(u.must_change_password),
  createdAt: u.created_at,
});
async function currentUser(req) {
  const s = session(req);
  if (!s) return null;
  const { data, error } = await db
    .from("profiles")
    .select(
      "id,name,username,email,phone,role,avatar_path,must_change_password,session_version,created_at",
    )
    .eq("id", s.id)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    Number(data.session_version || 0) !== Number(s.sessionVersion || 0)
  )
    return null;
  return safeUser(data);
}
async function requireUser(req, res, role) {
  const u = await currentUser(req);
  if (!u || (role && u.role !== role)) {
    fail(res, 401, "Please sign in with an authorized account.");
    return null;
  }
  const path = _reqPath(req);
  if (
    u.mustChangePassword &&
    ![
      "/api/dashboard",
      "/api/me",
      "/api/profile/password",
      "/api/logout",
    ].includes(path)
  ) {
    fail(res, 403, "Change your temporary password before using the portal.");
    return null;
  }
  return u;
}
async function bodyJson(req) {
  const a = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > 2e6) throw Error("Request too large.");
    a.push(c);
  }
  return a.length ? JSON.parse(Buffer.concat(a).toString()) : {};
}
function clientIpHash(req) {
  const ip = String(
    req.headers["x-vercel-forwarded-for"] ||
      req.headers["x-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "",
  )
    .split(",")[0]
    .trim();
  return ip
    ? crypto
        .createHmac("sha256", env.SESSION_SECRET || "")
        .update(ip)
        .digest("hex")
    : null;
}
async function bootstrapAdmin() {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return;
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);
  if (data?.length) return;
  const salt = crypto.randomBytes(16).toString("hex");
  await db.from("profiles").insert({
    name: env.ADMIN_NAME || "Portal Administrator",
    email: env.ADMIN_EMAIL.toLowerCase(),
    phone: "",
    role: "admin",
    password_salt: salt,
    password_hash: crypto
      .scryptSync(env.ADMIN_PASSWORD, salt, 64)
      .toString("hex"),
  });
}
async function getSettings() {
  const { data, error } = await db
    .from("portal_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: c, error: e } = await db
    .from("portal_settings")
    .upsert({
      id: 1,
      portal_name: "Comreds Papers Portal",
      currency: "KES",
      paper_price: Number(env.DEFAULT_PAPER_PRICE || 50),
      results_request_price: Number(env.DEFAULT_RESULTS_REQUEST_PRICE || 0),
      refer_registration_price: Number(
        env.DEFAULT_REFER_REGISTRATION_PRICE || 0,
      ),
      support_phone: env.DEFAULT_PAYMENT_PHONE || "+254723278526",
      login_design: "cdacc",
    })
    .select()
    .single();
  if (e) throw e;
  return c;
}
const mapPaper = (p) => ({
    id: p.id,
    title: p.title,
    subject: p.subject,
    type: p.type,
    description: p.description,
    price: Number(p.price),
    available: p.available,
    createdAt: p.created_at,
    level: p.level || "",
    year: p.year || "",
    semester: p.semester || "",
    downloads: Number(p.download_count || 0),
  }),
  mapRequest = (r) => ({
    id: r.id,
    userId: r.user_id,
    studentName: r.student_name,
    paperId: r.paper_id,
    title: r.title,
    subject: r.subject,
    status: r.status,
    amount: Number(r.amount),
    createdAt: r.created_at,
    level: r.level || "",
    archivedAt: r.archived_at || null,
  }),
  mapPayment = (p) => ({
    id: p.id,
    requestId: p.request_id,
    userId: p.user_id,
    amount: Number(p.amount),
    phone: p.phone,
    status: p.status,
    createdAt: p.created_at,
    paidAt: p.paid_at || null,
    paidAtSource: p.paid_at_source || "unknown",
    receipt: p.receipt,
    paidPhone: p.paid_phone || "",
    payerName: p.payer_name || "",
    payerNameSource: p.payer_name_source || "unavailable",
    paidAmount: Number(p.paid_amount || 0),
    resultCode: p.result_code,
    confirmationSource: p.confirmation_source || "legacy",
    reconciliationStatus: p.reconciliation_status || "not_checked",
    providerResultCode: p.provider_result_code,
    providerResultDescription: p.provider_result_description || "",
    providerCheckedAt: p.provider_checked_at || null,
    archivedAt: p.archived_at || null,
    archiveReason: p.archive_reason || "",
    error: p.error_message || "",
    serviceType: p.result_request_id
      ? "results"
      : p.refer_request_id
        ? "refer"
        : "paper",
    resultRequestId: p.result_request_id || "",
    referRequestId: p.refer_request_id || "",
  }),
  mapNotice = (n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    priority: n.priority || "normal",
    expiresAt: n.expires_at,
    createdAt: n.created_at,
  }),
  mapResultRequest = (r) => ({
    id: r.id,
    userId: r.user_id,
    institutionName: r.institution_name,
    registrationNumber: r.registration_number,
    admissionNumber: r.admission_number,
    registeredUnits: Array.isArray(r.registered_units)
      ? r.registered_units
      : [],
    status: r.status,
    resultFileName: r.status === "completed" ? r.result_file_name || "" : "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    uploadedAt: r.uploaded_at || null,
    serviceFee: Number(r.service_fee || 0),
    paymentStatus: r.payment_status || "paid",
    archivedAt: r.archived_at || null,
  });
const mapReferRequest = (r) => ({
  id: r.id,
  userId: r.user_id,
  institutionName: r.institution_name,
  registrationNumber: r.registration_number,
  admissionNumber: r.admission_number,
  failedUnits: Array.isArray(r.failed_units) ? r.failed_units : [],
  examPeriod: r.exam_period,
  notes: r.notes || "",
  status: r.status,
  paymentStatus: r.payment_status,
  serviceFee: Number(r.service_fee || 0),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archivedAt: r.archived_at || null,
});
async function notifyAdmins(title, body, type = "payment") {
  const { data } = await db.from("profiles").select("id").eq("role", "admin");
  for (const a of data || []) await notify(a.id, title, body, type);
}
async function writeAudit(entry) {
  const { error } = await db.from("audit_logs").insert(entry);
  if (error) throw error;
}
function manualPaymentEvidence(body) {
  const paidPhone = normalizeKenyanPhone(body.payerPhone || body.phone),
    payerName = String(body.payerName || "")
      .trim()
      .slice(0, 120),
    rawTime = String(body.paidAt || body.transactionDateTime || "").trim();
  if (!paidPhone)
    return {
      error: "Enter the Kenyan phone number shown in the M-Pesa transaction.",
    };
  let paidAt = now(),
    paidAtSource = "admin_recorded_at";
  if (rawTime) {
    if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(rawTime))
      return {
        error:
          "Transaction time must include a timezone, for example an ISO timestamp.",
      };
    const parsed = new Date(rawTime);
    if (!Number.isFinite(parsed.getTime()))
      return { error: "Enter a valid transaction date and time." };
    paidAt = parsed.toISOString();
    paidAtSource = "admin_verified";
  }
  return {
    paidPhone,
    payerName,
    payerNameSource: payerName ? "admin_verified" : "unavailable",
    paidAt,
    paidAtSource,
  };
}
async function markPaid(pay, receipt, amount) {
  if (!pay.request_id) {
    const service = pay.result_request_id
      ? {
          table: "result_requests",
          id: pay.result_request_id,
          label: "results",
        }
      : pay.refer_request_id
        ? {
            table: "refer_requests",
            id: pay.refer_request_id,
            label: "refer registration",
          }
        : null;
    if (!service) return;
    const { data: request, error } = await db
      .from(service.table)
      .update({ payment_status: "paid", updated_at: now() })
      .eq("id", service.id)
      .neq("payment_status", "paid")
      .select("id,user_id,institution_name,registration_number")
      .maybeSingle();
    if (error) throw error;
    if (!request) {
      const { data: existing, error: existingError } = await db
        .from(service.table)
        .select("id,payment_status")
        .eq("id", service.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing || existing.payment_status !== "paid")
        throw Error(
          "Confirmed payment could not update its linked service request.",
        );
    }
    if (request) {
      await notify(
        request.user_id,
        "Service payment confirmed",
        `Your ${service.label} service request is paid. The administrator can now process it. Receipt: ${receipt || "pending"}.`,
        "payment",
      );
      await notifyAdmins(
        "Academic service paid",
        `A ${service.label} request (${String(request.id).slice(0, 8)}) has been paid: KSh ${amount}, receipt ${receipt || "pending"}.`,
      );
      await writeAudit({
        actor_id: null,
        action: "service.payment.confirmed",
        entity_type: service.table,
        entity_id: request.id,
        metadata: { paymentId: pay.id, serviceType: service.label, receipt },
      });
    }
    return;
  }
  const { data: r, error } = await db
    .from("paper_requests")
    .update({ status: "paid" })
    .eq("id", pay.request_id)
    .neq("status", "paid")
    .select("user_id,title,student_name")
    .maybeSingle();
  if (error) throw error;
  if (!r) {
    const { data: existing, error: existingError } = await db
      .from("paper_requests")
      .select("id,status")
      .eq("id", pay.request_id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing || existing.status !== "paid")
      throw Error(
        "Confirmed payment could not update its linked paper request.",
      );
  }
  if (r) {
    await notify(
      r.user_id,
      "Payment confirmed",
      `Your payment for ${r.title} is confirmed. Your download is unlocked.`,
      "payment",
    );
    await notifyAdmins(
      "Payment received",
      `KSh ${amount} from ${r.student_name} for ${r.title}. M-Pesa code: ${receipt || "confirmed via Safaricom (code pending)"}`,
    );
  }
}
async function queryStk(id) {
  const { host, token } = await darajaToken(),
    sc = env.DARAJA_SHORTCODE || "174379",
    ts = formatDarajaTimestamp();
  if (!ts) throw Error("Could not generate the Daraja timestamp.");
  const r = await fetch(host + "/mpesa/stkpushquery/v1/query", {
    method: "POST",
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      BusinessShortCode: sc,
      Password: Buffer.from(sc + env.DARAJA_PASSKEY + ts).toString("base64"),
      Timestamp: ts,
      CheckoutRequestID: id,
    }),
  });
  return (await dJson(r)).j;
}
async function notify(userId, title, body, type = "system") {
  await db.from("notifications").insert({ user_id: userId, title, body, type });
}
async function dJson(r) {
  const raw = await r.text();
  let j = {};
  try {
    j = JSON.parse(raw);
  } catch {}
  return { j, raw };
}
async function darajaToken() {
  const prod =
      String(env.DARAJA_ENV || "sandbox").toLowerCase() === "production",
    host = prod
      ? "https://api.safaricom.co.ke"
      : "https://sandbox.safaricom.co.ke";
  if (!env.DARAJA_CONSUMER_KEY || !env.DARAJA_CONSUMER_SECRET)
    throw Error("Daraja credentials are not configured in Vercel.");
  const r = await fetch(
      host + "/oauth/v1/generate?grant_type=client_credentials",
      {
        headers: {
          authorization:
            "Basic " +
            Buffer.from(
              env.DARAJA_CONSUMER_KEY + ":" + env.DARAJA_CONSUMER_SECRET,
            ).toString("base64"),
        },
      },
    ),
    { j } = await dJson(r);
  if (!r.ok || !j.access_token)
    throw Error(
      `Daraja authentication failed (HTTP ${r.status}). Re-check DARAJA_CONSUMER_KEY, DARAJA_CONSUMER_SECRET and DARAJA_ENV in Vercel.`,
    );
  return { host, token: j.access_token };
}
function darajaCallbackUrl() {
  if (!env.DARAJA_CALLBACK_URL || (env.DARAJA_CALLBACK_TOKEN || "").length < 32)
    throw Error(
      "Set the HTTPS callback URL and DARAJA_CALLBACK_TOKEN in Vercel.",
    );
  const callback = new URL(env.DARAJA_CALLBACK_URL);
  callback.searchParams.set("token", env.DARAJA_CALLBACK_TOKEN);
  return callback.toString();
}
async function startSTK(phone, amount, account) {
  const prodMode =
      String(env.DARAJA_ENV || "sandbox").toLowerCase() === "production",
    sc0 = String(env.DARAJA_SHORTCODE || "174379");
  if (prodMode && sc0 === "174379")
    throw Error(
      "Blocked: live mode is on but DARAJA_SHORTCODE is still the test code 174379. Set DARAJA_SHORTCODE=1402050 and DARAJA_PASSKEY to your production passkey in Vercel, then redeploy.",
    );
  if (
    prodMode &&
    env.DARAJA_TRANSACTION_TYPE === "CustomerBuyGoodsOnline" &&
    !env.DARAJA_PARTY_B
  )
    throw Error("Blocked: set DARAJA_PARTY_B to your Till number in Vercel.");
  const { host, token } = await darajaToken(),
    shortcode = env.DARAJA_SHORTCODE || "174379";
  if (!env.DARAJA_PASSKEY) throw Error("Set the Daraja passkey in Vercel.");
  const ts = formatDarajaTimestamp();
  if (!ts) throw Error("Could not generate the Daraja timestamp.");
  const msisdn = phone.replace(/\D/g, "").replace(/^0/, "254");
  const payload = {
    BusinessShortCode: shortcode,
    Password: Buffer.from(shortcode + env.DARAJA_PASSKEY + ts).toString(
      "base64",
    ),
    Timestamp: ts,
    TransactionType: env.DARAJA_TRANSACTION_TYPE || "CustomerPayBillOnline",
    Amount: Math.max(1, Math.round(amount)),
    PartyA: msisdn,
    PartyB: String(env.DARAJA_PARTY_B || shortcode).trim(),
    PhoneNumber: msisdn,
    CallBackURL: darajaCallbackUrl(),
    AccountReference: ("COMREDS-" + account).slice(0, 12),
    TransactionDesc: "Comreds papers",
  };
  const r = await fetch(host + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    { j, raw } = await dJson(r);
  if (!r.ok || j.ResponseCode !== "0")
    throw Error(
      `STK Push failed (HTTP ${r.status}): ${
        j.errorMessage ||
        j.ResponseDescription ||
        j.CustomerMessage ||
        raw
          .replace(/<[^>]*>/g, " ")
          .trim()
          .slice(0, 140) ||
        "empty response from Safaricom"
      }`,
    );
  return j;
}
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
        headers: req.headers,
        limits: { fileSize: 4 * 1024 * 1024, files: 1 },
      }),
      fields = {},
      chunks = [];
    let info = null;
    bb.on("field", (n, v) => (fields[n] = v));
    bb.on("file", (n, stream, meta) => {
      info = meta;
      stream.on("data", (c) => chunks.push(c));
      stream.on("limit", () =>
        reject(Error("Server fallback uploads are limited to 4 MB.")),
      );
    });
    bb.on("error", reject);
    bb.on("close", () =>
      resolve({ fields, info, buffer: Buffer.concat(chunks) }),
    );
    req.pipe(bb);
  });
}
async function route(req, res) {
  const path = _reqPath(req),
    method = req.method;
  if (method === "GET" && path === "/api/health") {
    const REQUIRED = {
      audit_logs: [
        "action",
        "actor_id",
        "created_at",
        "entity_id",
        "entity_type",
        "id",
        "metadata",
      ],
      download_events: ["created_at", "id", "paper_id", "user_id"],
      favorites: ["created_at", "paper_id", "user_id"],
      login_events: [
        "created_at",
        "email",
        "ip_hash",
        "success",
        "user_agent",
        "user_id",
      ],
      notices: ["body", "created_at", "expires_at", "id", "priority", "title"],
      notifications: [
        "body",
        "created_at",
        "id",
        "read_at",
        "title",
        "type",
        "user_id",
      ],
      paper_requests: [
        "amount",
        "archived_at",
        "archived_by",
        "created_at",
        "id",
        "level",
        "paper_id",
        "status",
        "student_name",
        "subject",
        "title",
        "user_id",
      ],
      papers: [
        "available",
        "checksum",
        "created_at",
        "description",
        "download_count",
        "file_size",
        "id",
        "level",
        "mime_type",
        "original_name",
        "price",
        "semester",
        "storage_path",
        "subject",
        "tags",
        "title",
        "type",
        "uploaded_by",
        "year",
      ],
      payment_events: [
        "checkout_request_id",
        "created_at",
        "id",
        "payload",
        "payment_id",
        "result_code",
        "result_description",
      ],
      payments: [
        "amount",
        "archive_reason",
        "archived_at",
        "archived_by",
        "checkout_request_id",
        "confirmation_source",
        "created_at",
        "error_message",
        "id",
        "merchant_request_id",
        "paid_amount",
        "paid_at",
        "paid_at_source",
        "paid_phone",
        "payer_name",
        "payer_name_source",
        "phone",
        "provider_checked_at",
        "provider_result_code",
        "provider_result_description",
        "reconciliation_status",
        "receipt",
        "refer_request_id",
        "result_request_id",
        "request_id",
        "result_code",
        "result_description",
        "status",
        "user_id",
      ],
      portal_settings: [
        "currency",
        "id",
        "login_design",
        "paper_price",
        "portal_name",
        "refer_registration_price",
        "results_request_price",
        "support_phone",
      ],
      profiles: [
        "avatar_path",
        "created_at",
        "email",
        "id",
        "must_change_password",
        "name",
        "password_hash",
        "password_salt",
        "phone",
        "role",
        "session_version",
        "username",
      ],
      result_requests: [
        "admission_number",
        "archived_at",
        "archived_by",
        "created_at",
        "id",
        "institution_name",
        "registration_number",
        "registered_units",
        "result_file_name",
        "result_file_size",
        "result_storage_path",
        "payment_status",
        "service_fee",
        "status",
        "updated_at",
        "uploaded_at",
        "uploaded_by",
        "user_id",
      ],
      refer_requests: [
        "admission_number",
        "archived_at",
        "archived_by",
        "created_at",
        "exam_period",
        "failed_units",
        "id",
        "institution_name",
        "notes",
        "payment_status",
        "registration_number",
        "service_fee",
        "status",
        "updated_at",
        "user_id",
      ],
    };
    const names = Object.keys(REQUIRED),
      rs = await Promise.all(
        names.map((t) => db.from(t).select(REQUIRED[t].join(",")).limit(1)),
      ),
      problems = rs
        .map((x, i) =>
          x.error ? { table: names[i], error: x.error.message } : null,
        )
        .filter(Boolean),
      [
        { data: bucket, error: bErr },
        { data: avatarBucket, error: avatarError },
      ] = await Promise.all([
        supabase.storage.getBucket(BUCKET),
        supabase.storage.getBucket(AVATAR_BUCKET),
      ]);
    const papersStorageReady = bucket?.public === false,
      avatarStorageReady =
        avatarBucket?.public === false &&
        Number(avatarBucket.file_size_limit) === 3 * 1024 * 1024 &&
        ["image/jpeg", "image/png", "image/webp"].every((mime) =>
          (avatarBucket.allowed_mime_types || []).includes(mime),
        ),
      storageReady = papersStorageReady && avatarStorageReady,
      notReady = problems.length || !storageReady;
    return json(res, notReady ? 503 : 200, {
      ok: !notReady,
      database: "Supabase",
      storage: storageReady,
      papersStorageReady,
      avatarStorageReady,
      storageError: bErr
        ? bErr.message
        : !papersStorageReady
          ? "The papers bucket must exist and remain private."
          : undefined,
      avatarStorageError: avatarError
        ? avatarError.message
        : !avatarStorageReady
          ? "The avatars bucket must be private with a 3 MB limit and JPEG/PNG/WebP MIME types."
          : undefined,
      bucket: BUCKET,
      daraja: {
        environment: env.DARAJA_ENV || "sandbox",
        configured: Boolean(
          env.DARAJA_CONSUMER_KEY &&
            env.DARAJA_CONSUMER_SECRET &&
            env.DARAJA_PASSKEY &&
            (env.DARAJA_CALLBACK_TOKEN || "").length >= 32,
        ),
      },
      problems,
      hint: problems.length
        ? "Do not run the full schema on an existing portal. Identify the missing objects, then apply only the reviewed versioned migration for this database; reload the PostgREST schema cache after the migration."
        : undefined,
      version: "4.0.0",
    });
  }
  if (method === "POST" && path === "/api/register") {
    const b = await bodyJson(req),
      name = String(b.name || "").trim(),
      username = normalizeUsername(b.username),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      password = String(b.password || "");
    if (!name || !email || !isValidUsername(username) || password.length < 8)
      return fail(
        res,
        400,
        "Choose a username (3–32 letters, numbers, dots, dashes or underscores), enter a name and email, and use a password of at least 8 characters.",
      );
    const salt = crypto.randomBytes(16).toString("hex"),
      hash = crypto.scryptSync(password, salt, 64).toString("hex"),
      { data, error } = await db
        .from("profiles")
        .insert({
          name,
          username,
          email,
          phone: String(b.phone || ""),
          role: "student",
          password_salt: salt,
          password_hash: hash,
        })
        .select("id,name,username,email,phone,role,created_at")
        .single();
    if (error)
      return fail(
        res,
        error.code === "23505" ? 409 : 400,
        error.code === "23505"
          ? "That username or email is already registered."
          : error.message,
      );
    setSession(res, data);
    return json(res, 201, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/login") {
    const b = await bodyJson(req),
      identifier = normalizeUsername(b.identifier || b.username || b.email),
      ipHash = clientIpHash(req),
      since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recentByEmail = await db
        .from("login_events")
        .select("id", { count: "exact", head: true })
        .eq("email", identifier)
        .eq("success", false)
        .gte("created_at", since),
      recentByIp = ipHash
        ? await db
            .from("login_events")
            .select("id", { count: "exact", head: true })
            .eq("ip_hash", ipHash)
            .eq("success", false)
            .gte("created_at", since)
        : { count: 0, error: null };
    if (recentByEmail.error) throw recentByEmail.error;
    if (recentByIp.error) throw recentByIp.error;
    if ((recentByEmail.count || 0) >= 8 || (recentByIp.count || 0) >= 40)
      return fail(
        res,
        429,
        "Too many sign-in attempts. Try again in 15 minutes.",
      );
    let { data, error } = await db
      .from("profiles")
      .select("*")
      .eq("username", identifier)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const legacy = await db
        .from("profiles")
        .select("*")
        .eq("email", identifier)
        .maybeSingle();
      if (legacy.error) throw legacy.error;
      data = legacy.data;
    }
    const passwordMatches = data
      ? crypto.timingSafeEqual(
          crypto.scryptSync(String(b.password || ""), data.password_salt, 64),
          Buffer.from(data.password_hash, "hex"),
        )
      : false;
    const { error: eventError } = await db.from("login_events").insert({
      user_id: data?.id || null,
      email: identifier,
      success: passwordMatches,
      ip_hash: ipHash,
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
    });
    if (eventError) throw eventError;
    if (!data || !passwordMatches)
      return fail(res, 401, "Incorrect username or password.");
    setSession(res, data);
    return json(res, 200, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/logout") {
    clearSession(res);
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/me") {
    const [user, settings] = await Promise.all([
      currentUser(req),
      getSettings(),
    ]);
    return json(res, 200, {
      user,
      loginDesign: settings.login_design || "cdacc",
    });
  }
  if (method === "GET" && path === "/api/dashboard") {
    const u = await requireUser(req, res);
    if (!u) return;
    if (u.mustChangePassword) return json(res, 200, { user: u });
    const includeArchived =
      new URL(req.url, "https://vercel.local").searchParams.get(
        "includeArchived",
      ) === "true";
    const [s, rr, pp, pa, nn, uu, nt, ff, resultRows, referRows] =
      await Promise.all([
        getSettings(),
        db
          .from("paper_requests")
          .select("*")
          .order("created_at", { ascending: false }),
        db.from("papers").select("*").order("created_at", { ascending: false }),
        db
          .from("payments")
          .select("*")
          .order("created_at", { ascending: false }),
        db
          .from("notices")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        u.role === "admin"
          ? db
              .from("profiles")
              .select(
                "id,name,username,email,phone,role,avatar_path,must_change_password,created_at",
              )
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        db
          .from("notifications")
          .select("*")
          .eq("user_id", u.id)
          .order("created_at", { ascending: false })
          .limit(30),
        db.from("favorites").select("paper_id").eq("user_id", u.id),
        u.role === "admin"
          ? db
              .from("result_requests")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(500)
          : db
              .from("result_requests")
              .select("*")
              .eq("user_id", u.id)
              .order("created_at", { ascending: false })
              .limit(100),
        u.role === "admin"
          ? db
              .from("refer_requests")
              .select("*")
              .order("created_at", { ascending: false })
              .limit(500)
          : db
              .from("refer_requests")
              .select("*")
              .eq("user_id", u.id)
              .order("created_at", { ascending: false })
              .limit(100),
      ]);
    for (const x of [rr, pp, pa, nn, uu, nt, ff, resultRows, referRows])
      if (x.error && x.error.code !== "42P01") throw x.error;
    const requests = (rr.data || []).filter(
        (x) =>
          (u.role === "admin" || x.user_id === u.id) &&
          (includeArchived || !x.archived_at),
      ),
      payments = (pa.data || []).filter(
        (x) =>
          (u.role === "admin" || x.user_id === u.id) &&
          (includeArchived || !x.archived_at),
      );
    return json(res, 200, {
      user: u,
      requests: requests.map(mapRequest),
      payments: payments.map(mapPayment),
      papers: (pp.data || []).map(mapPaper),
      users: (uu.data || []).map(safeUser),
      notices: (nn.data || []).map(mapNotice),
      notifications: nt.data || [],
      favorites: (ff.data || []).map((x) => x.paper_id),
      resultRequests: (resultRows.data || [])
        .filter((x) => includeArchived || !x.archived_at)
        .map(mapResultRequest),
      referRequests: (referRows.data || [])
        .filter((x) => includeArchived || !x.archived_at)
        .map(mapReferRequest),
      settings: {
        portalName: s.portal_name,
        currency: s.currency,
        paperPrice: s.paper_price,
        resultsRequestPrice: s.results_request_price,
        referRegistrationPrice: s.refer_registration_price,
        loginDesign: s.login_design || "cdacc",
        supportPhone: normalizeKenyanPhone(s.support_phone)
          ? `+${normalizeKenyanPhone(s.support_phone)}`
          : "",
      },
    });
  }
  if (method === "POST" && path === "/api/results/requests") {
    const u = await requireUser(req, res, "student");
    if (!u) return;
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      recent = await db
        .from("result_requests")
        .select("id")
        .eq("user_id", u.id)
        .gte("created_at", since)
        .limit(5);
    if (recent.error) throw recent.error;
    if ((recent.data || []).length >= 5)
      return fail(
        res,
        429,
        "Too many results requests. Try again in 10 minutes.",
      );
    let details;
    try {
      details = validateResultsRequest(await bodyJson(req));
    } catch (error) {
      return fail(res, 400, error.message);
    }
    const settings = await getSettings(),
      serviceFee = Number(settings.results_request_price || 0);
    if (serviceFee < 1)
      return fail(
        res,
        409,
        "Results requests are not available until an administrator sets the service price.",
      );
    const { data: activeRequest, error: activeError } = await db
      .from("result_requests")
      .select("id")
      .eq("user_id", u.id)
      .eq("institution_name", details.institutionName)
      .eq("registration_number", details.registrationNumber)
      .eq("admission_number", details.admissionNumber)
      .in("status", ["requested", "processing"])
      .limit(1);
    if (activeError) throw activeError;
    if (activeRequest?.length)
      return fail(
        res,
        409,
        "A results request for these details is already active. Pay or follow the existing request instead.",
      );
    const { data, error } = await db
      .from("result_requests")
      .insert({
        user_id: u.id,
        institution_name: details.institutionName,
        registration_number: details.registrationNumber,
        admission_number: details.admissionNumber,
        registered_units: details.registeredUnits,
        status: "requested",
        service_fee: serviceFee,
        payment_status: "pending",
      })
      .select("*")
      .single();
    if (error?.code === "23505")
      return fail(
        res,
        409,
        "A results request for these details is already active. Pay or follow the existing request instead.",
      );
    if (error) throw error;
    await notifyAdmins(
      "New results request",
      `A student submitted an academic results request (reference ${data.id.slice(0, 8)}). Fee: KSh ${serviceFee}.`,
      "results",
    );
    return json(res, 201, { resultRequest: mapResultRequest(data) });
  }
  if (method === "POST" && path === "/api/refer/requests") {
    const u = await requireUser(req, res, "student");
    if (!u) return;
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      recent = await db
        .from("refer_requests")
        .select("id")
        .eq("user_id", u.id)
        .gte("created_at", since)
        .limit(5);
    if (recent.error) throw recent.error;
    if ((recent.data || []).length >= 5)
      return fail(
        res,
        429,
        "Too many refer requests. Try again in 10 minutes.",
      );
    let details;
    try {
      details = validateReferRequest(await bodyJson(req));
    } catch (error) {
      return fail(res, 400, error.message);
    }
    const settings = await getSettings(),
      serviceFee = Number(settings.refer_registration_price || 0);
    if (serviceFee < 1)
      return fail(
        res,
        409,
        "Refer registration is not available until an administrator sets the service price.",
      );
    const { data: duplicate, error: duplicateError } = await db
      .from("refer_requests")
      .select("id")
      .eq("user_id", u.id)
      .eq("institution_name", details.institutionName)
      .eq("registration_number", details.registrationNumber)
      .eq("admission_number", details.admissionNumber)
      .eq("exam_period", details.examPeriod)
      .in("payment_status", ["pending", "paid"])
      .in("status", ["requested", "processing"])
      .limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate?.length)
      return fail(
        res,
        409,
        "A refer-registration request for these details is already active.",
      );
    const { data, error } = await db
      .from("refer_requests")
      .insert({
        user_id: u.id,
        institution_name: details.institutionName,
        registration_number: details.registrationNumber,
        admission_number: details.admissionNumber,
        failed_units: details.failedUnits,
        exam_period: details.examPeriod,
        notes: details.notes,
        status: "requested",
        payment_status: "pending",
        service_fee: serviceFee,
      })
      .select("*")
      .single();
    if (error?.code === "23505")
      return fail(
        res,
        409,
        "A refer-registration request for these details is already active.",
      );
    if (error) throw error;
    await notifyAdmins(
      "New refer-registration request",
      `A learner submitted a failed-exam registration request (reference ${data.id.slice(0, 8)}). Fee: KSh ${serviceFee}.`,
      "refer",
    );
    await writeAudit({
      actor_id: u.id,
      action: "refer_request.create",
      entity_type: "refer_request",
      entity_id: data.id,
      metadata: { serviceFee },
    });
    return json(res, 201, { referRequest: mapReferRequest(data) });
  }
  if (method === "POST" && path === "/api/results/check") {
    const u = await requireUser(req, res, "student");
    if (!u) return;
    const b = await bodyJson(req),
      institutionName = String(b.institution || "").trim(),
      registrationNumber = String(b.registration || "").trim(),
      admissionNumber = String(b.admission || "").trim();
    if (!institutionName || !registrationNumber || !admissionNumber)
      return fail(
        res,
        400,
        "Enter your institution, registration number and admission number.",
      );
    const { data, error } = await db
      .from("result_requests")
      .select("*")
      .eq("user_id", u.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const key = (value) =>
        String(value || "")
          .trim()
          .replace(/\s+/g, " ")
          .toLowerCase(),
      match = (data || []).find(
        (item) =>
          key(item.institution_name) === key(institutionName) &&
          key(item.registration_number) === key(registrationNumber) &&
          key(item.admission_number) === key(admissionNumber),
      );
    return json(res, 200, {
      resultRequest: match ? mapResultRequest(match) : null,
    });
  }
  if (method === "POST" && path === "/api/admin/results/status") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      id = String(b.id || ""),
      status = String(b.status || "");
    if (!id || !["requested", "processing", "rejected"].includes(status))
      return fail(res, 400, "Choose a valid results-request status.");
    const { data: existing, error: existingError } = await db
      .from("result_requests")
      .select("id,user_id,payment_status,status")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing) return fail(res, 404, "Results request not found.");
    if (status === "processing" && existing.payment_status !== "paid")
      return fail(
        res,
        409,
        "The learner must pay the results-service fee first.",
      );
    const { data, error } = await db
      .from("result_requests")
      .update({ status, updated_at: now() })
      .eq("id", id)
      .neq("status", "completed")
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Open results request not found.");
    if (existing.status !== status)
      await notify(
        data.user_id,
        "Results request updated",
        `Your academic results request is now ${status.replaceAll("_", " ")}.`,
        "results",
      );
    await writeAudit({
      actor_id: u.id,
      action: "results.status",
      entity_type: "result_request",
      entity_id: data.id,
      metadata: { status },
    });
    return json(res, 200, { resultRequest: mapResultRequest(data) });
  }
  if (method === "POST" && path === "/api/admin/refer/status") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      id = String(b.id || ""),
      status = String(b.status || "");
    if (
      !id ||
      !["requested", "processing", "registered", "rejected"].includes(status)
    )
      return fail(res, 400, "Choose a valid refer-request status.");
    const { data: existing, error: existingError } = await db
      .from("refer_requests")
      .select("id,user_id,payment_status,status")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw existingError;
    if (!existing)
      return fail(res, 404, "Refer-registration request not found.");
    if (
      ["processing", "registered"].includes(status) &&
      existing.payment_status !== "paid"
    )
      return fail(
        res,
        409,
        "The learner must pay the refer-registration fee first.",
      );
    const { data, error } = await db
      .from("refer_requests")
      .update({ status, updated_at: now() })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Refer-registration request not found.");
    if (existing.status !== status)
      await notify(
        data.user_id,
        "Refer registration updated",
        `Your failed-exam registration request is now ${status}.`,
        "refer",
      );
    await writeAudit({
      actor_id: u.id,
      action: "refer_request.status",
      entity_type: "refer_request",
      entity_id: data.id,
      metadata: { status },
    });
    return json(res, 200, { referRequest: mapReferRequest(data) });
  }
  if (method === "POST" && path === "/api/admin/results/upload-url") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      id = String(b.requestId || ""),
      fileName = String(b.fileName || "")
        .replace(/[\\/\r\n]/g, "")
        .slice(0, 160),
      size = Number(b.size);
    if (!id || !/\.pdf$/i.test(fileName))
      return fail(res, 400, "Choose a PDF results document.");
    if (!Number.isFinite(size) || size < 1 || size > 25 * 1024 * 1024)
      return fail(
        res,
        400,
        "The results PDF must be between 1 byte and 25 MB.",
      );
    const { data: request, error: requestError } = await db
      .from("result_requests")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return fail(res, 404, "Results request not found.");
    const storagePath = `results/${id}/${crypto.randomUUID()}.pdf`,
      { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw error;
    return json(res, 200, {
      storagePath,
      uploadUrl: data.signedUrl || data.signedURL,
      token: data.token,
      contentType: "application/pdf",
      expiresIn: 7200,
    });
  }
  if (method === "POST" && path === "/api/admin/results/complete") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      id = String(b.requestId || ""),
      storagePath = String(b.storagePath || ""),
      fileName = String(b.fileName || "")
        .replace(/[\\/\r\n]/g, "")
        .slice(0, 160),
      fileSize = Number(b.fileSize),
      parts = storagePath.split("/");
    if (
      !id ||
      !/\.pdf$/i.test(fileName) ||
      !Number.isFinite(fileSize) ||
      fileSize < 1 ||
      fileSize > 25 * 1024 * 1024 ||
      parts.length !== 3 ||
      parts[0] !== "results" ||
      parts[1] !== id ||
      !/^[a-f0-9-]{36}\.pdf$/i.test(parts[2])
    )
      return fail(
        res,
        400,
        "Upload a valid PDF for this results request first.",
      );
    const { data: request, error: requestError } = await db
      .from("result_requests")
      .select("id,user_id,result_storage_path,payment_status")
      .eq("id", id)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return fail(res, 404, "Results request not found.");
    if (request.payment_status !== "paid")
      return fail(
        res,
        409,
        "The results-service fee must be paid before uploading results.",
      );
    const { data: objects, error: listError } = await supabase.storage
      .from(BUCKET)
      .list(`results/${id}`, { search: parts[2] });
    if (listError) throw listError;
    if (!objects?.some((object) => object.name === parts[2]))
      return fail(
        res,
        400,
        "Storage did not confirm the uploaded results PDF.",
      );
    const { data: storedFile, error: downloadError } = await supabase.storage
      .from(BUCKET)
      .download(storagePath);
    if (downloadError) throw downloadError;
    const pdfHeader = Buffer.from(
      await storedFile.slice(0, 5).arrayBuffer(),
    ).toString("ascii");
    if (storedFile.size !== fileSize || pdfHeader !== "%PDF-") {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return fail(
        res,
        400,
        "The uploaded file is not a valid PDF of the expected size.",
      );
    }
    const { data, error } = await db
      .from("result_requests")
      .update({
        result_storage_path: storagePath,
        result_file_name: fileName,
        result_file_size: fileSize,
        uploaded_by: u.id,
        uploaded_at: now(),
        updated_at: now(),
        status: "completed",
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    if (
      request.result_storage_path &&
      request.result_storage_path !== storagePath
    )
      await supabase.storage.from(BUCKET).remove([request.result_storage_path]);
    await notify(
      request.user_id,
      "Your results are ready",
      "Your requested results document is ready to view in the portal.",
      "results",
    );
    await writeAudit({
      actor_id: u.id,
      action: "results.upload",
      entity_type: "result_request",
      entity_id: id,
      metadata: { fileSize },
    });
    return json(res, 200, { resultRequest: mapResultRequest(data) });
  }
  if (method === "GET" && path.startsWith("/api/results/download/")) {
    const u = await requireUser(req, res),
      id = path.split("/").pop();
    if (!u) return;
    const { data: request, error } = await db
      .from("result_requests")
      .select("id,user_id,status,result_storage_path,result_file_name")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!request || (u.role !== "admin" && request.user_id !== u.id))
      return fail(res, 404, "Results document not found.");
    if (request.status !== "completed" || !request.result_storage_path)
      return fail(res, 404, "Results document is not available yet.");
    const { data: link, error: linkError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(request.result_storage_path, 120, {
        download: request.result_file_name || "results.pdf",
      });
    if (linkError) throw linkError;
    res.statusCode = 302;
    res.setHeader("cache-control", "no-store");
    res.setHeader("location", link.signedUrl);
    return res.end();
  }
  if (method === "GET" && path === "/api/papers") {
    const u = new URL(req.url, "https://vercel.local"),
      q = String(u.searchParams.get("q") || ""),
      subject = u.searchParams.get("subject");
    let query = db
      .from("papers")
      .select("*")
      .eq("available", true)
      .order("created_at", { ascending: false });
    if (subject) query = query.eq("subject", subject);
    if (q)
      query = query.or(
        `title.ilike.%${q}%,subject.ilike.%${q}%,description.ilike.%${q}%`,
      );
    const { data, error } = await query.limit(100);
    if (error) throw error;
    return json(res, 200, { papers: (data || []).map(mapPaper) });
  }
  if (method === "POST" && path === "/api/requests") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      { data: paper } = b.paperId
        ? await db.from("papers").select("*").eq("id", b.paperId).maybeSingle()
        : { data: null },
      s = await getSettings(),
      row = {
        user_id: u.id,
        student_name: u.name,
        paper_id: paper?.id || null,
        title: String(paper?.title || b.title || "").slice(0, 150),
        subject: String(paper?.subject || b.subject || "General").slice(0, 80),
        level: String(b.level || "").slice(0, 50),
        status: paper?.available ? "awaiting_payment" : "requested",
        amount: Number(paper?.price ?? s.paper_price),
      };
    if (!row.title)
      return fail(res, 400, "Choose a paper or provide a requested title.");
    const { data, error } = await db
      .from("paper_requests")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return json(res, 201, { request: mapRequest(data) });
  }
  if (method === "DELETE" && path.startsWith("/api/requests/")) {
    const u = await requireUser(req, res);
    if (!u) return;
    const id = path.split("/").pop();
    const q = await db
      .from("paper_requests")
      .select("id,user_id,status,title,student_name")
      .eq("id", id)
      .maybeSingle();
    if (q.error) throw q.error;
    if (!q.data) return fail(res, 404, "Request not found.");
    if (u.role !== "admin" && q.data.user_id !== u.id)
      return fail(res, 403, "You can only delete your own requests.");
    if (q.data.status === "paid")
      return fail(
        res,
        409,
        "Paid requests cannot be deleted because they are linked to a confirmed payment.",
      );
    const { data: attempts, error: attemptsError } = await db
      .from("payments")
      .select("id")
      .eq("request_id", id)
      .limit(1);
    if (attemptsError) throw attemptsError;
    if (attempts?.length)
      return fail(
        res,
        409,
        "This request has a payment attempt. Archive it instead so its financial history is preserved.",
      );
    const { data: deletion, error: deletionError } = await db.rpc(
      "delete_unpaid_paper_request",
      { p_request_id: id, p_actor_id: u.id },
    );
    if (deletionError) throw deletionError;
    if (!deletion?.ok) {
      const status =
        deletion?.reason === "not_found" ||
        deletion?.reason === "actor_not_found"
          ? 404
          : deletion?.reason === "forbidden"
            ? 403
            : 409;
      return fail(
        res,
        status,
        deletion?.reason === "has_payment_attempt"
          ? "This request has a payment attempt. Archive it instead so its financial history is preserved."
          : deletion?.reason === "paid"
            ? "Paid requests cannot be deleted because their financial history must be preserved."
            : deletion?.reason === "forbidden"
              ? "You can only delete your own requests."
              : "Request could not be deleted. Refresh and try again.",
      );
    }
    return json(res, 200, { ok: true, deletedId: id });
  }
  if (method === "POST" && path === "/api/payments/stk") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      serviceType = String(b.serviceType || "paper"),
      referenceField =
        serviceType === "results"
          ? "result_request_id"
          : serviceType === "refer"
            ? "refer_request_id"
            : "request_id",
      table =
        serviceType === "results"
          ? "result_requests"
          : serviceType === "refer"
            ? "refer_requests"
            : "paper_requests";
    if (!["paper", "results", "refer"].includes(serviceType))
      return fail(res, 400, "Choose a valid service request.");
    const { data: r, error: requestError } = await db
      .from(table)
      .select("*")
      .eq("id", b.requestId)
      .eq("user_id", u.id)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!r) return fail(res, 404, "Request not found.");
    if (r.archived_at)
      return fail(res, 409, "Restore this request before starting a payment.");
    const paid =
        serviceType === "paper"
          ? r.status === "paid"
          : r.payment_status === "paid",
      amount =
        serviceType === "paper" ? Number(r.amount) : Number(r.service_fee);
    if (paid) return fail(res, 409, "This request is already paid.");
    if (serviceType !== "paper" && r.status === "rejected")
      return fail(res, 409, "Rejected service requests cannot be paid.");
    if (serviceType !== "paper") {
      const { data: confirmedPayment, error: confirmedError } = await db
        .from("payments")
        .select("id")
        .eq(referenceField, r.id)
        .eq("status", "success")
        .limit(1);
      if (confirmedError) throw confirmedError;
      if (confirmedPayment?.length)
        return fail(
          res,
          409,
          "A confirmed payment already exists for this request.",
        );
    }
    await db
      .from("payments")
      .update({ status: "failed", error_message: "Timed out" })
      .eq(referenceField, r.id)
      .in("status", ["initiated", "pending"])
      .lt("created_at", new Date(Date.now() - 180000).toISOString());
    const recent = await db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", u.id)
      .gte("created_at", new Date(Date.now() - 600000).toISOString());
    if ((recent.count || 0) >= 6)
      return fail(
        res,
        429,
        "Too many payment attempts. Please wait a few minutes.",
      );
    const active = await db
      .from("payments")
      .select("id")
      .eq(referenceField, r.id)
      .in("status", ["initiated", "pending"])
      .limit(1);
    if (active.data?.length)
      return fail(
        res,
        409,
        "A payment prompt is already pending for this request.",
      );
    const s = await getSettings(),
      msisdn = String(
        b.phone ||
          u.phone ||
          s.support_phone ||
          env.DEFAULT_PAYMENT_PHONE ||
          "",
      )
        .replace(/\D/g, "")
        .replace(/^0/, "254");
    if (!/^254\d{9}$/.test(msisdn))
      return fail(res, 400, "Enter a valid Kenyan phone number.");
    const { data: pay, error } = await db
      .from("payments")
      .insert({
        [referenceField]: r.id,
        user_id: u.id,
        amount: Math.round(amount),
        phone: msisdn,
        status: "initiated",
        reconciliation_status: "awaiting_callback",
      })
      .select("*")
      .single();
    if (error?.code === "23505")
      return fail(
        res,
        409,
        "A payment prompt is already pending for this request.",
      );
    if (error?.code === "23514")
      return fail(res, 409, "Restore this request before starting a payment.");
    if (error) throw error;
    try {
      const stk = await startSTK(msisdn, amount, r.id),
        { error: e } = await db
          .from("payments")
          .update({
            checkout_request_id: stk.CheckoutRequestID,
            merchant_request_id: stk.MerchantRequestID,
            status: "pending",
          })
          .eq("id", pay.id);
      if (e) throw e;
      return json(res, 200, {
        message: "STK Push sent. Enter your M-Pesa PIN on your phone.",
        paymentId: pay.id,
      });
    } catch (e) {
      await db
        .from("payments")
        .update({ status: "failed", error_message: e.message })
        .eq("id", pay.id);
      return fail(res, 502, e.message);
    }
  }
  if (method === "POST" && path === "/api/mpesa/callback") {
    const b = await bodyJson(req),
      cb = b?.Body?.stkCallback;
    if (!cb?.CheckoutRequestID)
      return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    const { data: pay, error: paymentLookupError } = await db
      .from("payments")
      .select("*")
      .eq("checkout_request_id", cb.CheckoutRequestID)
      .maybeSingle();
    if (paymentLookupError) throw paymentLookupError;
    if (!pay) {
      const { error: orphanError } = await db.from("payment_events").upsert(
        {
          payment_id: null,
          checkout_request_id: cb.CheckoutRequestID,
          result_code: Number(cb.ResultCode),
          result_description: cb.ResultDesc || "Unmatched callback",
          payload: b,
        },
        { onConflict: "checkout_request_id" },
      );
      if (orphanError) throw orphanError;
      await notifyAdmins(
        "Unmatched M-Pesa callback",
        `A callback arrived for checkout ${String(cb.CheckoutRequestID).slice(0, 24)} but no payment record matched it. Review the payment event log.`,
      );
      return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }
    const items = Object.fromEntries(
      (cb.CallbackMetadata?.Item || []).map((x) => [x.Name, x.Value]),
    );
    const callbackReceipt = String(items.MpesaReceiptNumber || "")
      .trim()
      .toUpperCase();
    let valid = isValidMpesaConfirmation({
      resultCode: cb.ResultCode,
      amount: items.Amount,
      expectedAmount: pay.amount,
      payerPhone: items.PhoneNumber,
      expectedPhone: pay.phone,
      receipt: callbackReceipt,
    });
    let duplicateReceipt = false;
    if (callbackReceipt) {
      const { data: duplicate, error } = await db
        .from("payments")
        .select("id")
        .ilike("receipt", callbackReceipt)
        .neq("id", pay.id)
        .limit(1);
      if (error) throw error;
      duplicateReceipt = Boolean(duplicate?.length);
      if (duplicateReceipt) valid = false;
    }
    const { error: eventError } = await db.from("payment_events").upsert(
      {
        payment_id: pay.id,
        checkout_request_id: cb.CheckoutRequestID,
        result_code: Number(cb.ResultCode),
        result_description: cb.ResultDesc,
        payload: b,
      },
      { onConflict: "checkout_request_id" },
    );
    if (eventError) throw eventError;
    if (pay.status === "success") {
      if (
        valid &&
        callbackReceipt ===
          String(pay.receipt || "")
            .trim()
            .toUpperCase()
      )
        await markPaid(pay, callbackReceipt, items.Amount);
      return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }
    const callbackSuccess = Number(cb.ResultCode) === 0,
      paidAt = valid
        ? parseMpesaTransactionDate(items.TransactionDate) || now()
        : null,
      paidAtSource = valid
        ? parseMpesaTransactionDate(items.TransactionDate)
          ? "callback_transaction_date"
          : "callback_received_at"
        : "unknown",
      providerName =
        typeof items.PayerName === "string" && items.PayerName.trim()
          ? items.PayerName.trim().slice(0, 120)
          : null;
    let paymentUpdate = db
      .from("payments")
      .update({
        result_code: Number(cb.ResultCode),
        result_description: cb.ResultDesc,
        status: valid
          ? "success"
          : callbackSuccess
            ? "review_required"
            : "failed",
        receipt: duplicateReceipt ? null : callbackReceipt || null,
        paid_phone: items.PhoneNumber ? String(items.PhoneNumber) : null,
        paid_amount: items.Amount ? Number(items.Amount) : null,
        paid_at: paidAt,
        paid_at_source: paidAtSource,
        payer_name: providerName,
        payer_name_source: providerName ? "provider_callback" : "unavailable",
        confirmation_source: valid ? "daraja_callback" : "legacy",
        reconciliation_status: valid
          ? "verified"
          : callbackSuccess
            ? "proof_mismatch"
            : "provider_failed",
      })
      .eq("id", pay.id)
      .in("status", ["initiated", "pending", "review_required", "failed"]);
    const { data: updatedPayment, error: updateError } = await paymentUpdate
      .select("id")
      .maybeSingle();
    if (updateError?.code === "23505") {
      const conflictAt = parseMpesaTransactionDate(items.TransactionDate),
        conflictPhone = items.PhoneNumber ? String(items.PhoneNumber) : null,
        { error: reviewError } = await db
          .from("payments")
          .update({
            result_code: Number(cb.ResultCode),
            result_description:
              "Matching successful callback conflicts with another confirmed payment and requires review.",
            status: "review_required",
            receipt: null,
            paid_phone: conflictPhone,
            paid_amount: items.Amount ? Number(items.Amount) : null,
            paid_at: conflictAt || now(),
            paid_at_source: conflictAt
              ? "callback_transaction_date"
              : "callback_received_at",
            payer_name: providerName,
            payer_name_source: providerName
              ? "provider_callback"
              : "unavailable",
            confirmation_source: "legacy",
            reconciliation_status: "proof_mismatch",
          })
          .eq("id", pay.id)
          .in("status", ["initiated", "pending", "review_required", "failed"]);
      if (reviewError) throw reviewError;
      await writeAudit({
        actor_id: null,
        action: "payment.callback.unique_conflict",
        entity_type: "payment",
        entity_id: pay.id,
        metadata: { checkoutRequestId: cb.CheckoutRequestID },
      });
      await notifyAdmins(
        "M-Pesa payment needs review",
        `A successful callback for payment ${pay.id.slice(0, 8)} matched its amount and phone but conflicted with another confirmed receipt/payment. The callback event is saved; verify it before confirming.`,
      );
      return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }
    if (updateError) throw updateError;
    if (valid && updatedPayment) {
      await markPaid(pay, callbackReceipt, items.Amount);
    } else if (callbackSuccess && updatedPayment) {
      await writeAudit({
        actor_id: null,
        action: "payment.callback.proof_mismatch",
        entity_type: "payment",
        entity_id: pay.id,
        metadata: {
          checkoutRequestId: cb.CheckoutRequestID,
          reason: duplicateReceipt
            ? "duplicate_receipt"
            : "callback_proof_did_not_match_expected_amount_and_phone",
        },
      });
      await notifyAdmins(
        "M-Pesa payment needs review",
        `A successful callback for payment ${pay.id.slice(0, 8)} did not match the expected amount, payer phone, or unique receipt. It was not marked paid.`,
      );
    } else if (!callbackSuccess && updatedPayment) {
      if (pay.request_id)
        await db
          .from("paper_requests")
          .update({ status: "payment_failed" })
          .eq("id", pay.request_id)
          .neq("status", "paid");
      else if (pay.result_request_id)
        await db
          .from("result_requests")
          .update({ payment_status: "failed", updated_at: now() })
          .eq("id", pay.result_request_id)
          .neq("payment_status", "paid");
      else if (pay.refer_request_id)
        await db
          .from("refer_requests")
          .update({ payment_status: "failed", updated_at: now() })
          .eq("id", pay.refer_request_id)
          .neq("payment_status", "paid");
    }
    return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
  }
  const receiptMatch = path.match(/^\/api\/payments\/([^/]+)\/receipt$/);
  if (method === "GET" && receiptMatch) {
    const u = await requireUser(req, res);
    if (!u) return;
    const { data: payment, error: paymentError } = await db
      .from("payments")
      .select("*")
      .eq("id", receiptMatch[1])
      .eq("status", "success")
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment || (u.role !== "admin" && payment.user_id !== u.id))
      return fail(res, 404, "Payment receipt not found.");
    const [profileResult, serviceResult] = await Promise.all([
      db
        .from("profiles")
        .select("id,name,username,email,phone")
        .eq("id", payment.user_id)
        .maybeSingle(),
      payment.request_id
        ? db
            .from("paper_requests")
            .select("id,title,subject,student_name")
            .eq("id", payment.request_id)
            .maybeSingle()
        : payment.result_request_id
          ? db
              .from("result_requests")
              .select(
                "id,institution_name,registration_number,admission_number",
              )
              .eq("id", payment.result_request_id)
              .maybeSingle()
          : payment.refer_request_id
            ? db
                .from("refer_requests")
                .select(
                  "id,institution_name,registration_number,admission_number,exam_period",
                )
                .eq("id", payment.refer_request_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (serviceResult.error) throw serviceResult.error;
    const service = payment.result_request_id
        ? "Academic results request"
        : payment.refer_request_id
          ? "Supplementary/refer registration"
          : "Paper request",
      request = serviceResult.data || {},
      paidAt = payment.paid_at || payment.created_at,
      sourceLabels = {
        callback_transaction_date: "Safaricom callback transaction time (EAT)",
        callback_received_at:
          "Callback received time; Safaricom time unavailable",
        admin_verified: "Time verified by administrator from M-Pesa evidence",
        admin_recorded_at:
          "Administrator record time; transaction time unavailable",
        unknown: "Transaction time unavailable",
      },
      nameLabels = {
        provider_callback: "Supplied by provider callback",
        admin_verified: "Administrator verified against M-Pesa evidence",
        unavailable: "Not supplied by M-Pesa callback",
      },
      confirmationLabels = {
        daraja_callback: "Safaricom callback with matching proof",
        admin_verified: "Administrator verified M-Pesa evidence",
        legacy: "Previously recorded payment",
      },
      pdf = createReceiptPdf({
        portalName: (await getSettings()).portal_name,
        receipt: payment.receipt,
        status: "Confirmed",
        service,
        requestReference:
          [
            request.title,
            request.institution_name,
            request.registration_number,
            request.admission_number,
            request.exam_period,
          ]
            .filter(Boolean)
            .join(" · ") || payment.id.slice(0, 8),
        amount: payment.paid_amount || payment.amount,
        paidAt: paidAt ? formatMpesaTransactionDate(paidAt) : "Not supplied",
        paidAtSource:
          sourceLabels[payment.paid_at_source] || sourceLabels.unknown,
        studentName: profileResult.data?.name,
        requestStudentName: request.student_name,
        username: profileResult.data?.username,
        email: profileResult.data?.email,
        registeredPhone: profileResult.data?.phone,
        payerName: payment.payer_name,
        payerNameSource:
          nameLabels[payment.payer_name_source] || nameLabels.unavailable,
        paidPhone: payment.paid_phone,
        confirmationSource:
          confirmationLabels[payment.confirmation_source] ||
          confirmationLabels.legacy,
      });
    res.statusCode = 200;
    res.setHeader("content-type", "application/pdf");
    res.setHeader(
      "content-disposition",
      `attachment; filename="comreds-receipt-${String(payment.receipt || payment.id).replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`,
    );
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.end(pdf);
    return;
  }
  if (method === "GET" && path.startsWith("/api/payments/status/")) {
    const u = await requireUser(req, res);
    if (!u) return;
    const id = path.split("/").pop();
    const serviceType = new URL(
      req.url,
      "https://vercel.local",
    ).searchParams.get("serviceType");
    if (["results", "refer"].includes(serviceType)) {
      const serviceField =
          serviceType === "results" ? "result_request_id" : "refer_request_id",
        table =
          serviceType === "results" ? "result_requests" : "refer_requests";
      let { data: serviceRequest, error: serviceError } = await db
        .from(table)
        .select("id,user_id,payment_status,service_fee")
        .eq("id", id)
        .maybeSingle();
      if (serviceError) throw serviceError;
      if (
        !serviceRequest ||
        (u.role !== "admin" && serviceRequest.user_id !== u.id)
      )
        return fail(res, 404, "Service request not found.");
      if (serviceRequest.payment_status !== "paid") {
        const { data: servicePayment } = await db
          .from("payments")
          .select("*")
          .eq(serviceField, id)
          .in("status", ["initiated", "pending"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (
          servicePayment?.checkout_request_id &&
          Date.now() -
            new Date(
              servicePayment.provider_checked_at || servicePayment.created_at,
            ).getTime() >
            30000
        ) {
          try {
            const query = await queryStk(servicePayment.checkout_request_id);
            if (
              query.ResultCode !== undefined &&
              query.ResultCode !== null &&
              query.ResultCode !== ""
            )
              await db
                .from("payments")
                .update({
                  provider_result_code: Number(query.ResultCode),
                  provider_result_description:
                    query.ResultDesc ||
                    "Daraja query returned; awaiting authenticated callback details.",
                  provider_checked_at: now(),
                  reconciliation_status:
                    Number(query.ResultCode) === 0
                      ? "provider_success_pending_proof"
                      : "provider_pending",
                })
                .eq("id", servicePayment.id)
                .in("status", ["initiated", "pending"]);
          } catch (e) {
            console.error("STK service query", e && e.message);
          }
        }
        ({ data: serviceRequest } = await db
          .from(table)
          .select("id,user_id,payment_status,service_fee")
          .eq("id", id)
          .maybeSingle());
      }
      const { data: serviceReceipt } = await db
        .from("payments")
        .select("id,receipt,amount,paid_at,payer_name,paid_phone")
        .eq(serviceField, id)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json(res, 200, {
        status: serviceRequest.payment_status,
        serviceType,
        paymentId: serviceReceipt?.id || null,
        receipt: serviceReceipt?.receipt || null,
        amount: Number(serviceReceipt?.amount || serviceRequest.service_fee),
        paidAt: serviceReceipt?.paid_at || null,
      });
    }
    let { data: r } = await db
      .from("paper_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!r || (u.role !== "admin" && r.user_id !== u.id))
      return fail(res, 404, "Request not found.");
    if (r.status !== "paid") {
      const { data: pay } = await db
        .from("payments")
        .select("*")
        .eq("request_id", id)
        .in("status", ["initiated", "pending"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        pay?.checkout_request_id &&
        Date.now() -
          new Date(pay.provider_checked_at || pay.created_at).getTime() >
          30000
      ) {
        try {
          const q = await queryStk(pay.checkout_request_id);
          if (
            q.ResultCode !== undefined &&
            q.ResultCode !== null &&
            q.ResultCode !== ""
          ) {
            await db
              .from("payments")
              .update({
                provider_result_code: Number(q.ResultCode),
                provider_result_description:
                  q.ResultDesc ||
                  "Daraja query returned; awaiting authenticated callback details.",
                provider_checked_at: now(),
                reconciliation_status:
                  Number(q.ResultCode) === 0
                    ? "provider_success_pending_proof"
                    : "provider_pending",
              })
              .eq("id", pay.id)
              .in("status", ["initiated", "pending"]);
          }
        } catch (e) {
          console.error("STK query", e && e.message);
        }
      }
      ({ data: r } = await db
        .from("paper_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle());
    }
    let pp = null;
    if (r.status === "paid") {
      ({ data: pp } = await db
        .from("payments")
        .select("id,receipt,amount,paid_at")
        .eq("request_id", id)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }
    return json(res, 200, {
      status: r.status,
      paperId: r.paper_id,
      paymentId: (pp && pp.id) || null,
      receipt: (pp && pp.receipt) || null,
      amount: (pp && pp.amount) || r.amount,
      paidAt: (pp && pp.paid_at) || null,
    });
  }
  if (method === "POST" && path === "/api/admin/payments/reconcile") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const body = await bodyJson(req),
      paymentId = String(body.paymentId || "").trim();
    let query = db
      .from("payments")
      .select("id,checkout_request_id,status,created_at")
      .in("status", ["initiated", "pending"])
      .not("checkout_request_id", "is", null)
      .is("archived_at", null)
      .order("created_at", { ascending: true })
      .limit(paymentId ? 1 : 50);
    if (paymentId) query = query.eq("id", paymentId);
    const { data: attempts, error } = await query;
    if (error) throw error;
    if (paymentId && !attempts?.length)
      return fail(res, 404, "Pending payment attempt not found.");
    const results = [];
    for (const payment of attempts || []) {
      if (Date.now() - new Date(payment.created_at).getTime() < 10000) {
        results.push({ id: payment.id, outcome: "too_recent" });
        continue;
      }
      try {
        const response = await queryStk(payment.checkout_request_id),
          rawCode = response.ResultCode ?? response.ResponseCode,
          code =
            rawCode === undefined || rawCode === null || rawCode === ""
              ? null
              : Number(rawCode),
          description = String(
            response.ResultDesc ||
              response.ResponseDescription ||
              "Daraja query response received; awaiting authenticated callback evidence.",
          ).slice(0, 500);
        const { error: updateError } = await db
          .from("payments")
          .update({
            provider_result_code: Number.isFinite(code) ? code : null,
            provider_result_description: description,
            provider_checked_at: now(),
            reconciliation_status:
              code === 0
                ? "provider_success_pending_proof"
                : "provider_pending",
          })
          .eq("id", payment.id)
          .in("status", ["initiated", "pending"]);
        if (updateError) throw updateError;
        results.push({
          id: payment.id,
          outcome:
            code === 0
              ? "provider_response_awaiting_callback"
              : "provider_checked",
        });
      } catch (error) {
        console.error(
          "Admin payment reconciliation",
          payment.id,
          error?.message,
        );
        results.push({ id: payment.id, outcome: "query_error" });
      }
    }
    return json(res, 200, {
      checked: results.length,
      results,
      notice:
        "Provider query results are recorded for review only; only verified callback or administrator evidence confirms payment.",
    });
  }
  if (method === "POST" && path === "/api/admin/payments/verify") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      paymentId = String(b.paymentId || "").trim(),
      code = String(b.receipt || "")
        .trim()
        .toUpperCase(),
      amount = Number(b.amount),
      evidence = manualPaymentEvidence(b);
    if (!paymentId) return fail(res, 400, "Choose a payment to verify.");
    if (!/^[A-Z0-9]{8,12}$/.test(code))
      return fail(
        res,
        400,
        "Enter the M-Pesa code shown in transaction evidence.",
      );
    if (evidence.error) return fail(res, 400, evidence.error);
    const { data: pay, error: paymentError } = await db
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentError) throw paymentError;
    if (!pay) return fail(res, 404, "Payment not found.");
    if (pay.status === "success")
      return fail(res, 409, "This payment is already confirmed.");
    if (pay.archived_at)
      return fail(res, 409, "Restore this payment before verifying it.");
    if (!Number.isInteger(amount) || amount !== Number(pay.amount))
      return fail(
        res,
        409,
        "The verified M-Pesa amount must exactly match the requested amount.",
      );
    const { data: duplicate, error: duplicateError } = await db
      .from("payments")
      .select("id")
      .eq("receipt", code)
      .neq("id", pay.id)
      .limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate?.length)
      return fail(
        res,
        409,
        "That M-Pesa receipt is already assigned to another payment.",
      );
    const service = pay.result_request_id
      ? { table: "result_requests", id: pay.result_request_id }
      : pay.refer_request_id
        ? { table: "refer_requests", id: pay.refer_request_id }
        : pay.request_id
          ? { table: "paper_requests", id: pay.request_id }
          : null;
    if (!service)
      return fail(res, 409, "This payment is not linked to a request.");
    const { data: request, error: requestError } = await db
      .from(service.table)
      .select("id,status,payment_status,archived_at")
      .eq("id", service.id)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return fail(res, 404, "Linked request not found.");
    if (request.archived_at)
      return fail(
        res,
        409,
        "Restore the linked request before verifying payment.",
      );
    if (
      request.status === "rejected" ||
      request.status === "paid" ||
      request.payment_status === "paid"
    )
      return fail(
        res,
        409,
        "The linked request is already paid or cannot be paid.",
      );
    const { data: updated, error: updateError } = await db
      .from("payments")
      .update({
        status: "success",
        receipt: code,
        paid_phone: evidence.paidPhone,
        paid_amount: amount,
        payer_name: evidence.payerName || null,
        payer_name_source: evidence.payerNameSource,
        paid_at: evidence.paidAt,
        paid_at_source: evidence.paidAtSource,
        confirmation_source: "admin_verified",
        reconciliation_status: "verified",
      })
      .eq("id", pay.id)
      .in("status", ["initiated", "pending", "review_required", "failed"])
      .select("*")
      .maybeSingle();
    if (updateError?.code === "23505")
      return fail(
        res,
        409,
        "A successful payment or duplicate receipt already exists for this request.",
      );
    if (updateError) throw updateError;
    if (!updated)
      return fail(
        res,
        409,
        "Payment status changed; refresh and review it again.",
      );
    await markPaid(updated, code, amount);
    const { error: eventError } = await db.from("payment_events").insert({
      payment_id: updated.id,
      result_code: 0,
      result_description:
        "Manually verified by administrator against M-Pesa evidence",
      payload: {
        source: "admin_verified",
        actorId: u.id,
        receipt: code,
        amount,
        payerName: evidence.payerName || null,
        paidPhone: evidence.paidPhone,
        paidAt: evidence.paidAt,
        paidAtSource: evidence.paidAtSource,
      },
    });
    if (eventError) throw eventError;
    await writeAudit({
      actor_id: u.id,
      action: "payment.manual_reconciled",
      entity_type: "payment",
      entity_id: updated.id,
      metadata: {
        serviceType: updated.result_request_id
          ? "results"
          : updated.refer_request_id
            ? "refer"
            : "paper",
        receipt: code,
        amount,
        payerPhone: evidence.paidPhone,
        payerName: evidence.payerName || null,
        paidAt: evidence.paidAt,
        paidAtSource: evidence.paidAtSource,
      },
    });
    return json(res, 200, { ok: true, payment: mapPayment(updated) });
  }
  if (method === "POST" && path === "/api/records/archive") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      type = String(b.type || ""),
      action = String(b.action || ""),
      id = String(b.id || "").trim(),
      mapping = {
        paper: { table: "paper_requests", paymentField: "request_id" },
        results: {
          table: "result_requests",
          paymentField: "result_request_id",
        },
        refer: { table: "refer_requests", paymentField: "refer_request_id" },
        payment: { table: "payments" },
      };
    if (!mapping[type] || !["archive", "restore"].includes(action) || !id)
      return fail(res, 400, "Choose a valid record and archive action.");
    const { data: result, error } = await db.rpc("set_request_archive_state", {
      p_type: type,
      p_id: id,
      p_actor_id: u.id,
      p_action: action,
      p_reason: String(b.reason || "").slice(0, 300),
    });
    if (error) throw error;
    if (!result?.ok) {
      const reason = result?.reason || "unknown";
      return fail(
        res,
        reason === "pending_payment" ? 409 : 404,
        reason === "pending_payment"
          ? "This request has a pending payment attempt; reconcile it before archiving."
          : "Record not found or the archive action is not permitted.",
      );
    }
    return json(res, 200, result);
  }
  if (method === "POST" && path === "/api/admin/papers/update") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      p = {};
    if (b.title) p.title = String(b.title).slice(0, 150);
    if (b.subject) p.subject = String(b.subject).slice(0, 80);
    if (b.description !== undefined)
      p.description = String(b.description).slice(0, 500);
    if (b.price !== undefined && b.price !== "" && Number(b.price) >= 0)
      p.price = Number(b.price);
    if (typeof b.available === "boolean") p.available = b.available;
    if (!Object.keys(p).length) return fail(res, 400, "Nothing to update.");
    const { data, error } = await db
      .from("papers")
      .update(p)
      .eq("id", b.paperId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Paper not found.");
    if (p.title)
      await db
        .from("paper_requests")
        .update({ title: p.title })
        .eq("paper_id", data.id);
    await writeAudit({
      actor_id: u.id,
      action: "paper.update",
      entity_type: "paper",
      entity_id: data.id,
      metadata: p,
    });
    return json(res, 200, { paper: mapPaper(data) });
  }
  if (method === "POST" && path === "/api/admin/papers/delete") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      { data: p } = await db
        .from("papers")
        .select("id,storage_path,title")
        .eq("id", b.paperId)
        .maybeSingle();
    if (!p) return fail(res, 404, "Paper not found.");
    const { error } = await db.from("papers").delete().eq("id", p.id);
    if (error) throw error;
    const { data: same } = await db
      .from("papers")
      .select("id")
      .eq("storage_path", p.storage_path)
      .limit(1);
    if (!same?.length)
      await supabase.storage.from(BUCKET).remove([p.storage_path]);
    await writeAudit({
      actor_id: u.id,
      action: "paper.delete",
      entity_type: "paper",
      entity_id: null,
      metadata: { title: p.title },
    });
    return json(res, 200, { deleted: true });
  }
  if (method === "POST" && path === "/api/admin/payments/service-manual") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      serviceType = String(b.serviceType || ""),
      table = serviceType === "results" ? "result_requests" : "refer_requests",
      referenceField =
        serviceType === "results" ? "result_request_id" : "refer_request_id",
      code = String(b.receipt || "")
        .trim()
        .toUpperCase(),
      amount = Number(b.amount),
      evidence = manualPaymentEvidence(b),
      phone = evidence.paidPhone;
    if (!["results", "refer"].includes(serviceType))
      return fail(res, 400, "Choose a valid academic service.");
    if (!/^[A-Z0-9]{8,12}$/.test(code))
      return fail(res, 400, "Enter the M-Pesa code, for example UJV570GU3H.");
    if (!Number.isInteger(amount) || amount < 1)
      return fail(
        res,
        400,
        "Enter the M-Pesa amount shown in the transaction.",
      );
    if (evidence.error) return fail(res, 400, evidence.error);
    const { data: request, error: requestError } = await db
      .from(table)
      .select("id,user_id,payment_status,service_fee,status,archived_at")
      .eq("id", b.requestId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!request) return fail(res, 404, "Service request not found.");
    if (request.archived_at)
      return fail(res, 409, "Restore this request before recording payment.");
    if (request.status === "rejected")
      return fail(res, 409, "Rejected service requests cannot be paid.");
    if (request.payment_status === "paid")
      return fail(res, 409, "Already paid.");
    const { data: confirmedPayment, error: confirmedError } = await db
      .from("payments")
      .select("id")
      .eq(referenceField, request.id)
      .eq("status", "success")
      .limit(1);
    if (confirmedError) throw confirmedError;
    if (confirmedPayment?.length)
      return fail(
        res,
        409,
        "A confirmed payment already exists for this request.",
      );
    if (amount !== Number(request.service_fee))
      return fail(
        res,
        409,
        "The recorded M-Pesa amount must exactly match this service fee.",
      );
    const { data: duplicate, error: duplicateError } = await db
      .from("payments")
      .select("id")
      .eq("receipt", code)
      .limit(1);
    if (duplicateError) throw duplicateError;
    if (duplicate?.length)
      return fail(res, 409, "That M-Pesa code was already used.");
    const payment = {
        [referenceField]: request.id,
        user_id: request.user_id,
        amount,
        phone,
        status: "success",
        receipt: code,
        paid_phone: phone,
        paid_amount: amount,
        payer_name: evidence.payerName || null,
        payer_name_source: evidence.payerNameSource,
        paid_at: evidence.paidAt,
        paid_at_source: evidence.paidAtSource,
        confirmation_source: "admin_verified",
        reconciliation_status: "verified",
      },
      { data: inserted, error } = await db
        .from("payments")
        .insert(payment)
        .select("*")
        .single();
    if (error?.code === "23505")
      return fail(
        res,
        409,
        "That M-Pesa code was already used or this request already has a confirmed payment.",
      );
    if (error?.code === "23514")
      return fail(res, 409, "Restore this request before recording payment.");
    if (error) throw error;
    await markPaid(inserted, code, payment.amount);
    const { error: eventError } = await db.from("payment_events").insert({
      payment_id: inserted.id,
      result_code: 0,
      result_description: "Manually verified by administrator",
      payload: {
        source: "admin_verified",
        actorId: u.id,
        receipt: code,
        amount,
        payerName: evidence.payerName || null,
        paidPhone: phone,
        paidAt: evidence.paidAt,
        paidAtSource: evidence.paidAtSource,
      },
    });
    if (eventError) throw eventError;
    await writeAudit({
      actor_id: u.id,
      action: "service.payment.manual",
      entity_type: table,
      entity_id: request.id,
      metadata: { paymentId: inserted.id, serviceType, receipt: code, amount },
    });
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/admin/payments/manual") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      code = String(b.receipt || "")
        .trim()
        .toUpperCase(),
      evidence = manualPaymentEvidence(b);
    if (!/^[A-Z0-9]{8,12}$/.test(code))
      return fail(res, 400, "Enter the M-Pesa code, for example UJV570GU3H.");
    if (evidence.error) return fail(res, 400, evidence.error);
    const { data: r } = await db
      .from("paper_requests")
      .select("*")
      .eq("id", b.requestId)
      .maybeSingle();
    if (!r) return fail(res, 404, "Request not found.");
    if (r.archived_at)
      return fail(res, 409, "Restore this request before recording payment.");
    if (r.status === "paid") return fail(res, 409, "Already paid.");
    const amount = Number(b.amount ?? r.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount !== Number(r.amount))
      return fail(
        res,
        409,
        "The recorded M-Pesa amount must exactly match this request amount.",
      );
    const { data: dup } = await db
      .from("payments")
      .select("id")
      .eq("receipt", code)
      .limit(1);
    if (dup?.length)
      return fail(res, 409, "That M-Pesa code was already used.");
    const pay = {
        request_id: r.id,
        user_id: r.user_id,
        amount,
        phone: evidence.paidPhone,
        status: "success",
        receipt: code,
        paid_phone: evidence.paidPhone,
        paid_amount: amount,
        payer_name: evidence.payerName || null,
        payer_name_source: evidence.payerNameSource,
        paid_at: evidence.paidAt,
        paid_at_source: evidence.paidAtSource,
        confirmation_source: "admin_verified",
        reconciliation_status: "verified",
      },
      { data: ins, error } = await db
        .from("payments")
        .insert(pay)
        .select("*")
        .single();
    if (error?.code === "23505")
      return fail(
        res,
        409,
        "A confirmed payment already exists for this request or receipt.",
      );
    if (error?.code === "23514")
      return fail(res, 409, "Restore this request before recording payment.");
    if (error) throw error;
    await markPaid(ins, code, pay.amount);
    const { error: eventError } = await db.from("payment_events").insert({
      payment_id: ins.id,
      result_code: 0,
      result_description: "Manually verified by administrator",
      payload: {
        source: "admin_verified",
        actorId: u.id,
        receipt: code,
        amount,
        payerName: evidence.payerName || null,
        paidPhone: evidence.paidPhone,
        paidAt: evidence.paidAt,
        paidAtSource: evidence.paidAtSource,
      },
    });
    if (eventError) throw eventError;
    await writeAudit({
      actor_id: u.id,
      action: "payment.manual",
      entity_type: "payment",
      entity_id: ins.id,
      metadata: {
        code,
        amount,
        payerName: evidence.payerName || null,
        paidPhone: evidence.paidPhone,
        paidAt: evidence.paidAt,
        paidAtSource: evidence.paidAtSource,
      },
    });
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/admin/papers/upload") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const { fields, info, buffer } = await parseMultipart(req);
    const ext = (String(info?.filename || "").match(/\.[^.]+$/) || [
      "",
    ])[0].toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext))
      return fail(
        res,
        400,
        "Supported formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, CSV, TXT, RTF, ODT, ODS and ODP.",
      );
    if (!buffer.length) return fail(res, 400, "Choose a paper file first.");
    if (buffer.length > 4 * 1024 * 1024)
      return fail(res, 400, "Use the signed upload flow for files over 4 MB.");
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex"),
      mime = ALLOWED_MIME_TYPES.includes(info?.mimeType)
        ? info.mimeType
        : "application/octet-stream";
    const { data: duplicate } = await db
      .from("papers")
      .select("id")
      .eq("checksum", checksum)
      .maybeSingle();
    if (duplicate)
      return fail(
        res,
        409,
        "This document is already stored. Reuse the existing paper instead of uploading a duplicate.",
      );
    const storagePath = `uploads/${checksum}${ext}`,
      up = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, { contentType: mime, upsert: false });
    if (up.error) throw up.error;
    const s = await getSettings(),
      { data: paper, error } = await db
        .from("papers")
        .insert({
          title: String(fields.title || info.filename).slice(0, 150),
          subject: String(fields.subject || "General").slice(0, 80),
          type: fields.type || "Revision Paper",
          description: String(fields.description || "").slice(0, 1000),
          price: Math.max(0, Number(fields.price || s.paper_price)),
          available: true,
          storage_path: storagePath,
          original_name: String(info.filename),
          checksum,
          file_size: buffer.length,
          mime_type: mime,
          level: String(fields.level || "").slice(0, 50),
          year: String(fields.year || "").slice(0, 12),
          semester: String(fields.semester || "").slice(0, 30),
          uploaded_by: u.id,
        })
        .select("*")
        .single();
    if (error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      throw error;
    }
    await db.from("notices").insert({
      title: "New paper available: " + paper.title,
      body: `${paper.subject} materials are now available.`,
      priority: "normal",
    });
    const { data: matches } = await db
      .from("paper_requests")
      .select("user_id,title")
      .ilike("subject", paper.subject)
      .eq("status", "requested");
    for (const m of matches || [])
      await notify(
        m.user_id,
        "Requested paper available",
        `${paper.title} matches your requested ${m.title}.`,
        "availability",
      );
    return json(res, 201, {
      paper: mapPaper(paper),
      matchedRequests: (matches || []).length,
    });
  }
  if (method === "POST" && path === "/api/admin/papers/upload-url") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      name = String(b.fileName || ""),
      ext = (name.match(/\.[^.]+$/) || [""])[0].toLowerCase(),
      size = Number(b.size),
      checksum = String(b.checksum || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext))
      return fail(
        res,
        400,
        "Supported formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, CSV, TXT, RTF, ODT, ODS and ODP.",
      );
    if (!Number.isFinite(size) || size < 1 || size > 25 * 1024 * 1024)
      return fail(res, 400, "Paper must be between 1 byte and 25 MB.");
    if (!/^[a-f0-9]{64}$/.test(checksum))
      return fail(res, 400, "A valid SHA-256 document checksum is required.");
    const { data: duplicate, error: duplicateError } = await db
      .from("papers")
      .select("id")
      .eq("checksum", checksum)
      .maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return fail(res, 409, "This document is already stored.");
    const storagePath = `uploads/${checksum}${ext}`,
      { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw error;
    return json(res, 200, {
      storagePath,
      uploadUrl: data.signedUrl || data.signedURL,
      token: data.token,
      expiresIn: 7200,
      contentType: String(b.mime || "application/octet-stream"),
    });
  }
  if (method === "POST" && path === "/api/admin/papers") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req);
    const checksum = String(b.checksum || "").toLowerCase(),
      originalName = String(b.originalName || ""),
      ext = (originalName.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    if (
      !b.storagePath ||
      !b.title ||
      !b.subject ||
      !originalName ||
      !/^[a-f0-9]{64}$/.test(checksum) ||
      !ALLOWED_EXTENSIONS.includes(ext) ||
      b.storagePath !== `uploads/${checksum}${ext}`
    )
      return fail(
        res,
        400,
        "Upload the paper file and provide its title and subject.",
      );
    const folder = b.storagePath.split("/").slice(0, -1).join("/"),
      file = b.storagePath.split("/").pop(),
      { data: objects } = await supabase.storage
        .from(BUCKET)
        .list(folder, { search: file });
    if (!objects?.some((x) => x.name === file))
      return fail(
        res,
        400,
        "Storage did not confirm the uploaded file. Retry the upload.",
      );
    const s = await getSettings(),
      { data: paper, error } = await db
        .from("papers")
        .insert({
          title: String(b.title).slice(0, 150),
          subject: String(b.subject).slice(0, 80),
          type: b.type || "Revision Paper",
          description: String(b.description || "").slice(0, 1000),
          price: Math.max(0, Number(b.price || s.paper_price)),
          available: b.available !== false,
          storage_path: b.storagePath,
          original_name: originalName,
          checksum,
          file_size: Number(b.fileSize || 0) || null,
          mime_type: String(b.mimeType || "application/octet-stream"),
          level: String(b.level || "").slice(0, 50),
          year: String(b.year || "").slice(0, 12),
          semester: String(b.semester || "").slice(0, 30),
          uploaded_by: u.id,
        })
        .select("*")
        .single();
    if (error) {
      const { data: references } = await db
        .from("papers")
        .select("id")
        .eq("storage_path", b.storagePath)
        .limit(1);
      if (!references?.length)
        await supabase.storage.from(BUCKET).remove([b.storagePath]);
      throw error;
    }
    await db.from("notices").insert({
      title: "New paper available: " + paper.title,
      body: `${paper.subject} materials are now available.`,
      priority: "normal",
    });
    const { data: matches } = await db
      .from("paper_requests")
      .select("user_id,title")
      .ilike("subject", paper.subject)
      .eq("status", "requested");
    for (const m of matches || [])
      await notify(
        m.user_id,
        "Requested paper available",
        `${paper.title} matches your requested ${m.title}.`,
        "availability",
      );
    return json(res, 201, {
      paper: mapPaper(paper),
      matchedRequests: (matches || []).length,
    });
  }
  if (method === "GET" && path.startsWith("/api/download/")) {
    const u = await requireUser(req, res),
      id = path.split("/").pop();
    if (!u) return;
    const { data: paper } = await db
      .from("papers")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!paper) return fail(res, 404, "Paper not found.");
    if (u.role !== "admin") {
      const { data: ok } = await db
        .from("paper_requests")
        .select("id")
        .eq("user_id", u.id)
        .eq("paper_id", id)
        .eq("status", "paid")
        .limit(1);
      if (!ok?.length)
        return fail(
          res,
          403,
          "Complete payment for this paper before downloading.",
        );
    }
    await db.from("download_events").insert({ user_id: u.id, paper_id: id });
    await db
      .from("papers")
      .update({ download_count: Number(paper.download_count || 0) + 1 })
      .eq("id", id);
    const { data: link, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(paper.storage_path, 120, {
        download: paper.original_name,
      });
    if (error) throw error;
    res.statusCode = 302;
    res.setHeader("location", link.signedUrl);
    return res.end();
  }
  if (method === "POST" && path === "/api/favorites") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      { data, error } = await db
        .from("favorites")
        .upsert(
          { user_id: u.id, paper_id: b.paperId },
          { onConflict: "user_id,paper_id" },
        )
        .select()
        .single();
    if (error) throw error;
    return json(res, 201, { favorite: data });
  }
  if (method === "DELETE" && path.startsWith("/api/favorites/")) {
    const u = await requireUser(req, res);
    if (!u) return;
    await db
      .from("favorites")
      .delete()
      .eq("user_id", u.id)
      .eq("paper_id", path.split("/").pop());
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/notifications/read") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req);
    await db
      .from("notifications")
      .update({ read_at: now() })
      .eq("id", b.id)
      .eq("user_id", u.id);
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/notifications") {
    const u = await requireUser(req, res);
    if (!u) return;
    const { data, error } = await db
      .from("notifications")
      .select("*")
      .eq("user_id", u.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error && error.code !== "42P01") throw error;
    return json(res, 200, { notifications: data || [] });
  }
  if (method === "GET" && path === "/api/profile/avatar") {
    const u = await requireUser(req, res);
    if (!u) return;
    const userId = new URL(req.url, "https://vercel.local").searchParams.get(
      "userId",
    );
    if (!userId || (u.role !== "admin" && userId !== u.id))
      return fail(res, 404, "Profile photo not found.");
    const { data: profile, error } = await db
      .from("profiles")
      .select("avatar_path")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (!profile?.avatar_path || !profile.avatar_path.startsWith(`${userId}/`))
      return fail(res, 404, "Profile photo not found.");
    const { data: link, error: linkError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(profile.avatar_path, 120);
    if (linkError) throw linkError;
    res.statusCode = 302;
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("location", link.signedUrl);
    return res.end();
  }
  if (method === "POST" && path === "/api/profile/avatar-upload-url") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      mime = String(b.mime || "").toLowerCase(),
      extByMime = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
      },
      size = Number(b.size);
    if (!extByMime[mime])
      return fail(res, 400, "Choose a JPEG, PNG or WebP profile photo.");
    if (!Number.isFinite(size) || size < 1 || size > 3 * 1024 * 1024)
      return fail(res, 400, "Profile photos must be between 1 byte and 3 MB.");
    const storagePath = `${u.id}/${crypto.randomUUID()}${extByMime[mime]}`,
      { data, error } = await supabase.storage
        .from(AVATAR_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: false });
    if (error) throw error;
    return json(res, 200, {
      storagePath,
      uploadUrl: data.signedUrl || data.signedURL,
      token: data.token,
      contentType: mime,
      expiresIn: 7200,
    });
  }
  if (method === "POST" && path === "/api/profile/avatar-complete") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      storagePath = String(b.storagePath || ""),
      parts = storagePath.split("/"),
      expectedSize = Number(b.size);
    if (
      parts.length !== 2 ||
      parts[0] !== u.id ||
      !/^[a-f0-9-]{36}\.(jpg|png|webp)$/i.test(parts[1]) ||
      !Number.isFinite(expectedSize) ||
      expectedSize < 1 ||
      expectedSize > 3 * 1024 * 1024
    )
      return fail(res, 400, "Upload a valid profile photo first.");
    const { data: objects, error: listError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .list(parts[0], { search: parts[1] });
    if (listError) throw listError;
    if (!objects?.some((item) => item.name === parts[1]))
      return fail(
        res,
        400,
        "Storage did not confirm the profile photo upload.",
      );
    const { data: photo, error: downloadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .download(storagePath);
    if (downloadError) throw downloadError;
    const mime = detectAvatarMime(Buffer.from(await photo.arrayBuffer())),
      expectedMime = parts[1].endsWith(".jpg")
        ? "image/jpeg"
        : parts[1].endsWith(".png")
          ? "image/png"
          : "image/webp";
    if (photo.size !== expectedSize || mime !== expectedMime) {
      await supabase.storage.from(AVATAR_BUCKET).remove([storagePath]);
      return fail(
        res,
        400,
        "The uploaded photo is not a valid supported image.",
      );
    }
    const { data: previous, error: previousError } = await db
      .from("profiles")
      .select("avatar_path")
      .eq("id", u.id)
      .maybeSingle();
    if (previousError) throw previousError;
    const { data: profile, error } = await db
      .from("profiles")
      .update({ avatar_path: storagePath })
      .eq("id", u.id)
      .select(
        "id,name,username,email,phone,role,avatar_path,must_change_password,created_at",
      )
      .single();
    if (error) throw error;
    if (
      previous?.avatar_path &&
      previous.avatar_path.startsWith(`${u.id}/`) &&
      previous.avatar_path !== storagePath
    )
      await supabase.storage.from(AVATAR_BUCKET).remove([previous.avatar_path]);
    await writeAudit({
      actor_id: u.id,
      action: "profile.avatar_update",
      entity_type: "profile",
      entity_id: u.id,
      metadata: { mime, size: photo.size },
    });
    return json(res, 200, { user: safeUser(profile) });
  }
  if (method === "POST" && path === "/api/profile") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      name = String(b.name || u.name)
        .trim()
        .slice(0, 100),
      phone = String(b.phone || "").replace(/\s/g, ""),
      usernameInput = String(b.username || "").trim(),
      username = usernameInput ? normalizeUsername(usernameInput) : "";
    if (usernameInput && !isValidUsername(username))
      return fail(
        res,
        400,
        "Choose a username (3–32 letters, numbers, dots, dashes or underscores).",
      );
    if (phone && !/^\+?254\d{9}$/.test(phone) && !/^07\d{8}$/.test(phone))
      return fail(res, 400, "Enter a valid Kenyan phone number.");
    const updates = { name, phone };
    if (username) updates.username = username;
    const { data, error } = await db
      .from("profiles")
      .update(updates)
      .eq("id", u.id)
      .select(
        "id,name,username,email,phone,role,avatar_path,must_change_password,created_at",
      )
      .single();
    if (error?.code === "23505")
      return fail(res, 409, "That username is already in use.");
    if (error) throw error;
    return json(res, 200, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/profile/password") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      currentPassword = String(b.currentPassword || ""),
      newPassword = String(b.newPassword || ""),
      confirmPassword = String(b.confirmPassword || "");
    if (newPassword.length < 12)
      return fail(res, 400, "New passwords must be at least 12 characters.");
    if (confirmPassword && newPassword !== confirmPassword)
      return fail(res, 400, "The new passwords do not match.");
    const { data: account, error: readError } = await db
      .from("profiles")
      .select(
        "password_salt,password_hash,session_version,must_change_password",
      )
      .eq("id", u.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!account)
      return fail(res, 404, "Account not found. Sign in again and retry.");
    const expected = Buffer.from(account.password_hash || "", "hex"),
      actual = crypto.scryptSync(
        currentPassword,
        account.password_salt || "",
        64,
      );
    if (!account.must_change_password) {
      if (
        expected.length !== actual.length ||
        !crypto.timingSafeEqual(actual, expected)
      )
        return fail(res, 401, "Current password is incorrect.");
    }
    const salt = crypto.randomBytes(16).toString("hex"),
      password_hash = crypto.scryptSync(newPassword, salt, 64).toString("hex"),
      { error } = await db
        .from("profiles")
        .update({
          password_salt: salt,
          password_hash,
          must_change_password: false,
          session_version: Number(account.session_version || 0) + 1,
        })
        .eq("id", u.id);
    if (error) throw error;
    await writeAudit({
      actor_id: u.id,
      action: "profile.password_change",
      entity_type: "profile",
      entity_id: u.id,
      metadata: { forcedChange: Boolean(account.must_change_password) },
    });
    clearSession(res);
    return json(res, 200, { ok: true });
  }
  if (method === "POST" && path === "/api/admin/users/reset-password") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      targetId = String(b.userId || "");
    if (!targetId) return fail(res, 400, "Choose a learner account.");
    const { data: account, error: readError } = await db
      .from("profiles")
      .select("id,role,session_version")
      .eq("id", targetId)
      .maybeSingle();
    if (readError) throw readError;
    if (!account || account.role !== "student")
      return fail(res, 404, "Learner account not found.");
    const temporaryPassword = crypto.randomBytes(15).toString("base64url"),
      salt = crypto.randomBytes(16).toString("hex"),
      password_hash = crypto
        .scryptSync(temporaryPassword, salt, 64)
        .toString("hex"),
      { error } = await db
        .from("profiles")
        .update({
          password_salt: salt,
          password_hash,
          must_change_password: true,
          session_version: Number(account.session_version || 0) + 1,
        })
        .eq("id", targetId);
    if (error) throw error;
    await writeAudit({
      actor_id: u.id,
      action: "admin.password_reset",
      entity_type: "profile",
      entity_id: targetId,
      metadata: { forcedChange: true },
    });
    return json(res, 200, { temporaryPassword });
  }
  if (method === "GET" && path === "/api/admin/analytics") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const [p, r, pa, d] = await Promise.all([
      db.from("papers").select("id,subject,download_count"),
      db.from("paper_requests").select("id,status,subject,amount"),
      db.from("payments").select("amount,status"),
      db.from("download_events").select("id"),
    ]);
    return json(res, 200, {
      papers: p.data?.length || 0,
      requests: r.data?.length || 0,
      downloads: d.data?.length || 0,
      revenue: (pa.data || [])
        .filter((x) => x.status === "success")
        .reduce((a, x) => a + Number(x.amount || 0), 0),
      subjects: Object.entries(
        (r.data || []).reduce(
          (a, x) => ((a[x.subject] = (a[x.subject] || 0) + 1), a),
          {},
        ),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8),
    });
  }
  if (method === "GET" && path === "/api/admin/export/payments") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const { data, error } = await db
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const profileIds = [
        ...new Set((data || []).map((x) => x.user_id).filter(Boolean)),
      ],
      { data: profiles, error: profilesError } = profileIds.length
        ? await db
            .from("profiles")
            .select("id,name,username,email,phone")
            .in("id", profileIds)
        : { data: [], error: null };
    if (profilesError) throw profilesError;
    const profileById = new Map((profiles || []).map((x) => [x.id, x]));
    res.statusCode = 200;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      "attachment; filename=comreds-payments.csv",
    );
    const csvCell = (value) => {
      const text = String(value ?? ""),
        safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    res.end(
      [
        "id,service_type,request_id,result_request_id,refer_request_id,amount,paid_amount,registered_name,registered_username,registered_email,registered_phone,payer_name,payer_name_source,requested_phone,paid_phone,paid_at,paid_at_source,confirmation_source,reconciliation_status,provider_result_code,provider_result_description,provider_checked_at,status,receipt,result_code,result_description,created_at,archived_at,archive_reason",
        ...(data || []).map((x) =>
          [
            x.id,
            x.result_request_id
              ? "results"
              : x.refer_request_id
                ? "refer"
                : "paper",
            x.request_id || "",
            x.result_request_id || "",
            x.refer_request_id || "",
            x.amount,
            x.paid_amount ?? "",
            profileById.get(x.user_id)?.name || "",
            profileById.get(x.user_id)?.username || "",
            profileById.get(x.user_id)?.email || "",
            profileById.get(x.user_id)?.phone || "",
            x.payer_name || "",
            x.payer_name_source || "unavailable",
            x.phone || "",
            x.paid_phone || "",
            x.paid_at || "",
            x.paid_at_source || "unknown",
            x.confirmation_source || "legacy",
            x.reconciliation_status || "not_checked",
            x.provider_result_code ?? "",
            x.provider_result_description || "",
            x.provider_checked_at || "",
            x.status,
            x.receipt || "",
            x.result_code ?? "",
            x.result_description || "",
            x.created_at,
            x.archived_at || "",
            x.archive_reason || "",
          ]
            .map(csvCell)
            .join(","),
        ),
      ].join("\n"),
    );
    return;
  }
  if (method === "POST" && path === "/api/admin/papers/archive") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req);
    const { data, error } = await db
      .from("papers")
      .update({ available: false })
      .eq("id", b.paperId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Paper not found.");
    await writeAudit({
      actor_id: u.id,
      action: "paper.archive",
      entity_type: "paper",
      entity_id: data.id,
      metadata: {},
    });
    return json(res, 200, { paper: mapPaper(data) });
  }
  if (method === "POST" && path === "/api/admin/requests/bulk-status") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req);
    const allowedStatuses = [
      "requested",
      "awaiting_payment",
      "rejected",
      "processing",
      "delivered",
      "payment_failed",
    ];
    if (
      !Array.isArray(b.ids) ||
      b.ids.length === 0 ||
      b.ids.length > 100 ||
      !allowedStatuses.includes(b.status)
    )
      return fail(res, 400, "Provide request IDs and a status.");
    const { data, error } = await db
      .from("paper_requests")
      .update({ status: b.status })
      .in("id", b.ids)
      .select("id");
    if (error) throw error;
    return json(res, 200, { updated: data?.length || 0 });
  }
  if (method === "POST" && path === "/api/admin/notices") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      { data, error } = await db
        .from("notices")
        .insert({
          title: String(b.title || "").slice(0, 150),
          body: String(b.body || "").slice(0, 1000),
          priority: b.priority || "normal",
          expires_at: b.expiresAt || null,
        })
        .select("*")
        .single();
    if (error) throw error;
    return json(res, 201, { notice: mapNotice(data) });
  }
  if (method === "POST" && path === "/api/admin/settings") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      s = await getSettings(),
      rawPhone = String(b.supportPhone ?? s.support_phone ?? "").trim(),
      phone = rawPhone ? normalizeKenyanPhone(rawPhone) : "",
      loginDesign = String(b.loginDesign ?? s.login_design ?? "cdacc");
    if (rawPhone && !/^254[17]\d{8}$/.test(phone || ""))
      return fail(
        res,
        400,
        "Enter a valid Kenyan WhatsApp mobile number (07…/01… or +254…).",
      );
    if (!["cdacc", "classic", "navy"].includes(loginDesign))
      return fail(res, 400, "Choose one of the available welcome designs.");
    const prices = {
      paper_price: Number(b.paperPrice ?? s.paper_price),
      results_request_price: Number(
        b.resultsRequestPrice ?? s.results_request_price ?? 0,
      ),
      refer_registration_price: Number(
        b.referRegistrationPrice ?? s.refer_registration_price ?? 0,
      ),
    };
    if (
      Object.values(prices).some(
        (price) => !Number.isInteger(price) || price < 0 || price > 1000000,
      )
    )
      return fail(
        res,
        400,
        "Prices must be whole-shilling amounts from KSh 0 to 1,000,000.",
      );
    const { data, error } = await db
      .from("portal_settings")
      .upsert({
        id: 1,
        portal_name: String(b.portalName || s.portal_name).slice(0, 80),
        currency: "KES",
        ...prices,
        support_phone: phone,
        login_design: loginDesign,
      })
      .select()
      .single();
    if (error) throw error;
    return json(res, 200, { settings: data });
  }
  if (method === "POST" && path === "/api/admin/requests/status") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req);
    if (
      ![
        "requested",
        "awaiting_payment",
        "rejected",
        "processing",
        "delivered",
        "payment_failed",
      ].includes(b.status)
    )
      return fail(res, 400, "Invalid request status.");
    const { data, error } = await db
      .from("paper_requests")
      .update({ status: b.status })
      .eq("id", b.id)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return fail(res, 404, "Request not found.");
    await writeAudit({
      actor_id: u.id,
      action: "request.status",
      entity_type: "paper_request",
      entity_id: data.id,
      metadata: { status: b.status },
    });
    return json(res, 200, { request: mapRequest(data) });
  }
  return fail(res, 404, "Not found");
}
export default async function handler(req, res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "same-origin");
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type");
      return res.end();
    }
    if (!isSameOriginRequest(req))
      return fail(res, 403, "Cross-origin request rejected.");
    const path = _reqPath(req);
    if (req.method === "POST") {
      const contentType = String(req.headers["content-type"] || "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const multipart = path === "/api/admin/papers/upload";
      if (
        multipart
          ? contentType !== "multipart/form-data"
          : contentType !== "application/json"
      )
        return fail(res, 415, "Use the expected request content type.");
    }
    if (path === "/api/mpesa/callback") {
      const supplied = new URL(
        req.url,
        "https://vercel.local",
      ).searchParams.get("token");
      if (
        (env.DARAJA_CALLBACK_TOKEN || "").length < 32 ||
        !safeEquals(supplied || "", env.DARAJA_CALLBACK_TOKEN)
      )
        return fail(res, 401, "Unauthorized payment callback.");
    }
    if (
      !env.SUPABASE_URL ||
      !env.SUPABASE_SERVICE_ROLE_KEY ||
      !env.SESSION_SECRET
    )
      return fail(
        res,
        500,
        "Server setup incomplete: configure Supabase and SESSION_SECRET in Vercel.",
      );
    if (req.method === "GET" && path === "/api/health")
      return await route(req, res);
    await bootstrapAdmin();
    return await route(req, res);
  } catch (e) {
    console.error("Comreds API error:", e);
    if (res.headersSent || res.writableEnded) return;
    return fail(res, 500, "Server error. Check the Vercel function logs.");
  }
}

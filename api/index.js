import crypto from "node:crypto";
import Busboy from "busboy";
import { createClient } from "@supabase/supabase-js";
import { db, supabaseUrl } from "./db.js";
import { resolveRequestPath } from "./request-path.js";
import { isSameOriginRequest, safeEquals } from "./security.js";
import { isValidMpesaConfirmation } from "./payment-proof.js";
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
    JSON.stringify({ id: u.id, role: u.role, exp: Date.now() + 604800000 }),
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
  email: u.email,
  phone: u.phone || "",
  role: u.role,
  createdAt: u.created_at,
});
async function currentUser(req) {
  const s = session(req);
  if (!s) return null;
  const { data, error } = await db
    .from("profiles")
    .select("id,name,email,phone,role,created_at")
    .eq("id", s.id)
    .maybeSingle();
  if (error) throw error;
  return data ? safeUser(data) : null;
}
async function requireUser(req, res, role) {
  const u = await currentUser(req);
  if (!u || (role && u.role !== role)) {
    fail(res, 401, "Please sign in with an authorized account.");
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
      support_phone: env.DEFAULT_PAYMENT_PHONE || "+254723278526",
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
  }),
  mapPayment = (p) => ({
    id: p.id,
    requestId: p.request_id,
    userId: p.user_id,
    amount: Number(p.amount),
    phone: p.phone,
    status: p.status,
    createdAt: p.created_at,
    receipt: p.receipt,
    paidPhone: p.paid_phone || "",
    paidAmount: Number(p.paid_amount || 0),
    resultCode: p.result_code,
    error: p.error_message || "",
  }),
  mapNotice = (n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    priority: n.priority || "normal",
    expiresAt: n.expires_at,
    createdAt: n.created_at,
  });
async function notifyAdmins(title, body) {
  const { data } = await db.from("profiles").select("id").eq("role", "admin");
  for (const a of data || []) await notify(a.id, title, body, "payment");
}
async function markPaid(pay, receipt, amount) {
  const { data: r } = await db
    .from("paper_requests")
    .update({ status: "paid" })
    .eq("id", pay.request_id)
    .neq("status", "paid")
    .select("user_id,title,student_name")
    .maybeSingle();
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
    ts = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14),
    r = await fetch(host + "/mpesa/stkpushquery/v1/query", {
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
  const ts = new Date()
      .toISOString()
      .replace(/[-T:.Z]/g, "")
      .slice(0, 14),
    msisdn = phone.replace(/\D/g, "").replace(/^0/, "254");
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
        "checkout_request_id",
        "created_at",
        "error_message",
        "id",
        "merchant_request_id",
        "paid_amount",
        "paid_phone",
        "phone",
        "receipt",
        "request_id",
        "result_code",
        "result_description",
        "status",
        "user_id",
      ],
      portal_settings: [
        "currency",
        "id",
        "paper_price",
        "portal_name",
        "support_phone",
      ],
      profiles: [
        "created_at",
        "email",
        "id",
        "name",
        "password_hash",
        "password_salt",
        "phone",
        "role",
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
      { data: bucket, error: bErr } = await supabase.storage.getBucket(BUCKET);
    return json(res, problems.length || !bucket ? 503 : 200, {
      ok: !problems.length && !!bucket,
      database: "Supabase",
      storage: !!bucket,
      storageError: bErr ? bErr.message : undefined,
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
        ? "Run supabase/schema.sql in the Supabase SQL Editor, then run: notify pgrst, 'reload schema';"
        : undefined,
      version: "3.0.0",
    });
  }
  if (method === "POST" && path === "/api/register") {
    const b = await bodyJson(req),
      name = String(b.name || "").trim(),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      password = String(b.password || "");
    if (!name || !email || password.length < 8)
      return fail(
        res,
        400,
        "Name, email and a password of at least 8 characters are required.",
      );
    const salt = crypto.randomBytes(16).toString("hex"),
      hash = crypto.scryptSync(password, salt, 64).toString("hex"),
      { data, error } = await db
        .from("profiles")
        .insert({
          name,
          email,
          phone: String(b.phone || ""),
          role: "student",
          password_salt: salt,
          password_hash: hash,
        })
        .select("id,name,email,phone,role,created_at")
        .single();
    if (error)
      return fail(
        res,
        error.code === "23505" ? 409 : 400,
        error.code === "23505" ? "Email is already registered." : error.message,
      );
    setSession(res, data);
    return json(res, 201, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/login") {
    const b = await bodyJson(req),
      email = String(b.email || "")
        .trim()
        .toLowerCase(),
      ipHash = clientIpHash(req),
      since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recentByEmail = await db
        .from("login_events")
        .select("id", { count: "exact", head: true })
        .eq("email", email)
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
    const { data, error } = await db
      .from("profiles")
      .select("*")
      .eq("email", email)
      .maybeSingle();
    if (error) throw error;
    const passwordMatches = data
      ? crypto.timingSafeEqual(
          crypto.scryptSync(String(b.password || ""), data.password_salt, 64),
          Buffer.from(data.password_hash, "hex"),
        )
      : false;
    const { error: eventError } = await db.from("login_events").insert({
      user_id: data?.id || null,
      email,
      success: passwordMatches,
      ip_hash: ipHash,
      user_agent: String(req.headers["user-agent"] || "").slice(0, 500),
    });
    if (eventError) throw eventError;
    if (!data || !passwordMatches)
      return fail(res, 401, "Incorrect email or password.");
    setSession(res, data);
    return json(res, 200, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/logout") {
    clearSession(res);
    return json(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/me")
    return json(res, 200, { user: await currentUser(req) });
  if (method === "GET" && path === "/api/dashboard") {
    const u = await requireUser(req, res);
    if (!u) return;
    const [s, rr, pp, pa, nn, uu, nt, ff] = await Promise.all([
      getSettings(),
      db
        .from("paper_requests")
        .select("*")
        .order("created_at", { ascending: false }),
      db.from("papers").select("*").order("created_at", { ascending: false }),
      db.from("payments").select("*").order("created_at", { ascending: false }),
      db
        .from("notices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      u.role === "admin"
        ? db
            .from("profiles")
            .select("id,name,email,phone,role,created_at")
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      db
        .from("notifications")
        .select("*")
        .eq("user_id", u.id)
        .order("created_at", { ascending: false })
        .limit(30),
      db.from("favorites").select("paper_id").eq("user_id", u.id),
    ]);
    for (const x of [rr, pp, pa, nn, uu, nt, ff])
      if (x.error && x.error.code !== "42P01") throw x.error;
    const requests = (rr.data || []).filter(
        (x) => u.role === "admin" || x.user_id === u.id,
      ),
      payments = (pa.data || []).filter(
        (x) => u.role === "admin" || x.user_id === u.id,
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
      settings: {
        portalName: s.portal_name,
        currency: s.currency,
        paperPrice: s.paper_price,
        supportPhone: s.support_phone,
      },
    });
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
    if (q.data.status === "paid")
      return fail(
        res,
        409,
        "Paid requests cannot be deleted because they are linked to a confirmed payment.",
      );
    if (u.role !== "admin" && q.data.user_id !== u.id)
      return fail(res, 403, "You can only delete your own requests.");
    const { error } = await db.from("paper_requests").delete().eq("id", id);
    if (error) throw error;
    await db.from("audit_logs").insert({
      actor_id: u.id,
      action: "request.delete",
      entity_type: "paper_request",
      entity_id: null,
      metadata: {
        requestId: id,
        title: q.data.title,
        student: q.data.student_name,
        previousStatus: q.data.status,
      },
    });
    await db.from("request_deletion_logs").insert({
      request_id: id,
      actor_id: u.id,
      title: q.data.title,
      previous_status: q.data.status,
    });
    return json(res, 200, { ok: true, deletedId: id });
  }
  if (method === "POST" && path === "/api/payments/stk") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      { data: r } = await db
        .from("paper_requests")
        .select("*")
        .eq("id", b.requestId)
        .eq("user_id", u.id)
        .maybeSingle();
    if (!r) return fail(res, 404, "Request not found.");
    if (r.status === "paid")
      return fail(res, 409, "This request is already paid.");
    await db
      .from("payments")
      .update({ status: "failed", error_message: "Timed out" })
      .eq("request_id", r.id)
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
      .eq("request_id", r.id)
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
        request_id: r.id,
        user_id: u.id,
        amount: Math.round(Number(r.amount)),
        phone: msisdn,
        status: "initiated",
      })
      .select("*")
      .single();
    if (error) throw error;
    try {
      const stk = await startSTK(msisdn, r.amount, r.id),
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
    const { data: pay } = await db
      .from("payments")
      .select("*")
      .eq("checkout_request_id", cb.CheckoutRequestID)
      .maybeSingle();
    if (!pay) return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    const items = Object.fromEntries(
      (cb.CallbackMetadata?.Item || []).map((x) => [x.Name, x.Value]),
    );
    let valid = isValidMpesaConfirmation({
      resultCode: cb.ResultCode,
      amount: items.Amount,
      expectedAmount: pay.amount,
      payerPhone: items.PhoneNumber,
      expectedPhone: pay.phone,
      receipt: items.MpesaReceiptNumber,
    });
    if (valid) {
      const { data: duplicate, error } = await db
        .from("payments")
        .select("id")
        .eq("receipt", String(items.MpesaReceiptNumber))
        .neq("id", pay.id)
        .limit(1);
      if (error) throw error;
      if (duplicate?.length) valid = false;
    }
    await db.from("payment_events").upsert(
      {
        payment_id: pay.id,
        checkout_request_id: cb.CheckoutRequestID,
        result_code: Number(cb.ResultCode),
        result_description: cb.ResultDesc,
        payload: b,
      },
      { onConflict: "checkout_request_id" },
    );
    let paymentUpdate = db
      .from("payments")
      .update({
        result_code: Number(cb.ResultCode),
        result_description: cb.ResultDesc,
        status: valid ? "success" : "failed",
        receipt: items.MpesaReceiptNumber || null,
        paid_phone: items.PhoneNumber ? String(items.PhoneNumber) : null,
        paid_amount: items.Amount ? Number(items.Amount) : null,
      })
      .eq("id", pay.id);
    if (!valid)
      paymentUpdate = paymentUpdate.in("status", ["initiated", "pending"]);
    const { data: updatedPayment, error: updateError } = await paymentUpdate
      .select("id")
      .maybeSingle();
    if (updateError?.code === "23505") {
      console.error(
        "Rejected M-Pesa receipt already assigned to another payment.",
      );
      return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
    }
    if (updateError) throw updateError;
    if (valid && updatedPayment) {
      await markPaid(pay, items.MpesaReceiptNumber, items.Amount);
      if (pay.status === "success" && !pay.receipt)
        await notifyAdmins(
          "M-Pesa code received",
          `Code ${items.MpesaReceiptNumber} for KSh ${items.Amount} (order ${String(pay.request_id).slice(0, 8)})`,
        );
    } else if (!valid && updatedPayment)
      await db
        .from("paper_requests")
        .update({ status: "payment_failed" })
        .eq("id", pay.request_id)
        .neq("status", "paid");
    return json(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
  }
  if (method === "GET" && path.startsWith("/api/payments/status/")) {
    const u = await requireUser(req, res);
    if (!u) return;
    const id = path.split("/").pop();
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
        Date.now() - new Date(pay.created_at) > 10000
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
                result_code: Number(q.ResultCode),
                result_description:
                  q.ResultDesc ||
                  "Daraja query returned; awaiting authenticated callback details.",
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
        .select("receipt,amount")
        .eq("request_id", id)
        .eq("status", "success")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
    }
    return json(res, 200, {
      status: r.status,
      paperId: r.paper_id,
      receipt: (pp && pp.receipt) || null,
      amount: (pp && pp.amount) || r.amount,
    });
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
    await db.from("audit_logs").insert({
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
    await db.from("audit_logs").insert({
      actor_id: u.id,
      action: "paper.delete",
      entity_type: "paper",
      entity_id: null,
      metadata: { title: p.title },
    });
    return json(res, 200, { deleted: true });
  }
  if (method === "POST" && path === "/api/admin/payments/manual") {
    const u = await requireUser(req, res, "admin");
    if (!u) return;
    const b = await bodyJson(req),
      code = String(b.receipt || "")
        .trim()
        .toUpperCase();
    if (!/^[A-Z0-9]{8,12}$/.test(code))
      return fail(res, 400, "Enter the M-Pesa code, for example UJV570GU3H.");
    const { data: r } = await db
      .from("paper_requests")
      .select("*")
      .eq("id", b.requestId)
      .maybeSingle();
    if (!r) return fail(res, 404, "Request not found.");
    if (r.status === "paid") return fail(res, 409, "Already paid.");
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
        amount: Number(b.amount || r.amount),
        phone: String(b.phone || "manual"),
        status: "success",
        receipt: code,
        paid_amount: Number(b.amount || r.amount),
      },
      { data: ins, error } = await db
        .from("payments")
        .insert(pay)
        .select("*")
        .single();
    if (error) throw error;
    await markPaid(ins, code, pay.amount);
    await db.from("audit_logs").insert({
      actor_id: u.id,
      action: "payment.manual",
      entity_type: "payment",
      entity_id: ins.id,
      metadata: { code },
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
  if (method === "POST" && path === "/api/profile") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      name = String(b.name || u.name)
        .trim()
        .slice(0, 100),
      phone = String(b.phone || "").replace(/\s/g, "");
    if (phone && !/^\+?254\d{9}$/.test(phone) && !/^07\d{8}$/.test(phone))
      return fail(res, 400, "Enter a valid Kenyan phone number.");
    const { data, error } = await db
      .from("profiles")
      .update({ name, phone })
      .eq("id", u.id)
      .select("id,name,email,phone,role,created_at")
      .single();
    if (error) throw error;
    return json(res, 200, { user: safeUser(data) });
  }
  if (method === "POST" && path === "/api/profile/password") {
    const u = await requireUser(req, res);
    if (!u) return;
    const b = await bodyJson(req),
      currentPassword = String(b.currentPassword || ""),
      newPassword = String(b.newPassword || "");
    if (newPassword.length < 12)
      return fail(res, 400, "New passwords must be at least 12 characters.");
    const { data: account, error: readError } = await db
      .from("profiles")
      .select("password_salt,password_hash")
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
    if (
      expected.length !== actual.length ||
      !crypto.timingSafeEqual(actual, expected)
    )
      return fail(res, 401, "Current password is incorrect.");
    const salt = crypto.randomBytes(16).toString("hex"),
      password_hash = crypto.scryptSync(newPassword, salt, 64).toString("hex"),
      { error } = await db
        .from("profiles")
        .update({ password_salt: salt, password_hash })
        .eq("id", u.id);
    if (error) throw error;
    await db.from("audit_logs").insert({
      actor_id: u.id,
      action: "profile.password_change",
      entity_type: "profile",
      entity_id: u.id,
      metadata: {},
    });
    clearSession(res);
    return json(res, 200, { ok: true });
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
    res.statusCode = 200;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader(
      "content-disposition",
      "attachment; filename=comreds-payments.csv",
    );
    res.end(
      [
        "id,request_id,amount,phone,status,receipt,created_at",
        (data || [])
          .map((x) =>
            [
              x.id,
              x.request_id,
              x.amount,
              x.phone,
              x.status,
              x.receipt || "",
              x.created_at,
            ]
              .map((v) => '"' + String(v).replaceAll('"', '""') + '"')
              .join(","),
          )
          .join("\n"),
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
    await db.from("audit_logs").insert({
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
      phone = String(b.supportPhone || s.support_phone || "").replace(
        /\s/g,
        "",
      );
    if (phone && !/^\+?254\d{9}$/.test(phone) && !/^07\d{8}$/.test(phone))
      return fail(res, 400, "Enter a valid Kenyan M-Pesa number.");
    const { data, error } = await db
      .from("portal_settings")
      .upsert({
        id: 1,
        portal_name: String(b.portalName || s.portal_name).slice(0, 80),
        currency: "KES",
        paper_price: Math.max(0, Number(b.paperPrice ?? s.paper_price)),
        support_phone: phone,
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
    await db.from("audit_logs").insert({
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

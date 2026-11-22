const $ = (s) => document.querySelector(s);
let state = {
  user: null,
  data: null,
  tab: "Dashboard",
  mode: "login",
  includeArchived: false,
  refreshedAt: null,
};
async function api0(url, opts = {}) {
  let r;
  try {
    r = await fetch(url, {
      ...opts,
      headers: {
        ...(opts.body instanceof FormData
          ? {}
          : { "content-type": "application/json" }),
        ...(opts.headers || {}),
      },
    });
  } catch {
    throw Error("No internet connection. Check your network and try again.");
  }
  let j = {},
    raw = "";
  try {
    raw = await r.text();
    j = JSON.parse(raw);
  } catch {}
  if (!r.ok) {
    if (r.status === 401 && !/\/api\/(me|login|register|logout)/.test(url)) {
      toast("Session expired. Please sign in again.");
      setTimeout(() => location.reload(), 1500);
    }
    if (j.error) throw Error(j.error);
    if (r.status === 404)
      throw Error("API route not found (404). Redeploy the latest version.");
    if (r.status === 413) throw Error("File too large for the server (413).");
    throw Error(
      "Server error " +
        r.status +
        (raw
          ? ": " +
            raw
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 120)
          : "") +
        ". Check Vercel logs.",
    );
  }
  return j;
}
function toast(s) {
  let e = document.createElement("div");
  e.className = "toast";
  e.textContent = s;
  document.body.append(e);
  setTimeout(() => e.remove(), 4000);
}
function esc(s = "") {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function formatNairobi(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
        timeZone: "Africa/Nairobi",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}
function metaLabel(value) {
  return value ? String(value).replaceAll("_", " ") : "unavailable";
}
function status(s) {
  let c = ["paid", "success", "delivered"].includes(s)
    ? ""
    : ["failed", "payment_failed", "rejected"].includes(s)
      ? "failed"
      : ["pending", "requested", "awaiting_payment"].includes(s)
        ? "pending"
        : "processing";
  return `<span class="pill ${c}">${esc((s || "new").replaceAll("_", " "))}</span>`;
}
function authView() {
  const admin = state.mode === "admin";
  $("#app").innerHTML =
    `<div class="auth"><section class="auth-intro"><div class="brand"><span class="brand-icon">🎓</span><div><strong>Comreds Papers Portal</strong><small>Learn · Prepare · Succeed</small></div></div><h1>Your revision journey starts here.</h1><p>Request, pay for and access learning materials from one secure student portal.</p></section><section class="auth-card"><h2>${state.mode === "register" ? "Create learner account" : admin ? "Administrator sign in" : "Welcome back"}</h2><p class="muted">${state.mode === "register" ? "Choose a username to sign in and add your contact details." : "Sign in with your username and password."}</p><form id="authForm">${state.mode === "register" ? `<div class="field"><label>Username</label><input name="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="username" placeholder="e.g. learner_01"></div><div class="field"><label>Full name</label><input name="name" required></div><div class="field"><label>Email address</label><input name="email" type="email" required autocomplete="email"></div><div class="field"><label>Phone number</label><input name="phone" placeholder="07XXXXXXXX"></div>` : `<div class="field"><label>Username or email</label><input name="identifier" required autocomplete="username" placeholder="Your username"></div>`}<div class="field"><label>Password</label><input name="password" type="password" minlength="8" required autocomplete="${state.mode === "register" ? "new-password" : "current-password"}"></div><button class="btn" style="width:100%">${state.mode === "register" ? "Create account" : "Sign in"}</button></form><p style="margin-top:18px">${!admin && state.mode !== "register" ? `New learner? <button class="link" id="register">Create account</button>` : ""}${state.mode === "register" ? `Already registered? <button class="link" id="login">Sign in</button>` : ""}</p>${!admin && state.mode !== "register" ? '<p class="recovery-note">Forgot your password? Contact the portal administrator to reset it. A temporary password will be issued and must be changed at your next sign-in.</p>' : ""}<button class="link" id="adminLogin">Administrator access</button></section></div>`;
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = Object.fromEntries(new FormData(e.target));
    try {
      const x = await api(
        state.mode === "register" ? "/api/register" : "/api/login",
        { method: "POST", body: JSON.stringify(b) },
      );
      state.user = x.user;
      await load();
    } catch (err) {
      toast(err.message);
    }
  };
  $("#register")?.addEventListener("click", () => {
    state.mode = "register";
    authView();
  });
  $("#login")?.addEventListener("click", () => {
    state.mode = "login";
    authView();
  });
  $("#adminLogin").onclick = () => {
    state.mode = admin ? "login" : "admin";
    authView();
  };
}
async function load() {
  try {
    const x = await api(
      `/api/dashboard${state.includeArchived ? "?includeArchived=true" : ""}`,
    );
    state.data = x;
    state.user = x.user;
    state.refreshedAt = new Date();
    render();
  } catch {
    state.user = null;
    state.mode = "login";
    authView();
  }
}
function render() {
  const d = state.data,
    u = state.user,
    admin = u.role === "admin";
  if (u.mustChangePassword) state.tab = "Security";
  const nav = u.mustChangePassword
    ? ["Security"]
    : admin
      ? [
          "Dashboard",
          "Manage Papers",
          "Manage Members",
          "Requests & Orders",
          "Results Requests",
          "Refer Requests",
          "Transactions",
          "Payment Reports",
          "Emergency Papers",
          "System Settings",
          "Security",
        ]
      : [
          "Dashboard",
          "Request Results",
          "Check Results",
          "Refer Registration",
          "Request Papers",
          "My Papers",
          "Payments",
          "Transaction History",
          "Emergency Papers",
          "My Profile",
          "Security",
        ];
  const count = (arr, fn) => arr.filter(fn).length;
  const req = d.requests || [],
    pays = d.payments || [],
    papers = d.papers || [];
  $("#app").innerHTML =
    `<div class="shell"><aside class="side" id="side"><div class="brand"><span class="brand-icon">🎓</span><div><strong>Comreds Papers Portal</strong><small>${admin ? "Admin Panel" : "Learn · Prepare · Succeed"}</small></div></div><nav class="nav">${nav.map((n) => `<button class="${state.tab === n ? "active" : ""}" data-tab="${n}">${{ Dashboard: "⌂", "Manage Papers": "▤", "Manage Members": "♙", "Requests & Orders": "▣", "Results Requests": "▧", "Refer Requests": "↻", "Refer Registration": "↻", "Request Results": "▤", "Check Results": "✓", Transactions: "▧", "Payment Reports": "▥", "Emergency Papers": "⚠", "System Settings": "⚙", "Request Papers": "▤", "My Papers": "▣", Payments: "▣", "Transaction History": "▤", "My Profile": "♙" }[n] || "•"} &nbsp; ${n}</button>`).join("")}</nav><div class="side-foot">“Small steps everyday lead to big results.”<br><br><button class="link" id="logout" style="color:white">↪ Log out</button></div></aside><main class="main"><header class="top"><button class="mobile-menu" id="menu">☰</button><input class="search" id="search" placeholder="⌕  Search for papers (e.g. Mathematics, Automotive...)"/><div class="top-tools"><button class="icon-btn" title="Notifications">♢<span class="notification-count">${(d.notifications || []).filter((n) => !n.read_at).length || ""}</span></button><button class="icon" id="refreshDashboard" type="button">Refresh</button></div><div class="user">${avatarMarkup(u, "header-avatar")}<div><b>${esc(u.name)}</b><br><small class="muted">${admin ? "Administrator" : "Student"}</small></div></div></header><section class="content" id="content"><div class="refresh-bar"><small class="muted" id="refreshFeedback">Last refreshed: ${state.refreshedAt ? esc(state.refreshedAt.toLocaleString()) : "not yet"}</small><label class="chk archived-toggle"><input type="checkbox" id="includeArchived" ${state.includeArchived ? "checked" : ""}> Include archived records</label></div>${pageContent(d, admin)}</section></main></div>`;
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        state.tab = b.dataset.tab;
        render();
      }),
  );
  $("#logout").onclick = async () => {
    await api("/api/logout", { method: "POST" });
    state.user = null;
    state.data = null;
    authView();
  };
  $("#menu").onclick = () => $("#side").classList.toggle("open");
  $("#refreshDashboard")?.addEventListener("click", async () => {
    try {
      await load();
      toast("Dashboard refreshed.");
    } catch (error) {
      toast(error.message);
    }
  });
  $("#includeArchived")?.addEventListener("change", async (event) => {
    state.includeArchived = event.target.checked;
    await load();
  });
  $("#search").oninput = (e) => {
    const v = e.target.value.toLowerCase();
    document
      .querySelectorAll(".paper")
      .forEach((x) =>
        x.classList.toggle("hidden", !x.textContent.toLowerCase().includes(v)),
      );
  };
  wire(admin);
}
function pageContent(d, admin) {
  const req = d.requests || [],
    papers = d.papers || [],
    pays = d.payments || [],
    users = d.users || [],
    notices = d.notices || [],
    resultRequests = d.resultRequests || [],
    referRequests = d.referRequests || [],
    paid = countSafe(req, (x) => x.status === "paid"),
    pending = countSafe(req, (x) =>
      ["requested", "awaiting_payment", "processing"].includes(x.status),
    );
  const title = state.tab;
  if (title === "Request Results")
    return `<div class="welcome"><div><h1>Request Academic Results</h1><p class="muted">Send your institution and student details to the admin for processing; pay the listed service fee for each request.</p></div></div><div class="panel service-intro"><div><span class="service-kicker">ACADEMIC RESULTS SERVICE</span><h2>Results request</h2><p class="muted">Requests are private to you and the portal administrator.</p></div><div class="service-price">${d.settings.resultsRequestPrice > 0 ? `KSh ${Number(d.settings.resultsRequestPrice).toLocaleString()} <small>per request</small>` : "<small>Price not configured yet</small>"}</div></div>${d.settings.resultsRequestPrice > 0 ? `<div class="panel"><h2>Submit a results request</h2><form id="resultRequestForm" class="form-grid"><div class="field"><label>Institution name</label><input name="institutionName" maxlength="160" required placeholder="College or university"></div><div class="field"><label>Registration number</label><input name="registrationNumber" maxlength="80" required></div><div class="field"><label>Admission number</label><input name="admissionNumber" maxlength="80" required></div><div class="field full"><label>Registered units (one per line)</label><textarea name="registeredUnits" rows="5" maxlength="5000" required placeholder="MAT 101 — Calculus&#10;CSC 102 — Programming"></textarea></div><div class="full"><button class="btn">Submit request · KSh ${Number(d.settings.resultsRequestPrice).toLocaleString()}</button></div></form></div>` : '<div class="panel muted">Results requests are temporarily unavailable. Please check again after an administrator publishes the service fee.</div>'}<div class="panel"><h2>Your requests</h2><div class="table-wrap"><table><tr><th>Institution</th><th>Registration</th><th>Admission</th><th>Units</th><th>Fee</th><th>Payment</th><th>Status</th><th>Submitted</th><th>Action</th></tr>${resultRequests.map((r) => `<tr><td>${esc(r.institutionName)}</td><td>${esc(r.registrationNumber)}</td><td>${esc(r.admissionNumber)}</td><td>${r.registeredUnits.map(esc).join(", ")}</td><td>KSh ${Number(r.serviceFee).toLocaleString()}</td><td>${status(r.paymentStatus)}</td><td>${status(r.status)}</td><td>${new Date(r.createdAt).toLocaleDateString()}</td><td>${r.status === "rejected" ? "Request rejected" : r.paymentStatus === "paid" ? "Paid" : `<button class="btn" data-service-pay="results" data-request-id="${esc(r.id)}">${r.paymentStatus === "failed" ? "Retry payment" : "Pay now"}</button>`} <button class="icon" data-archive-type="results" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button></td></tr>`).join("") || '<tr><td colspan="9" class="muted">You have not requested results yet.</td></tr>'}</table></div></div>`;
  if (title === "Refer Registration" && !admin)
    return `<div class="welcome"><div><h1>Register for Supplementary Exams</h1><p class="muted">Request registration for units you failed, then pay the published service fee.</p></div></div><div class="panel service-intro"><div><span class="service-kicker">FAILED-EXAM SERVICE</span><h2>Refer registration</h2><p class="muted">Enter the same institution and student identifiers used by your school. List each failed unit on a separate line.</p></div><div class="service-price">${d.settings.referRegistrationPrice > 0 ? `KSh ${Number(d.settings.referRegistrationPrice).toLocaleString()} <small>per request</small>` : "<small>Price not configured yet</small>"}</div></div>${d.settings.referRegistrationPrice > 0 ? `<div class="panel"><h2>Submit a refer request</h2><form id="referRequestForm" class="form-grid"><div class="field"><label>Institution name</label><input name="institutionName" maxlength="160" required placeholder="College or university"></div><div class="field"><label>Registration number</label><input name="registrationNumber" maxlength="80" required></div><div class="field"><label>Admission number</label><input name="admissionNumber" maxlength="80" required></div><div class="field"><label>Exam period</label><input name="examPeriod" maxlength="80" required placeholder="e.g. May–June 2026"></div><div class="field full"><label>Failed units (one per line)</label><textarea name="failedUnits" rows="5" maxlength="5000" required placeholder="MAT 101 — Calculus&#10;CSC 102 — Programming"></textarea><small class="muted">1–40 units, up to 120 characters each.</small></div><div class="field full"><label>Notes (optional)</label><textarea name="notes" rows="3" maxlength="1000" placeholder="Any useful context for the administrator"></textarea></div><div class="full"><button class="btn">Submit refer request · KSh ${Number(d.settings.referRegistrationPrice).toLocaleString()}</button></div></form></div>` : '<div class="panel muted">Refer registration is temporarily unavailable. Please check again after an administrator publishes the service fee.</div>'}<div class="panel"><h2>Your refer requests</h2><div class="table-wrap"><table><tr><th>Institution</th><th>Exam period</th><th>Failed units</th><th>Service fee</th><th>Payment</th><th>Request status</th><th>Date</th><th>Action</th></tr>${referRequests.map((r) => `<tr><td>${esc(r.institutionName)}</td><td>${esc(r.examPeriod)}</td><td>${r.failedUnits.map(esc).join(", ")}</td><td>KSh ${Number(r.serviceFee).toLocaleString()}</td><td>${status(r.paymentStatus)}</td><td>${status(r.status)}</td><td>${new Date(r.createdAt).toLocaleDateString()}</td><td>${r.status === "rejected" ? "Request rejected" : r.paymentStatus === "paid" ? (r.status === "registered" ? "Registered" : "Payment confirmed") : `<button class="btn" data-service-pay="refer" data-request-id="${esc(r.id)}">${r.paymentStatus === "failed" ? "Retry payment" : "Pay now"}</button>`} <button class="icon" data-archive-type="refer" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button></td></tr>`).join("") || '<tr><td colspan="8" class="muted">No refer requests submitted yet.</td></tr>'}</table></div></div>`;
  if (title === "Check Results")
    return `<div class="welcome"><div><h1>Check Your Results</h1><p class="muted">Use the same institution, registration number and admission number you submitted with your request.</p></div></div><div class="panel"><form id="resultLookupForm" class="form-grid"><div class="field"><label>Institution name</label><input name="institution" required></div><div class="field"><label>Registration number</label><input name="registration" required></div><div class="field"><label>Admission number</label><input name="admission" required></div><div class="full"><button class="btn">Check results</button></div></form><div id="resultsLookup" aria-live="polite"></div></div><div class="panel"><h2>Your submitted results requests</h2><div class="table-wrap"><table><tr><th>Institution</th><th>Registration</th><th>Status</th><th>Updated</th><th>Results</th><th>Action</th></tr>${resultRequests.map((r) => `<tr><td>${esc(r.institutionName)}</td><td>${esc(r.registrationNumber)}</td><td>${status(r.status)}</td><td>${new Date(r.updatedAt || r.createdAt).toLocaleDateString()}</td><td>${r.status === "completed" ? `<a class="btn" href="/api/results/download/${encodeURIComponent(r.id)}">Download PDF</a>` : "Not ready"}</td><td><button class="icon" data-archive-type="results" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button></td></tr>`).join("") || '<tr><td colspan="6" class="muted">No results requests found.</td></tr>'}</table></div></div>`;
  if (title === "Results Requests" && admin)
    return `<div class="welcome"><div><h1>Academic Results Requests</h1><p class="muted">Review student details, update progress and upload each private PDF result.</p></div></div>${
      resultRequests
        .map((r) => {
          const student = users.find((x) => x.id === r.userId) || {};
          return `<div class="panel result-request ${r.archived || r.archivedAt || r.isArchived ? "archived-row" : ""}"><div class="panel-head"><h2>Request ${esc(String(r.id || "").slice(0, 8))}</h2><div>${status(r.status)} <button class="icon" data-archive-type="results" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button></div></div><p><b>Student:</b> ${esc(student.name || "Learner")} · ${esc(student.username || "")} · ${esc(student.email || "")}</p><p><b>Institution:</b> ${esc(r.institutionName)}</p><p><b>Registration number:</b> ${esc(r.registrationNumber)} &nbsp; <b>Admission number:</b> ${esc(r.admissionNumber)}</p><p><b>Registered units:</b> ${r.registeredUnits.map(esc).join(", ")}</p><p><b>Service fee:</b> KSh ${Number(r.serviceFee).toLocaleString()} · <b>Payment:</b> ${status(r.paymentStatus)}</p>${r.paymentStatus !== "paid" && r.status !== "rejected" ? `<button class="btn" data-service-manual="results" data-request-id="${esc(r.id)}">Record verified M-Pesa receipt</button>` : ""}<p class="muted">Submitted ${new Date(r.createdAt).toLocaleString()}${r.resultFileName ? ` · Current file: ${esc(r.resultFileName)}` : ""}</p><div class="form-grid"><div class="field"><label>Request status</label><select data-result-status="${esc(r.id)}" ${r.status === "completed" ? "disabled" : ""}><option value="requested" ${r.status === "requested" ? "selected" : ""}>Requested</option><option value="processing" ${r.status === "processing" ? "selected" : ""}>Processing</option><option value="rejected" ${r.status === "rejected" ? "selected" : ""}>Rejected</option>${r.status === "completed" ? '<option value="completed" selected>Completed</option>' : ""}</select></div><form class="field result-upload-form" data-result-upload="${esc(r.id)}"><label>${r.resultFileName ? "Replace results PDF" : "Upload results PDF"}</label><input type="file" name="file" accept="application/pdf,.pdf" required><button class="btn" type="submit">${r.resultFileName ? "Replace PDF" : "Upload PDF and notify student"}</button></form></div></div>`;
        })
        .join("") ||
      '<div class="panel muted">There are no academic results requests yet.</div>'
    }`;
  if (title === "Refer Requests" && admin)
    return `<div class="welcome"><div><h1>Refer Registration Queue</h1><p class="muted">Review failed-exam registration requests and update their progress after payment.</p></div></div>${
      referRequests
        .map((r) => {
          const student = users.find((x) => x.id === r.userId) || {};
          return `<div class="panel result-request ${r.archived || r.archivedAt || r.isArchived ? "archived-row" : ""}"><div class="panel-head"><h2>Request ${esc(String(r.id || "").slice(0, 8))}</h2><div>${status(r.status)} <button class="icon" data-archive-type="refer" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button></div></div><p><b>Student:</b> ${esc(student.name || "Learner")} · ${esc(student.username || "")} · ${esc(student.email || "")}</p><p><b>Institution:</b> ${esc(r.institutionName)} · <b>Exam period:</b> ${esc(r.examPeriod)}</p><p><b>Registration:</b> ${esc(r.registrationNumber)} · <b>Admission:</b> ${esc(r.admissionNumber)}</p><p><b>Failed units:</b> ${r.failedUnits.map(esc).join(", ")}</p>${r.notes ? `<p><b>Notes:</b> ${esc(r.notes)}</p>` : ""}<p><b>Fee:</b> KSh ${Number(r.serviceFee).toLocaleString()} · <b>Payment:</b> ${status(r.paymentStatus)}</p><small class="muted">Submitted ${new Date(r.createdAt).toLocaleString()}</small><div class="row-actions"><label class="field"><span>Request status</span><select data-refer-status="${esc(r.id)}" ${r.paymentStatus !== "paid" ? "disabled" : ""}><option value="requested" ${r.status === "requested" ? "selected" : ""}>Requested</option><option value="processing" ${r.status === "processing" ? "selected" : ""}>Processing</option><option value="registered" ${r.status === "registered" ? "selected" : ""}>Registered</option><option value="rejected" ${r.status === "rejected" ? "selected" : ""}>Rejected</option></select></label>${r.paymentStatus !== "paid" && r.status !== "rejected" ? `<button class="btn" data-service-manual="refer" data-request-id="${esc(r.id)}">Record verified M-Pesa receipt</button>` : ""}</div></div>`;
        })
        .join("") ||
      '<div class="panel muted">No refer-registration requests have been submitted.</div>'
    }`;
  if (title === "Manage Papers" || title === "Request Papers")
    return `<div class="welcome"><div><h1>${admin ? "Manage Papers" : "Request Revision Papers"}</h1><p class="muted">${admin ? "Upload, organize and publish learning materials." : "Browse available materials or submit a paper request."}</p></div></div>${!admin && title === "Request Papers" ? `<div class="panel request-panel"><h2>Can’t find your paper?</h2><p class="muted">Submit a request and we’ll notify you when matching material is published.</p><form id="requestForm" class="form-grid"><div class="field"><label>Paper title</label><input name="title" required placeholder="e.g. KCSE Mathematics 2023"></div><div class="field"><label>Subject</label><input name="subject" required placeholder="Mathematics"></div><div class="field"><label>Level / year</label><input name="level" placeholder="Form 4 / 2023"></div><div class="full"><button class="btn">Submit paper request</button></div></form></div>` : ""}${admin ? `<div class="panel"><h2>Upload a new paper</h2><form id="uploadForm" class="form-grid"><div class="field"><label>Paper title</label><input name="title" required></div><div class="field"><label>Subject</label><input name="subject" required placeholder="Mathematics, English..."></div><div class="field"><label>Paper type</label><select name="type"><option>Revision Paper</option><option>Past Paper</option><option>Marking Scheme</option><option>Notes</option></select></div><div class="field"><label>Price (KES)</label><input name="price" type="number" min="0" value="${d.settings.paperPrice}" required></div><div class="field"><label>Document (PDF, Word, Excel, PowerPoint, CSV, TXT, ODT/ODS/ODP, RTF)</label><input name="file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.odt,.ods,.odp" required></div><div class="field"><label>Description</label><input name="description"></div><div class="full"><button class="btn">Upload paper</button></div></form></div>` : ""}<div class="panel"><h2>Available papers</h2>${filterBar(papers)}<div class="paper-grid">${
      applyFilter(papers.filter((x) => admin || x.available))
        .map((p) => paperCard(p, admin))
        .join("") || '<p class="muted">No papers published yet.</p>'
    }</div></div>`;
  if (title === "Manage Members")
    return `<div class="welcome"><div><h1>Manage Members</h1><p class="muted">Registered learners and their accounts.</p></div></div><div class="panel"><div class="table-wrap"><table><tr><th>Learner</th><th>Username</th><th>Email</th><th>Phone</th><th>Joined</th><th>Account access</th></tr>${
      users
        .filter((x) => x.role === "student")
        .map(
          (x) =>
            `<tr><td><span class="member-cell">${avatarMarkup(x, "member-avatar")} ${esc(x.name)}</span></td><td>${esc(x.username || "—")}</td><td>${esc(x.email)}</td><td>${esc(x.phone || "—")}</td><td>${new Date(x.createdAt).toLocaleDateString()}</td><td><button class="btn" data-reset-password="${esc(x.id)}">Reset password</button></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="6" class="muted">No learner accounts yet.</td></tr>'
    }</table></div><p class="muted">A reset immediately signs out existing sessions and displays a temporary password once. The learner must set a new password at next sign-in; share the temporary password privately.</p></div>`;
  if (title === "System Settings")
    return `<div class="welcome"><div><h1>System Settings</h1><p class="muted">Configure portal details and administrator-set service prices.</p></div></div><div class="panel"><form id="settingsForm" class="form-grid"><div class="field full"><label>Portal name</label><input name="portalName" value="${esc(d.settings.portalName)}"></div><div class="field"><label>Default paper price (KES)</label><input name="paperPrice" type="number" min="0" max="1000000" step="1" value="${d.settings.paperPrice}" required></div><div class="field"><label>Results request fee (KES)</label><input name="resultsRequestPrice" type="number" min="0" max="1000000" step="1" value="${Number(d.settings.resultsRequestPrice || 0)}" required></div><div class="field"><label>Failed-exam refer registration fee (KES)</label><input name="referRegistrationPrice" type="number" min="0" max="1000000" step="1" value="${Number(d.settings.referRegistrationPrice || 0)}" required></div><div class="field"><label>M-Pesa checkout default phone</label><input name="supportPhone" type="tel" placeholder="+2547XXXXXXXX" value="${esc(d.settings.supportPhone)}"></div><div class="full"><button class="btn">Save settings</button></div></form><p class="muted">Set either academic service fee to KSh 0 to temporarily disable new requests of that type. Existing requests keep their original price snapshot. Prices are whole Kenyan shillings. This number is used as the default STK checkout phone when a learner has no saved phone. Daraja credentials remain server-only.</p></div>`;
  if (title === "Emergency Papers")
    return `<div class="welcome"><div><h1>Emergency Papers & Notices</h1><p class="muted">Urgent revision materials and important updates.</p></div></div>${admin ? `<div class="panel"><h2>Publish notice</h2><form id="noticeForm"><div class="field"><label>Title</label><input name="title" required></div><div class="field"><label>Message</label><textarea name="body" required></textarea></div><button class="btn">Publish notice</button></form></div>` : ""}<div class="panel">${notices.map((n) => `<div class="notice"><b>📢 ${esc(n.title)}</b><div>${esc(n.body)}</div><small>${new Date(n.createdAt).toLocaleString()}</small></div>`).join("")}</div>`;
  if (title === "Requests & Orders" || title === "My Papers")
    return `<div class="welcome"><div><h1>${title}</h1><p class="muted">Track requests and paper access.</p></div></div><div class="panel"><div class="table-wrap"><table><tr><th>Paper</th>${admin ? "<th>Student</th>" : ""}<th>Subject</th><th>Amount</th><th>Status</th><th>Date</th>${admin ? "<th>Update</th>" : "<th>Action</th>"}</tr>${
      req
        .map(
          (r) =>
            `<tr><td>${esc(r.title)}</td>${admin ? `<td>${esc(r.studentName)}</td>` : ""}<td>${esc(r.subject)}</td><td>KSh ${r.amount}</td><td>${status(r.status)}</td><td>${new Date(r.createdAt).toLocaleDateString()}</td><td>${
              admin
                ? `<select data-status="${r.id}"><option>${r.status}</option>${[
                    "requested",
                    "awaiting_payment",
                    "processing",
                    "delivered",
                    "rejected",
                  ]
                    .filter((x) => x !== r.status)
                    .map((x) => `<option>${x}</option>`)
                    .join(
                      "",
                    )}</select> <button class="icon" data-delete-request="${r.id}">Delete</button> <button class="icon" data-archive-type="paper" data-archive-id="${esc(r.id)}" data-archive-action="${r.archivedAt ? "restore" : "archive"}">${r.archivedAt ? "Restore" : "Archive"}</button>`
                : `${r.status === "paid" ? `<button class="link" data-download="${esc(r.paperId)}">Download</button>` : r.status === "awaiting_payment" || r.status === "payment_failed" ? `<button class="link" data-pay="${esc(r.id)}">Pay now</button> ` : ""}<button class="icon" data-archive-type="paper" data-archive-id="${esc(r.id)}" data-archive-action="${r.archived || r.archivedAt || r.isArchived ? "restore" : "archive"}">${r.archived || r.archivedAt || r.isArchived ? "Restore" : "Archive"}</button>`
            }</td></tr>`,
        )
        .join("") || '<tr><td colspan="7">No requests yet.</td></tr>'
    }</table></div></div>`;
  if (
    title === "Payments" ||
    title === "Transactions" ||
    title === "Payment Reports" ||
    title === "Transaction History"
  ) {
    const visiblePays = pays,
      pendingPayments = pays.filter(
        (payment) =>
          ["pending", "initiated"].includes(
            String(payment.status || "").toLowerCase(),
          ) &&
          !payment.archived &&
          !payment.archivedAt,
      ),
      paymentRows = visiblePays
        .map((x) => {
          const q = req.find((r) => r.id === x.requestId) || {},
            learner = users.find((user) => user.id === x.userId) || {},
            serviceName =
              x.serviceType === "results"
                ? "Academic results"
                : x.serviceType === "refer"
                  ? "Refer registration"
                  : q.title || "Paper order",
            serviceId = x.resultRequestId || x.referRequestId,
            payerName = x.payerName || "unavailable",
            payerNameSource = x.payerNameSource,
            payerPhone = x.paidPhone || "—",
            transactionTime = x.paidAt,
            source = x.paidAtSource,
            confirmation = x.confirmationSource,
            reconciliationStatus = x.reconciliationStatus,
            websiteIdentity =
              [
                learner.name ||
                  q.studentName ||
                  (state.user?.id === x.userId ? state.user.name : ""),
                learner.username ||
                (state.user?.id === x.userId ? state.user.username : "")
                  ? `@${learner.username || state.user.username}`
                  : "",
                learner.email ||
                  (state.user?.id === x.userId ? state.user.email : ""),
              ]
                .filter(Boolean)
                .join(" · ") || "—",
            receiptLink =
              x.status === "success"
                ? `<a class="icon receipt-link" href="/api/payments/${encodeURIComponent(x.id)}/receipt" download>Download PDF receipt</a>`
                : "",
            archived = Boolean(x.archived || x.archivedAt || x.isArchived);
          return `<tr class="${archived ? "archived-row" : ""}"><td>${esc(formatNairobi(transactionTime))}<small class="muted payment-meta">Paid-time source: ${esc(metaLabel(source))}</small></td>${admin ? `<td><b>Website registration</b><small class="muted payment-meta">${esc(websiteIdentity)}</small><b class="payer-label">M-Pesa payer</b><small class="muted payment-meta">${esc(payerName)}</small><small class="muted payment-meta">Name source: ${esc(metaLabel(payerNameSource))}</small></td>` : `<td><b>Website registration</b><small class="muted payment-meta">${esc(websiteIdentity)}</small><b class="payer-label">M-Pesa payer</b><small class="muted payment-meta">${esc(payerName)}</small><small class="muted payment-meta">Name source: ${esc(metaLabel(payerNameSource))}</small></td>`}<td>${esc(serviceName)}${serviceId ? `<small class="muted service-ref"> · ${esc(String(serviceId).slice(0, 8))}</small>` : ""}</td><td>KSh ${esc(String(x.amount ?? "—"))}</td><td>${esc(payerPhone)}</td><td>${status(x.status)}<small class="muted payment-meta">Confirmation source: ${esc(metaLabel(confirmation))}</small><small class="muted payment-meta">Reconciliation: ${esc(metaLabel(reconciliationStatus))}</small></td><td>${esc(x.receipt || "—")}${x.receipt ? ` <button class="icon" data-copy="${esc(x.receipt)}">Copy</button>` : ""}${receiptLink}</td><td>${archived ? `<button class="icon" data-archive-type="payment" data-archive-id="${esc(x.id)}" data-archive-action="restore">Restore</button>` : `<button class="icon" data-archive-type="payment" data-archive-id="${esc(x.id)}" data-archive-action="archive">Archive</button>`}${admin && ["pending", "initiated"].includes(String(x.status || "").toLowerCase()) && !archived ? ` <button class="icon" data-reconcile-payment="${esc(x.id)}">Reconcile</button>` : ""}</td></tr>`;
        })
        .join("");
    return `<div class="welcome"><div><h1>${admin ? "Transactions" : "Payments & Transaction History"}</h1><p class="muted">Payment records show website registration and payer details separately. PDF receipts are available for confirmed payments.</p></div></div>${admin ? adminCharts(pays, req) : ""}${
      admin
        ? `<div class="panel"><h2>Total received: KSh ${pays
            .filter((x) => x.status === "success")
            .reduce((t, x) => t + Number(x.amount || 0), 0)
            .toLocaleString()}</h2><p class="muted">Today: KSh ${pays
            .filter(
              (x) =>
                x.status === "success" &&
                new Date(x.paidAt || x.createdAt).toDateString() ===
                  new Date().toDateString(),
            )
            .reduce((t, x) => t + Number(x.amount || 0), 0)
            .toLocaleString()} · ${pays.filter((x) => x.status === "success").length} successful payments</p><div class="payment-tools"><input id="txSearch" placeholder="Search payer, student, service or receipt code" aria-label="Search transactions"><button class="btn" type="button" id="resetTxSearch">Start fresh</button><button class="btn" type="button" id="reconcile">Refresh pending/initiated attempts (${pendingPayments.length})</button></div><p class="muted">Reconciliation checks pending attempts only; it does not confirm or mark a payment as paid.</p><form id="manualPay" class="form-grid"><div class="field"><label>Unpaid paper request</label><select name="requestId" required>${req
            .filter(
              (r) =>
                r.status !== "paid" &&
                r.paperId &&
                !r.archived &&
                !r.archivedAt,
            )
            .map(
              (r) =>
                `<option value="${esc(r.id)}">${esc(r.studentName || "Learner")} – ${esc(r.title || "Paper")} (KSh ${esc(String(r.amount ?? "—"))})</option>`,
            )
            .join(
              "",
            )}</select></div><div class="field"><label>Receipt code (verified against transaction evidence)</label><input name="receipt" required maxlength="80" autocomplete="off"></div><div class="field"><label>Payer phone shown in evidence</label><input name="payerPhone" type="tel" required maxlength="32" placeholder="Phone shown on transaction"></div><div class="field"><label>Transaction time (optional, EAT)</label><input name="paidAt" type="datetime-local"><small class="muted">Enter only if visible in evidence. This local time is sent with the EAT +03:00 offset.</small></div><div class="field full"><label class="verify-name"><input type="checkbox" id="payerNameVerified"> I can verify the payer name from transaction evidence</label><input name="payerName" id="payerNameInput" maxlength="100" placeholder="Verified payer name (optional)" disabled></div><div class="full"><button class="btn">Record verified manual payment</button></div></form></div>`
        : ""
    }<div class="panel"><h2>Payment records</h2><div class="table-wrap"><table><tr><th>Transaction time / source</th><th>${admin ? "Website and payer identity" : "Payer identity"}</th><th>Service</th><th>Amount</th><th>Payer phone</th><th>Confirmation / reconciliation</th><th>Receipt / PDF</th><th>Record actions</th></tr>${paymentRows || `<tr><td colspan="8" class="muted">No payments recorded.</td></tr>`}</table></div></div>`;
  }
  if (title === "Security")
    return `<div class="welcome"><div><h1>${d.user.mustChangePassword ? "Set a new password" : "Account security"}</h1><p class="muted">${d.user.mustChangePassword ? "Your administrator issued a temporary password. Choose a new password to unlock the portal." : "Rotate your password; your current session will be signed out afterward."}</p></div></div><div class="panel"><form id="passwordForm" class="form-grid">${d.user.mustChangePassword ? "" : `<div class="field"><label>Current password</label><input name="currentPassword" type="password" autocomplete="current-password" required></div>`}<div class="field"><label>New password (12 characters minimum)</label><input name="newPassword" type="password" minlength="12" autocomplete="new-password" required></div><div class="field"><label>Confirm new password</label><input name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required></div><div class="full"><button class="btn">${d.user.mustChangePassword ? "Set new password" : "Change password"}</button></div></form></div>`;
  if (title === "My Profile")
    return `<div class="welcome"><div><h1>My Profile</h1><p class="muted">Your learner account information and profile photo.</p></div></div><div class="panel profile-panel"><div class="profile-photo">${avatarMarkup(d.user, "profile-avatar")}<div><h2>Profile photo</h2><p class="muted">JPEG, PNG or WebP, up to 3 MB.</p><label class="btn upload-label" for="avatarFile">Choose photo</label><input class="hidden" id="avatarFile" type="file" accept="image/jpeg,image/png,image/webp"><p id="avatarMessage" class="muted" aria-live="polite"></p></div></div></div><div class="panel"><form id="profileForm" class="form-grid"><div class="field"><label>Full name</label><input name="name" maxlength="100" required value="${esc(d.user.name)}"></div><div class="field"><label>Username</label><input name="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,31}" autocomplete="username" value="${esc(d.user.username || "")}" placeholder="Set a username for future sign-ins"></div><div class="field"><label>Email</label><input value="${esc(d.user.email)}" disabled></div><div class="field"><label>Phone</label><input name="phone" value="${esc(d.user.phone || "")}" placeholder="07XXXXXXXX"></div><div class="full"><button class="btn">Save profile</button></div></form><p class="muted">You can keep using your email or sign in with your username. Leave username blank to keep your current username.</p></div>`;
  return `<div class="welcome"><div><h1>${admin ? "Admin Dashboard" : `Welcome, ${esc(d.user.name)} 👋`}</h1><p class="muted">${admin ? "Monitor portal activity, papers and payments." : "Access your revision papers, track your payments and stay updated."}</p></div></div><div class="stats"><div class="stat blue"><div class="stat-icon">${admin ? "♙" : "▤"}</div><span>${admin ? "Total Students" : "Total Requests"}</span><b>${admin ? users.filter((x) => x.role === "student").length : req.length}</b><small>${admin ? "Registered learners" : "This month"}</small></div><div class="stat green"><div class="stat-icon">✓</div><span>${admin ? "Total Papers" : "Papers Downloaded"}</span><b>${admin ? papers.length : paid}</b><small>${admin ? "Uploaded materials" : "This month"}</small></div><div class="stat orange"><div class="stat-icon">▣</div><span>${admin ? "Total Revenue" : "Total Spent"}</span><b>KSh ${admin ? pays.filter((x) => x.status === "success").reduce((a, x) => a + x.amount, 0) : pays.filter((x) => x.status === "success").reduce((a, x) => a + x.amount, 0)}</b><small>This month</small></div><div class="stat purple"><div class="stat-icon">◷</div><span>Pending Requests</span><b>${pending}</b><small>${admin ? "Awaiting action" : "Awaiting availability"}</small></div></div>${admin ? `<div class="insight-grid"><div class="panel chart-panel"><div class="panel-head"><h2>Transactions Overview</h2><span class="muted">This month⌄</span></div><div class="chart-bars">${[35, 52, 43, 68, 57, 74, 63, 82, 66, 88, 76, 94].map((v, i) => `<i style="height:${v}%" title="Week ${i + 1}"></i>`).join("")}</div><div class="chart-legend"><span><b class="dot success"></b>Successful</span><span><b class="dot failed"></b>Failed</span></div></div><div class="panel status-panel"><div class="panel-head"><h2>Request Status</h2><span class="donut">${req.length}</span></div><div class="status-row"><span class="dot success"></span>Delivered <b>${countSafe(req, (x) => x.status === "delivered")}</b></div><div class="status-row"><span class="dot pending"></span>Pending <b>${pending}</b></div><div class="status-row"><span class="dot processing"></span>Processing <b>${countSafe(req, (x) => x.status === "processing")}</b></div></div></div>` : ""}<div class="layout"><div><div class="panel"><div class="panel-head"><h2>${admin ? "Recent Paper Requests" : "Recent Paper Requests"}</h2><button class="link" data-goto="${admin ? "Requests & Orders" : "Request Papers"}">View all →</button></div><div class="table-wrap"><table><tr><th>Paper</th>${admin ? "<th>Student</th>" : ""}<th>Status</th><th>Date</th></tr>${
    req
      .slice(0, 6)
      .map(
        (r) =>
          `<tr><td>${esc(r.title)}</td>${admin ? `<td>${esc(r.studentName)}</td>` : ""}<td>${status(r.status)}</td><td>${new Date(r.createdAt).toLocaleDateString()}</td></tr>`,
      )
      .join("") ||
    '<tr><td colspan="4" class="muted">No requests yet.</td></tr>'
  }</table></div></div><div class="panel"><h2>${admin ? "Recently Uploaded Papers" : "Available Papers"}</h2><div class="paper-grid">${
    papers
      .filter((x) => x.available)
      .slice(0, 4)
      .map((p) => paperCard(p, admin))
      .join("") || '<p class="muted">No papers available yet.</p>'
  }</div></div></div><aside><div class="panel"><h2>Quick Actions</h2><div class="quick">${admin ? '<button data-goto="Manage Papers">＋ Upload Papers</button><button class="qgreen" data-goto="Results Requests">▧ Results Requests</button><button class="qgreen" data-goto="Manage Members">♙ Manage Members</button><button class="qpurple" data-goto="Transactions">▣ View Transactions</button><button class="qorange" data-goto="Emergency Papers">⚠ Emergency Papers</button>' : '<button data-goto="Request Results">▧ Request Results</button><button data-goto="Check Results">✓ Check Results</button><button data-goto="Request Papers">▤ Request Papers</button><button class="qgreen" data-goto="Payments">▣ Make Payment (M-Pesa)</button><button class="qorange" data-goto="Emergency Papers">⚠ Emergency Papers</button><button class="qpurple" data-goto="My Papers">☁ View My Papers</button>'}</div></div><div class="panel"><h2>Latest Notices</h2>${
    notices
      .slice(0, 4)
      .map(
        (n) =>
          `<div class="notice"><b>${esc(n.title)}</b><small>${new Date(n.createdAt).toLocaleDateString()}</small></div>`,
      )
      .join("") || '<p class="muted">No notices.</p>'
  }</div></aside></div>`;
}
function avatarMarkup(user, extraClass = "") {
  const initial = esc(user?.name?.[0]?.toUpperCase() || "C");
  return `<div class="avatar ${extraClass}">${user?.avatarUrl ? `<img src="${esc(user.avatarUrl)}" alt="${esc(user.name || "Learner")} profile photo">` : initial}</div>`;
}
function countSafe(a, fn) {
  return a.filter(fn).length;
}
function paperCard(p, admin) {
  const own =
    !admin &&
    (state.data.requests || []).some(
      (r) => r.paperId === p.id && r.status === "paid",
    );
  return `<article class="paper"><div class="paper-kicker">${esc(p.type)} · ${esc(p.level || "All levels")}</div><h3>📄 ${esc(p.title)}</h3><div class="muted">${esc(p.subject)} · ${esc(p.year || "Current")}</div><p>${esc(p.description || "Revision material available for learners.")}</p><b>KSh ${p.price}</b> <small class="muted">· ⬇ ${p.downloads || 0}</small>${Date.now() - new Date(p.createdAt) < 6048e5 ? ' <span class="newtag">NEW</span>' : ""}${p.available ? "" : ' <small class="muted">(archived)</small>'}<br>${admin ? "" : `<button class="icon" data-fav="${p.id}">${(state.data.favorites || []).includes(p.id) ? "♥ Saved" : "♡ Save"}</button> <a class="icon" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(p.title + " – " + location.origin)}">Share</a><br>`}${admin ? `<div class="row-actions"><button class="btn" data-edit="${p.id}">Rename / Edit</button> <button class="btn" data-catalog-paper-archive="${esc(p.id)}" data-archive-action="${p.available ? "archive" : "restore"}">${p.available ? "Archive" : "Restore"}</button> <button class="btn" data-del="${p.id}">Delete</button></div>` : own ? `<button class="btn" data-download="${p.id}">Download</button>` : `<button class="btn" data-buy="${p.id}">Buy &amp; download</button>`}</article>`;
}
function applyFilter(l) {
  const f = state.f || (state.f = { subject: "", sort: "new", saved: false });
  return l
    .filter(
      (p) =>
        (!f.subject || p.subject === f.subject) &&
        (!f.saved || (state.data.favorites || []).includes(p.id)),
    )
    .sort((x, y) =>
      f.sort === "cheap"
        ? x.price - y.price
        : f.sort === "popular"
          ? y.downloads - x.downloads
          : new Date(y.createdAt) - new Date(x.createdAt),
    );
}
function filterBar(ps) {
  const f = state.f || (state.f = { subject: "", sort: "new", saved: false }),
    o = (v, t) =>
      `<option value="${v}" ${f.sort === v ? "selected" : ""}>${t}</option>`;
  return `<div class="filters"><select id="fSubject"><option value="">All subjects</option>${[...new Set(ps.map((p) => p.subject))].map((s) => `<option ${f.subject === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><select id="fSort">${o("new", "Newest")}${o("cheap", "Cheapest")}${o("popular", "Most downloaded")}</select><label class="chk"><input type="checkbox" id="fSaved" ${f.saved ? "checked" : ""}> ♥ Saved</label><button class="icon" type="button" id="resetFilters">Start fresh</button></div>`;
}
function adminCharts(pays, req) {
  const days = [...Array(7)].map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - 6 + i);
      return d;
    }),
    sums = days.map((d) =>
      pays
        .filter(
          (x) =>
            x.status === "success" &&
            new Date(x.createdAt).toDateString() === d.toDateString(),
        )
        .reduce((t, x) => t + x.amount, 0),
    ),
    max = Math.max(1, ...sums),
    top = {};
  req
    .filter((r) => r.status === "paid")
    .forEach((r) => (top[r.title] = (top[r.title] || 0) + 1));
  const t = Object.entries(top)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 5);
  const feed =
    pays
      .filter((x) => x.status === "success")
      .slice(0, 6)
      .map((x) => {
        const q = req.find((r) => r.id === x.requestId) || {};
        return `<p>✅ <b>KSh ${x.amount}</b> · ${esc(q.studentName || "Student")} · ${esc(q.title || "Paper")} · <b>${esc(x.receipt || "code pending")}</b></p>`;
      })
      .join("") || '<p class="muted">No payments yet.</p>';
  return `<div class="panel"><h2>Payments received</h2>${feed}</div><div class="panel"><h2>Last 7 days</h2><div class="bars">${sums.map((v, i) => `<div class="bar"><b>${v}</b><i style="height:${Math.round((v / max) * 100)}%"></i><small>${days[i].toLocaleDateString(undefined, { weekday: "short" })}</small></div>`).join("")}</div><h2>Top sellers</h2>${t.map(([n, c]) => `<p>${esc(n)} — ${c} sold</p>`).join("") || '<p class="muted">No sales yet.</p>'}<a class="btn" href="/api/admin/export/payments">Export CSV</a></div>`;
}
function wire(admin) {
  if (admin) {
    const paymentHeading = [...document.querySelectorAll(".panel h2")].find(
        (heading) => heading.textContent === "Payment records",
      ),
      paymentPanel = paymentHeading?.closest(".panel"),
      tableWrap = paymentPanel?.querySelector(".table-wrap");
    if (paymentPanel && tableWrap) {
      const reviewTools = document.createElement("div"),
        select = document.createElement("select"),
        verifyButton = document.createElement("button"),
        unresolved = (state.data?.payments || []).filter(
          (payment) =>
            ["initiated", "pending", "review_required", "failed"].includes(
              payment.status,
            ) && !payment.archivedAt,
        );
      reviewTools.className = "payment-tools manual-review-tools";
      select.id = "verifyPaymentId";
      select.setAttribute("aria-label", "Payment attempt to verify");
      for (const payment of unresolved) {
        const option = document.createElement("option");
        option.value = payment.id;
        option.textContent = `${payment.status} · KSh ${payment.amount} · ${payment.receipt || payment.id.slice(0, 8)}`;
        select.append(option);
      }
      if (!unresolved.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No unresolved payment attempts";
        select.append(option);
      }
      verifyButton.type = "button";
      verifyButton.className = "btn";
      verifyButton.textContent = "Verify from M-Pesa evidence";
      verifyButton.disabled = !unresolved.length;
      verifyButton.onclick = async () => {
        const payment = unresolved.find((item) => item.id === select.value),
          receipt = prompt(
            "Enter the M-Pesa receipt code exactly as shown in transaction evidence:",
            payment?.receipt || "",
          );
        if (receipt === null) return;
        const amount = prompt(
          "Enter the exact amount shown in M-Pesa evidence:",
          String(payment?.amount || ""),
        );
        if (amount === null) return;
        const payerPhone = prompt(
          "Enter the actual payer phone shown in transaction evidence:",
        );
        if (!payerPhone) return;
        const payerName = confirm(
          "Can you verify the payer name from M-Pesa transaction evidence? Choose Cancel if unavailable.",
        )
          ? prompt("Enter the verified payer name:") || ""
          : "";
        const paidAt = prompt(
          "Transaction time from evidence (optional). Enter ISO 8601 with timezone, e.g. 2026-11-22T08:40:00+03:00:",
          "",
        );
        if (paidAt === null) return;
        verifyButton.disabled = true;
        try {
          await api("/api/admin/payments/verify", {
            method: "POST",
            body: JSON.stringify({
              paymentId: payment.id,
              receipt,
              amount,
              payerPhone,
              ...(payerName ? { payerName } : {}),
              ...(paidAt ? { paidAt } : {}),
            }),
          });
          toast(
            "Payment verified from evidence; receipt and request status updated.",
          );
          await load();
        } catch (error) {
          toast(error.message);
          if (verifyButton.isConnected) verifyButton.disabled = false;
        }
      };
      reviewTools.append(select, verifyButton);
      paymentPanel.insertBefore(reviewTools, tableWrap);
    }
  }
  document.querySelector("#txSearch")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll(".panel .table-wrap tr").forEach((tr) => {
      if (!tr.querySelector("th"))
        tr.style.display = tr.textContent.toLowerCase().includes(q)
          ? ""
          : "none";
    });
  });
  document.querySelector("#resetTxSearch")?.addEventListener("click", () => {
    const search = document.querySelector("#txSearch");
    if (search) search.value = "";
    document.querySelectorAll(".panel .table-wrap tr").forEach((tr) => {
      tr.style.display = "";
    });
  });
  document
    .querySelector("#reconcile")
    ?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await api("/api/admin/payments/reconcile", {
          method: "POST",
          body: JSON.stringify({}),
        });
        toast(
          result.message ||
            `Checked ${result.checked ?? result.count ?? "pending"} pending attempt(s). No payment was confirmed by this refresh.`,
        );
        await load();
      } catch (error) {
        toast(error.message);
      } finally {
        if (event.currentTarget?.isConnected)
          event.currentTarget.disabled = false;
      }
    });
  document.querySelectorAll("[data-reconcile-payment]").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await api("/api/admin/payments/reconcile", {
          method: "POST",
          body: JSON.stringify({ paymentId: button.dataset.reconcilePayment }),
        });
        toast(
          result.message ||
            "Pending attempt checked; reconciliation does not confirm payment.",
        );
        await load();
      } catch (error) {
        toast(error.message);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
  });
  document
    .querySelectorAll("[data-catalog-paper-archive]")
    .forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          await api("/api/admin/papers/update", {
            method: "POST",
            body: JSON.stringify({
              paperId: button.dataset.catalogPaperArchive,
              available: button.dataset.archiveAction === "restore",
            }),
          });
          toast(
            button.dataset.archiveAction === "restore"
              ? "Paper restored."
              : "Paper archived.",
          );
          await load();
        } catch (error) {
          toast(error.message);
          if (button.isConnected) button.disabled = false;
        }
      };
    });
  document.querySelectorAll("[data-archive-type]").forEach((button) => {
    button.onclick = async () => {
      const {
        archiveType: type,
        archiveId: id,
        archiveAction: action,
      } = button.dataset;
      button.disabled = true;
      try {
        await api("/api/records/archive", {
          method: "POST",
          body: JSON.stringify({ type, id, action }),
        });
        toast(
          action === "archive"
            ? "Record archived. You can restore it while archived items are included."
            : "Record restored.",
        );
        await load();
      } catch (error) {
        toast(error.message);
        if (button.isConnected) button.disabled = false;
      }
    };
  });
  const fl = state.f || (state.f = { subject: "", sort: "new", saved: false });
  document.querySelector("#fSubject")?.addEventListener("change", (e) => {
    fl.subject = e.target.value;
    render();
  });
  document.querySelector("#fSort")?.addEventListener("change", (e) => {
    fl.sort = e.target.value;
    render();
  });
  document.querySelector("#fSaved")?.addEventListener("change", (e) => {
    fl.saved = e.target.checked;
    render();
  });
  document.querySelector("#resetFilters")?.addEventListener("click", () => {
    state.f = { subject: "", sort: "new", saved: false };
    const globalSearch = document.querySelector("#search");
    if (globalSearch) globalSearch.value = "";
    render();
  });
  document.querySelectorAll("[data-fav]").forEach(
    (b) =>
      (b.onclick = async () => {
        const id = b.dataset.fav,
          on = (state.data.favorites || []).includes(id);
        try {
          await api(on ? "/api/favorites/" + id : "/api/favorites", {
            method: on ? "DELETE" : "POST",
            body: on ? undefined : JSON.stringify({ paperId: id }),
          });
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document.querySelectorAll("[data-copy]").forEach(
    (b) =>
      (b.onclick = () => {
        navigator.clipboard?.writeText(b.dataset.copy);
        toast("M-Pesa code copied.");
      }),
  );
  document
    .querySelectorAll("[data-buy]")
    .forEach((b) => (b.onclick = () => buy(b.dataset.buy)));
  document.querySelectorAll("[data-edit]").forEach(
    (b) =>
      (b.onclick = async () => {
        const p = state.data.papers.find((x) => x.id === b.dataset.edit),
          title = prompt("Paper name:", p.title);
        if (title === null) return;
        const price = prompt("Price (KES):", p.price);
        if (price === null) return;
        try {
          await api("/api/admin/papers/update", {
            method: "POST",
            body: JSON.stringify({ paperId: p.id, title, price }),
          });
          toast("Paper updated.");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );

  document.querySelectorAll("[data-del]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Delete this paper and its file permanently?")) return;
        try {
          await api("/api/admin/papers/delete", {
            method: "POST",
            body: JSON.stringify({ paperId: b.dataset.del }),
          });
          toast("Paper deleted.");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document
    .querySelector("#payerNameVerified")
    ?.addEventListener("change", (event) => {
      const input = document.querySelector("#payerNameInput");
      if (!input) return;
      input.disabled = !event.target.checked;
      if (!event.target.checked) input.value = "";
      if (event.target.checked) input.focus();
    });
  document
    .querySelector("#manualPay")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (!document.querySelector("#payerNameVerified")?.checked)
        delete f.payerName;
      if (f.paidAt) {
        if (f.paidAt.length === 16) f.paidAt += ":00";
        f.paidAt += "+03:00";
      } else {
        delete f.paidAt;
      }
      try {
        await api("/api/admin/payments/manual", {
          method: "POST",
          body: JSON.stringify(f),
        });
        toast("Payment recorded. Download unlocked.");
        await load();
      } catch (x) {
        toast(x.message);
      }
    });
  document.querySelectorAll("[data-goto]").forEach(
    (b) =>
      (b.onclick = () => {
        state.tab = b.dataset.goto;
        render();
      }),
  );
  document.querySelectorAll("[data-request]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const x = await api("/api/requests", {
            method: "POST",
            body: JSON.stringify({ paperId: b.dataset.request }),
          });
          state.tab = "My Papers";
          await load();
          toast("Paper request created.");
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document
    .querySelectorAll("[data-pay]")
    .forEach((b) => (b.onclick = () => pay(b.dataset.pay)));
  document.querySelectorAll("[data-download]").forEach(
    (b) =>
      (b.onclick = () => {
        if (b.dataset.download)
          location.href = "/api/download/" + b.dataset.download;
      }),
  );
  document.querySelectorAll("[data-delete-request]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (!confirm("Delete this request? Paid requests cannot be deleted."))
          return;
        try {
          await api("/api/requests/" + b.dataset.deleteRequest, {
            method: "DELETE",
          });
          toast("Request deleted.");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  document.querySelectorAll("[data-status]").forEach(
    (s) =>
      (s.onchange = async () => {
        try {
          await api("/api/admin/requests/status", {
            method: "POST",
            body: JSON.stringify({ id: s.dataset.status, status: s.value }),
          });
          toast("Request updated.");
          await load();
        } catch (e) {
          toast(e.message);
        }
      }),
  );
  $("#uploadForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target,
      fd = new FormData(form),
      file = fd.get("file");
    if (!file || !file.size) {
      toast("Choose a paper file first.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      toast("Documents must be 25 MB or smaller.");
      return;
    }
    try {
      toast("Uploading… please wait");
      const checksum = await sha256(file);
      const meta = await api("/api/admin/papers/upload-url", {
        method: "POST",
        body: JSON.stringify({
          fileName: file.name,
          size: file.size,
          mime: file.type || "application/octet-stream",
          checksum,
        }),
      });
      const put = await fetch(meta.uploadUrl, {
        method: "PUT",
        headers: {
          "x-upsert": "false",
          "content-type":
            meta.contentType || file.type || "application/octet-stream",
        },
        body: file,
      });
      if (!put.ok) {
        let t = "";
        try {
          t = (await put.json()).message || "";
        } catch {}
        if (file.size <= 4 * 1024 * 1024) {
          const fb = new FormData(form);
          const up = await api("/api/admin/papers/upload", {
            method: "POST",
            body: fb,
          });
          toast(
            `Paper uploaded. ${up.matchedRequests || 0} student request(s) matched.`,
          );
          form.reset();
          await load();
          return;
        }
        throw Error(
          "File upload to storage failed" +
            (t ? ": " + t : "") +
            ". Check the papers bucket in Supabase.",
        );
      }
      const g = (k) => fd.get(k) || "";
      const result = await api("/api/admin/papers", {
        method: "POST",
        body: JSON.stringify({
          storagePath: meta.storagePath,
          checksum,
          originalName: file.name,
          fileSize: file.size,
          mimeType: file.type || "application/octet-stream",
          title: g("title") || file.name,
          subject: g("subject") || "General",
          type: g("type") || "Revision Paper",
          description: g("description"),
          price: g("price"),
          level: g("level"),
          year: g("year"),
          semester: g("semester"),
        }),
      });
      toast(
        `Paper uploaded. ${result.matchedRequests || 0} student request(s) matched.`,
      );
      form.reset();
      await load();
    } catch (x) {
      toast(x.message);
    }
  });
  document.querySelectorAll("[data-service-pay]").forEach((button) => {
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await payService(button.dataset.requestId, button.dataset.servicePay);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
  });
  $("#referRequestForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      submit = form.querySelector('button[type="submit"]');
    if (form.dataset.submitting) return;
    form.dataset.submitting = "true";
    if (submit) submit.disabled = true;
    try {
      const response = await api("/api/refer/requests", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      toast(
        `Refer request submitted. Reference: ${response.referRequest.id.slice(0, 8)}.`,
      );
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      if (form.isConnected) {
        delete form.dataset.submitting;
        if (submit) submit.disabled = false;
      }
    }
  });
  document.querySelectorAll("[data-refer-status]").forEach((select) => {
    select.onchange = async () => {
      try {
        await api("/api/admin/refer/status", {
          method: "POST",
          body: JSON.stringify({
            id: select.dataset.referStatus,
            status: select.value,
          }),
        });
        toast("Refer request status updated.");
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  document.querySelectorAll("[data-service-manual]").forEach((button) => {
    button.onclick = async () => {
      const serviceType = button.dataset.serviceManual,
        collection =
          serviceType === "results"
            ? state.data.resultRequests || []
            : state.data.referRequests || [],
        request = collection.find(
          (item) => item.id === button.dataset.requestId,
        ),
        receipt = prompt(
          "Verify transaction evidence and enter the receipt code:",
        );
      if (!receipt) return;
      const amount = prompt(
        "Enter the exact amount shown in transaction evidence:",
        String(request?.serviceFee || ""),
      );
      if (amount === null) return;
      const payerPhone = prompt(
        "Enter the payer phone shown in transaction evidence:",
      );
      if (!payerPhone) return;
      const verifyName = confirm(
        "Can you verify the payer's name from transaction evidence? Choose Cancel if not.",
      );
      const payerName = verifyName
        ? prompt("Enter the verified payer name:") || ""
        : "";
      const paidAt =
        prompt(
          "Transaction time from evidence (optional; leave blank if unavailable). Enter ISO 8601 including timezone, e.g. 2026-11-22T08:40:00+03:00:",
          "",
        ) || "";
      try {
        await api("/api/admin/payments/service-manual", {
          method: "POST",
          body: JSON.stringify({
            serviceType,
            requestId: button.dataset.requestId,
            receipt,
            amount,
            payerPhone,
            ...(payerName ? { payerName } : {}),
            ...(paidAt ? { paidAt } : {}),
          }),
        });
        toast("Payment recorded; service processing is unlocked.");
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  document.querySelectorAll("[data-reset-password]").forEach((button) => {
    button.onclick = async () => {
      const learner = (state.data.users || []).find(
        (user) => user.id === button.dataset.resetPassword,
      );
      if (
        !learner ||
        !confirm(
          `Issue a temporary password for ${learner.name}? Their existing sessions will be signed out.`,
        )
      )
        return;
      try {
        const result = await api("/api/admin/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ userId: learner.id }),
        });
        const message = `Temporary password for ${learner.name}: ${result.temporaryPassword}\n\nShare it privately. The learner must change it immediately after signing in.`;
        try {
          await navigator.clipboard.writeText(result.temporaryPassword);
          alert(`${message}\n\nThe password was copied to your clipboard.`);
        } catch {
          prompt(message, result.temporaryPassword);
        }
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  const avatarInput = $("#avatarFile");
  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 3 * 1024 * 1024
    ) {
      toast("Choose a JPEG, PNG or WebP image up to 3 MB.");
      avatarInput.value = "";
      return;
    }
    const preview = URL.createObjectURL(file),
      profileAvatar = document.querySelector(".profile-avatar");
    if (profileAvatar)
      profileAvatar.innerHTML = `<img src="${preview}" alt="Profile photo preview">`;
    $("#avatarMessage").textContent = "Uploading and verifying photo…";
    try {
      const signed = await api("/api/profile/avatar-upload-url", {
        method: "POST",
        body: JSON.stringify({ mime: file.type, size: file.size }),
      });
      const upload = await fetch(signed.uploadUrl, {
        method: "PUT",
        headers: { "x-upsert": "false", "content-type": file.type },
        body: file,
      });
      if (!upload.ok) throw Error("Photo upload failed. Please try again.");
      await api("/api/profile/avatar-complete", {
        method: "POST",
        body: JSON.stringify({
          storagePath: signed.storagePath,
          size: file.size,
        }),
      });
      URL.revokeObjectURL(preview);
      toast("Profile photo updated.");
      await load();
    } catch (error) {
      URL.revokeObjectURL(preview);
      $("#avatarMessage").textContent = error.message;
      toast(error.message);
      await load();
    }
  });
  $("#settingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/settings", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      toast("Settings saved.");
      await load();
    } catch (x) {
      toast(x.message);
    }
  });
  $("#profileForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/profile", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      toast("Profile updated.");
      await load();
    } catch (error) {
      toast(error.message);
    }
  });
  $("#passwordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/profile/password", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      toast("Password changed. Please sign in again.");
      state.user = null;
      state.data = null;
      state.mode = "login";
      authView();
    } catch (x) {
      toast(x.message);
    }
  });
  $("#requestForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/requests", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      toast("Request submitted. We will notify you when it becomes available.");
      await load();
    } catch (x) {
      toast(x.message);
    }
  });
  $("#resultRequestForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget,
      submit = form.querySelector('button[type="submit"]');
    if (form.dataset.submitting) return;
    form.dataset.submitting = "true";
    if (submit) submit.disabled = true;
    try {
      const response = await api("/api/results/requests", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      toast(
        `Results request submitted. Reference: ${response.resultRequest.id.slice(0, 8)}.`,
      );
      await load();
    } catch (error) {
      toast(error.message);
    } finally {
      if (form.isConnected) {
        delete form.dataset.submitting;
        if (submit) submit.disabled = false;
      }
    }
  });
  $("#resultLookupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const target = $("#resultsLookup"),
      values = Object.fromEntries(new FormData(e.target));
    try {
      const response = await api("/api/results/check", {
          method: "POST",
          body: JSON.stringify(values),
        }),
        request = response.resultRequest;
      target.innerHTML = request
        ? `<div class="notice"><b>${request.status === "completed" ? "Results are ready" : "Request status"}</b><p>${status(request.status)} · ${esc(request.institutionName)} · ${esc(request.registrationNumber)}</p>${request.status === "completed" ? `<a class="btn" href="/api/results/download/${encodeURIComponent(request.id)}">Download your results PDF</a>` : '<p class="muted">The admin has not uploaded the results document yet.</p>'}</div>`
        : '<p class="notice">No request matched those details in your account. Check the information or submit a results request first.</p>';
    } catch (error) {
      target.textContent = error.message;
    }
  });
  document.querySelectorAll("[data-result-status]").forEach((select) => {
    select.onchange = async () => {
      if (select.value === "completed") return;
      try {
        await api("/api/admin/results/status", {
          method: "POST",
          body: JSON.stringify({
            id: select.dataset.resultStatus,
            status: select.value,
          }),
        });
        toast("Results request status updated.");
        await load();
      } catch (error) {
        toast(error.message);
      }
    };
  });
  document.querySelectorAll("[data-result-upload]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const file = new FormData(form).get("file"),
        requestId = form.dataset.resultUpload;
      if (!file || !file.size || !/\.pdf$/i.test(file.name)) {
        toast("Choose a PDF results file.");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast("The results PDF must be 25 MB or smaller.");
        return;
      }
      try {
        toast("Uploading results PDF…");
        const upload = await api("/api/admin/results/upload-url", {
          method: "POST",
          body: JSON.stringify({
            requestId,
            fileName: file.name,
            size: file.size,
          }),
        });
        const stored = await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "x-upsert": "false", "content-type": "application/pdf" },
          body: file,
        });
        if (!stored.ok)
          throw Error("Private storage upload failed. Please retry.");
        await api("/api/admin/results/complete", {
          method: "POST",
          body: JSON.stringify({
            requestId,
            storagePath: upload.storagePath,
            fileName: file.name,
            fileSize: file.size,
          }),
        });
        toast("Results uploaded and the student has been notified.");
        await load();
      } catch (error) {
        toast(error.message);
      }
    });
  });
  $("#noticeForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/notices", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.target))),
      });
      toast("Notice published.");
      await load();
    } catch (x) {
      toast(x.message);
    }
  });
}
async function payService(id, serviceType) {
  const phone = normPhone(
    prompt(
      "Enter your M-Pesa number for the payment prompt (e.g. 07XXXXXXXX):",
      state.phone || state.user.phone || "",
    ),
  );
  if (!/^254\d{9}$/.test(phone)) {
    toast("Enter a valid Kenyan phone number.");
    return;
  }
  try {
    state.phone = phone;
    toast("Sending M-Pesa prompt to your phone…");
    await api("/api/payments/stk", {
      method: "POST",
      body: JSON.stringify({ requestId: id, phone, serviceType }),
    });
    await waitServicePaid(id, serviceType);
  } catch (error) {
    toast(error.message);
  }
}
async function waitServicePaid(id, serviceType) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    try {
      const result = await api(
        `/api/payments/status/${encodeURIComponent(id)}?serviceType=${encodeURIComponent(serviceType)}`,
      );
      if (result.status === "paid") {
        toast("Payment confirmed. Your service request is now queued.");
        await load();
        return true;
      }
      if (result.status === "failed") {
        toast("Payment was not completed. Use Retry payment to try again.");
        await load();
        return false;
      }
    } catch {}
  }
  toast(
    "Payment is still awaiting confirmation. Check the request status shortly.",
  );
  await load();
  return false;
}
function normPhone(v) {
  v = String(v || "").replace(/[\s-]/g, "");
  if (/^\+?254/.test(v)) return v.replace(/^\+/, "");
  if (/^0/.test(v)) return "254" + v.slice(1);
  if (/^[17]\d{8}$/.test(v)) return "254" + v;
  return v;
}
async function sha256(file) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function waitPaid(id, paperId) {
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    let s;
    try {
      s = await api("/api/payments/status/" + id);
    } catch {
      continue;
    }
    if (s.status === "paid") {
      toast("Payment received! Your download is starting…");
      await load();
      showReady(s, paperId);
      if (paperId)
        setTimeout(() => {
          location.href = "/api/download/" + paperId;
        }, 700);
      return true;
    }
    if (s.status === "payment_failed") {
      toast("Payment was not completed. Tap Buy to try again.");
      await load();
      return false;
    }
  }
  toast("Still waiting for confirmation. Check My Papers in a minute.");
  await load();
  return false;
}
async function startPay(id, paperId) {
  const phone = normPhone(
    prompt(
      "Enter your M-Pesa number to receive the payment prompt (e.g. 07XXXXXXXX):",
      state.phone ||
        (() => {
          try {
            return localStorage.getItem("phone");
          } catch {
            return "";
          }
        })() ||
        state.user.phone ||
        "",
    ),
  );
  if (!/^254\d{9}$/.test(phone)) {
    toast("Enter a valid Kenyan phone number.");
    return;
  }
  state.phone = phone;
  try {
    localStorage.setItem("phone", phone);
  } catch {}
  try {
    toast("Sending M-Pesa prompt to your phone…");
    await api("/api/payments/stk", {
      method: "POST",
      body: JSON.stringify({ requestId: id, phone }),
    });
  } catch (e) {
    if (!/already pending/i.test(e.message)) {
      toast(e.message);
      return;
    }
  }
  toast(
    "Enter your M-Pesa PIN on your phone. Your download starts automatically.",
  );
  await waitPaid(id, paperId);
}
async function buy(paperId) {
  if (state.buying) return;
  if (
    (state.data.requests || []).some(
      (r) => r.paperId === paperId && r.status === "paid",
    )
  ) {
    location.href = "/api/download/" + paperId;
    return;
  }
  const p = state.data.papers.find((x) => x.id === paperId);
  if (p && !confirm(`Pay KSh ${p.price} for "${p.title}" using M-Pesa?`))
    return;
  state.buying = true;
  try {
    let r = (state.data.requests || []).find(
      (x) => x.paperId === paperId && x.status !== "paid",
    );
    if (!r) {
      const x = await api("/api/requests", {
        method: "POST",
        body: JSON.stringify({ paperId }),
      });
      r = x.request || x;
    }
    await startPay(r.id, paperId);
  } catch (e) {
    toast(e.message);
  } finally {
    state.buying = false;
  }
}
async function pay(requestId) {
  const r = (state.data.requests || []).find((x) => x.id === requestId);
  await startPay(requestId, r && r.paperId);
}
(async () => {
  try {
    const x = await api("/api/me");
    if (x.user) {
      state.user = x.user;
      await load();
    } else authView();
  } catch {
    authView();
  }
})();

(() => {
  try {
    if (localStorage.getItem("dark")) document.body.classList.add("dark");
  } catch {}
  const b = document.createElement("button");
  b.id = "themeBtn";
  b.textContent = "🌓";
  b.title = "Dark mode";
  b.onclick = () => {
    document.body.classList.toggle("dark");
    try {
      localStorage.setItem(
        "dark",
        document.body.classList.contains("dark") ? "1" : "",
      );
    } catch {}
  };
  document.body.appendChild(b);
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "/" &&
      !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
    ) {
      const i = document.querySelector(".top input");
      if (i) {
        e.preventDefault();
        i.focus();
      }
    }
  });
  setInterval(async () => {
    if (
      document.hidden ||
      !state.user ||
      ![
        "Transactions",
        "Payment Reports",
        "Requests & Orders",
        "Payments",
        "Transaction History",
      ].includes(state.tab)
    )
      return;
    const priorSuccesses = new Set(
      (state.data?.payments || [])
        .filter((payment) => payment.status === "success")
        .map((payment) => payment.id),
    );
    try {
      await load();
    } catch {
      return;
    }
    const newSuccess = (state.data?.payments || []).some(
      (payment) =>
        payment.status === "success" && !priorSuccesses.has(payment.id),
    );
    if (newSuccess) {
      toast(
        state.user?.role === "admin"
          ? "New successful payment received."
          : "Your payment confirmation has been updated.",
      );
      if (state.user?.role === "admin") beep();
      document.title = "New payment · Papers Portal";
    }
  }, 30000);
})();

async function api(u, o) {
  document.body.classList.add("busy");
  try {
    return await api0(u, o);
  } finally {
    document.body.classList.remove("busy");
  }
}
function beep() {
  try {
    const c = new AudioContext(),
      o = c.createOscillator();
    o.frequency.value = 880;
    o.connect(c.destination);
    o.start();
    setTimeout(() => {
      o.stop();
      c.close();
    }, 250);
  } catch {}
}
function showReady(s, paperId) {
  document.querySelector(".ready")?.remove();
  const o = document.createElement("div");
  o.className = "ready";
  o.innerHTML = `<div class="ready-card"><div style="font-size:46px">✅</div><h2>Payment received</h2><p>${s.receipt ? "M-Pesa code: <b>" + esc(s.receipt) + "</b><br>" : ""}KSh ${esc(String(s.amount || ""))} paid. Your paper is ready.</p><a class="btn" href="/api/download/${encodeURIComponent(paperId || "")}">Download now</a>${s.paymentId ? ` <a class="icon" href="/api/payments/${encodeURIComponent(s.paymentId)}/receipt" download>Download PDF receipt</a>` : ""} <button class="icon" id="rdClose">Close</button></div>`;
  document.body.appendChild(o);
  o.querySelector("#rdClose").onclick = () => o.remove();
  o.onclick = (e) => {
    if (e.target === o) o.remove();
  };
}
(() => {
  const t0 = document.title;
  addEventListener("offline", () => toast("You are offline."));
  addEventListener("online", () => toast("Back online."));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.querySelector(".ready")?.remove();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) document.title = t0;
  });
  const w = document.createElement("a");
  w.id = "waBtn";
  w.textContent = "💬";
  w.title = "Chat with support on WhatsApp";
  w.target = "_blank";
  w.rel = "noopener";
  w.href = "https://wa.me/254723278526";
  w.onclick = () => {
    const p = String(
      state.data?.settings?.supportPhone || "+254723278526",
    ).replace(/\D/g, "");
    w.href = "https://wa.me/" + p;
  };
  document.body.appendChild(w);
})();

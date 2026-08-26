// edge/src/lib/turso.js
var _dbUrl = null;
var _token = null;
function initTurso({ url, token }) {
  _dbUrl = String(url || "").replace(/\/+$/, "");
  _token = token;
}
function dbUrl() {
  if (!_dbUrl) throw new Error("Turso not initialized: url missing");
  return _dbUrl;
}
function dbToken() {
  if (!_token) throw new Error("Turso not initialized: token missing");
  return _token;
}
function arg(v) {
  if (v === null || v === void 0) return { type: "null", value: null };
  if (typeof v === "number") return { type: "integer", value: String(v) };
  if (typeof v === "boolean") return { type: "integer", value: v ? "1" : "0" };
  return { type: "text", value: String(v) };
}
async function pipeline(requests) {
  const body = { requests };
  const res = await fetch(`${dbUrl()}/v2/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dbToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    const msg = (() => {
      try {
        const j = JSON.parse(text);
        return j.message || j.error || text;
      } catch {
        return text;
      }
    })();
    throw new Error(`Turso HTTP ${res.status}: ${msg}`);
  }
  const data = JSON.parse(text);
  if (data.response && data.response.error) {
    throw new Error(`Turso pipeline: ${data.response.error.message || data.response.error}`);
  }
  const results = [];
  for (const step of data.results || []) {
    if (step.error) throw new Error(`Turso stmt: ${step.error.message || JSON.stringify(step.error)}`);
    const r = step.response && step.response.result;
    if (step.response && step.response.error) {
      throw new Error(`Turso stmt: ${step.response.error.message || step.response.error}`);
    }
    results.push(r);
  }
  return results;
}
async function execute(sql, args = []) {
  const [r] = await pipeline([{ type: "execute", stmt: { sql, args: args.map(arg) } }]);
  return r;
}
async function query(sql, args = []) {
  const [r] = await pipeline([{ type: "execute", stmt: { sql, args: args.map(arg) } }]);
  return parseRows(r);
}
function parseRows(result) {
  if (!result || !Array.isArray(result.cols)) return [];
  const cols = result.cols.map((c) => c.name);
  const rows = result.rows || [];
  return rows.map((row) => {
    const obj = {};
    row.forEach((cell, i) => {
      if (cell === null) {
        obj[cols[i]] = null;
      } else if (typeof cell === "object" && "value" in cell && "type" in cell) {
        obj[cols[i]] = cell.type === "integer" ? Number(cell.value) : cell.value;
      } else {
        obj[cols[i]] = cell;
      }
    });
    return obj;
  });
}
async function batch(sqlStmts) {
  const requests = sqlStmts.map(({ sql, args = [] }) => ({
    type: "execute",
    stmt: { sql, args: args.map(arg) }
  }));
  return pipeline(requests);
}

// edge/src/lib/resend.js
var _apiKey = null;
var _from = "noreply@vasc.beer";
function initResend({ apiKey, from }) {
  _apiKey = apiKey;
  if (from) _from = from;
}
async function sendEmail({ to, subject, html, text }) {
  if (!_apiKey) throw new Error("Resend not initialized");
  const body = {
    from: _from,
    to: Array.isArray(to) ? to : [String(to)],
    subject,
    html: html || void 0,
    text: text || void 0
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${_apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.message || data.name || `Resend HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data.id;
}
function buildCodeEmail({ to, code, action = "register" }) {
  const subject = "\u3010\u793E\u533A\u3011\u90AE\u7BB1\u9A8C\u8BC1\u7801";
  const text = `\u60A8\u7684\u9A8C\u8BC1\u7801\u662F\uFF1A${code}

\u8BE5\u9A8C\u8BC1\u7801 10 \u5206\u949F\u5185\u6709\u6548\uFF0C\u8BF7\u52FF\u6CC4\u9732\u7ED9\u4ED6\u4EBA\u3002
\uFF08\u82E5\u975E\u672C\u4EBA\u64CD\u4F5C\uFF0C\u8BF7\u5FFD\u7565\u672C\u90AE\u4EF6\uFF09`;
  const html = `
<div style="font-family:-apple-system,'PingFang SC',sans-serif;max-width:420px;margin:0 auto;padding:24px;border:1px solid #eee;border-radius:12px">
  <h2 style="margin:0 0 12px;font-size:18px">\u90AE\u7BB1\u9A8C\u8BC1\u7801</h2>
  <p style="color:#666;font-size:14px">\u7528\u4E8E\u300C\u793E\u533A\u300D${action === "register" ? "\u6CE8\u518C" : "\u9A8C\u8BC1"}\uFF0C10 \u5206\u949F\u5185\u6709\u6548\uFF1A</p>
  <div style="font-size:32px;letter-spacing:8px;font-weight:700;color:#ff5000;margin:12px 0">${code}</div>
  <p style="color:#999;font-size:12px">\u82E5\u975E\u672C\u4EBA\u64CD\u4F5C\uFF0C\u8BF7\u5FFD\u7565\u672C\u90AE\u4EF6\u3002</p>
</div>`;
  return { to, subject, text, html };
}

// edge/src/lib/qiniu.js
var _q = null;
function initQiniu({ accessKey, secretKey, bucket, region }) {
  _q = { accessKey, secretKey, bucket, region };
}
var enc = (s) => new TextEncoder().encode(s);
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function hmacSign(data) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(_q.secretKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}
async function uploadToken({ key, expires = 3600, policy = {} } = {}) {
  if (!_q) throw new Error("Qiniu not initialized");
  const deadline = Math.floor(Date.now() / 1e3) + expires;
  const putPolicy = { scope: key ? `${_q.bucket}:${key}` : _q.bucket, deadline, ...policy };
  const data = enc(JSON.stringify(putPolicy));
  const sig = b64url(await hmacSign(data));
  return `${_q.accessKey}:${sig}`;
}
var REGION_CODES = { "cn-east-1": "z0", "cn-north-1": "z1", "cn-south-1": "z2", "z0": "z0", "z1": "z1", "z2": "z2" };
function uploadHost() {
  const code = REGION_CODES[_q.region] || _q.region || "z2";
  return `up-${code}.qiniup.com`;
}

// edge/src/lib/schema.js
var SCHEMA = [
  // 用户
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    avatar TEXT,
    bio TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // 邮箱验证码（发送记录）
  `CREATE TABLE IF NOT EXISTS email_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    action TEXT NOT NULL DEFAULT 'register',
    code TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    sent_at INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // 索引：按邮箱查最新验证码
  `CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, sent_at)`
];

// edge/src/lib/resp.js
function ok(data) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
function fail(msg, status = 200) {
  return new Response(JSON.stringify({ code: 1, msg }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("\u65E0\u6548\u7684 JSON \u8BF7\u6C42\u4F53");
  }
}
function handleOptions() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  } });
}

// edge/src/lib/crypto.js
var enc2 = new TextEncoder();
function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}
function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bufToHex(buf);
}
async function hashPassword(password, saltHex) {
  const salt = hexToBuf(saltHex || (saltHex = randomHex(16)));
  const key = await crypto.subtle.importKey(
    "raw",
    enc2.encode(String(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" },
    key,
    256
  );
  return { salt: saltHex, hash: bufToHex(bits) };
}
async function verifyPassword(password, saltHex, hashHex) {
  if (!saltHex || !hashHex) return false;
  const { hash } = await hashPasswordWithSalt(String(password), saltHex);
  return hash === hashHex;
}
async function hashPasswordWithSalt(password, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  return { hash };
}

// edge/src/lib/jwt.js
var enc3 = new TextEncoder();
function b64url2(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sign(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc3.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", key, data);
}
async function signJwt(payload, secret, ttlMs) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Date.now();
  const body = { ...payload, iat: Math.floor(now / 1e3), exp: Math.floor((now + ttlMs) / 1e3) };
  const h = b64urlToJson(header);
  const p = b64urlToJson(body);
  const sig = b64url2(await sign(enc3.encode(`${h}.${p}`), secret));
  return `${h}.${p}.${sig}`;
}
function b64urlToJson(obj) {
  return b64url2(enc3.encode(JSON.stringify(obj)));
}

// edge/src/api/auth.js
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var CODE_TTL_MS = 10 * 60 * 1e3;
var SEND_INTERVAL_MS = 60 * 1e3;
function genCode() {
  return String(Math.floor(1e5 + Math.random() * 9e5));
}
async function handleSendCode(request, ctx) {
  const body = await readJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const action = body.action || "register";
  if (!EMAIL_RE.test(email)) return fail("\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E");
  if (action === "register") {
    const [exist] = await query("SELECT id FROM users WHERE email = ?", [email]);
    if (exist) return fail("\u8BE5\u90AE\u7BB1\u5DF2\u88AB\u6CE8\u518C");
  }
  const [last] = await query(
    "SELECT sent_at FROM email_codes WHERE email = ? ORDER BY sent_at DESC LIMIT 1",
    [email]
  );
  if (last && Date.now() - last.sent_at < SEND_INTERVAL_MS) {
    return fail("\u53D1\u9001\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
  }
  const code = genCode();
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;
  const mockEmail = ctx.mockEmail;
  if (!mockEmail) {
    try {
      const { to, subject, text, html } = buildCodeEmail({ to: email, code, action });
      await sendEmail({ to, subject, text, html });
    } catch (e) {
      console.error("[send-code] email fail", e);
      return fail("\u90AE\u4EF6\u53D1\u9001\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
    }
  }
  const finalCode = mockEmail ? "123456" : code;
  await query(
    `INSERT INTO email_codes (email, action, code, expires_at, used, sent_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [email, action, finalCode, expiresAt, now]
  );
  return ok({ sent: true, expiresIn: Math.floor(CODE_TTL_MS / 1e3) });
}
async function handleRegister(routerReq, ctx) {
  const { username, email, password, code } = await readJson(routerReq);
  const mail = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) return fail("\u90AE\u7BB1\u683C\u5F0F\u4E0D\u6B63\u786E");
  if (!username || String(username).trim().length < 2) return fail("\u7528\u6237\u540D\u81F3\u5C11 2 \u4E2A\u5B57\u7B26");
  if (!password || String(password).length < 6) return fail("\u5BC6\u7801\u81F3\u5C11 6 \u4F4D");
  if (!code || !/^\d{6}$/.test(String(code))) return fail("\u9A8C\u8BC1\u7801\u9519\u8BEF\u6216\u5DF2\u8FC7\u671F");
  const [rec] = await query(
    `SELECT id, code, expires_at, used FROM email_codes
     WHERE email = ? AND action = 'register' ORDER BY sent_at DESC LIMIT 1`,
    [mail]
  );
  if (!rec || rec.used || Date.now() > rec.expires_at || rec.code !== String(code)) {
    return fail("\u9A8C\u8BC1\u7801\u9519\u8BEF\u6216\u5DF2\u8FC7\u671F");
  }
  const [exist] = await query("SELECT id FROM users WHERE email = ?", [mail]);
  if (exist) return fail("\u8BE5\u90AE\u7BB1\u5DF2\u88AB\u6CE8\u518C");
  const { salt, hash } = await hashPassword(String(password));
  const r = await execute(
    "INSERT INTO users (username, email, password_hash, password_salt) VALUES (?, ?, ?, ?)",
    [String(username).trim(), mail, hash, salt]
  );
  const userId = r.last_insert_rowid;
  await execute("UPDATE email_codes SET used = 1 WHERE id = ?", [rec.id]);
  const secret = ctx.jwtSecret;
  const token = await signJwt({ uid: userId }, secret, 7 * 24 * 3600 * 1e3);
  return ok({ token, userId, username: String(username).trim(), email: mail });
}
async function login(req, ctx) {
  const { email, password } = await readJson(req);
  const mail = String(email || "").trim().toLowerCase();
  const [user] = await query("SELECT * FROM users WHERE email = ?", [mail]);
  if (!user) return fail("\u8BE5\u90AE\u7BB1\u5C1A\u672A\u6CE8\u518C");
  const passOk = await verifyPassword(String(password || ""), user.password_salt, user.password_hash);
  if (!passOk) return fail("\u5BC6\u7801\u9519\u8BEF");
  const token = await signJwt({ userId: user.id }, ctx.jwtSecret, 7 * 24 * 3600 * 1e3);
  return ok({ token, userId: user.id, username: user.username, email: user.email });
}

// edge/src/lib/palette.js
var bannerBg = [
  "linear-gradient(135deg,#2b2d50 0%,#14161f 100%)",
  "linear-gradient(135deg,#1f4e5f 0%,#0d3b2b 100%)",
  "linear-gradient(135deg,#3f3a5e 0%,#1f1c33 100%)",
  "linear-gradient(135deg,#23465f 0%,#10202e 100%)",
  "linear-gradient(135deg,#5a2d45 0%,#111421 100%)"
];
var feedGradients = [
  "linear-gradient(135deg, #ffd7c2 0%, #ff9d76 100%)",
  "linear-gradient(135deg, #bfe3ff 0%, #6fb3f5 100%)",
  "linear-gradient(135deg, #caf2dc 0%, #5fd3a4 100%)",
  "linear-gradient(135deg, #ffe9b3 0%, #ffc24b 100%)",
  "linear-gradient(135deg, #e3d9ff 0%, #a98bf0 100%)",
  "linear-gradient(135deg, #d8f0ff 0%, #8fd0f0 100%)",
  "linear-gradient(135deg, #ffd9e0 0%, #ff8fab 100%)",
  "linear-gradient(135deg, #d6f5e6 0%, #6fd6a8 100%)",
  "linear-gradient(135deg, #ffe6c9 0%, #ffb35c 100%)",
  "linear-gradient(135deg, #dcf0ff 0%, #7fc4f8 100%)"
];

// edge/src/lib/data.js
var NOW = Date.now();
var ago = (hours) => new Date(NOW - hours * 36e5).toISOString();
var grad = (i) => feedGradients[Math.abs(i) % feedGradients.length];
var banners = [
  { id: 1, title: "AI \u5F00\u6E90\u5468\u62A5", subtitle: "\u672C\u5468\u6700\u503C\u5F97\u5173\u6CE8\u7684\u9879\u76EE", bg: bannerBg[0], icon: "fileText" },
  { id: 2, title: "\u524D\u7AEF\u6280\u672F\u5927\u4F1A 2026", subtitle: "\u62A5\u540D\u901A\u9053\u5DF2\u5F00\u542F", bg: bannerBg[1], icon: "flag" },
  { id: 3, title: "\u65B0\u624B\u6307\u5357", subtitle: "\u4E09\u6B65\u4E0A\u624B\u793E\u533A", bg: bannerBg[2], icon: "star" },
  { id: 4, title: "\u4F18\u79C0\u521B\u4F5C\u8005\u8BA1\u5212", subtitle: "\u4F60\u7684\u4F5C\u54C1\u503C\u5F97\u88AB\u770B\u89C1", bg: bannerBg[3], icon: "heart" },
  { id: 5, title: "\u793E\u533A\u516C\u544A\u677F", subtitle: "\u6700\u65B0\u89C4\u5219\u4E0E\u6D3B\u52A8", bg: bannerBg[4], icon: "tag" }
];
var channels = [
  { key: "recommend", label: "\u63A8\u8350", icon: "star" },
  { key: "announce", label: "\u516C\u544A", icon: "flag" },
  { key: "featured", label: "\u7CBE\u9009", icon: "check" },
  { key: "project", label: "\u9879\u76EE", icon: "folder" },
  { key: "newbie", label: "\u65B0\u624B", icon: "user" }
];
var channelLabels = {
  recommend: "\u63A8\u8350",
  announce: "\u516C\u544A",
  featured: "\u7CBE\u9009",
  project: "\u9879\u76EE",
  newbie: "\u65B0\u624B"
};
var authorPool = [
  { name: "CodeMantis", avatarText: "CM" },
  { name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648" },
  { name: "AI Builder", avatarText: "AI" },
  { name: "\u8001\u738B\u5199\u7801", avatarText: "\u738B" },
  { name: "Nova", avatarText: "N" },
  { name: "\u963F\u8336", avatarText: "\u8336" }
];
var tagPool = ["Vue", "React", "AI", "\u5F00\u6E90", "\u8BBE\u8BA1", "\u6559\u7A0B", "\u524D\u7AEF", "\u540E\u7AEF", "\u5DE5\u5177", "\u5B9E\u6218"];
var _seed = 0;
function nextSeed() {
  _seed = (_seed * 7 + 3) % 997;
  return _seed;
}
var pickAuthor = () => authorPool[nextSeed() % authorPool.length];
function pickTags(n) {
  const set = /* @__PURE__ */ new Set();
  while (set.size < n) set.add(tagPool[nextSeed() % tagPool.length]);
  return [...set];
}
var announceTabs = [
  { key: "announce", label: "\u516C\u544A" },
  { key: "news", label: "\u8D44\u8BAF" }
];
var announces = [
  { id: 1, type: "announce", title: "\u5173\u4E8E\u4E25\u5389\u6253\u51FB\u704C\u6C34\u4E0E\u5E7F\u544A\u884C\u4E3A\u7684\u901A\u77E5", date: "2026-08-24", cover: grad(0) },
  { id: 2, type: "announce", title: "\u793E\u533A\u89C4\u8303 v2.0 \u6B63\u5F0F\u53D1\u5E03\uFF0C\u8BF7\u5168\u4F53\u6210\u5458\u77E5\u6089", date: "2026-08-22", cover: grad(1) },
  { id: 3, type: "announce", title: "\u4F18\u79C0\u521B\u4F5C\u8005\u6FC0\u52B1\u8BA1\u5212 8 \u6708\u5165\u9009\u540D\u5355\u516C\u5E03", date: "2026-08-20", cover: grad(2) },
  { id: 4, type: "announce", title: "\u3010\u7CFB\u7EDF\u7EF4\u62A4\u30118 \u6708 26 \u65E5\u51CC\u6668\u505C\u673A\u5347\u7EA7", date: "2026-08-26", cover: grad(3) },
  { id: 5, type: "news", title: "Vue 4 \u524D\u77BB\uFF1ACombined API \u4E0E\u7F16\u8BD1\u5668\u4F18\u5316", date: "2026-08-25", cover: grad(4) },
  { id: 6, type: "news", title: "React 19 \u6B63\u5F0F\u53D1\u5E03\uFF0CServer Component \u5168\u91CF\u4E0A\u7EBF", date: "2026-08-23", cover: grad(5) },
  { id: 7, type: "news", title: "2026 \u524D\u7AEF\u5DE5\u7A0B\u5316\u8D8B\u52BF\u76D8\u70B9\uFF1ARust \u5DE5\u5177\u94FE\u5D1B\u8D77", date: "2026-08-21", cover: grad(6) },
  { id: 8, type: "news", title: "\u4ECE\u96F6\u642D\u5EFA\u79FB\u52A8\u7AEF\u8DE8\u7AEF\u65B9\u6848\u5BF9\u6BD4\uFF08Vue/React\uFF09", date: "2026-08-19", cover: grad(7) },
  { id: 9, type: "news", title: "AI \u8F85\u52A9\u5F00\u53D1\u5B9E\u8DF5\uFF1A\u4ECE\u63D0\u6548\u5230\u53EF\u53D8\u73B0", date: "2026-08-18", cover: grad(8) },
  { id: 10, type: "news", title: "\u8BBE\u8BA1\u7CFB\u7EDF\u843D\u5730\u624B\u518C\uFF1AToken \u9A71\u52A8\u7684\u4E8C\u6B21\u5F00\u53D1", date: "2026-08-17", cover: grad(9) }
];
var getAnnounces = (type = "announce") => announces.filter((a) => a.type === type);
function buildPostList(channelId, count = 14) {
  return Array.from({ length: count }, (_, i) => {
    const top = i < 2;
    const images = channelId === "project" ? i % 3 === 0 ? [grad(i + 1), grad(i + 2)] : i % 3 === 1 ? [grad(i + 3)] : [] : i % 4 === 0 ? [] : i % 4 === 1 ? [grad(i + 4)] : [grad(i + 5), grad(i + 6)];
    return {
      id: `${channelId}-${i + 1}`,
      channelId,
      title: top ? `\u3010\u7F6E\u9876\u3011${channelLabels[channelId] || channelId}\u9891\u9053\u91CD\u8981\u5185\u5BB9\uFF1A${i + 1} \u53F7\u5E16\u5B50\u6807\u9898` : `${channelLabels[channelId] || channelId}\u9891\u9053\u7CBE\u9009\u5185\u5BB9 ${i + 1}\uFF0C\u8FD9\u662F\u4E00\u6761\u503C\u5F97\u70B9\u5F00\u7684\u4F18\u8D28\u6807\u9898`,
      excerpt: "\u8FD9\u91CC\u662F\u5E16\u5B50\u7684\u5185\u5BB9\u6458\u8981\uFF0C\u7528\u4E8E\u5728\u5217\u8868\u4E2D\u4EE5\u5355\u884C\u622A\u53D6\u7684\u65B9\u5F0F\u5C55\u793A\u90E8\u5206\u53D1\u5E03\u5185\u5BB9\uFF0C\u70B9\u51FB\u53EF\u8FDB\u5165\u5B8C\u6574\u6B63\u6587\u3002",
      top,
      author: pickAuthor(),
      publishTime: ago((i + 1) * 5 + i % 4),
      images,
      tags: pickTags(i % 3 + 2),
      replies: i * 13 % 320 + 5,
      views: i * 97 % 9e3 + 300,
      likes: i * 61 % 600 + 10,
      shares: i * 17 % 90 + 2,
      comments: i * 23 % 150 + 5,
      repo: i % 2 === 0 ? "github.com/community-app/example" : null,
      liked: false
    };
  });
}
var _channelCache = {};
function getFeeds(channelId, { sort = "default" } = {}) {
  if (!_channelCache[channelId]) _channelCache[channelId] = buildPostList(channelId);
  const list = [..._channelCache[channelId]];
  if (sort === "latestReply") {
    list.sort((a, b) => Number(b.top) - Number(a.top) || b.replies - a.replies);
  } else if (sort === "latestPublish") {
    list.sort((a, b) => Number(b.top) - Number(a.top) || +new Date(b.publishTime) - +new Date(a.publishTime));
  }
  return list;
}
var sortOptions = [
  { key: "default", label: "\u9ED8\u8BA4" },
  { key: "latestReply", label: "\u6700\u65B0\u56DE\u590D" },
  { key: "latestPublish", label: "\u6700\u65B0\u53D1\u5E03" }
];
var feedCards = Array.from({ length: 14 }, (_, i) => {
  const author = pickAuthor();
  const tags = pickTags(i % 2 + 2);
  return {
    id: `recommend-${i + 1}`,
    type: i % 5 === 0 ? "project" : "article",
    title: `\u63A8\u8350\u9891\u9053\u7B2C ${i + 1} \u6761\uFF1A${i % 4 === 0 ? "\u4E00\u4E2A\u503C\u5F97\u6536\u85CF\u7684\u6807\u9898\u793A\u4F8B" : "\u4F18\u8D28\u5185\u5BB9\uFF0C\u9002\u5408\u5728\u53CC\u5217\u7011\u5E03\u4E2D\u5C55\u793A"}`,
    cover: grad(i),
    author,
    tags,
    likes: i * 37 % 2e3 + 20,
    views: i * 89 % 3e4 + 500,
    timeAgo: ago((i + 1) * 3),
    liked: false
  };
});
var followAuthors = [
  { id: "u1", name: "CodeMantis", avatarText: "CM", bio: "\u5168\u6808\u5DE5\u7A0B\u5E08 \xB7 \u5F00\u6E90\u7231\u597D\u8005\uFF0C\u4E13\u6CE8\u524D\u7AEF\u5DE5\u7A0B\u5316", following: 128, followers: 4520, posts: 36, followed: true },
  { id: "u2", name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", bio: "Vue / React \u53CC\u4FEE\uFF0C\u7231\u5199\u5B9E\u6218\u6559\u7A0B", following: 89, followers: 2100, posts: 52, followed: true },
  { id: "u3", name: "AI Builder", avatarText: "AI", bio: "AI \u5E94\u7528\u843D\u5730\u8DF5\u884C\u8005\uFF0C\u5206\u4EAB\u53EF\u590D\u7528\u7684\u65B9\u6848", following: 56, followers: 9800, posts: 28, followed: true },
  { id: "u4", name: "\u8001\u738B\u5199\u7801", avatarText: "\u738B", bio: "\u540E\u7AEF\u51FA\u8EAB\u7684\u5168\u6808\uFF0C\u5076\u5C14\u5199\u5199\u6027\u80FD\u4F18\u5316", following: 200, followers: 1560, posts: 44, followed: true },
  { id: "u5", name: "Nova", avatarText: "N", bio: "\u8BBE\u8BA1\u5E08 & \u524D\u7AEF\uFF0C\u559C\u6B22\u505A\u4E00\u4E9B\u597D\u770B\u7684\u4E1C\u897F", following: 35, followers: 12e3, posts: 19, followed: true },
  { id: "u6", name: "\u963F\u8336", avatarText: "\u8336", bio: "\u8BB0\u5F55\u5B66\u4E60\u8FC7\u7A0B\uFF0C\u5206\u4EAB\u8E29\u5751\u7B14\u8BB0", following: 77, followers: 890, posts: 15, followed: true }
];
var authorById = Object.fromEntries(followAuthors.map((a) => [a.id, a]));
var seeds = [
  { userId: "u1", title: "\u4ECE\u96F6\u642D\u5EFA Monorepo\uFF1ATurborepo + pnpm \u5B9E\u8DF5\u8BB0\u5F55", excerpt: "\u6700\u8FD1\u628A\u516C\u53F8\u9879\u76EE\u62C6\u6210\u4E86 monorepo\uFF0C\u8BB0\u5F55\u4E00\u4E0B\u4EFB\u52A1\u7F16\u6392\u3001\u4F9D\u8D56\u63D0\u5347\u548C\u7F13\u5B58\u547D\u4E2D\u8FD9\u51E0\u4E2A\u5173\u952E\u70B9\uFF0C\u5E0C\u671B\u5BF9\u5927\u5BB6\u6709\u5E2E\u52A9\u3002", tags: ["\u5DE5\u7A0B\u5316", "Monorepo", "\u5B9E\u6218"], images: 2 },
  { userId: "u2", title: "Vue 3 \u7EC4\u5408\u5F0F API \u7684 10 \u4E2A\u6613\u9519\u70B9", excerpt: "\u7528\u4E86\u4E24\u5E74\u7EC4\u5408\u5F0F API\uFF0C\u6574\u7406\u51FA 10 \u4E2A\u9AD8\u9891\u8E29\u5751\u70B9\uFF1Aref \u89E3\u5305\u3001watch \u89E6\u53D1\u65F6\u673A\u3001provide/inject \u7B49\u7B49\u3002", tags: ["Vue", "\u524D\u7AEF", "\u6559\u7A0B"], images: 0 },
  { userId: "u3", title: "\u7528\u672C\u5730\u5927\u6A21\u578B\u7ED9\u9ED1\u76D2\u63A5\u53E3\u505A\u56DE\u5F52\u6D4B\u8BD5", excerpt: "\u4E0D\u4F9D\u8D56\u6807\u6CE8\u6570\u636E\uFF0C\u8BA9\u672C\u5730\u6A21\u578B\u7406\u89E3\u63A5\u53E3\u6587\u6863\u5E76\u81EA\u52A8\u751F\u6210\u56DE\u5F52\u7528\u4F8B\uFF0C\u4E00\u5468\u5B9E\u8DF5\u4E0B\u6765\u7684\u6548\u679C\u4E0E\u5751\u3002", tags: ["AI", "\u6D4B\u8BD5", "LLM"], images: 2 },
  { userId: "u4", title: "Node \u670D\u52A1 50ms \u5230 8ms\uFF1A\u4E00\u6B21\u5B8C\u6574\u7684\u6027\u80FD\u5256\u6790", excerpt: "\u901A\u8FC7\u706B\u7130\u56FE\u5B9A\u4F4D\u5230\u5E8F\u5217\u5316\u70ED\u70B9\uFF0C\u914D\u5408\u7F13\u5B58\u4E0E\u6279\u91CF IO \u6539\u5199\uFF0C\u6700\u7EC8\u628A P95 \u4ECE 50ms \u538B\u5230 8ms \u7684\u5B8C\u6574\u8FC7\u7A0B\u3002", tags: ["Node", "\u6027\u80FD", "\u540E\u7AEF"], images: 1 },
  { userId: "u5", title: "\u6211\u6574\u7406\u7684\u4E00\u5957\u79FB\u52A8\u7AEF\u8BBE\u8BA1 Token \u4E0E\u843D\u5730\u89C4\u8303", excerpt: "\u4ECE\u8272\u677F\u3001\u95F4\u8DDD\u3001\u5B57\u53F7\u5230\u56FE\u6807\uFF0C\u6C89\u6DC0\u51FA\u4E00\u5957\u53EF\u4EE5\u76F4\u63A5\u7ED9\u524D\u7AEF\u540C\u5B66\u63A5\u5165\u7684\u8BBE\u8BA1 Token\uFF0C\u9644\u5B8C\u6574\u6E05\u5355\u3002", tags: ["\u8BBE\u8BA1", "DesignToken", "\u89C4\u8303"], images: 3 },
  { userId: "u6", title: "\u72EC\u7ACB\u5F00\u53D1\u4E00\u4E2A\u6708\uFF1A\u6211\u628A\u535A\u5BA2\u6539\u6210\u4E86 SSG", excerpt: "\u8BB0\u5F55\u4ECE SSR \u5207\u5230 SSG \u7684\u5FC3\u8DEF\u5386\u7A0B\uFF1A\u6784\u5EFA\u901F\u5EA6\u3001SEO \u4E0E\u90E8\u7F72\u6210\u672C\u7684\u771F\u5B9E\u5BF9\u6BD4\uFF0C\u9644\u8E29\u5751\u8BB0\u5F55\u3002", tags: ["\u535A\u5BA2", "SSG", "\u5206\u4EAB"], images: 1 },
  { userId: "u1", title: "\u5982\u4F55\u7ED9\u8001\u9879\u76EE\u63A5\u5165 TypeScript \u800C\u4E0D\u7206\u70B8", excerpt: "\u6E10\u8FDB\u5F0F\u8FC1\u79FB\u7684\u56DB\u4E2A\u9636\u6BB5\uFF1A\u4ECE checker \u5230 strict \u518D\u5230 type-only \u5BFC\u5165\uFF0C\u5206\u4EAB\u5728\u4F01\u4E1A\u9879\u76EE\u7684\u843D\u5730\u65B9\u6848\u3002", tags: ["TypeScript", "\u91CD\u6784", "\u5DE5\u7A0B\u5316"], images: 0 },
  { userId: "u2", title: "React 19\uFF1AServer Components \u5B9E\u6218\u521D\u4F53\u9A8C", excerpt: "\u5728\u4E00\u4E2A\u771F\u5B9E\u7684\u7535\u5546\u5217\u8868\u9875\u5C1D\u8BD5\u4E86 RSC\uFF0C\u8BF4\u8BF4\u6570\u636E\u52A0\u8F7D\u3001\u6D41\u5F0F\u6E32\u67D3\u548C\u4E00\u6574\u5957\u4F53\u9A8C\u7684\u521D\u5370\u8C61\u3002", tags: ["React", "\u5B9E\u6218", "\u524D\u6CBF"], images: 2 }
];
var followFeeds = seeds.map((s, i) => {
  const author = authorById[s.userId];
  const images = Array.from({ length: s.images }, (_, k) => grad(i * 3 + k + 1));
  return {
    id: `follow-${i + 1}`,
    userId: s.userId,
    title: s.title,
    excerpt: s.excerpt,
    top: i < 1,
    author: { name: author.name, avatarText: author.avatarText },
    publishTime: ago((i + 1) * 6),
    images,
    tags: s.tags,
    replies: i * 29 % 400 + 8,
    views: i * 113 % 12e3 + 500,
    likes: i * 67 % 900 + 30,
    shares: i * 23 % 120 + 3,
    comments: i * 31 % 200 + 8,
    repo: null,
    liked: false
  };
});
var getFollowFeeds = (userId) => userId ? followFeeds.filter((f) => f.userId === userId) : followFeeds;
var getAuthorById = (id) => authorById[id] || null;

// edge/src/api/home.js
function getBanners() {
  return ok(banners);
}
function getChannels() {
  return ok(channels);
}
function feedList(url) {
  const channel = url.searchParams.get("channel") || "recommend";
  const page = Number(url.searchParams.get("page") || 1);
  const pageSize = Number(url.searchParams.get("pageSize") || 10);
  let listData;
  if (channel === "recommend") {
    listData = feedCards;
  } else {
    listData = getFeeds(channel, {});
  }
  const start = (page - 1) * pageSize;
  const pageList = listData.slice(start, start + pageSize);
  return ok({ list: pageList, page, hasMore: start + pageSize < listData.length });
}
async function toggleFeedLike(request) {
  const body = await readJson(request);
  const liked = !!body.liked;
  return ok({ feedId: body.feedId, liked });
}
function feedPosts(url) {
  const channel = url.searchParams.get("channel") || "featured";
  const sort = url.searchParams.get("sort") || "default";
  return ok({ channel, list: getFeeds(channel, { sort }) });
}
function feedSorts() {
  return ok(sortOptions);
}
function announceList(url) {
  const type = url.searchParams.get("type") || "announce";
  return ok(getAnnounces(type));
}
function announceTabsApi() {
  return ok(announceTabs);
}

// edge/src/lib/content.js
var NOW2 = Date.now();
var ago2 = (n) => new Date(NOW2 - n * 36e5).toISOString();
var grad2 = (i) => feedGradients[Math.abs(i) % feedGradients.length];
var searchTypes = [
  { key: "project", label: "\u9879\u76EE" },
  { key: "dynamic", label: "\u52A8\u6001" },
  { key: "article", label: "\u6587\u7AE0" }
];
var hotTopics = [
  { id: "hot-1", rank: 1, title: "Vue 4 \u7EC4\u5408\u5F0F API", intro: "\u4E0B\u4E00\u4EE3 Vue \u7F16\u8BD1\u5668\u7684\u6838\u5FC3\u53D8\u5316", cover: grad2(1) },
  { id: "hot-2", rank: 2, title: "React Server Components", intro: "\u5168\u6808\u6E32\u67D3\u7684\u65B0\u8303\u5F0F", cover: grad2(2) },
  { id: "hot-3", rank: 3, title: "AI \u7F16\u7A0B\u52A9\u624B\u5B9E\u6D4B", intro: "Copilot / Cursor \u5BF9\u6BD4", cover: grad2(3) },
  { id: "hot-4", rank: 4, title: "Monorepo \u5B9E\u8DF5", intro: "Turborepo + pnpm", cover: grad2(4) },
  { id: "hot-5", rank: 5, title: "\u8FB9\u7F18\u51FD\u6570\u5165\u95E8", intro: "ESA / Cloudflare Workers", cover: grad2(5) },
  { id: "hot-6", rank: 6, title: "\u8BBE\u8BA1 Token \u843D\u5730", intro: "Design Token \u4F53\u7CFB", cover: grad2(6) }
];
var searchHistory = ["Vue \u7EC4\u4EF6\u5E93", "React Hook \u6559\u7A0B", "\u8FB9\u7F18\u51FD\u6570", "Monorepo", "AI \u7ED8\u56FE"];
function getHistory() {
  return [...searchHistory];
}
function deleteHistory(kw) {
  searchHistory = searchHistory.filter((k) => k !== kw);
  return [...searchHistory];
}
function clearHistory() {
  searchHistory = [];
  return [];
}
var suggestPool = [
  "Vue \u7EC4\u4EF6\u5E93\u63A8\u8350",
  "Vue 3 \u6027\u80FD\u4F18\u5316",
  "Vue 3 \u7EC4\u5408\u5F0F API \u6613\u9519\u70B9",
  "Vue Router \u6E90\u7801\u89E3\u6790",
  "React Hook \u6559\u7A0B",
  "React 19 Server Components",
  "React \u72B6\u6001\u7BA1\u7406\u5BF9\u6BD4",
  "\u8FB9\u7F18\u51FD\u6570\u5B9E\u8DF5",
  "\u8FB9\u7F18\u51FD\u6570\u5165\u95E8",
  "\u8FB9\u7F18\u7F13\u5B58\u7B56\u7565",
  "AI \u7F16\u7A0B\u52A9\u624B",
  "AI \u81EA\u52A8\u5316\u6D4B\u8BD5",
  "Node \u6027\u80FD\u5256\u6790",
  "Monorepo \u811A\u624B\u67B6"
];
function getSuggests(kw = "") {
  const k = String(kw || "").trim().toLowerCase();
  if (!k) return [];
  return suggestPool.filter((s) => s.toLowerCase().includes(k)).slice(0, 8);
}
var searchArticles = [
  { id: "s-1", type: "article", title: "Vue \u7EC4\u4EF6\u5E93\u4ECE 0 \u5230 1", excerpt: "\u5982\u4F55\u642D\u5EFA\u4E00\u5957\u53EF\u7EF4\u62A4\u7684\u7EC4\u4EF6\u5E93", cover: grad2(1), author: { name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648" }, likes: 120, views: 3120, createdAt: ago2(20) },
  { id: "s-2", type: "project", title: "Monorepo \u811A\u624B\u67B6\u5DE5\u5177", excerpt: "\u4E00\u952E\u521D\u59CB\u5316 Turborepo \u5DE5\u7A0B", cover: grad2(2), author: { name: "CodeMantis", avatarText: "CM" }, likes: 200, views: 5600, createdAt: ago2(30) },
  { id: "s-3", type: "dynamic", title: "\u4ECA\u5929\u8C03\u901A\u4E86\u4E00\u4E2A\u8FB9\u7F18\u51FD\u6570", excerpt: "\u5728 ESA \u4E0A\u8DD1\u4E86\u7B2C\u4E00\u4E2A fetch", cover: grad2(3), author: { name: "\u8001\u738B\u5199\u7801", avatarText: "\u738B" }, likes: 45, views: 890, createdAt: ago2(2) }
];
function searchArticlesBy(kw, type) {
  let list = searchArticles;
  if (type && type !== "all") list = list.filter((a) => a.type === type);
  const k = String(kw || "").trim().toLowerCase();
  if (k) list = list.filter((a) => (a.title + a.excerpt).toLowerCase().includes(k));
  return list;
}
var articleDetail = {
  id: "article-1001",
  title: "Vue 3 \u7EC4\u5408\u5F0F API\uFF1A\u4ECE\u5165\u95E8\u5230\u4F18\u96C5\u5730\u7EC4\u7EC7\u4E1A\u52A1\u4EE3\u7801",
  publishTime: ago2(26),
  author: { id: "u-2001", name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", followers: 12800, followed: false },
  tags: ["Vue", "Vite"],
  views: 32861,
  likes: 1286,
  favorites: 521,
  comments: 38,
  content: [
    "## \u4E3A\u4EC0\u4E48\u7528\u7EC4\u5408\u5F0F API",
    "",
    "\u7EC4\u5408\u5F0F API\uFF08Composition API\uFF09\u8BA9\u6211\u4EEC\u6309**\u903B\u8F91\u5173\u6CE8\u70B9**\u7EC4\u7EC7\u4EE3\u7801\uFF0C\u800C\u4E0D\u662F\u6309\u9009\u9879\u5757\u5806\u780C\u3002",
    "",
    "### \u6838\u5FC3 API",
    "",
    "- `ref`\uFF1A\u57FA\u7840\u54CD\u5E94\u5F0F",
    "- `computed`\uFF1A\u6D3E\u751F\u72B6\u6001",
    "- `watch`\uFF1A\u526F\u4F5C\u7528",
    "",
    "```js",
    "import { ref, computed, watch } from 'vue'",
    "",
    "const count = ref(0)",
    "const double = computed(() => count.value * 2)",
    "watch(count, (v) => console.log('count ->', v))",
    "```",
    "",
    "> \u5C0F\u6280\u5DE7\uFF1A\u5584\u7528 `reactive` + `toRefs` \u62C6\u5206\u5927\u5BF9\u8C61\u3002",
    "",
    "### \u7EC4\u7EC7\u4E1A\u52A1\u4EE3\u7801",
    "",
    "\u628A\u76F8\u5173\u903B\u8F91\u63D0\u53D6\u5230 `useXxx` \u7EC4\u5408\u51FD\u6570\uFF0C\u9875\u9762\u53EA\u8D1F\u8D23\u88C5\u914D\uFF1A",
    "",
    "```js",
    "function useCounter(init = 0) {",
    "  const count = ref(init)",
    "  const inc = () => count.value++",
    "  return { count, inc }",
    "}",
    "```",
    "",
    "\u6574\u4F53\u4F53\u9A8C\uFF1A**\u66F4\u6E05\u6670\u3001\u66F4\u597D\u590D\u7528\u3001\u66F4\u597D\u6D4B\u8BD5**\u3002\u6B22\u8FCE\u5728\u8BC4\u8BBA\u533A\u4EA4\u6D41\u4F60\u7684\u7528\u6CD5\u3002"
  ].join("\n"),
  cover: grad2(5),
  images: [grad2(5), grad2(6)]
};
var articleState = { liked: false, favorited: false, focused: false };
var commentSorts = [
  { key: "default", label: "\u9ED8\u8BA4" },
  { key: "latest", label: "\u6700\u65B0" }
];
var articleComments = [
  {
    id: "c-1",
    floor: 1,
    author: { name: "Nova", avatarText: "N", isAuthor: false },
    time: ago2(26),
    content: "\u5199\u5F97\u5F88\u624E\u5B9E\uFF01\u7279\u522B\u662F\u628A\u903B\u8F91\u62BD\u6210 useXxx \u90A3\u6BB5\uFF0C\u6B63\u597D\u89E3\u51B3\u4E86\u6211\u73B0\u5728\u7684\u75DB\u70B9\u3002",
    likes: 128,
    liked: false,
    repliesCount: 3,
    replies: [
      { id: "r-1-1", author: { name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", isAuthor: true }, time: ago2(24), content: "\u611F\u8C22\u652F\u6301\uFF01\u540E\u7EED\u53EF\u4EE5\u518D\u8BA8\u8BBA\u4E0B\u6D4B\u8BD5\u600E\u4E48\u5199\u3002" },
      { id: "r-1-2", author: { name: "\u8001\u738B\u5199\u7801", avatarText: "\u738B", isAuthor: false }, time: ago2(20), content: "\u540C\u611F\uFF0C\u7EC4\u5408\u5F0F\u786E\u5B9E\u66F4\u597D\u7EF4\u62A4\u3002" },
      { id: "r-1-3", author: { name: "\u963F\u8336", avatarText: "\u8336", isAuthor: false }, time: ago2(12), content: "\u6536\u85CF\u4E86\uFF0C\u8C22\u8C22\u5206\u4EAB\uFF01" }
    ]
  },
  {
    id: "c-2",
    floor: 2,
    author: { name: "AI Builder", avatarText: "AI", isAuthor: false },
    content: "\u5728 ref \u548C reactive \u4E4B\u95F4\u505A\u9009\u62E9\u65F6\u6709\u6CA1\u6709\u4EC0\u4E48\u7ECF\u9A8C\uFF1F\u6211\u603B\u89C9\u5F97 reactive \u89E3\u6784\u5F88\u9EBB\u70E6\u3002",
    likes: 64,
    liked: false,
    repliesCount: 1,
    replies: [
      { id: "r-2-1", author: { name: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", isAuthor: true }, time: ago2(10), content: "\u63A8\u8350\u4F18\u5148 ref\uFF0C\u914D\u5408 toRefs \u5728 setup return \u65F6\u81EA\u52A8\u89E3\u5305\uFF0C\u5FC3\u667A\u8D1F\u62C5\u6700\u5C0F\u3002" }
    ]
  },
  {
    id: "c-3",
    floor: 3,
    author: { name: "\u963F\u8336", avatarText: "\u8336", isAuthor: false },
    content: "\u4EE3\u7801\u5757\u91CC\u7684 watch \u4F8B\u5B50\u975E\u5E38\u76F4\u89C2\uFF0C\u6536\u85CF\u4E86\u3002",
    likes: 21,
    liked: false,
    repliesCount: 0,
    replies: []
  }
];
var moreActions = [
  { key: "wechat", label: "\u5FAE\u4FE1\u5206\u4EAB", icon: "wechat", color: "#07c160" },
  { key: "qq", label: "QQ \u5206\u4EAB", icon: "qq", color: "#12b7f5" },
  { key: "copy", label: "\u590D\u5236\u94FE\u63A5", icon: "link", color: "#666a73" },
  { key: "favorite", label: "\u6536\u85CF", icon: "star", color: "#ffb53d" },
  { key: "report", label: "\u4E3E\u62A5", icon: "flag", color: "#e04340" }
];
var messageTypes = [
  { key: "comment", label: "\u8BC4\u8BBA\u4E0E\u56DE\u590D", icon: "comment", desc: "\u522B\u4EBA\u8BC4\u8BBA\u4E86\u4F60\u7684\u5185\u5BB9" },
  { key: "like", label: "\u70B9\u8D5E", icon: "thumbUp", desc: "\u522B\u4EBA\u8D5E\u4E86\u4F60\u7684\u5185\u5BB9" },
  { key: "at", label: "@\u6211\u7684", icon: "at", desc: "\u6709\u4EBA\u5728\u5185\u5BB9\u4E2D\u63D0\u5230\u4F60" },
  { key: "fans", label: "\u65B0\u589E\u7C89\u4E1D", icon: "userPlus", desc: "\u65B0\u7684\u5173\u6CE8\u8005" }
];
var messageList = [
  { id: "m1", type: "comment", nickname: "Echo", avatarText: "E", time: "10 \u5206\u949F\u524D", content: "\u4F60\u7684\u5E16\u5B50\u300C\u5982\u4F55\u642D\u4E00\u5957\u5FEB\u7684 Monorepo\u300D\u6709\u4E86\u65B0\u56DE\u590D", articleTitle: "\u5982\u4F55\u642D\u4E00\u5957\u5FEB\u7684 Monorepo", articleId: "follow-1" },
  { id: "m2", type: "like", nickname: "Adonis", avatarText: "A", time: "1 \u5C0F\u65F6\u524D", content: "\u8D5E\u4E86\u4F60\u7684\u5E16\u5B50\u300CVue 3 \u7EC4\u5408\u5F0F API \u7684 10 \u4E2A\u6613\u9519\u70B9\u300D", articleTitle: "Vue 3 \u7EC4\u5408\u5F0F API \u7684 10 \u4E2A\u6613\u9519\u70B9", articleId: "follow-2" },
  { id: "m3", type: "at", nickname: "CodeMantis", avatarText: "CM", time: "\u6628\u665A 22:41", content: "\u5728\u300CMonorepo \u5B9E\u8DF5\u300D\u91CC @\u4E86\u4F60", articleTitle: "Monorepo \u5B9E\u8DF5", articleId: "follow-1" },
  { id: "m4", type: "fans", nickname: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", time: "\u6628\u5929", content: "\u5173\u6CE8\u4E86\u4F60", articleTitle: null, articleId: null },
  { id: "m5", type: "comment", nickname: "\u963F\u8336", avatarText: "\u8336", time: "2 \u5929\u524D", content: "\u56DE\u590D\u4E86\u4F60\u7684\u8BC4\u8BBA\u300C\u52A0\u6CB9\uFF0C\u4E00\u8D77\u8FDB\u6B65\uFF01\u300D", articleTitle: "\u8FB9\u7F18\u51FD\u6570\u4ECE\u5165\u95E8\u5230\u653E\u5F03", articleId: "article-1001" }
];
var typeMsg = {
  comment: [
    { id: "c1", nickname: "Echo", avatarText: "E", time: "10 \u5206\u949F\u524D", event: "\u8BC4\u8BBA\u4E86\u4F60\u7684\u6587\u7AE0", content: "\u5199\u5F97\u592A\u597D\u4E86\uFF01\u611F\u8C22\u5206\u4EAB\u3002", cover: grad2(1), articleTitle: "\u5982\u4F55\u642D\u4E00\u5957\u5FEB\u7684 Monorepo", articleId: "follow-1" },
    { id: "c2", nickname: "\u963F\u8336", avatarText: "\u8336", time: "2 \u5929\u524D", event: "\u56DE\u590D\u4E86\u4F60\u7684\u8BC4\u8BBA", content: "\u70ED\u5E16\u4E00\u8D77\u8FDB\u6B65\uFF01", articleTitle: "\u8FB9\u7F18\u51FD\u6570\u4E0E\u5929\u6587\u5230\u653E\u5F03", articleId: "article-100" }
  ],
  like: [
    { id: "l1", nickname: "Adonis", avatarText: "A", time: "1 \u5C0F\u65F6\u524D", event: "\u8D5E\u4E86\u4F60\u7684\u6587\u7AE0", content: "Vue 3 \u7EC4\u5408\u5F0F API \u6613\u9519\u70B9", coverText: grad2(2), articleTitle: "Vue 3 \u7EC4\u5408\u5F0F API \u7684 10 \u4E2A\u6613\u9519\u70B9", articleId: "follow-2" }
  ],
  at: [
    { id: "a1", nickname: "CodeMantis", avatarText: "CM", time: "\u6628\u665A 22:41", event: "\u5728\u6587\u7AE0\u4E2D\u63D0\u5230\u4F60", content: "\u628A\u8FD9\u4E2A\u65B9\u6848\u7ED9\u5927\u5BB6\u770B\u770B @\u4F60", coverText: grad2(3), articleTitle: "Monorepo \u5B9E\u8DF5", articleId: "follow-1" }
  ],
  fans: [
    { id: "f1", nickname: "\u524D\u7AEF\u5C0F\u9648", avatarText: "\u9648", time: "\u6628\u5929", event: "\u5173\u6CE8\u4E86\u4F60", content: "\u6211\u662F\u524D\u7AEF\u5C0F\u9648\uFF0C\u591A\u591A\u6307\u6559\uFF01", coverText: null, articleTitle: null, articleId: null },
    { id: "f2", nickname: "Nova", avatarText: "N", time: "3 \u5929\u524D", event: "\u5173\u6CE8\u4E86\u4F60", content: "\u8BBE\u8BA1\u5E08\u6765\u62A5\u5230\uFF01", coverText: null, articleTitle: null, articleId: null }
  ]
};
function getTypeMessages(type) {
  return typeMsg[type] || [];
}
function getMessageDetail(id) {
  const m = messageList.find((x) => x.id === id);
  if (m) return { ...m, title: "\u8BC4\u8BBA\u4E0E\u56DE\u590D", from: m.articleTitle };
  const all = Object.values(typeMsg).flat();
  const t = all.find((x) => x.id === id);
  if (t) return { id, type: "msg", nickname: t.nickname, avatarText: t.avatarText, time: t.time, title: "\u6D88\u606F\u8BE6\u60C5", content: t.content, from: t.articleTitle };
  return null;
}
var publishTypes = [
  { key: "article", label: "\u6587\u7AE0", desc: "\u5206\u4EAB\u6280\u672F\u6587\u7AE0\u4E0E\u89C1\u89E3", placeholder: "\u5206\u4EAB\u4F60\u7684\u6280\u672F\u89C1\u89E3\u2026" },
  { key: "project", label: "\u9879\u76EE", desc: "\u53D1\u5E03\u4F60\u7684\u5F00\u6E90\u9879\u76EE\u6216\u4F5C\u54C1\u96C6", placeholder: "\u4ECB\u7ECD\u4F60\u7684\u9879\u76EE\u2026" },
  { key: "dynamic", label: "\u52A8\u6001", desc: "\u968F\u624B\u8BB0\u5F55\u6B64\u523B\u7684\u60F3\u6CD5", placeholder: "\u5206\u4EAB\u6B64\u523B\u7684\u60F3\u6CD5\u2026" }
];
var topics = [
  { id: "t1", name: "Vue \u5F00\u53D1", hot: 128e3 },
  { id: "t2", name: "React \u751F\u6001", hot: 96300 },
  { id: "t3", name: "AI \u7F16\u7A0B", hot: 21e4 },
  { id: "t4", name: "\u524D\u7AEF\u5DE5\u7A0B\u5316", hot: 84500 },
  { id: "t5", name: "\u5F00\u6E90\u9879\u76EE", hot: 56e3 },
  { id: "t6", name: "\u7B14\u8BB0\u5206\u4EAB", hot: 32e3 }
];
function searchTopics(kw = "") {
  const k = String(kw || "").trim().toLowerCase();
  if (!k) return topics;
  return topics.filter((t) => t.name.toLowerCase().includes(k));
}
var profileState = {
  nickname: "\u8001\u9093",
  id: "dengm_2024",
  signature: "\u6478\u9C7C\u5F0F\u5F00\u53D1\uFF0C\u8BA4\u771F\u5199\u4EE3\u7801\u3002YOLO \u8BAD\u7EC3\u5E08\u3002",
  gender: "male",
  avatarIdx: 0
};
var avatarPool = [
  { bg: "linear-gradient(135deg,#ff9a8b 0%,#ff6a88 100%)", text: "\u9093" },
  { bg: "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)", text: "D" },
  { bg: "linear-gradient(135deg,#43e97b 0%,#38f9d7 100%)", text: "d" },
  { bg: "linear-gradient(135deg,#fa709a 0%,#fee140 100%)", text: "\u8001" }
];
function getProfile() {
  return {
    nickname: profileState.nickname,
    id: profileState.id,
    signature: profileState.signature,
    gender: profileState.gender,
    avatar: avatarPool[profileState.avatarIdx % avatarPool.length] || avatarPool[0],
    stats: { following: 128, followers: 356, likes: 1024 }
  };
}
function updateProfile(patch = {}) {
  if (patch.nickname !== void 0) profileState.nickname = patch.nickname;
  if (patch.gender !== void 0) profileState.gender = patch.gender;
  if (patch.signature !== void 0) profileState.signature = patch.signature;
  return getProfile();
}
function changeAvatar() {
  profileState.avatarIdx = ((profileState.avatarIdx || 0) + 1) % avatarPool.length;
  return avatarPool[profileState.avatarIdx];
}
var myPosts = [
  { id: "art-1001", grad: 1, title: "\u6211\u7684 Vue 3 \u5B9E\u6218\u603B\u7ED3", excerpt: "\u628A\u4E00\u5E74\u6765\u7684\u7EC4\u5408\u5F0F API \u5B9E\u8DF5\u505A\u4E86\u7CFB\u7EDF\u68B3\u7406\u2026", meta: { views: 1280, likes: 320, comments: 18 } },
  { id: "art-1002", grad: 4, title: "\u8FB9\u7F18\u51FD\u6570\u521D\u4F53\u9A8C", excerpt: "\u5728 ESA \u4E0A\u8DD1\u4E86\u7B2C\u4E00\u4E2A\u8FB9\u7F18\u51FD\u6570\u2026", meta: { views: 860, likes: 210, comments: 6 } },
  { id: "art-1003", grad: 7, title: "\u7528\u8BBE\u8BA1 Token \u6CBB\u7406\u6837\u5F0F", excerpt: "\u4E00\u7BC7\u6587\u7AE0\u770B\u61C2 Design Token \u7684\u4EF7\u503C\u2026", meta: { views: 420, likes: 95, comments: 3 } }
];
function getMyList(type = "posts") {
  const nowStr = /* @__PURE__ */ new Date();
  return myPosts.map((p, i) => {
    const base = {
      id: p.id,
      cover: grad2(p.grad + i),
      title: p.title,
      excerpt: p.excerpt,
      meta: p.meta,
      time: i === 0 ? "12 \u5929\u524D" : i === 1 ? "\u4ECA\u5929 12:03" : "3 \u5468\u524D"
    };
    if (type === "comments") base.comment = "\u8FD9\u662F\u6211\u5199\u4E0B\u7684\u8BC4\u8BBA\u5185\u5BB9\u9884\u89C8\uFF0C\u4F1A\u622A\u65AD\u5C55\u793A\u3002";
    if (type === "history") base.progress = (i + 4) * 16 + "%";
    return base;
  });
}
var splashInfo = {
  appName: "\u793E\u533A",
  slogan: "\u8FDE\u63A5\u6BCF\u4E00\u4E2A\u70ED\u7231\u5206\u4EAB\u7684\u4F60",
  version: "v1.0.0",
  copyright: "\xA9 2026 \u793E\u533A\u56E2\u961F",
  durationMs: 1800
};
var appExitInfo = { ok: true, time: (/* @__PURE__ */ new Date()).toISOString() };

// edge/src/api/search.js
function getTypes() {
  return ok(searchTypes);
}
function getHistoryApi() {
  return ok(getHistory());
}
async function deleteHistoryApi(request) {
  const body = await readJson(request);
  return ok({ list: deleteHistory(body.keyword) });
}
async function clearHistoryApi() {
  return ok({ list: clearHistory() });
}
function getHot() {
  return ok(hotTopics);
}
function getSuggest(url) {
  return ok(getSuggests(url.searchParams.get("keyword") || ""));
}
function doSearch(url) {
  const type = url.searchParams.get("type") || "all";
  const keyword = url.searchParams.get("keyword") || "";
  const page = Number(url.searchParams.get("page") || 1);
  const list = searchArticlesBy(keyword, type);
  return ok({ type, keyword, list, page, hasMore: false });
}

// edge/src/api/article.js
function getDetail(url) {
  const id = url.searchParams.get("id") || articleDetail.id;
  return ok({ ...articleDetail, id: id || articleDetail.id });
}
function getComments(url) {
  const sort = url.searchParams.get("sort") || "default";
  const list = [...articleComments];
  if (sort === "latest") list.sort((a, b) => +new Date(b.time) - +new Date(a.time));
  else list.sort((a, b) => a.floor - b.floor);
  return ok({ list, sorts: commentSorts });
}
async function addComment(request) {
  const body = await readJson(request);
  const floor = articleComments.length + 1;
  const comment = {
    id: `c-${Date.now()}`,
    floor,
    author: { name: "\u6211", avatarText: "\u6211" },
    time: (/* @__PURE__ */ new Date()).toISOString(),
    content: body.content || "",
    likes: 0,
    liked: false,
    repliesCount: 0,
    replies: []
  };
  articleComments.push(comment);
  return ok(comment);
}
async function addReply(request) {
  const body = await readJson(request);
  return ok({
    id: `r-${Date.now()}`,
    author: { name: "\u6211", avatarText: "\u6211" },
    time: (/* @__PURE__ */ new Date()).toISOString(),
    content: body.content || ""
  });
}
async function toggleCommentLike(request) {
  const body = await readJson(request);
  return ok({ commentId: body.commentId, liked: !!body.liked });
}
async function articleAction(request) {
  const body = await readJson(request);
  if (body.action === "like") articleState.liked = !!body.value;
  if (body.action === "favorite") articleState.favorited = !!body.value;
  if (body.action === "follow") articleState.focused = !!body.value;
  return ok({ action: body.action, value: !!body.value });
}
function getMoreActions() {
  return ok(moreActions);
}

// edge/src/api/follow.js
function getAuthors() {
  return ok(followAuthors);
}
function getFeedsApi(url) {
  const userId = url.searchParams.get("userId") || "";
  return ok({ userId, list: getFollowFeeds(userId) });
}
async function toggleFollow(request) {
  const body = await readJson(request);
  const uid = body.userId;
  const author = getAuthorById(uid);
  if (author) author.followed = !author.followed;
  return ok({ userId: uid, followed: author ? author.followed : false });
}

// edge/src/api/message.js
function getTypes2() {
  return ok(messageTypes);
}
function getList() {
  return ok(messageList);
}
function getType(url) {
  const type = url.searchParams.get("type") || "comment";
  return ok({ type, list: getTypeMessages(type) });
}
function getDetail2(url) {
  const id = url.searchParams.get("id") || "m1";
  const detail = getMessageDetail(id);
  return ok(detail || { id, type: "unknown", content: "" });
}
async function deleteMsg(request) {
  const body = await readJson(request);
  return ok({ id: body.id });
}

// edge/src/api/publish.js
function getTypes3() {
  return ok(publishTypes);
}
function getTopics(url) {
  return ok(searchTopics(url.searchParams.get("keyword") || ""));
}
async function submit(req) {
  const body = await readJson(req);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const type = body.type || "article";
  return ok({
    id: `p-${Date.now()}`,
    type,
    title: body.title || "",
    content: body.content || "",
    topics: body.topics || [],
    attachments: type === "project" ? body.attachments || [] : [],
    video: type === "dynamic" ? body.video || null : null,
    createdAt: now
  });
}
async function upload(req) {
  const body = await readJson(req);
  const kind = body.kind || "file";
  const token = await uploadToken({ expires: 3600 });
  return ok({
    uploadToken: token,
    uploadUrl: `https://${uploadHost()}`,
    key: `${kind === "video" ? "video" : "file"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    note: "\u5BA2\u6237\u7AEF\u7528 uploadToken \u76F4\u4F20\u4E03\u725B\uFF08\u53EF\u518D\u53D6\u56DE URL\uFF09"
  });
}
async function uploadImage(req) {
  const body = await readJson(req);
  const token = await uploadToken({ key: `img/${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  return ok({
    uploadToken: token,
    uploadUrl: `https://${uploadHost()}`,
    width: 1080,
    height: 720
  });
}

// edge/src/api/profile.js
function profileInfo() {
  return ok(getProfile());
}
async function profileUpdate(req) {
  const body = await readJson(req);
  return ok(updateProfile(body.patch || {}));
}
async function profileAvatar() {
  return ok(changeAvatar());
}
async function profileLogout() {
  return ok({ ok: true });
}
function myList(url) {
  const type = url.searchParams.get("type") || "posts";
  return ok({ type, list: getMyList(type) });
}
function splash() {
  return ok(splashInfo);
}
function exitApp() {
  return ok(appExitInfo);
}

// edge/index.js
var env = (ctx, k, dflt) => ctx && ctx.env && ctx.env[k] || globalThis.__env && globalThis.__env[k] || typeof process !== "undefined" && process.env && process.env[k] || dflt;
function readEnv(ctx) {
  return {
    tursoUrl: env(ctx, "TURSO_URL", "https://commity-dengmingen.aws-us-east-2.turso.io"),
    // TURSO_TOKEN 超过 ESA 单变量 200 字符限制时拆两段（TURSO_TOKEN_B 存剩余部分），拼接还原
    tursoToken: env(ctx, "TURSO_TOKEN", "") + env(ctx, "TURSO_TOKEN_B", ""),
    qiniuAk: env(ctx, "QINIU_AK", ""),
    qiniuSk: env(ctx, "QINIU_SK", ""),
    qiniuBucket: env(ctx, "QINIU_BUCKET", "deng09"),
    qiniuRegion: env(ctx, "QINIU_REGION", "he"),
    resendKey: env(ctx, "RESEND_KEY", ""),
    mailFrom: env(ctx, "MAIL_FROM", "noreply@vasc.beer"),
    jwtSecret: env(ctx, "JWT_SECRET", "dev-secret-change-me"),
    mockEmail: env(ctx, "MOCK_EMAIL", "1") === "1"
  };
}
async function ensureTurso(ctx) {
  if (!ctx.env.tursoToken || !ctx.env.tursoUrl) return;
  for (const sql of SCHEMA) {
    await batch([{ sql }]);
  }
}
async function route(request, path, url, ctx) {
  const m = path.split("?")[0];
  if (m === "/api/health" || m === "/health") {
    return ok({ ok: true, service: "community-edge", time: (/* @__PURE__ */ new Date()).toISOString() });
  }
  if (m === "/api/debug/env") {
    return ok({
      turso: !!ctx.env.tursoUrl && !!ctx.env.tursoToken,
      qiniu: !!ctx.env.qiniuAk && !!ctx.env.qiniuSk,
      resend: !!ctx.env.resendKey,
      mailFrom: ctx.env.mailFrom,
      mockEmail: ctx.env.mockEmail,
      jwtSecret: !!ctx.env.jwtSecret,
      tursoUrl: ctx.env.tursoUrl ? String(ctx.env.tursoUrl).slice(0, 40) + "\u2026" : "(empty)",
      tokenLen: String(ctx.env.tursoToken || "").length,
      envKeys: Object.keys(ctx.env || {})
    });
  }
  if (m === "/api/auth/send-code" && request.method === "POST") return handleSendCode(request, ctx);
  if (m === "/api/auth/register" && request.method === "POST") return handleRegister(request, ctx);
  if (m === "/api/auth/login" && request.method === "POST") return login(request, ctx);
  if (m === "/api/banners") return getBanners();
  if (m === "/api/channels") return getChannels();
  if (m === "/api/feed/list") return feedList(url);
  if (m === "/api/feed/posts") return feedPosts(url);
  if (m === "/api/feed/sorts") return feedSorts();
  if (m === "/api/feed/like" && request.method === "POST") return toggleFeedLike(request);
  if (m === "/api/announces") return announceList(url);
  if (m === "/api/announce/tabs") return announceTabsApi();
  if (m === "/api/search/types") return getTypes();
  if (m === "/api/search/history" && request.method === "GET") return getHistoryApi();
  if (m === "/api/search/history/delete" && request.method === "POST") return deleteHistoryApi(request);
  if (m === "/api/search/history/clear" && request.method === "POST") return clearHistoryApi();
  if (m === "/api/search/hot") return getHot();
  if (m === "/api/search/suggest") return getSuggest(url);
  if (m === "/api/search") return doSearch(url);
  if (m === "/api/article/detail") return getDetail(url);
  if (m === "/api/article/comments") return getComments(url);
  if (m === "/api/article/comment" && request.method === "POST") return addComment(request);
  if (m === "/api/article/reply" && request.method === "POST") return addReply(request);
  if (m === "/api/article/comment/like" && request.method === "POST") return toggleCommentLike(request);
  if (m === "/api/article/action" && request.method === "POST") return articleAction(request);
  if (m === "/api/article/more-actions") return getMoreActions();
  if (m === "/api/follow/authors") return getAuthors();
  if (m === "/api/follow/feeds") return getFeedsApi(url);
  if (m === "/api/follow/toggle" && request.method === "POST") return toggleFollow(request);
  if (m === "/api/message/types") return getTypes2();
  if (m === "/api/message/list") return getList();
  if (m === "/api/message/type") return getType(url);
  if (m === "/api/message/detail") return getDetail2(url);
  if (m === "/api/message/delete" && request.method === "POST") return deleteMsg(request);
  if (m === "/api/publish/types") return getTypes3();
  if (m === "/api/publish/topics") return getTopics(url);
  if (m === "/api/publish/submit" && request.method === "POST") return submit(request);
  if (m === "/api/publish/upload" && request.method === "POST") return upload(request);
  if (m === "/api/upload/image" && request.method === "POST") return uploadImage(request);
  if (m === "/api/profile/info") return profileInfo();
  if (m === "/api/profile/update" && request.method === "POST") return profileUpdate(request);
  if (m === "/api/profile/avatar" && request.method === "POST") return profileAvatar();
  if (m === "/api/profile/logout" && request.method === "POST") return profileLogout();
  if (m === "/api/profile/my-list") return myList(url);
  if (m === "/api/splash/info") return splash();
  if (m === "/api/app/exit" && request.method === "POST") return exitApp();
  return fail("\u63A5\u53E3\u4E0D\u5B58\u5728: " + m, 200);
}
var edge_default = {
  async fetch(request, context) {
    const e = readEnv(context);
    const ctx = { env: e, mockEmail: e.mockEmail, jwtSecret: e.jwtSecret };
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return handleOptions();
    try {
      if (ctx.env.tursoToken) initTurso({ url: ctx.env.tursoUrl, token: ctx.env.tursoToken });
      if (ctx.env.resendKey) initResend({ apiKey: ctx.env.resendKey, from: ctx.env.mailFrom });
      if (ctx.env.qiniuAk) initQiniu({
        accessKey: ctx.env.qiniuAk,
        secretKey: ctx.env.qiniuSk,
        bucket: ctx.env.qiniuBucket,
        region: ctx.env.qiniuRegion
      });
      await ensureTurso(ctx);
      return await route(request, url.pathname, url, ctx);
    } catch (e2) {
      console.error("[edge] error", e2);
      return fail(e2.message || "\u670D\u52A1\u5668\u5185\u90E8\u9519\u8BEF", 500);
    }
  }
};
export {
  edge_default as default
};

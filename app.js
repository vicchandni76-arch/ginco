import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_KEY, EXTRACT_FUNCTION, STORAGE_BUCKET, APP_NAME } from "./config.js";

/* ───────────────────────── setup ───────────────────────── */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $("#app");

const prefs = {};
const state = {
  session: null, user: null, business: null, memberships: [],
  suppliers: [], products: [],
  route: "home", authMode: "signin",
  review: null,            // extracted data being checked before saving
  lang: "en",               // last detected language (en / hi / pa)
  speak: prefGet("ginco_speak", "1") === "1",
  pricesQuery: "", dataTab: "suppliers",
};

// Preferences are kept in memory for this visit (works in any hosting environment).
function prefGet(k, d) { return prefs[k] ?? d; }
function prefSet(k, v) { prefs[k] = v; }

/* ───────────────────────── helpers ───────────────────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n, cur = "GBP") => n == null || n === "" || Number.isNaN(Number(n)) ? "—" : new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 4 }).format(Number(n));
const num = (n) => n == null || n === "" ? "—" : new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(Number(n));
const dateUK = (d) => d ? new Date(d + (d.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);

let toastTimer;
function toast(msg, kind = "") {
  const t = $("#toast"); t.textContent = msg; t.className = `toast ${kind}`; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), kind === "error" ? 6000 : 3200);
}
function errMsg(e) { return e?.message || e?.error_description || e?.error || (typeof e === "string" ? e : "Something went wrong"); }

function speakOut(text, lang = state.lang) {
  if (!state.speak || !("speechSynthesis" in window) || !text) return;
  try {
    speechSynthesis.cancel(); const code = { en: "en-GB", hi: "hi-IN", pa: "pa-IN" }[lang] || "en-GB";
    const u = new SpeechSynthesisUtterance(text); u.lang = code;
    const v = speechSynthesis.getVoices().find((x) => x.lang?.replace("_", "-").toLowerCase().startsWith(code.slice(0, 2)));
    if (v) u.voice = v; speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

function sheet(html, onMount) {
  const wrap = document.createElement("div"); wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  wrap.addEventListener("click", (e) => { if (e.target === wrap) wrap.remove(); });
  document.body.appendChild(wrap);
  onMount?.(wrap, () => wrap.remove());
  return wrap;
}

const I = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#1f5f3b"/><path d="M9 16.5c0-5 3.5-9.5 8.5-9.5H22v3h-4.5c-3 0-5.3 2.8-5.3 6.5S14.5 23 17.5 23H22v-5h-4v-3h7v11h-7.5C12.5 26 9 21.5 9 16.5Z" fill="#fbfaf5"/></svg>`,
  camera: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  tag: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8L3 12Z"/><circle cx="8" cy="9" r="1.5"/></svg>`,
  db: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9Z"/></svg>`,
  user: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
  box: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 7 9-4 9 4-9 4-9-4Zm0 0v10l9 4 9-4V7M12 11v10"/></svg>`,
};

/* ───────────────────────── data ───────────────────────── */
async function loadContext() {
  const { data: ms, error } = await sb.from("memberships").select("business_id, role, businesses(id, name, currency)");
  if (error) throw error;
  state.memberships = ms || [];
  const m = state.memberships[0];
  state.business = m ? { ...m.businesses, role: m.role } : null;
  if (state.business) await loadLists();
}
async function loadLists() {
  const bid = state.business.id;
  const [s, p] = await Promise.all([
    sb.from("suppliers").select("id, name, phone, email, contact_name, payment_terms_days, lead_time_days, active").eq("business_id", bid).order("name"),
    sb.from("products").select("id, name, sku, barcode, base_unit, pack_size, category, vat_rate, aliases, active, default_supplier_id").eq("business_id", bid).order("name"),
  ]);
  if (s.error) throw s.error; if (p.error) throw p.error;
  state.suppliers = s.data || []; state.products = p.data || [];
}
const supplierName = (id) => state.suppliers.find((s) => s.id === id)?.name || "Unknown supplier";
const productName = (id) => state.products.find((p) => p.id === id)?.name || "Unknown product";

/* ───────────────────────── router / shell ───────────────────────── */
const routes = ["home", "scan", "speak", "prices", "data", "account"];
function go(route) { state.route = routes.includes(route) ? route : "home"; location.hash = "#/" + state.route; render(); }
window.addEventListener("hashchange", () => { const r = location.hash.replace(/^#\/?/, "") || "home"; if (r !== state.route) { state.route = routes.includes(r) ? r : "home"; render(); } });

function shell(inner) {
  const tabs = [["home", "Home", I.home], ["scan", "Scan", I.camera], ["speak", "Speak", I.mic], ["prices", "Prices", I.tag], ["data", "Data", I.db]];
  return `
  <div class="shell">
    <header class="topbar">
      <div class="brand">${I.logo}<span>${APP_NAME}</span></div>
      <button class="btn ghost sm biz" data-go="account" title="Account">${esc(state.business?.name || "")} · ${esc(state.user?.email || "")}</button>
    </header>
    <main class="page">${inner}</main>
    <nav class="tabbar" aria-label="Main">
      ${tabs.map(([r, l, ic]) => `<button data-go="${r}" ${state.route === r ? 'aria-current="page"' : ""}>${ic}<span>${l}</span></button>`).join("")}
    </nav>
  </div>`;
}

function render() {
  if (!state.session) return renderAuth();
  if (!state.business) return renderOnboarding();
  const views = { home: viewHome, scan: viewScan, speak: viewSpeak, prices: viewPrices, data: viewData, account: viewAccount };
  app.innerHTML = shell(views[state.route]());
  $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  const mounts = { home: mountHome, scan: mountScan, speak: mountSpeak, prices: mountPrices, data: mountData, account: mountAccount };
  mounts[state.route]?.();
  window.scrollTo(0, 0);
}

/* ───────────────────────── auth ───────────────────────── */
function renderAuth() {
  const m = state.authMode;
  app.innerHTML = `
  <div class="auth"><div class="card">
    <div class="logo">${I.logo}<div><h1>${APP_NAME}</h1><p>Invoices, orders and cheapest-supplier prices</p></div></div>
    <form id="authForm" class="stack">
      <div class="field"><label for="email">Email</label><input class="input" id="email" name="email" type="email" autocomplete="email" required inputmode="email" /></div>
      ${m !== "reset" ? `<div class="field"><label for="password">Password</label><input class="input" id="password" name="password" type="password" autocomplete="${m === "signup" ? "new-password" : "current-password"}" required minlength="6" /></div>` : ""}
      <div id="authMsg"></div>
      <button class="btn primary block" type="submit">${m === "signin" ? "Sign in" : m === "signup" ? "Create account" : "Send reset link"}</button>
    </form>
    <div class="switch">
      ${m === "signin" ? `No account? <button data-mode="signup">Create one</button> · <button data-mode="reset">Forgot password</button>` : `<button data-mode="signin">Back to sign in</button>`}
    </div>
  </div></div>`;
  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => { state.authMode = b.dataset.mode; renderAuth(); }));
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const email = f.get("email").trim(); const password = f.get("password");
    const btn = $("#authForm button[type=submit]"); btn.disabled = true; const msg = $("#authMsg"); msg.innerHTML = "";
    try {
      if (m === "signin") {
        const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error;
      } else if (m === "signup") {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } }); if (error) throw error;
        if (!data.session) { msg.innerHTML = `<div class="notice success">Check your email and tap the confirmation link, then sign in.</div>`; state.authMode = "signin"; setTimeout(renderAuth, 4000); return; }
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw error;
        msg.innerHTML = `<div class="notice success">Reset link sent. Check your email.</div>`;
      }
    } catch (err) { msg.innerHTML = `<div class="notice error">${esc(errMsg(err))}</div>`; }
    finally { btn.disabled = false; }
  });
}

function renderOnboarding() {
  app.innerHTML = `
  <div class="auth"><div class="card">
    <div class="logo">${I.logo}<div><h1>Set up your business</h1><p>Signed in as ${esc(state.user.email)}</p></div></div>
    <form id="obForm" class="stack">
      <div class="field"><label for="bname">Business name</label><input class="input" id="bname" name="bname" required minlength="2" maxlength="160" placeholder="e.g. Ginco Foods" /></div>
      <div class="field"><label for="cur">Currency</label><select class="input" id="cur" name="cur"><option>GBP</option><option>EUR</option><option>USD</option><option>INR</option></select></div>
      <div id="obMsg"></div>
      <button class="btn primary block" type="submit">Create workspace</button>
      <button class="btn ghost block" type="button" id="obSignOut">Sign out</button>
    </form>
  </div></div>`;
  $("#obSignOut").addEventListener("click", () => sb.auth.signOut());
  $("#obForm").addEventListener("submit", async (e) => {
    e.preventDefault(); const f = new FormData(e.target); const msg = $("#obMsg");
    try {
      const { error } = await sb.rpc("complete_onboarding", { p_business_name: f.get("bname").trim(), p_currency: f.get("cur") }); if (error) throw error;
      await loadContext(); toast("Workspace ready", "success"); render();
    } catch (err) { msg.innerHTML = `<div class="notice error">${esc(errMsg(err))}</div>`; }
  });
}

/* ───────────────────────── home ───────────────────────── */
function viewHome() {
  return `
  <div class="page-head"><div><h1>Hello</h1><p>${esc(state.business.name)} · ${state.suppliers.length} suppliers · ${state.products.length} products</p></div></div>
  <div class="tiles">
    <button class="tile primary" data-go="scan"><span class="ico">${I.camera}</span><span><span class="title">Scan invoice</span><br/><span class="sub">Photo → checked → saved</span></span></button>
    <button class="tile" data-go="speak"><span class="ico">${I.mic}</span><span><span class="title">Speak or type</span><br/><span class="sub">“Ordered 20 kg basmati…”</span></span></button>
    <button class="tile" data-go="prices"><span class="ico">${I.tag}</span><span><span class="title">Cheapest supplier</span><br/><span class="sub">Latest price per unit</span></span></button>
    <button class="tile" data-go="data"><span class="ico">${I.db}</span><span><span class="title">Suppliers &amp; products</span><br/><span class="sub">Add or edit records</span></span></button>
  </div>
  <section style="margin-top: var(--space-8)">
    <div class="row between" style="margin-bottom: var(--space-3)"><h2>Recent activity</h2></div>
    <div id="recent" class="stack"><div class="skel"></div><div class="skel"></div><div class="skel"></div></div>
  </section>`;
}
async function mountHome() {
  const bid = state.business.id;
  const [inv, ord] = await Promise.all([
    sb.from("purchase_invoices").select("id, invoice_number, invoice_date, total_amount, currency, supplier_id, created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(5),
    sb.from("purchase_orders").select("id, order_date, status, ordered_via, supplier_id, created_at").eq("business_id", bid).order("created_at", { ascending: false }).limit(5),
  ]);
  const items = [
    ...(inv.data || []).map((r) => ({ t: r.created_at, html: `<div><div class="title">Invoice ${esc(r.invoice_number)}</div><div class="sub">${esc(supplierName(r.supplier_id))} · ${dateUK(r.invoice_date)}</div></div><span class="price">${money(r.total_amount, r.currency)}</span>` })),
    ...(ord.data || []).map((r) => ({ t: r.created_at, html: `<div><div class="title">Order · ${esc(supplierName(r.supplier_id))}</div><div class="sub">${dateUK(r.order_date)} · via ${esc(r.ordered_via || "app")}</div></div><span class="pill">${esc(r.status)}</span>` })),
  ].sort((a, b) => (a.t < b.t ? 1 : -1)).slice(0, 6);
  const el = $("#recent"); if (!el) return;
  el.innerHTML = items.length ? `<ul class="list">${items.map((i) => `<li class="list-item" style="cursor:default">${i.html}</li>`).join("")}</ul>`
    : `<div class="card empty">${I.box}<p>Nothing saved yet. Scan your first invoice or speak an order to get going.</p></div>`;
}

/* ───────────────────────── extraction ───────────────────────── */
async function extract(payload) {
  const { data, error } = await sb.functions.invoke(EXTRACT_FUNCTION, { body: { reply_language: state.lang, ...payload } });
  if (error) {
    let detail = ""; try { detail = await error.context?.json?.().then((j) => j.error || JSON.stringify(j.detail || j)) || ""; } catch { /* ignore */ }
    throw new Error(detail || errMsg(error));
  }
  if (!data?.ok) throw new Error(data?.error || "Reader returned no data");
  return data.data;
}

async function fileToResizedJpeg(file, max = 1600) {
  const bmp = await createImageBitmap(file).catch(() => null);
  const img = bmp || await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL("image/jpeg", 0.85);
  const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
  const buf = await blob.arrayBuffer();
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { dataUrl, base64: dataUrl.split(",")[1], blob, sha };
}

/* ───────────────────────── scan ───────────────────────── */
function viewScan() {
  if (state.review) return viewReview();
  return `
  <div class="page-head"><div><h1>Scan an invoice</h1><p>Take a photo or choose one. Ginco reads it and shows you the details to check.</p></div></div>
  <div class="dropzone" id="drop">
    <span class="ico" style="color: var(--color-primary)">${I.camera.replace('stroke-width="2"', 'stroke-width="1.5"').replace("<svg", '<svg width="48" height="48"')}</span>
    <p class="muted small">Invoice, delivery note or price list. JPG, PNG or HEIC.</p>
    <input id="file" type="file" accept="image/*" capture="environment" class="sr-only" />
    <div class="row wrap" style="justify-content:center">
      <label class="btn primary" for="file">${I.camera} Take photo</label>
      <button class="btn" id="pick">Choose from gallery</button>
    </div>
  </div>
  <div id="scanStage" class="stack" style="margin-top: var(--space-4)"></div>`;
}
function mountScan() {
  if (state.review) return mountReview();
  const file = $("#file"); const pick = $("#pick"); const stage = $("#scanStage");
  pick.addEventListener("click", () => { const f = document.createElement("input"); f.type = "file"; f.accept = "image/*,application/pdf"; f.onchange = () => handle(f.files[0]); f.click(); });
  file.addEventListener("change", () => handle(file.files[0]));
  async function handle(f) {
    if (!f) return;
    if (f.type === "application/pdf") { toast("PDFs aren't supported yet — please photograph the page instead.", "error"); return; }
    stage.innerHTML = `<div class="card stack"><div class="row"><div class="spinner sm"></div><span>Preparing photo…</span></div></div>`;
    try {
      const img = await fileToResizedJpeg(f);
      stage.innerHTML = `<div class="card stack"><img class="preview" src="${img.dataUrl}" alt="Invoice preview" /><div class="row"><div class="spinner sm"></div><span>Reading with AI… this takes a few seconds</span></div></div>`;
      const data = await extract({ image_base64: img.base64, mime_type: "image/jpeg" });
      state.review = normalise(data, { image: img, via: "scan" });
      state.review.reply = data.reply; render(); speakOut(data.reply || summaryLine(state.review));
    } catch (err) {
      stage.innerHTML = `<div class="notice error">${esc(errMsg(err))}</div>`;
    }
  }
}

/* ───────────────────────── speak / type ───────────────────────── */
const LANG_LABEL = { en: "English", hi: "हिन्दी", pa: "ਪੰਜਾਬੀ" };
const TTS_LANG = { en: "en-GB", hi: "hi-IN", pa: "pa-IN" };
let rec = null; // { mr, stream, chunks, timer, started }
// Live microphone is only possible where the page is allowed to use it (blocked inside some hosted previews).
function micAllowed() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return false;
  const fp = document.permissionsPolicy || document.featurePolicy;
  try { if (fp?.allowsFeature && !fp.allowsFeature("microphone")) return false; } catch { /* ignore */ }
  return true;
}
const blobToBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
// Convert any recording to 16 kHz mono WAV so Gemini always accepts it.
async function toWav(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC(); const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); ctx.close?.();
    const rate = 16000, len = Math.max(1, Math.ceil(buf.duration * rate));
    const off = new OfflineAudioContext(1, len, rate); const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2)); const w = (o, t) => [...t].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); out.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
    out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, "data"); out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    return { blob: new Blob([out], { type: "audio/wav" }), mime: "audio/wav" };
  } catch { return { blob, mime: blob.type || "audio/mpeg" }; }
}
function viewSpeak() {
  if (state.review) return viewReview();
  const live = micAllowed();
  return `
  <div class="page-head"><div><h1>Speak or type</h1><p>Say what you ordered or received in English, Hindi or Punjabi. Ginco works out the language and replies in it.</p></div></div>
  <div class="card stack">
    ${live ? `<button class="mic" id="mic" aria-label="Start recording">${I.mic}</button>`
           : `<label class="mic" for="audioFile" role="button" aria-label="Record a voice note">${I.mic}</label>`}
    <input type="file" id="audioFile" accept="audio/*,.m4a,.mp3,.wav,.ogg,.aac,.amr,.3gp,.webm" hidden />
    <p class="muted small" id="micHint" style="text-align:center">${live ? "Tap to start, tap again to stop" : "Tap, then choose your voice recorder (or a saved voice note)"}</p>
    <p class="xs muted" style="text-align:center">English · हिन्दी · ਪੰਜਾਬੀ — detected automatically</p>
    <div class="field"><label for="transcript">Or type it (any of the three languages)</label>
      <textarea class="input" id="transcript" placeholder="e.g. Ordered 20 kg basmati rice from Ali Foods at £1.20 a kilo · अली फूड्स से 20 किलो चावल मंगवाए"></textarea></div>
    <div class="form-actions"><button class="btn" id="clearT">Clear</button><button class="btn primary" id="understand">Understand</button></div>
    <div id="speakMsg"></div>
    ${live ? `<p class="xs muted" style="text-align:center"><label for="audioFile" style="text-decoration:underline;cursor:pointer">Or use your phone's recorder</label></p>` : ""}
  </div>
  <p class="muted small" style="margin-top: var(--space-4)">Examples: “Received 5 cases of sunflower oil from Bestway, batch B123, best before March”, “Bestway se 10 dabbe aam mangvaaye, £8.50 ek dabba”.</p>`;
}
function mountSpeak() {
  if (state.review) return mountReview();
  const ta = $("#transcript"); const mic = $("#mic"); const hint = $("#micHint"); const msg = $("#speakMsg");
  $("#clearT").addEventListener("click", () => (ta.value = ""));
  const busy = (t) => (msg.innerHTML = `<div class="row"><div class="spinner sm"></div><span>${esc(t)}</span></div>`);
  async function understand(payload, typed) {
    busy(payload.audio_base64 ? "Listening to your recording…" : "Understanding…");
    try {
      const data = await extract(payload);
      if (data.language && TTS_LANG[data.language]) state.lang = data.language;
      const transcript = typed || data.transcript || "";
      state.review = normalise(data, { transcript, via: "voice", language: data.language, reply: data.reply });
      render(); speakOut(data.reply || summaryLine(state.review), data.language);
    } catch (err) { msg.innerHTML = `<div class="notice error">${esc(errMsg(err))}</div>`; }
  }
  async function sendAudio(blob) {
    if (!blob || blob.size < 1000) { toast("That recording was empty. Try again."); return; }
    if (blob.size > 9_000_000) { toast("Recording is too long. Keep it under 2 minutes.", "error"); return; }
    busy("Preparing recording…");
    const { blob: wav, mime } = await toWav(blob);
    await understand({ audio_base64: await blobToBase64(wav), audio_mime: mime });
  }
  $("#audioFile").addEventListener("change", (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) sendAudio(f); });
  if (mic) mic.addEventListener("click", async () => {
    if (rec) { rec.mr.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { toast("Microphone is blocked here, so Ginco will use your phone's recorder instead.", "error"); $("#audioFile").click(); return; }
    const chunks = []; const mr = new MediaRecorder(stream);
    rec = { mr, stream, chunks, started: Date.now() };
    mr.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    mr.onstop = () => { clearInterval(rec.timer); stream.getTracks().forEach((t) => t.stop()); mic.classList.remove("live"); hint.textContent = "Tap to start, tap again to stop";
      const b = new Blob(chunks, { type: mr.mimeType || "audio/webm" }); rec = null; sendAudio(b); };
    mr.start(); mic.classList.add("live");
    rec.timer = setInterval(() => { const s = Math.round((Date.now() - rec.started) / 1000); hint.textContent = `Recording ${s}s… tap to stop`; if (s >= 120) mr.stop(); }, 500);
    hint.textContent = "Recording… tap to stop";
  });
  $("#understand").addEventListener("click", () => {
    const text = ta.value.trim(); if (!text) { toast("Say or type something first."); return; }
    understand({ text }, text);
  });
}

/* ───────────────────────── review & save ───────────────────────── */
function normalise(d, extra) {
  const kind = d.document_type === "order" ? "order" : d.document_type === "delivery_note" ? "delivery_note" : "invoice";
  const matchSupplier = state.suppliers.find((s) => s.name.toLowerCase() === (d.supplier_name || "").toLowerCase());
  const lines = (d.lines || []).map((l) => {
    const name = (l.description || "").toLowerCase();
    const prod = state.products.find((p) => p.name.toLowerCase() === name || (p.aliases || []).some((a) => a.toLowerCase() === name));
    return { id: uid(), description: l.description || "", product_id: prod?.id || "", quantity: l.quantity ?? "", unit: l.unit || prod?.base_unit || "", pack_size: l.pack_size ?? prod?.pack_size ?? "",
      unit_price: l.unit_price ?? "", vat_rate: l.vat_rate ?? "", line_total: l.line_total ?? "", batch_code: l.batch_code || "", best_before: l.best_before || "" };
  });
  if (!lines.length) lines.push(blankLine());
  return { kind, supplier_name: d.supplier_name || "", supplier_id: matchSupplier?.id || "", invoice_number: d.invoice_number || "", invoice_date: d.invoice_date || today(),
    currency: d.currency || state.business.currency || "GBP", net_amount: d.net_amount ?? "", tax_amount: d.tax_amount ?? "", total_amount: d.total_amount ?? "", notes: d.notes || "", lines, raw: d, ...extra };
}
const blankLine = () => ({ id: uid(), description: "", product_id: "", quantity: "", unit: "", pack_size: "", unit_price: "", vat_rate: "", line_total: "", batch_code: "", best_before: "" });
function summaryLine(r) {
  const k = r.kind === "order" ? "order" : r.kind === "delivery_note" ? "delivery note" : "invoice";
  return `I read a ${k} from ${r.supplier_name || "an unknown supplier"} with ${r.lines.length} line${r.lines.length === 1 ? "" : "s"}${r.total_amount ? `, total ${money(r.total_amount, r.currency)}` : ""}. Please check it and tap save.`;
}

function viewReview() {
  const r = state.review;
  const kinds = [["invoice", "Invoice"], ["delivery_note", "Delivery note"], ["order", "Order"]];
  const supplierOpts = state.suppliers.map((s) => `<option value="${esc(s.name)}"></option>`).join("");
  const productOpts = state.products.map((p) => `<option value="${esc(p.name)}"></option>`).join("");
  return `
  <div class="page-head"><div><h1>Check the details</h1><p>Fix anything the reader got wrong, then save.</p></div>
    <button class="btn ghost sm" id="discard">${I.x} Discard</button></div>
  ${r.notes ? `<div class="notice warn" style="margin-bottom: var(--space-3)">Reader note: ${esc(r.notes)}</div>` : ""}
  ${r.image ? `<img class="preview" src="${r.image.dataUrl}" alt="Scanned document" style="margin-bottom: var(--space-3); max-height: 10rem" />` : ""}
  ${r.reply ? `<div class="notice info" style="margin-bottom: var(--space-3)"><b>Ginco:</b> ${esc(r.reply)}</div>` : ""}
  ${r.transcript ? `<div class="card small" style="margin-bottom: var(--space-3)"><span class="muted">You said${r.language ? ` (${esc(LANG_LABEL[r.language] || r.language)})` : ""}:</span> “${esc(r.transcript)}”</div>` : ""}
  <form id="reviewForm" class="stack">
    <div class="subtabs" role="tablist">${kinds.map(([k, l]) => `<button type="button" role="tab" data-kind="${k}" aria-selected="${r.kind === k}">${l}</button>`).join("")}</div>
    <div class="card stack">
      <div class="field"><label for="supplier">Supplier</label><input class="input" id="supplier" name="supplier_name" list="supplierList" value="${esc(r.supplier_name)}" required placeholder="Start typing…" /><datalist id="supplierList">${supplierOpts}</datalist>
        <span class="xs muted" id="supplierHint">${r.supplier_id ? "Matches an existing supplier" : r.supplier_name ? "New supplier — will be created on save" : ""}</span></div>
      <div class="grid-2">
        <div class="field"><label for="invno">${r.kind === "order" ? "Order ref" : r.kind === "delivery_note" ? "Delivery note no." : "Invoice no."}</label><input class="input" id="invno" name="invoice_number" value="${esc(r.invoice_number)}" /></div>
        <div class="field"><label for="invdate">${r.kind === "order" ? "Order date" : "Date"}</label><input class="input" id="invdate" name="invoice_date" type="date" value="${esc(r.invoice_date)}" /></div>
      </div>
      ${r.kind === "invoice" ? `<div class="totals">
        <div class="field"><label for="net">Net</label><input class="input" name="net_amount" id="net" type="number" step="0.01" inputmode="decimal" value="${esc(r.net_amount)}" /></div>
        <div class="field"><label for="tax">VAT</label><input class="input" name="tax_amount" id="tax" type="number" step="0.01" inputmode="decimal" value="${esc(r.tax_amount)}" /></div>
        <div class="field"><label for="total">Total</label><input class="input" name="total_amount" id="total" type="number" step="0.01" inputmode="decimal" value="${esc(r.total_amount)}" /></div>
      </div>` : ""}
    </div>
    <div class="row between"><h2>Lines (${r.lines.length})</h2><button type="button" class="btn sm" id="addLine">${I.plus} Add line</button></div>
    <div class="lines" id="lines">${r.lines.map((l, i) => lineHtml(l, i, productOpts)).join("")}</div>
    <datalist id="productList">${productOpts}</datalist>
    <div class="field"><label for="notes">Notes</label><input class="input" id="notes" name="notes" placeholder="Optional" /></div>
    <div id="saveMsg"></div>
    <div class="form-actions"><button type="button" class="btn" id="discard2">Discard</button><button type="submit" class="btn primary" id="saveBtn">Save ${r.kind === "order" ? "order" : r.kind === "delivery_note" ? "goods in" : "invoice + goods in"}</button></div>
  </form>`;
}
function lineHtml(l, i) {
  const isOrder = state.review.kind === "order";
  const matched = l.product_id ? "Matched product" : l.description ? "New product — created on save" : "";
  return `<div class="line" data-id="${l.id}">
    <div class="head"><span class="pill">${i + 1}</span>
      <input class="input sm" data-f="description" list="productList" placeholder="Product / description" value="${esc(l.description)}" required />
      <button type="button" class="btn btn-icon sm ghost danger" data-del="${l.id}" aria-label="Remove line">${I.x}</button></div>
    <span class="xs muted" data-match>${matched}</span>
    <div class="grid">
      <div class="field"><label>Qty</label><input class="input sm" data-f="quantity" type="number" step="any" inputmode="decimal" value="${esc(l.quantity)}" /></div>
      <div class="field"><label>Unit</label><input class="input sm" data-f="unit" placeholder="kg, case…" value="${esc(l.unit)}" /></div>
      <div class="field"><label>Pack size</label><input class="input sm" data-f="pack_size" type="number" step="any" inputmode="decimal" placeholder="e.g. 25" value="${esc(l.pack_size)}" /></div>
      <div class="field"><label>Unit price</label><input class="input sm" data-f="unit_price" type="number" step="any" inputmode="decimal" value="${esc(l.unit_price)}" /></div>
    </div>
    ${isOrder ? "" : `<div class="grid">
      <div class="field"><label>VAT %</label><input class="input sm" data-f="vat_rate" type="number" step="any" inputmode="decimal" value="${esc(l.vat_rate)}" /></div>
      <div class="field"><label>Line total</label><input class="input sm" data-f="line_total" type="number" step="any" inputmode="decimal" value="${esc(l.line_total)}" /></div>
      <div class="field"><label>Batch</label><input class="input sm" data-f="batch_code" value="${esc(l.batch_code)}" /></div>
      <div class="field"><label>Best before</label><input class="input sm" data-f="best_before" type="date" value="${esc(l.best_before)}" /></div>
    </div>`}
  </div>`;
}
function mountReview() {
  const r = state.review;
  const discard = () => { state.review = null; render(); };
  $("#discard").addEventListener("click", discard); $("#discard2").addEventListener("click", discard);
  $$("[data-kind]").forEach((b) => b.addEventListener("click", () => { syncReview(); r.kind = b.dataset.kind; render(); }));
  $("#addLine").addEventListener("click", () => { syncReview(); r.lines.push(blankLine()); render(); setTimeout(() => $$(".line").at(-1)?.querySelector("input")?.focus(), 0); });
  $("#lines").addEventListener("click", (e) => { const del = e.target.closest("[data-del]"); if (!del) return; syncReview(); r.lines = r.lines.filter((l) => l.id !== del.dataset.del); if (!r.lines.length) r.lines.push(blankLine()); render(); });
  $("#lines").addEventListener("input", (e) => {
    if (e.target.dataset.f !== "description") return;
    const v = e.target.value.toLowerCase(); const p = state.products.find((x) => x.name.toLowerCase() === v || (x.aliases || []).some((a) => a.toLowerCase() === v));
    e.target.closest(".line").querySelector("[data-match]").textContent = p ? "Matched product" : v ? "New product — created on save" : "";
  });
  $("#supplier").addEventListener("input", (e) => { const v = e.target.value.toLowerCase(); const s = state.suppliers.find((x) => x.name.toLowerCase() === v); $("#supplierHint").textContent = s ? "Matches an existing supplier" : v ? "New supplier — will be created on save" : ""; });
  $("#reviewForm").addEventListener("submit", async (e) => {
    e.preventDefault(); syncReview();
    const btn = $("#saveBtn"); btn.disabled = true; btn.innerHTML = `<div class="spinner sm"></div> Saving…`; const msg = $("#saveMsg"); msg.innerHTML = "";
    try {
      const res = await saveReview(r);
      toast("Saved", "success"); speakOut(({ hi: "सेव हो गया।", pa: "ਸੇਵ ਹੋ ਗਿਆ।" })[r.language] || (r.kind === "order" ? "Order saved." : "Invoice saved."), r.language);
      await loadLists(); state.review = null;
      app.querySelector("main").innerHTML = `<div class="card empty" style="margin-top: var(--space-8)">
        <span style="color: var(--color-success)">${I.box}</span><h2>Saved</h2>
        <p>${r.kind === "order" ? "Order" : r.kind === "delivery_note" ? "Goods-in record" : "Invoice and goods-in record"} for <b>${esc(r.supplier_name)}</b> with ${res.lines} line${res.lines === 1 ? "" : "s"}.</p>
        <div class="row wrap" style="justify-content:center"><button class="btn primary" data-go="${r.via === "voice" ? "speak" : "scan"}">${r.via === "voice" ? "Speak another" : "Scan another"}</button><button class="btn" data-go="prices">See prices</button><button class="btn" data-go="home">Home</button></div></div>`;
      $$("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
    } catch (err) { msg.innerHTML = `<div class="notice error">${esc(errMsg(err))}</div>`; btn.disabled = false; btn.textContent = "Save"; }
  });
}
function syncReview() {
  const r = state.review; const f = $("#reviewForm"); if (!f) return;
  const fd = new FormData(f);
  for (const k of ["supplier_name", "invoice_number", "invoice_date", "net_amount", "tax_amount", "total_amount", "notes"]) if (fd.has(k)) r[k] = fd.get(k);
  r.supplier_id = state.suppliers.find((s) => s.name.toLowerCase() === (r.supplier_name || "").toLowerCase())?.id || "";
  r.lines = $$(".line").map((el) => {
    const l = r.lines.find((x) => x.id === el.dataset.id) || blankLine();
    $$("[data-f]", el).forEach((inp) => (l[inp.dataset.f] = inp.value));
    const v = (l.description || "").toLowerCase();
    l.product_id = state.products.find((x) => x.name.toLowerCase() === v || (x.aliases || []).some((a) => a.toLowerCase() === v))?.id || "";
    return l;
  });
}
async function saveReview(r) {
  const bid = state.business.id;
  const lines = r.lines.filter((l) => l.description.trim()).map((l) => ({ ...l, product_id: l.product_id || null }));
  if (!lines.length) throw new Error("Add at least one line.");
  if (r.kind === "order") {
    const { data, error } = await sb.rpc("ginco_save_order", { p: { business_id: bid, supplier_id: r.supplier_id || null, supplier_name: r.supplier_name, order_number: r.invoice_number, order_date: r.invoice_date, notes: r.notes,
      ordered_via: r.via === "voice" ? "voice" : "web", transcript: r.transcript || null, extracted: r.raw, lines } });
    if (error) throw error; return data;
  }
  let storage_path = null;
  if (r.image) {
    storage_path = `${bid}/${r.image.sha}.jpg`;
    const up = await sb.storage.from(STORAGE_BUCKET).upload(storage_path, r.image.blob, { contentType: "image/jpeg", upsert: true });
    if (up.error) { console.warn("Photo upload failed", up.error); storage_path = null; }
  }
  const { data, error } = await sb.rpc("ginco_save_goods", { p: { business_id: bid, kind: r.kind, supplier_id: r.supplier_id || null, supplier_name: r.supplier_name, invoice_number: r.invoice_number, invoice_date: r.invoice_date,
    currency: r.currency, net_amount: r.net_amount, tax_amount: r.tax_amount, total_amount: r.total_amount, notes: r.notes, via: r.via, image_sha256: r.image?.sha || null, storage_path, extracted: r.raw, lines } });
  if (error) throw error; return data;
}

/* ───────────────────────── prices ───────────────────────── */
function viewPrices() {
  return `
  <div class="page-head"><div><h1>Cheapest supplier</h1><p>Latest price per base unit from each supplier. Rank 1 is cheapest.</p></div></div>
  <div class="search" style="margin-bottom: var(--space-4)">${I.search}<input class="input" id="q" placeholder="Search a product, e.g. basmati" value="${esc(state.pricesQuery)}" /></div>
  <div id="priceList" class="stack"><div class="skel"></div><div class="skel"></div></div>`;
}
let priceRows = null;
async function mountPrices() {
  const q = $("#q"); q.addEventListener("input", () => { state.pricesQuery = q.value; drawPrices(); });
  const { data, error } = await sb.from("v_cheapest_supplier").select("*").eq("business_id", state.business.id).order("product").order("price_rank");
  if (error) { $("#priceList").innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`; return; }
  priceRows = data || []; drawPrices();
}
function drawPrices() {
  const el = $("#priceList"); if (!el || !priceRows) return;
  const q = state.pricesQuery.trim().toLowerCase();
  const groups = new Map();
  for (const r of priceRows) { if (q && !r.product.toLowerCase().includes(q) && !r.supplier.toLowerCase().includes(q)) continue; if (!groups.has(r.product_id)) groups.set(r.product_id, []); groups.get(r.product_id).push(r); }
  if (!groups.size) { el.innerHTML = `<div class="card empty">${I.box}<p>${priceRows.length ? "No products match that search." : "No prices yet. Save an invoice with prices and they'll appear here."}</p></div>`; return; }
  el.innerHTML = [...groups.values()].map((rows) => {
    const best = rows[0]; const cur = state.business.currency || "GBP";
    return `<div class="card">
      <div class="row between" style="margin-bottom: var(--space-2)"><h3>${esc(best.product)}</h3><button class="btn sm ghost" data-hist="${best.product_id}">History</button></div>
      ${rows.map((r) => `<div class="rank"><span class="n ${r.price_rank === 1 ? "best" : ""}">${r.price_rank}</span>
        <div><div>${esc(r.supplier)}</div><div class="xs muted">${dateUK(r.invoice_date)}</div></div>
        <div class="right"><div class="price">${money(r.price_per_base_unit, cur)}</div><div class="xs muted">per ${esc(r.base_unit || "unit")}</div></div></div>`).join("")}
    </div>`;
  }).join("");
  $$("[data-hist]").forEach((b) => b.addEventListener("click", () => showHistory(b.dataset.hist)));
}
async function showHistory(product_id) {
  const p = state.products.find((x) => x.id === product_id);
  const s = sheet(`<div class="row between" style="margin-bottom: var(--space-3)"><h2>${esc(p?.name || "Product")}</h2><button class="btn btn-icon sm ghost" data-close aria-label="Close">${I.x}</button></div><div id="hist"><div class="skel"></div></div>`,
    (w, close) => $("[data-close]", w).addEventListener("click", close));
  const { data, error } = await sb.from("v_price_history").select("*").eq("business_id", state.business.id).eq("product_id", product_id).order("invoice_date", { ascending: false }).limit(50);
  const el = $("#hist", s); const cur = state.business.currency || "GBP";
  if (error) { el.innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`; return; }
  el.innerHTML = data.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Supplier</th><th>Invoice</th><th class="num">Pack price</th><th class="num">Per ${esc(p?.base_unit || "unit")}</th></tr></thead>
    <tbody>${data.map((r) => `<tr><td>${dateUK(r.invoice_date)}</td><td>${esc(supplierName(r.supplier_id))}</td><td class="muted">${esc(r.invoice_number)}</td><td class="num">${money(r.unit_price, cur)}</td><td class="num price">${money(r.price_per_base_unit, cur)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="muted">No price history yet.</p>`;
}

/* ───────────────────────── data ───────────────────────── */
function viewData() {
  const tabs = [["suppliers", "Suppliers"], ["products", "Products"], ["invoices", "Invoices"], ["orders", "Orders"]];
  return `
  <div class="page-head"><div><h1>Your data</h1><p>Everything Ginco has stored for ${esc(state.business.name)}.</p></div>
    <button class="btn primary sm" id="addBtn" ${["invoices", "orders"].includes(state.dataTab) ? "hidden" : ""}>${I.plus} Add</button></div>
  <div class="subtabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.dataTab === k}">${l}</button>`).join("")}</div>
  <div id="dataList" class="stack"><div class="skel"></div><div class="skel"></div></div>`;
}
async function mountData() {
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => { state.dataTab = b.dataset.tab; render(); }));
  $("#addBtn")?.addEventListener("click", () => (state.dataTab === "suppliers" ? supplierForm() : productForm()));
  const el = $("#dataList"); const bid = state.business.id; const cur = state.business.currency || "GBP";
  if (state.dataTab === "suppliers") {
    el.innerHTML = state.suppliers.length ? `<ul class="list">${state.suppliers.map((s) => `<li><button class="list-item" data-edit="${s.id}"><div><div class="title">${esc(s.name)}</div><div class="sub">${esc([s.contact_name, s.phone, s.email].filter(Boolean).join(" · ") || "No contact details")}</div></div>${s.active ? "" : '<span class="pill">inactive</span>'}</button></li>`).join("")}</ul>`
      : `<div class="card empty">${I.box}<p>No suppliers yet. Add one, or scan an invoice and Ginco will create it.</p></div>`;
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => supplierForm(state.suppliers.find((s) => s.id === b.dataset.edit))));
  } else if (state.dataTab === "products") {
    el.innerHTML = state.products.length ? `<ul class="list">${state.products.map((p) => `<li><button class="list-item" data-edit="${p.id}"><div><div class="title">${esc(p.name)}</div><div class="sub">${esc([p.category, p.base_unit && `per ${p.base_unit}`, p.pack_size && `pack ${num(p.pack_size)}`, p.sku].filter(Boolean).join(" · ") || "No details")}</div></div>${p.active ? "" : '<span class="pill">inactive</span>'}</button></li>`).join("")}</ul>`
      : `<div class="card empty">${I.box}<p>No products yet. Add one, or scan an invoice and Ginco will create them.</p></div>`;
    $$("[data-edit]").forEach((b) => b.addEventListener("click", () => productForm(state.products.find((p) => p.id === b.dataset.edit))));
  } else if (state.dataTab === "invoices") {
    const { data, error } = await sb.from("purchase_invoices").select("id, invoice_number, invoice_date, total_amount, net_amount, currency, status, supplier_id").eq("business_id", bid).order("invoice_date", { ascending: false, nullsFirst: false }).limit(100);
    if (error) return (el.innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`);
    el.innerHTML = data.length ? `<ul class="list">${data.map((r) => `<li><button class="list-item" data-inv="${r.id}"><div><div class="title">${esc(r.invoice_number)}</div><div class="sub">${esc(supplierName(r.supplier_id))} · ${dateUK(r.invoice_date)}</div></div><span class="price">${money(r.total_amount ?? r.net_amount, r.currency || cur)}</span></button></li>`).join("")}</ul>`
      : `<div class="card empty">${I.box}<p>No invoices saved yet.</p></div>`;
    $$("[data-inv]").forEach((b) => b.addEventListener("click", () => showInvoice(b.dataset.inv)));
  } else {
    const { data, error } = await sb.from("purchase_orders").select("id, order_number, order_date, expected_date, status, ordered_via, supplier_id, notes").eq("business_id", bid).order("order_date", { ascending: false }).limit(100);
    if (error) return (el.innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`);
    el.innerHTML = data.length ? `<ul class="list">${data.map((r) => `<li><button class="list-item" data-ord="${r.id}"><div><div class="title">${esc(supplierName(r.supplier_id))}</div><div class="sub">${dateUK(r.order_date)}${r.order_number ? ` · ${esc(r.order_number)}` : ""} · via ${esc(r.ordered_via || "app")}</div></div><span class="pill ${r.status === "received" ? "best" : r.status === "cancelled" ? "err" : "primary"}">${esc(r.status.replace("_", " "))}</span></button></li>`).join("")}</ul>`
      : `<div class="card empty">${I.box}<p>No orders yet. Speak one on the Speak tab.</p></div>`;
    $$("[data-ord]").forEach((b) => b.addEventListener("click", () => showOrder(b.dataset.ord)));
  }
}

function supplierForm(s = null) {
  const v = (k) => esc(s?.[k] ?? "");
  sheet(`<div class="row between" style="margin-bottom: var(--space-3)"><h2>${s ? "Edit supplier" : "New supplier"}</h2><button class="btn btn-icon sm ghost" data-close aria-label="Close">${I.x}</button></div>
  <form class="stack" id="sf">
    <div class="field"><label>Name</label><input class="input" name="name" required value="${v("name")}" /></div>
    <div class="grid-2"><div class="field"><label>Contact name</label><input class="input" name="contact_name" value="${v("contact_name")}" /></div><div class="field"><label>Phone</label><input class="input" name="phone" type="tel" value="${v("phone")}" /></div></div>
    <div class="field"><label>Email</label><input class="input" name="email" type="email" value="${v("email")}" /></div>
    <div class="grid-2"><div class="field"><label>Payment terms (days)</label><input class="input" name="payment_terms_days" type="number" inputmode="numeric" value="${v("payment_terms_days")}" /></div><div class="field"><label>Lead time (days)</label><input class="input" name="lead_time_days" type="number" inputmode="numeric" value="${v("lead_time_days")}" /></div></div>
    ${s ? `<label class="row small"><input type="checkbox" name="active" ${s.active ? "checked" : ""}/> Active</label>` : ""}
    <div id="sfMsg"></div><div class="form-actions"><button type="submit" class="btn primary">Save</button></div></form>`,
  (w, close) => {
    $("[data-close]", w).addEventListener("click", close);
    $("#sf", w).addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target);
      const row = { business_id: state.business.id, name: fd.get("name").trim(), contact_name: fd.get("contact_name") || null, phone: fd.get("phone") || null, email: fd.get("email") || null,
        payment_terms_days: fd.get("payment_terms_days") ? Number(fd.get("payment_terms_days")) : null, lead_time_days: fd.get("lead_time_days") ? Number(fd.get("lead_time_days")) : null };
      if (s) row.active = fd.get("active") === "on";
      const q = s ? sb.from("suppliers").update(row).eq("id", s.id) : sb.from("suppliers").insert(row);
      const { error } = await q;
      if (error) return ($("#sfMsg", w).innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`);
      await loadLists(); close(); toast("Supplier saved", "success"); render();
    });
  });
}
function productForm(p = null) {
  const v = (k) => esc(p?.[k] ?? "");
  sheet(`<div class="row between" style="margin-bottom: var(--space-3)"><h2>${p ? "Edit product" : "New product"}</h2><button class="btn btn-icon sm ghost" data-close aria-label="Close">${I.x}</button></div>
  <form class="stack" id="pf">
    <div class="field"><label>Name</label><input class="input" name="name" required value="${v("name")}" /></div>
    <div class="grid-2"><div class="field"><label>Category</label><input class="input" name="category" value="${v("category")}" placeholder="Rice, Oils…" /></div><div class="field"><label>Base unit</label><input class="input" name="base_unit" value="${v("base_unit")}" placeholder="kg, l, each" /></div></div>
    <div class="grid-2"><div class="field"><label>Pack size (base units per pack)</label><input class="input" name="pack_size" type="number" step="any" inputmode="decimal" value="${v("pack_size")}" /></div><div class="field"><label>VAT %</label><input class="input" name="vat_rate" type="number" step="any" inputmode="decimal" value="${v("vat_rate")}" /></div></div>
    <div class="grid-2"><div class="field"><label>SKU</label><input class="input" name="sku" value="${v("sku")}" /></div><div class="field"><label>Barcode</label><input class="input" name="barcode" inputmode="numeric" value="${v("barcode")}" /></div></div>
    <div class="field"><label>Other names (comma separated)</label><input class="input" name="aliases" value="${esc((p?.aliases || []).join(", "))}" placeholder="How suppliers write it on invoices" /></div>
    <div class="field"><label>Default supplier</label><select class="input" name="default_supplier_id"><option value="">—</option>${state.suppliers.map((s) => `<option value="${s.id}" ${p?.default_supplier_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="grid-2"><div class="field"><label>Allergens</label><input class="input" name="allergens" value="${v("allergens")}" /></div><div class="field"><label>Minimum stock</label><input class="input" name="min_stock" type="number" step="any" inputmode="decimal" value="${v("min_stock")}" /></div></div>
    ${p ? `<label class="row small"><input type="checkbox" name="active" ${p.active ? "checked" : ""}/> Active</label>` : ""}
    <div id="pfMsg"></div><div class="form-actions"><button type="submit" class="btn primary">Save</button></div></form>`,
  (w, close) => {
    $("[data-close]", w).addEventListener("click", close);
    $("#pf", w).addEventListener("submit", async (e) => {
      e.preventDefault(); const fd = new FormData(e.target); const n = (k) => (fd.get(k) ? Number(fd.get(k)) : null);
      const row = { business_id: state.business.id, name: fd.get("name").trim(), category: fd.get("category") || null, base_unit: fd.get("base_unit") || null, pack_size: n("pack_size"), vat_rate: n("vat_rate") ?? 0,
        sku: fd.get("sku") || null, barcode: fd.get("barcode") || null, aliases: String(fd.get("aliases") || "").split(",").map((x) => x.trim()).filter(Boolean), default_supplier_id: fd.get("default_supplier_id") || null,
        allergens: fd.get("allergens") || null, min_stock: n("min_stock") };
      if (p) row.active = fd.get("active") === "on";
      const q = p ? sb.from("products").update(row).eq("id", p.id) : sb.from("products").insert(row);
      const { error } = await q;
      if (error) return ($("#pfMsg", w).innerHTML = `<div class="notice error">${esc(errMsg(error))}</div>`);
      await loadLists(); close(); toast("Product saved", "success"); render();
    });
  });
}
async function showInvoice(id) {
  const s = sheet(`<div id="iv"><div class="skel"></div></div>`);
  const [{ data: inv }, { data: lines }] = await Promise.all([
    sb.from("purchase_invoices").select("*").eq("id", id).single(),
    sb.from("purchase_invoice_lines").select("*").eq("invoice_id", id).order("line_number"),
  ]);
  const cur = inv?.currency || "GBP";
  $("#iv", s).innerHTML = `<div class="row between" style="margin-bottom: var(--space-3)"><div><h2>Invoice ${esc(inv.invoice_number)}</h2><p class="muted small">${esc(supplierName(inv.supplier_id))} · ${dateUK(inv.invoice_date)} · <span class="pill">${esc(inv.status)}</span></p></div><button class="btn btn-icon sm ghost" data-close aria-label="Close">${I.x}</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Total</th></tr></thead>
    <tbody>${(lines || []).map((l) => `<tr><td class="muted">${l.line_number}</td><td>${esc(l.original_description)}${l.product_id ? `<div class="xs muted">${esc(productName(l.product_id))}</div>` : ""}</td><td class="num">${num(l.quantity)} ${esc(l.unit || "")}</td><td class="num">${money(l.unit_price, cur)}</td><td class="num">${money(l.line_total, cur)}</td></tr>`).join("")}</tbody></table></div>
    <div class="totals" style="margin-top: var(--space-4)"><div><div class="xs muted">Net</div><div class="price">${money(inv.net_amount, cur)}</div></div><div><div class="xs muted">VAT</div><div class="price">${money(inv.tax_amount, cur)}</div></div><div><div class="xs muted">Total</div><div class="price">${money(inv.total_amount, cur)}</div></div></div>`;
  $("[data-close]", s).addEventListener("click", () => s.remove());
}
async function showOrder(id) {
  const s = sheet(`<div id="ov"><div class="skel"></div></div>`);
  const [{ data: o }, { data: lines }] = await Promise.all([
    sb.from("purchase_orders").select("*").eq("id", id).single(),
    sb.from("purchase_order_lines").select("*").eq("order_id", id).order("line_number"),
  ]);
  const cur = state.business.currency || "GBP";
  const statuses = ["draft", "ordered", "part_received", "received", "cancelled"];
  $("#ov", s).innerHTML = `<div class="row between" style="margin-bottom: var(--space-3)"><div><h2>Order · ${esc(supplierName(o.supplier_id))}</h2><p class="muted small">${dateUK(o.order_date)}${o.expected_date ? ` · expected ${dateUK(o.expected_date)}` : ""} · via ${esc(o.ordered_via || "app")}</p></div><button class="btn btn-icon sm ghost" data-close aria-label="Close">${I.x}</button></div>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Agreed price</th></tr></thead>
    <tbody>${(lines || []).map((l) => `<tr><td class="muted">${l.line_number}</td><td>${esc(l.description)}</td><td class="num">${num(l.qty_ordered)} ${esc(l.unit || "")}</td><td class="num">${money(l.agreed_unit_price, cur)}</td></tr>`).join("")}</tbody></table></div>
    ${o.notes ? `<p class="small muted" style="margin-top: var(--space-3)">${esc(o.notes)}</p>` : ""}
    <div class="field" style="margin-top: var(--space-4)"><label for="ost">Status</label><select class="input" id="ost">${statuses.map((x) => `<option value="${x}" ${o.status === x ? "selected" : ""}>${x.replace("_", " ")}</option>`).join("")}</select></div>`;
  $("[data-close]", s).addEventListener("click", () => s.remove());
  $("#ost", s).addEventListener("change", async (e) => {
    const { error } = await sb.from("purchase_orders").update({ status: e.target.value }).eq("id", id);
    if (error) toast(errMsg(error), "error"); else { toast("Order updated", "success"); render(); }
  });
}

/* ───────────────────────── account ───────────────────────── */
function viewAccount() {
  return `
  <div class="page-head"><div><h1>Account</h1><p>${esc(state.user.email)}</p></div></div>
  <div class="card stack">
    <div class="row between"><div><div class="xs muted">Business</div><div><b>${esc(state.business.name)}</b> · ${esc(state.business.currency)}</div></div><span class="pill primary">${esc(state.business.role)}</span></div>
    <div class="row between"><div><div class="xs muted">Spoken replies</div><div class="small muted">Ginco reads results aloud after scanning or listening</div></div><input type="checkbox" id="speakToggle" ${state.speak ? "checked" : ""} style="width:1.4rem;height:1.4rem"/></div>
    <div class="row between"><div><div class="xs muted">Voice language</div><div class="small muted">Detected automatically: English, हिन्दी or ਪੰਜਾਬੀ. Ginco replies in the language you used.</div></div></div>
  </div>
  <div class="card stack" style="margin-top: var(--space-3)">
    <h3>Tip: add Ginco to your home screen</h3>
    <p class="small muted">In Chrome on Android, open the menu and choose “Add to Home screen”. On iPhone, tap Share then “Add to Home Screen”. It then opens like an app.</p>
  </div>
  <div style="margin-top: var(--space-6)"><button class="btn block danger" id="signOut">Sign out</button></div>`;
}
function mountAccount() {
  $("#speakToggle").addEventListener("change", (e) => { state.speak = e.target.checked; prefSet("ginco_speak", state.speak ? "1" : "0"); });
  $("#signOut").addEventListener("click", () => sb.auth.signOut());
}

/* ───────────────────────── boot ───────────────────────── */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  await onSession(session);
  sb.auth.onAuthStateChange((_evt, s) => { if ((s?.user?.id || null) !== (state.session?.user?.id || null)) onSession(s); else state.session = s; });
}
async function onSession(session) {
  state.session = session; state.user = session?.user || null; state.business = null; state.review = null;
  if (session) {
    try { await loadContext(); } catch (e) { toast(errMsg(e), "error"); }
    const r = location.hash.replace(/^#\/?/, ""); state.route = routes.includes(r) ? r : "home";
  }
  render();
}
boot().catch((e) => { app.innerHTML = `<div class="auth"><div class="card"><div class="notice error">${esc(errMsg(e))}</div></div></div>`; });

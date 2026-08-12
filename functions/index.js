import {
    GALLERY_HTML,
    buildDetailHtml,
    buildEditHtml,
    canManageScript,
    getAllScriptSummaries,
    getRobloxGameInfo,
    getScript,
    handleScriptsApi,
    prepareScriptForPage,
    recordScriptView
} from "./scripts.js";

function sanitizeText(value, maxLen) { if (typeof value !== "string") return ""; return value.trim().slice(0, maxLen); }
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function safeJsonForHtml(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}
async function readJson(request, maxBytes = 35000) {
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length && length > maxBytes) throw new Error("BODY_TOO_LARGE");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("BODY_TOO_LARGE");
    return JSON.parse(text);
}
async function rateLimit(request, env, name, limit, windowSeconds) {
    if (!env.SCRIPTS_KV) return true;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rate:${name}:${ip}:${bucket}`;
    const raw = await env.SCRIPTS_KV.get(key);
    const count = raw ? Number(raw) : 0;
    if (count >= limit) return false;
    await env.SCRIPTS_KV.put(key, String(count + 1), { expirationTtl: windowSeconds + 30 });
    return true;
}
function sanitizeTags(input) {
    if (!input) return [];
    let arr;
    if (Array.isArray(input)) arr = input;
    else if (typeof input === "string") arr = input.split(",");
    else return [];
    return arr.map((t) => String(t).trim().toUpperCase().replace(/[\[\]]/g, "")).filter((t) => t.length > 0 && t.length <= 24).slice(0, 10);
}
function renderCodeWithLineNumbers(code) {
    const lines = code.split("\n");
    return lines.map((line, i) => {
        const num = String(i + 1).padStart(3, " ");
        return `<span class="code-line"><span class="ln">${num}</span><span class="lt">${escapeHtml(line) || " "}</span></span>`;
    }).join("\n");
}

function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const out = {};
    header.split(";").forEach((part) => { const [k, ...v] = part.trim().split("="); if (k) out[k] = decodeURIComponent(v.join("=")); });
    return out;
}
async function getSession(request, env) {
    const cookies = parseCookies(request);
    const sid = cookies.session;
    if (!sid) return null;
    const raw = await env.SESSIONS_KV.get(`session:${sid}`);
    if (!raw) return null;
    return JSON.parse(raw);
}
function isAdminEmail(env, email) {
    if (!email) return false;
    const configured = [env.ADMIN_EMAILS || "", env.ADMIN_EMAIL || ""].join(",");
    const list = configured.split(/[,\s;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(String(email).trim().toLowerCase());
}
async function sendDiscordWebhook(env, { title, gameName, link, tags, username }) {
    if (!env.DISCORD_WEBHOOK_URL) return;
    const lines = [
        `**New script uploaded** by **${username || "anonymous"}**`,
        gameName ? `For game: **${gameName}**` : null,
        `Title: ${title}`, link,
        tags && tags.length ? `Tags: ${tags.map((t) => `\`${t}\``).join(" ")}` : null,
    ].filter(Boolean);
    try { await fetch(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: lines.join("\n") }) }); } catch (err) { }
}

/* ─────────────────── FAVICON SVG ─────────────────── */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0d0f14"/>
  <!-- camel silhouette -->
  <g fill="#d4a574">
    <!-- body -->
    <ellipse cx="30" cy="42" rx="16" ry="10"/>
    <!-- hump -->
    <ellipse cx="24" cy="33" rx="7" ry="8"/>
    <!-- head -->
    <ellipse cx="44" cy="34" rx="6" ry="5"/>
    <!-- neck -->
    <path d="M38 34 Q36 40 30 42" stroke="#d4a574" stroke-width="5" fill="none" stroke-linecap="round"/>
    <!-- snout -->
    <ellipse cx="49" cy="36" rx="3.5" ry="2.5"/>
    <!-- legs -->
    <rect x="18" y="50" width="4" height="10" rx="2"/>
    <rect x="26" y="51" width="4" height="9" rx="2"/>
    <rect x="33" y="50" width="4" height="10" rx="2"/>
    <rect x="39" y="51" width="4" height="9" rx="2"/>
    <!-- eye -->
    <circle cx="46" cy="32.5" r="1.2" fill="#0d0f14"/>
    <!-- ear -->
    <ellipse cx="41" cy="30" rx="2" ry="3" transform="rotate(-20 41 30)"/>
  </g>
  <!-- small star accent -->
  <circle cx="14" cy="14" r="2" fill="#d4a574" opacity="0.7"/>
  <circle cx="52" cy="18" r="1.5" fill="#d4a574" opacity="0.5"/>
  <circle cx="10" cy="30" r="1" fill="#d4a574" opacity="0.4"/>
</svg>`;

/* ─────────────────── SHARED CSS & HEAD SNIPPETS ─────────────────── */
const SHARED_HEAD = (title, desc, canonical, ogImage = "https://dakait.online/og-image.png") => `
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<link rel="canonical" href="${escapeHtml(canonical)}"/>
<meta name="robots" content="index, follow"/>
<meta name="keywords" content="roblox scripts, free roblox scripts, roblox executor scripts, keyless roblox scripts, blox fruits script, grow a garden script, rivals script, lumber tycoon script, dakait"/>

<!-- Open Graph (Discord / WhatsApp / Facebook previews) -->
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:url" content="${escapeHtml(canonical)}"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:site_name" content="Silk Road Script Hub — dakait.online"/>

<!-- Twitter card -->
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>

<!-- Favicon -->
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="/favicon.svg"/>
`;

/* ─────────────────── HOME PAGE ─────────────────── */
const SILK_ROAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Silk Road Script Hub — Free Roblox Scripts | dakait.online",
    "Browse and download free Roblox scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon and more. Keyless scripts updated daily.",
    "https://dakait.online"
)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap"/>
<style>
  :root{ --night:#1a1f2e; --ink:#0d0f14; --sand:#d4a574; --parchment:#e8dcc8; --vermilion:#c1502e; --green:#5fbf7a; }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ scroll-behavior:smooth; }
  body{ background:var(--ink); background-image: radial-gradient(ellipse at 20% 0%, rgba(212,165,116,0.08), transparent 60%), radial-gradient(ellipse at 80% 30%, rgba(193,80,46,0.06), transparent 60%); color:var(--parchment); font-family:'JetBrains Mono',monospace; min-height:100vh; padding:8vh 6vw 6vh; display:flex; justify-content:center; }
  .manifest{ max-width:760px; width:100%; position:relative; z-index:1; }

  .route-line{ display:flex; align-items:center; gap:10px; margin-bottom:2.2rem; color:var(--sand); font-size:0.72rem; letter-spacing:0.18em; text-transform:uppercase; opacity:0.75; }
  .route-line::before,.route-line::after{ content:""; flex:1; height:1px; background:linear-gradient(90deg,transparent,var(--sand),transparent); opacity:0.4; }

  h1{ font-family:'Fraunces',serif; font-weight:600; font-size:clamp(2.6rem,7vw,4.4rem); line-height:1.02; letter-spacing:-0.01em; }
  h1 em{ font-style:italic; color:var(--sand); }
  .tagline{ margin-top:1.1rem; font-size:0.95rem; opacity:0.62; max-width:50ch; line-height:1.6; min-height:1.6em; }

  .stat-bar{ margin-top:1.4rem; display:flex; gap:1.4rem; flex-wrap:wrap; }
  .stat{ display:flex; flex-direction:column; }
  .stat-num{ font-family:'Fraunces',serif; font-size:2rem; color:var(--sand); line-height:1; }
  .stat-label{ font-size:0.65rem; letter-spacing:0.15em; text-transform:uppercase; opacity:0.55; margin-top:2px; }

  .seal-row{ margin-top:2.6rem; display:flex; flex-wrap:wrap; align-items:center; gap:0.9rem; }
  .seal{ display:inline-flex; align-items:center; gap:0.7rem; padding:0.85rem 1.3rem; border:1px solid rgba(212,165,116,0.35); border-radius:999px; background:rgba(212,165,116,0.05); }
  .dot{ width:8px; height:8px; border-radius:50%; background:var(--green); animation:pulse 2.2s infinite; }
  @keyframes pulse{ 0%{box-shadow:0 0 0 0 rgba(95,191,122,0.55)} 70%{box-shadow:0 0 0 8px rgba(95,191,122,0)} 100%{box-shadow:0 0 0 0 rgba(95,191,122,0)} }
  .seal-text{ font-size:0.74rem; letter-spacing:0.12em; text-transform:uppercase; opacity:0.85; }
  .seal-text b{ color:var(--green); font-weight:500; }

  .btn{ appearance:none; border:1px solid rgba(193,80,46,0.5); background:rgba(193,80,46,0.1); color:var(--parchment); font-family:'JetBrains Mono',monospace; font-size:0.72rem; letter-spacing:0.1em; text-transform:uppercase; padding:0.85rem 1.4rem; border-radius:999px; cursor:pointer; transition:background 0.2s, border-color 0.2s, transform 0.15s; display:inline-flex; align-items:center; gap:0.5rem; text-decoration:none; }
  .btn:hover{ background:rgba(193,80,46,0.22); border-color:var(--vermilion); }
  .btn:active{ transform:scale(0.97); }
  .btn.primary{ background:rgba(95,191,122,0.12); border-color:rgba(95,191,122,0.45); }
  .btn.primary:hover{ background:rgba(95,191,122,0.22); border-color:var(--green); }
  .btn.gold{ background:rgba(212,165,116,0.12); border-color:rgba(212,165,116,0.45); }
  .btn.gold:hover{ background:rgba(212,165,116,0.22); border-color:var(--sand); }
  .arrow{ transition:transform 0.25s; font-size:0.85em; }
  .info-btn.open .arrow{ transform:rotate(90deg); }

  .info-panel{ max-height:0; overflow:hidden; transition:max-height 0.45s ease; }
  .info-panel.open{ max-height:900px; }
  .info-inner{ margin-top:1.8rem; padding:1.6rem 1.8rem; border:1px solid rgba(212,165,116,0.18); border-radius:10px; background:rgba(232,220,200,0.03); font-size:0.85rem; line-height:1.75; opacity:0.85; }
  .info-inner p{ margin-bottom:1rem; }
  .info-inner p:last-child{ margin-bottom:0; }

  /* Caravan route animation */
  .caravan-track{ margin:2.8rem 0 0; position:relative; height:28px; }
  .track-line{ position:absolute; top:50%; left:0; right:0; height:1px; background:linear-gradient(90deg,transparent,rgba(212,165,116,0.3),rgba(212,165,116,0.6),rgba(212,165,116,0.3),transparent); transform:translateY(-50%); }
  .track-dot{ position:absolute; top:50%; width:6px; height:6px; border-radius:50%; background:var(--sand); transform:translate(-50%,-50%); animation:caravanMove 6s ease-in-out infinite; }
  .track-dot:nth-child(2){ animation-delay:1.5s; opacity:0.7; width:5px; height:5px; }
  .track-dot:nth-child(3){ animation-delay:3s; opacity:0.5; width:4px; height:4px; }
  @keyframes caravanMove{ 0%{left:0%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:100%;opacity:0} }

  section{ margin-top:3.4rem; }
  .ledger{ border-top:1px solid rgba(212,165,116,0.18); padding-top:1.8rem; }
  .ledger-label{ font-size:0.66rem; letter-spacing:0.18em; text-transform:uppercase; color:var(--vermilion); opacity:0.85; margin-bottom:1.1rem; }

  .crew{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:1.2rem; }
  .crew-card{ border:1px solid rgba(212,165,116,0.18); border-radius:10px; padding:1.4rem 1.6rem; background:rgba(232,220,200,0.02); transition:transform 0.3s, border-color 0.3s, background 0.3s; }
  .crew-card:hover{ transform:translateY(-3px); border-color:rgba(212,165,116,0.4); background:rgba(232,220,200,0.04); }
  .crew-name{ font-family:'Fraunces',serif; font-size:1.25rem; color:var(--sand); margin-bottom:0.3rem; }
  .crew-role{ font-size:0.68rem; letter-spacing:0.1em; text-transform:uppercase; opacity:0.55; margin-bottom:0.8rem; }
  .crew-desc{ font-size:0.82rem; opacity:0.75; line-height:1.6; }

  .quote-block{ border-left:2px solid var(--vermilion); padding-left:1.4rem; font-family:'Fraunces',serif; font-style:italic; font-size:1.15rem; opacity:0.85; line-height:1.55; }
  .quote-attr{ margin-top:0.8rem; font-family:'JetBrains Mono',monospace; font-style:normal; font-size:0.7rem; letter-spacing:0.1em; text-transform:uppercase; opacity:0.5; }

  footer{ margin-top:3.5rem; padding-top:1.5rem; border-top:1px solid rgba(212,165,116,0.1); font-size:0.7rem; opacity:0.4; letter-spacing:0.05em; display:flex; justify-content:space-between; flex-wrap:wrap; gap:0.5rem; }
  a{ color:var(--sand); }

  @keyframes fadeUp{ from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  .load-in{ opacity:0; animation:fadeUp 0.9s cubic-bezier(0.16,1,0.3,1) forwards; }
  .load-in.d1{ animation-delay:0.05s; }
  .load-in.d2{ animation-delay:0.2s; }
  .load-in.d3{ animation-delay:0.35s; }
  .load-in.d4{ animation-delay:0.5s; }
  .reveal{ opacity:0; transform:translateY(18px); transition:opacity 0.8s cubic-bezier(0.16,1,0.3,1), transform 0.8s cubic-bezier(0.16,1,0.3,1); }
  .reveal.in-view{ opacity:1; transform:translateY(0); }

  #dust{ position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:0; opacity:0.5; }
  @media(prefers-reduced-motion:reduce){ .dot,.track-dot{animation:none} html{scroll-behavior:auto} .load-in,.reveal{animation:none !important;opacity:1 !important;transform:none !important;transition:none !important} #dust{display:none} }
</style>
</head>
<body>
<canvas id="dust"></canvas>
<main class="manifest">
  <div class="route-line load-in d1">Silk Road Script Hub — dakait.online</div>

  <h1 class="load-in d2">The <em>Silk Road</em><br>Script Hub</h1>
  <p class="tagline load-in d2" id="typewriterText"></p>

  <div class="stat-bar load-in d3">
    <div class="stat">
      <span class="stat-num" id="scriptCount">—</span>
      <span class="stat-label">Scripts dropped</span>
    </div>
    <div class="stat">
      <span class="stat-num">Free</span>
      <span class="stat-label">Always</span>
    </div>
    <div class="stat">
      <span class="stat-num">∞</span>
      <span class="stat-label">Games covered</span>
    </div>
  </div>

  <div class="caravan-track load-in d3">
    <div class="track-line"></div>
    <div class="track-dot"></div>
    <div class="track-dot"></div>
    <div class="track-dot"></div>
  </div>

  <div class="seal-row load-in d3">
    <div class="seal"><span class="dot"></span><span class="seal-text">Route: <b>open</b></span></div>
    <button class="btn info-btn" id="infoToggle" onclick="toggleInfo()">
      <span>More about this route</span><span class="arrow">›</span>
    </button>
  </div>

  <div class="seal-row load-in d4">
    <a class="btn primary" href="/scripts">Explore Scripts</a>
    <a class="btn gold" href="/upload-scripts">Upload Script</a>
  </div>
  <div class="seal-row load-in d4" id="accountRow"></div>

  <div class="info-panel" id="infoPanel">
    <div class="info-inner">
      <p>Silk Road is a free Roblox script hub — find scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon 2, and more. Every script is uploaded by the community, keyless where possible, and browsable without an account.</p>
      <p>We're built on Cloudflare Workers, so the site is fast from anywhere. Sign in with Google to upload and manage your own scripts. No bloat, no paywalls.</p>
      <p>Built by <a href="https://dakait.online">Dakait Shah &amp; Dakait Guri</a>.</p>
    </div>
  </div>

  <section class="ledger reveal">
    <div class="ledger-label">Caravan Leadership</div>
    <div class="crew">
      <div class="crew-card">
        <div class="crew-name">Dakait Shah</div>
        <div class="crew-role">Route Operator</div>
        <div class="crew-desc">Builds and runs the trade route end to end — the API, the game's server logic, and everything that keeps the ledger honest.</div>
      </div>
      <div class="crew-card">
        <div class="crew-name">Dakait Guri</div>
        <div class="crew-role">Co-Conspirator</div>
        <div class="crew-desc">Rides alongside the route — shaping the world the caravan moves through and keeping watch over the checkpoints.</div>
      </div>
    </div>
  </section>

  <section class="reveal">
    <div class="quote-block">
      "A route is only as trustworthy as the hands that guard its checkpoints."
      <div class="quote-attr">— Silk Road Charter</div>
    </div>
  </section>

  <!-- AD CONTAINER -->
  <div style="margin-top:2.5rem; text-align:center;">
    <script async="async" data-cfasync="false" src="https://pl30819137.effectivecpmnetwork.com/9f9a081fb4df321e6c86f26cc58c6192/invoke.js"></script>
    <div id="container-9f9a081fb4df321e6c86f26cc58c6192"></div>
  </div>

  <footer class="reveal">
    <span>dakait.online</span>
    <span>operated by Dakait Shah &amp; Dakait Guri</span>
  </footer>
</main>

<script>
  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]);}

  // Typewriter
  const phrases = [
    "Blox Fruits, Grow a Garden, Rivals — all here.",
    "Free Roblox scripts. No keys. No paywalls.",
    "Drop a script. Take a script. Community built.",
  ];
  let pi = 0, ci = 0, deleting = false;
  const tw = document.getElementById("typewriterText");
  function typeStep() {
    const phrase = phrases[pi];
    if (!deleting) {
      tw.textContent = phrase.slice(0, ++ci);
      if (ci === phrase.length) { deleting = true; setTimeout(typeStep, 2200); return; }
    } else {
      tw.textContent = phrase.slice(0, --ci);
      if (ci === 0) { deleting = false; pi = (pi + 1) % phrases.length; }
    }
    setTimeout(typeStep, deleting ? 28 : 52);
  }
  typeStep();

  // Live script count
  fetch("/api/scripts").then(r => r.json()).then(d => {
    const n = (d.scripts || []).length;
    const el = document.getElementById("scriptCount");
    let cur = 0;
    const step = Math.max(1, Math.floor(n / 40));
    const t = setInterval(() => { cur = Math.min(cur + step, n); el.textContent = cur; if (cur >= n) clearInterval(t); }, 30);
  }).catch(() => {});

  // Login row
  fetch('/api/me', {credentials:'same-origin', cache:'no-store'}).then(r => r.json()).then(me => {
    const row = document.getElementById('accountRow');
    const name = esc(me.name || '');
    if (me.loggedIn) {
      row.innerHTML = '<span class="seal-text" style="opacity:0.75;">Signed in as <b>' + name + '</b>' + (me.isAdmin ? ' · <b style="color:var(--sand)">ADMIN</b>' : '') + '</span>' + (me.isAdmin ? '<a class="btn" href="/admin/">Admin</a>' : '') + '<a class="btn" href="/auth/logout">Log out</a>';
    } else {
      row.innerHTML = '<a class="btn" href="/auth/login?return=%2F">Sign in with Google</a>';
    }
  }).catch(() => {});

  function toggleInfo() {
    const panel = document.getElementById('infoPanel'), btn = document.getElementById('infoToggle');
    const isOpen = panel.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.querySelector('span').textContent = isOpen ? 'Less detail' : 'More about this route';
  }

  // Scroll reveal
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); obs.unobserve(e.target); } });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

  // Dust
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const canvas = document.getElementById('dust'), ctx = canvas.getContext('2d');
    let w, h, particles;
    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    function makeParticles() {
      const count = Math.min(60, Math.floor(w / 22));
      particles = Array.from({ length: count }, () => ({ x: Math.random()*w, y: Math.random()*h, r: Math.random()*1.4+0.3, speedX: (Math.random()-0.5)*0.12, speedY: Math.random()*0.08+0.02, alpha: Math.random()*0.35+0.08 }));
    }
    function tick() {
      ctx.clearRect(0,0,w,h);
      particles.forEach(p => {
        p.x += p.speedX; p.y += p.speedY;
        if (p.y > h) { p.y = -4; p.x = Math.random()*w; }
        if (p.x > w) p.x = 0; if (p.x < 0) p.x = w;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle = \`rgba(212,165,116,\${p.alpha})\`; ctx.fill();
      });
      requestAnimationFrame(tick);
    }
    resize(); makeParticles(); tick();
    window.addEventListener('resize', () => { resize(); makeParticles(); });
  }
</script>
</body>
</html>`;

/* ─────────────────── GALLERY PAGE ─────────────────── */
const UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Upload a Roblox Script — Silk Road Script Hub | dakait.online",
    "Share your Roblox script with the community. Google sign-in is required so every upload has a verified owner.",
    "https://dakait.online/upload-scripts"
)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
  :root {
    --bg: #0a0b0e; --surface: #12141a; --surface2: #1a1d26; --border: #222530;
    --text: #e4e6ed; --muted: #7a7f90; --accent: #f5a623; --green: #4ecb7a; --red: #f05656;
    --mono: 'JetBrains Mono', monospace; --sans: 'Inter', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.5; overflow-x: hidden; }
  body::before { content:''; position:fixed; inset:0; z-index:0; pointer-events:none; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E"); opacity:0.025; mix-blend-mode:overlay; }

  .page { max-width: 1060px; margin: 0 auto; padding: 28px 20px 100px; position: relative; z-index: 1; }

  nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; flex-wrap: wrap; gap: 10px; }
  .brand { font-family: var(--mono); font-weight: 700; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; }
  .brand a { color: var(--muted); text-decoration: none; } .brand span { color: var(--accent); }
  .back-link { font-family: var(--mono); font-size: 11.5px; color: var(--muted); text-decoration: none; transition: color 0.2s; }
  .back-link:hover { color: var(--accent); }

  /* ── Hero ── */
  .hero { margin-bottom: 36px; }
  .hero-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 8px; opacity: 0; animation: up 0.6s 0.1s cubic-bezier(0.16,1,0.3,1) forwards; }
  .hero-title { font-family: var(--mono); font-size: clamp(28px,5vw,44px); font-weight: 700; line-height: 1.05; margin: 0 0 10px; clip-path: inset(0 100% 0 0); animation: reveal 0.7s 0.25s cubic-bezier(0.77,0,0.18,1) forwards; }
  .hero-sub { font-size: 14.5px; color: var(--muted); max-width: 52ch; opacity: 0; animation: up 0.6s 0.5s cubic-bezier(0.16,1,0.3,1) forwards; }
  @keyframes reveal { to { clip-path: inset(0 0% 0 0); } }
  @keyframes up { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

  /* ── Login banner ── */
  .login-banner { display: flex; justify-content: space-between; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 10px 16px; margin-bottom: 28px; font-size: 13px; color: var(--muted); flex-wrap: wrap; opacity: 0; animation: up 0.5s 0.6s cubic-bezier(0.16,1,0.3,1) forwards; }
  .login-banner a { color: var(--accent); text-decoration: none; font-family: var(--mono); font-size: 12px; }

  /* ── Layout: form + preview side by side ── */
  .layout { display: grid; grid-template-columns: 1fr 340px; gap: 28px; align-items: start; }
  @media(max-width:800px){ .layout{grid-template-columns:1fr;} .preview-sticky{position:static !important;} }

  /* ── Form panel ── */
  .form-panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 24px; opacity: 0; animation: up 0.6s 0.7s cubic-bezier(0.16,1,0.3,1) forwards; }

  /* Floating label fields */
  .field { position: relative; margin-bottom: 18px; }
  .field label { display: block; font-size: 11px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 7px; transition: color 0.2s; }
  .field:focus-within label { color: var(--accent); }
  .field input, .field textarea { width: 100%; background: #0a0b0e; border: 1px solid var(--border); border-radius: 8px; color: var(--text); padding: 11px 14px; font-family: var(--sans); font-size: 14px; outline: none; transition: border-color 0.25s, box-shadow 0.25s; resize: vertical; }
  .field textarea { font-family: var(--mono); font-size: 12.5px; min-height: 180px; }
  .field input:focus, .field textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(245,166,35,0.1); }
  .field .hint { font-size: 11px; color: rgba(245,166,35,0.5); margin-top: 5px; font-family: var(--mono); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media(max-width:500px){ .row2{grid-template-columns:1fr;} }

  /* Key toggle */
  .toggle-label { font-size: 11px; font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 8px; }
  .key-toggle { display: flex; gap: 8px; margin-bottom: 18px; }
  .kt-opt { flex: 1; text-align: center; padding: 11px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; font-size: 12.5px; font-family: var(--mono); color: var(--muted); transition: all 0.2s; user-select: none; }
  .kt-opt:hover { border-color: var(--muted); }
  .kt-opt.active-kl { border-color: var(--green); color: var(--green); background: rgba(78,203,122,0.08); }
  .kt-opt.active-hk { border-color: var(--red); color: var(--red); background: rgba(240,86,86,0.08); }

  /* Submit */
  .submit-row { display: flex; align-items: center; gap: 14px; margin-top: 6px; }
  .submit-btn { background: var(--accent); color: #1a0f00; border: none; font-family: var(--mono); font-weight: 700; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; padding: 13px 24px; border-radius: 8px; cursor: pointer; transition: background 0.2s, transform 0.15s; position: relative; overflow: hidden; }
  .submit-btn::after { content:''; position:absolute; inset:0; background:rgba(255,255,255,0.15); transform:translateX(-100%) skewX(-20deg); transition:transform 0.4s ease; }
  .submit-btn:hover { background: #ffba3e; } .submit-btn:hover::after { transform:translateX(120%) skewX(-20deg); }
  .submit-btn:active { transform: scale(0.97); }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .form-msg { font-size: 13px; font-family: var(--mono); }
  .form-msg.err { color: var(--red); } .form-msg.ok { color: var(--green); }
  .form-msg.ok a { color: var(--accent); }

  /* ── Preview panel ── */
  .preview-sticky { position: sticky; top: 28px; opacity: 0; animation: up 0.6s 0.9s cubic-bezier(0.16,1,0.3,1) forwards; }
  .preview-label { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin-bottom: 12px; display: flex; align-items: center; gap: 6px; }
  .preview-label::before { content:''; width:6px; height:6px; border-radius:50%; background:var(--accent); animation:pulseDot 2s infinite; }
  @keyframes pulseDot { 0%{box-shadow:0 0 0 0 rgba(245,166,35,0.5)} 70%{box-shadow:0 0 0 8px rgba(245,166,35,0)} 100%{box-shadow:0 0 0 0 rgba(245,166,35,0)} }

  .preview-card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; transition: border-color 0.3s; }
  .preview-card.has-content { border-color: rgba(245,166,35,0.3); }
  .preview-ph { width:100%; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; background:linear-gradient(135deg,#14161d,#0c0d11); font-size:28px; color:rgba(245,166,35,0.15); font-family:var(--mono); }
  .preview-badge { display:inline-block; font-family:var(--mono); font-size:9px; letter-spacing:0.08em; text-transform:uppercase; padding:3px 9px; border-radius:6px; margin: 12px 14px 0; }
  .preview-badge.kl { color:var(--green); background:rgba(10,12,16,0.85); border:1px solid rgba(78,203,122,0.35); }
  .preview-badge.hk { color:var(--red); background:rgba(10,12,16,0.85); border:1px solid rgba(240,86,86,0.35); }
  .preview-body { padding: 6px 14px 14px; }
  .preview-game { font-family:var(--mono); font-size:10px; color:var(--accent); text-transform:uppercase; letter-spacing:0.07em; opacity:0.8; margin-bottom:3px; min-height:14px; }
  .preview-title { font-weight:700; font-size:14.5px; margin:0 0 4px; line-height:1.3; color:var(--text); min-height:20px; }
  .preview-desc { color:var(--muted); font-size:12px; margin:0 0 8px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:34px; }
  .preview-tags { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; min-height:18px; }
  .preview-foot { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted); padding-top:8px; border-top:1px solid var(--border); font-family:var(--mono); }
  .preview-foot .pu::before { content:'@'; color:var(--accent); }
  .preview-empty-hint { font-family:var(--mono); font-size:11px; color:var(--muted); text-align:center; padding:20px; opacity:0.6; }

  @media(prefers-reduced-motion:reduce){ *,*::before,*::after{animation:none !important;transition:none !important;clip-path:none !important;} }
</style>
</head>
<body>
<div class="page">
  <nav>
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
    <a class="back-link" href="/scripts">← Browse scripts</a>
  </nav>

  <div class="hero">
    <div class="hero-eyebrow">Silk Road · Script Hub</div>
    <h1 class="hero-title">Drop your script.</h1>
    <p class="hero-sub">Sign in with Google, paste your script, tag it, and it goes live immediately. Every upload has a verified owner who can manage or delete it.</p>
  </div>

  <div class="login-banner" id="loginBanner">Checking…</div>

  <div class="layout">
    <section class="form-panel">
      <form id="uform">
        <div class="field">
          <label for="title">Script title</label>
          <input id="title" type="text" maxlength="120" required placeholder="e.g. Grow a Garden AutoFarm Script"/>
        </div>
        <div class="row2">
          <div class="field">
            <label for="username">Your handle</label>
            <input id="username" type="text" maxlength="40" placeholder="anonymous"/>
          </div>
          <div class="field">
            <label for="placeId">Roblox Place ID <span style="opacity:0.5">(optional)</span></label>
            <input id="placeId" type="text" inputmode="numeric" placeholder="e.g. 920587237"/>
            <p class="hint">Pulls game name + icon automatically.</p>
          </div>
        </div>
        <div class="row2">
          <div class="field">
            <label for="hubName">Hub name <span style="opacity:0.5">(optional)</span></label>
            <input id="hubName" type="text" maxlength="40" placeholder="e.g. SpeedXHub"/>
          </div>
          <div class="field">
            <label for="tags">Tags <span style="opacity:0.5">(comma separated)</span></label>
            <input id="tags" type="text" placeholder="AUTO-FARM, ESP, GUI"/>
          </div>
        </div>
        <div class="toggle-label">Key system</div>
        <div class="key-toggle">
          <div class="kt-opt active-kl" id="optKl">Keyless / No key</div>
          <div class="kt-opt" id="optHk">Has key system</div>
        </div>
        <div class="field">
          <label for="description">Description</label>
          <input id="description" type="text" maxlength="500" placeholder="What does it do, what game, anything to know?"/>
        </div>
        <div class="field">
          <label for="code">Script code</label>
          <textarea id="code" required placeholder="Paste your Lua code here"></textarea>
        </div>
        <div class="submit-row">
          <button type="submit" class="submit-btn">Drop it →</button>
          <p class="form-msg" id="fmsg"></p>
        </div>
      </form>
    </section>

    <aside class="preview-sticky">
      <div class="preview-label">Live preview</div>
      <div class="preview-card" id="previewCard">
        <div class="preview-ph">⌗</div>
        <p class="preview-empty-hint">Fill in the form to see how your script card will look in the gallery.</p>
      </div>
    </aside>
  </div>

  <!-- AD CONTAINER -->
  <div style="margin-top:2.5rem; text-align:center;">
    <script async="async" data-cfasync="false" src="https://pl30819137.effectivecpmnetwork.com/9f9a081fb4df321e6c86f26cc58c6192/invoke.js"></script>
    <div id="container-9f9a081fb4df321e6c86f26cc58c6192"></div>
  </div>
</div>

<script>
  let keysys=false;
  const optKl=document.getElementById("optKl"), optHk=document.getElementById("optHk");
  const fmsg=document.getElementById("fmsg"), form=document.getElementById("uform");
  const card=document.getElementById("previewCard");

  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]);}

  optKl.addEventListener("click",()=>{ keysys=false; optKl.className="kt-opt active-kl"; optHk.className="kt-opt"; updatePreview(); });
  optHk.addEventListener("click",()=>{ keysys=true; optHk.className="kt-opt active-hk"; optKl.className="kt-opt"; updatePreview(); });

  fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(me=>{
    const b=document.getElementById("loginBanner");
    if(me.loggedIn){
      b.innerHTML='Signed in as <b>'+esc(me.name)+'</b> — this upload will belong to your account. <a href="/auth/logout">Log out</a>';
      document.getElementById("username").value=me.name;
      updatePreview();
    } else {
      b.innerHTML='🔒 <b>Google sign-in is required to upload.</b> <a href="/auth/login?return=%2Fupload-scripts">Sign in with Google →</a>';
      document.querySelectorAll('#uform input,#uform textarea,#uform button').forEach(el=>el.disabled=true);
      setTimeout(()=>{ window.location.href='/auth/login?return=%2Fupload-scripts'; },500);
    }
  }).catch(()=>{ document.getElementById("loginBanner").textContent="Please sign in with Google before uploading."; });

  function updatePreview(){
    const title=document.getElementById("title").value.trim();
    const desc=document.getElementById("description").value.trim();
    const user=document.getElementById("username").value.trim()||"anonymous";
    const hub=document.getElementById("hubName").value.trim();
    const rawTags=document.getElementById("tags").value.trim();
    const tags=rawTags?rawTags.split(",").map(t=>t.trim().toUpperCase()).filter(Boolean).slice(0,5):[];
    const hasContent=!!(title||desc||hub||tags.length);
    card.classList.toggle("has-content",hasContent);
    if(!hasContent){
      card.innerHTML='<div class="preview-ph">⌗</div><p class="preview-empty-hint">Fill in the form to see how your script card will look in the gallery.</p>';
      return;
    }
    const badge=keysys?'<div class="preview-badge hk">Key</div>':'<div class="preview-badge kl">Keyless</div>';
    const tagHtml=tags.map(t=>'<span style="font-family:var(--mono);font-size:9.5px;padding:2px 8px;border-radius:5px;background:rgba(245,166,35,0.09);color:var(--accent);border:1px solid rgba(245,166,35,0.2)">'+esc(t)+'</span>').join("");
    const hubHtml=hub?'<span style="font-family:var(--mono);font-size:9.5px;padding:2px 8px;border-radius:5px;background:rgba(78,203,122,0.08);color:var(--green);border:1px solid rgba(78,203,122,0.22)">'+esc(hub)+'</span>':"";
    card.innerHTML='<div class="preview-ph">⌗</div>'+badge+'<div class="preview-body"><div class="preview-game"></div><p class="preview-title">'+(esc(title)||'<span style="opacity:0.3">Your title here</span>')+'</p><p class="preview-desc">'+(esc(desc)||'<span style="opacity:0.3">Your description…</span>')+'</p><div class="preview-tags">'+hubHtml+tagHtml+'</div><div class="preview-foot"><span class="pu">'+esc(user)+'&nbsp;·&nbsp;just now</span><span style="color:var(--accent)">→</span></div></div>';
  }

  ["title","description","username","hubName","tags"].forEach(id=>{
    document.getElementById(id).addEventListener("input",updatePreview);
  });

  form.addEventListener("submit",async(e)=>{
    e.preventDefault(); fmsg.textContent=""; fmsg.className="form-msg";
    const title=document.getElementById("title").value.trim();
    const code=document.getElementById("code").value;
    if(!title||!code.trim()){ fmsg.textContent="Title and script code are required."; fmsg.className="form-msg err"; return; }
    const placeId=document.getElementById("placeId").value.trim();
    if(placeId&&!/^\d+$/.test(placeId)){ fmsg.textContent="Place ID should be numbers only."; fmsg.className="form-msg err"; return; }
    const btn=form.querySelector(".submit-btn"); btn.disabled=true; btn.textContent="Dropping…";
    try{
      const r=await fetch("/api/scripts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,username:document.getElementById("username").value.trim(),description:document.getElementById("description").value.trim(),code,placeId:placeId||null,hubName:document.getElementById("hubName").value.trim(),tags:document.getElementById("tags").value.trim(),keysystem:keysys})});
      if(!r.ok){const e=await r.json();throw new Error(e.error||"Upload failed");}
      const d=await r.json();
      fmsg.innerHTML='Dropped! <a href="/scripts/'+d.script.id+'">View it →</a>';
      fmsg.className="form-msg ok"; form.reset(); keysys=false; optKl.className="kt-opt active-kl"; optHk.className="kt-opt"; updatePreview();
    }catch(e){ fmsg.textContent=e.message||"Something went wrong."; fmsg.className="form-msg err"; }
    finally{ btn.disabled=false; btn.textContent="Drop it →"; }
  });

  updatePreview();
</script>
</body>
</html>`;


/* ─────────────────── ADMIN PAGE ─────────────────── */
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
${SHARED_HEAD("Admin Control Room — dakait.online", "Private Dakait administration panel.", "https://dakait.online/admin/")}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"/>
<style>
:root{--bg:#090a0d;--panel:#111318;--line:#252832;--text:#e8e9ed;--muted:#858a98;--accent:#ffb238;--green:#5cd98a;--red:#ff6262;--blue:#6ea8ff;--mono:'JetBrains Mono',monospace}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 20% 0%,#2a1b0c22,transparent 45%),var(--bg);color:var(--text);font-family:var(--mono)}.wrap{max-width:1050px;margin:auto;padding:28px 18px 80px}.top{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:24px;flex-wrap:wrap}.brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase}.brand span{color:var(--accent)}a{color:inherit}.actions{display:flex;gap:8px;flex-wrap:wrap}.btn{display:inline-block;text-decoration:none;border:1px solid var(--line);background:#151820;color:var(--text);padding:9px 12px;border-radius:7px;font:11px var(--mono);cursor:pointer}.btn:hover{border-color:#555b69}.danger{color:var(--red);border-color:#61383b}.hero{border:1px solid var(--line);background:linear-gradient(135deg,#171a21,#0f1116);border-radius:12px;padding:22px;margin-bottom:18px}.eyebrow{font-size:10px;color:var(--accent);letter-spacing:.16em;text-transform:uppercase}.hero h1{font-size:28px;margin:8px 0}.hero p{color:var(--muted);font-size:12px;line-height:1.6}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.stat{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:15px}.num{font-size:24px;color:var(--accent)}.label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-top:4px}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-top:15px}.panel h2{font-size:13px;margin:0 0 12px}.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.controls input{flex:1;min-width:180px;background:#090a0d;border:1px solid var(--line);border-radius:7px;color:var(--text);padding:10px;font:12px var(--mono)}.script{display:grid;grid-template-columns:1fr auto;gap:12px;padding:13px 0;border-top:1px dashed var(--line);align-items:center}.script:first-child{border-top:0}.title{font-size:13px}.meta{font-size:9px;color:var(--muted);margin-top:5px}.script-actions{display:flex;gap:6px;flex-wrap:wrap}.empty,.msg{color:var(--muted);font-size:11px}.ok{color:var(--green)}.err{color:var(--red)}.feature-list{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.feature{border:1px solid var(--line);border-radius:8px;padding:12px}.feature b{font-size:11px}.feature p{font-size:10px;color:var(--muted);line-height:1.5;margin:5px 0 0}@media(max-width:650px){.stats{grid-template-columns:repeat(2,1fr)}.feature-list{grid-template-columns:1fr}.script{grid-template-columns:1fr}.script-actions{justify-content:flex-start}}
</style></head><body><main class="wrap">
<div class="top"><div class="brand"><a href="/">DAKAIT<span>.ONLINE</span></a> / ADMIN</div><div class="actions"><a class="btn" href="/scripts">Gallery</a><a class="btn" href="/">Home</a><a class="btn" href="/auth/logout">Log out</a></div></div>
<section class="hero"><div class="eyebrow">Private control room</div><h1>Admin control.</h1><p id="who">Checking administrator session…</p></section>
<div class="stats"><div class="stat"><div class="num" id="scriptCount">—</div><div class="label">Scripts</div></div><div class="stat"><div class="num" id="views">—</div><div class="label">Total views</div></div><div class="stat"><div class="num" id="ratings">—</div><div class="label">Ratings</div></div><div class="stat"><div class="num" id="avg">—</div><div class="label">Average rating</div></div></div>
<section class="panel"><h2>Script management</h2><div class="controls"><input id="search" placeholder="Search scripts…"/><button class="btn" id="refresh">Refresh</button></div><div id="scripts"><div class="empty">Loading…</div></div></section>
<section class="panel"><h2>Admin controls available</h2><div class="feature-list">
<div class="feature"><b>Manage scripts</b><p>Edit or delete any script, regardless of owner.</p></div>
<div class="feature"><b>Moderate comments</b><p>Next control can remove abusive or unwanted community comments.</p></div>
<div class="feature"><b>Review ratings</b><p>See rating distribution and community health for every script.</p></div>
<div class="feature"><b>Site statistics</b><p>Monitor scripts, views, ratings and average score.</p></div>
<div class="feature"><b>Content moderation</b><p>Future control for hiding, restoring or flagging scripts without deleting them.</p></div>
<div class="feature"><b>Admin audit log</b><p>Future control to record who edited or deleted content and when.</p></div>
</div></section>
<p class="msg" id="msg"></p>
</main><script>
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let all=[];
async function load(){const msg=document.getElementById("msg");msg.textContent="Refreshing…";try{const r=await fetch("/api/admin/overview",{credentials:"same-origin",cache:"no-store"});const d=await r.json();if(r.status===401){location.href="/auth/login?return="+encodeURIComponent("/admin/");return}if(!r.ok)throw new Error(d.error||"Admin access denied");all=d.scripts||[];document.getElementById("who").textContent="Signed in as "+d.user.name+" · "+d.user.email+" · ADMIN";document.getElementById("scriptCount").textContent=d.stats.scripts;document.getElementById("views").textContent=d.stats.views;document.getElementById("ratings").textContent=d.stats.ratings;document.getElementById("avg").textContent=d.stats.average?d.stats.average.toFixed(1)+"/5":"—";render();msg.textContent="Updated.";msg.className="msg ok"}catch(e){msg.textContent=e.message;msg.className="msg err"}}
function render(){const q=document.getElementById("search").value.toLowerCase().trim();const list=all.filter(s=>[s.title,s.username,s.gameName,s.hubName,...(s.tags||[])].join(" ").toLowerCase().includes(q));const el=document.getElementById("scripts");if(!list.length){el.innerHTML='<div class="empty">No matching scripts.</div>';return}el.innerHTML=list.map(s=>'<div class="script"><div><div class="title">'+esc(s.title)+'</div><div class="meta">'+esc(s.id)+' · @'+esc(s.username||"unknown")+' · '+Number(s.views||0)+' views · '+(s.rating?.total||0)+' ratings</div></div><div class="script-actions"><a class="btn" href="/scripts/'+encodeURIComponent(s.id)+'">View</a><a class="btn" href="/scripts/'+encodeURIComponent(s.id)+'/edit">Edit</a><button class="btn danger" data-id="'+esc(s.id)+'">Delete</button></div></div>').join("");el.querySelectorAll("button[data-id]").forEach(b=>b.onclick=()=>removeScript(b.dataset.id));}
async function removeScript(id){const s=all.find(x=>x.id===id);if(!s||!confirm('Delete '+s.title+'? This removes its comments and ratings too.'))return;const r=await fetch('/api/scripts/'+encodeURIComponent(id),{method:'DELETE',credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok){alert(d.error||'Delete failed');return}await load()}
document.getElementById("refresh").onclick=load;document.getElementById("search").oninput=render;load();
</script></body></html>`;

/* ─────────────────── Google OAuth ─────────────────── */
const REDIRECT_URI = "https://dakait.online/auth/callback";

function safeReturnPath(value) {
    try {
        const path = String(value || "/");
        if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
        return path.slice(0, 1000);
    } catch { return "/"; }
}

async function handleAuthLogin(request, env) {
    const url = new URL(request.url);
    const returnTo = safeReturnPath(url.searchParams.get("return") || "/");
    const state = crypto.randomUUID();
    await env.SESSIONS_KV.put(`oauthstate:${state}`, JSON.stringify({ returnTo }), { expirationTtl: 600 });
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` } });
}

async function handleAuthCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing code/state", { status: 400 });
    const stateRaw = await env.SESSIONS_KV.get(`oauthstate:${state}`);
    if (!stateRaw) return new Response("Invalid state", { status: 400 });
    await env.SESSIONS_KV.delete(`oauthstate:${state}`);
    let returnTo = "/";
    try { returnTo = safeReturnPath(JSON.parse(stateRaw).returnTo); } catch { }

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }) });
    if (!tokenRes.ok) return new Response("Token exchange failed", { status: 400 });
    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    if (!userRes.ok) return new Response("Failed to fetch profile", { status: 400 });
    const profile = await userRes.json();
    const sessionId = crypto.randomUUID();
    const session = { sub: profile.sub, email: profile.email, name: profile.name || profile.email, picture: profile.picture || null };
    await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 2592000 });
    return new Response(null, { status: 302, headers: {
        Location: returnTo,
        "Cache-Control": "no-store",
        "Set-Cookie": `session=${sessionId}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`
    } });
}

function jsonResponse(data, status = 200) {
    const r = new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
    return r;
}

function handleAuthLogout() {
    return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": "session=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax" } });
}

async function handleApiMe(request, env) {
    const session = await getSession(request, env);
    if (!session) {
        const response = jsonResponse({ loggedIn: false });
        response.headers.set("Cache-Control", "no-store");
        return response;
    }
    const admin = isAdminEmail(env, session.email);
    const response = jsonResponse({ loggedIn: true, sub: session.sub, name: session.name, email: session.email, isAdmin: admin });
    response.headers.set("Cache-Control", "no-store");
    return response;
}


async function handleAdminOverview(request, env) {
    const session = await getSession(request, env);
    if (!session?.sub) return jsonResponse({ error: "Sign in with Google first." }, 401);
    if (!isAdminEmail(env, session.email)) return jsonResponse({ error: "Admin access required." }, 403);
    const scripts = await getAllScriptSummaries(env);
    let ratings = 0, weighted = 0;
    for (const s of scripts) {
        const total = Number(s.rating?.total || 0);
        ratings += total;
        weighted += Number(s.rating?.average || 0) * total;
    }
    return jsonResponse({
        user: { name: session.name, email: session.email },
        stats: {
            scripts: scripts.length,
            views: scripts.reduce((n, s) => n + Number(s.views || 0), 0),
            ratings,
            average: ratings ? weighted / ratings : 0
        },
        scripts
    });
}

/* ─────────────────── Sitemap (helps Google index every script) ─────────────────── */
async function buildSitemap(env) {
    const index = await getAllScriptSummaries(env);
    const sorted = [...index].sort((a, b) => b.createdAt - a.createdAt);
    const urls = [
        `<url><loc>https://dakait.online/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
        `<url><loc>https://dakait.online/scripts</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
        `<url><loc>https://dakait.online/upload-scripts</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
        ...sorted.map(s => {
            const lastmod = new Date(s.createdAt).toISOString().split("T")[0];
            return `<url><loc>https://dakait.online/scripts/${s.id}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`;
        }),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

/* ─────────────────── Main fetch handler ─────────────────── */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Favicon
        if (path === "/favicon.svg" || path === "/favicon.ico") {
            return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
        }

        // robots.txt — tells Google what to crawl + where sitemap is
        if (path === "/robots.txt") {
            return new Response(
                "User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nSitemap: https://dakait.online/sitemap.xml\n",
                { headers: { "Content-Type": "text/plain" } }
            );
        }

        // sitemap.xml — list of all script URLs for Google to index
        if (path === "/sitemap.xml") {
            const xml = await buildSitemap(env);
            return new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } });
        }

        // Auth
        if (path === "/auth/login") return handleAuthLogin(request, env);
        if (path === "/auth/callback") return handleAuthCallback(request, env);
        if (path === "/auth/logout") return handleAuthLogout();
        if (path === "/api/me") return handleApiMe(request, env);
        if (path === "/api/admin/overview" && request.method === "GET") return handleAdminOverview(request, env);

        // Private admin page
        if (path === "/admin" || path === "/admin/") {
            const session = await getSession(request, env);
            if (!session?.sub) return new Response(null, { status: 302, headers: { Location: "/auth/login?return=%2Fadmin%2F" } });
            if (!isAdminEmail(env, session.email)) return new Response("Forbidden — admin access required.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
            return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
        }

        // Scripts pages
        if (path === "/scripts" || path === "/scripts/") return new Response(GALLERY_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
        if (path === "/upload-scripts" || path === "/upload-scripts/") return new Response(UPLOAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });

        // Roblox thumbnail proxy
        if (path === "/api/roblox-thumbnail" && request.method === "GET") {
            const placeId = url.searchParams.get("placeId");
            const info = await getRobloxGameInfo(env, placeId);
            if (!info || !info.imageUrl) return new Response("Not found", { status: 404 });
            const imgRes = await fetch(info.imageUrl);
            return new Response(imgRes.body, { headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/png", "Cache-Control": "public, max-age=86400" } });
        }

        if (path === "/ads.txt") {
            return new Response(
                "google.com, pub-1269702947671634, DIRECT, f08c47fec0942fa0",
                {
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8",
                        "Cache-Control": "public, max-age=3600"
                    }
                }
            );
        }

        // Edit page
        const editMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)\/edit$/);
        if (editMatch && request.method === "GET") {
            const script = await getScript(env, editMatch[1]);
            if (!script) return new Response("Script not found", { status: 404 });

            const access = await canManageScript(request, env, script);
            if (!access.allowed) return new Response("Not authorized", { status: 403 });

            return new Response(buildEditHtml(script), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
                status: 200
            });
        }

        // Script detail page (server-rendered — Google indexes each one)
        const detailMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)$/);
        if (detailMatch && request.method === "GET") {
            const script = await prepareScriptForPage(env, detailMatch[1]);
            if (!script) return new Response("Script not found", { status: 404 });

            const thumbnailUrl = script.placeId
                ? `/api/roblox-thumbnail?placeId=${encodeURIComponent(script.placeId)}`
                : null;

            // Count real page visits without blocking HTML generation.
            if (ctx && typeof ctx.waitUntil === "function") {
                ctx.waitUntil(recordScriptView(env, script.id).catch(() => {}));
            }

            return new Response(buildDetailHtml(script, thumbnailUrl), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store"
                },
                status: 200
            });
        }

        // Scripts JSON API
        if (path.startsWith("/api/scripts")) {
            const resp = await handleScriptsApi(request, env, path);
            resp.headers.set("Access-Control-Allow-Origin", "*");
            return resp;
        }

        return new Response(SILK_ROAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
    }
};


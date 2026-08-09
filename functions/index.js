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

const SCRIPTS_INDEX_KEY = "scripts:index";
const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;
const MAX_HUB_LENGTH = 40;
const MAX_COMMENT_LENGTH = 400;

async function getScriptsIndex(env) { const raw = await env.SCRIPTS_KV.get(SCRIPTS_INDEX_KEY); return raw ? JSON.parse(raw) : []; }
async function saveScriptsIndex(env, index) { await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(index)); }

async function getRobloxGameInfo(env, placeId) {
    if (!placeId || !/^\d+$/.test(String(placeId))) return null;
    const cacheKey = `robloxinfo:${placeId}`;
    const cached = await env.SCRIPTS_KV.get(cacheKey);
    if (cached) return cached === "NONE" ? null : JSON.parse(cached);
    try {
        const uniRes = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        if (!uniRes.ok) { await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 }); return null; }
        const uniData = await uniRes.json();
        const universeId = uniData.universeId;
        if (!universeId) { await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 }); return null; }
        const [iconRes, gameRes] = await Promise.all([
            fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`),
            fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`),
        ]);
        const iconData = iconRes.ok ? await iconRes.json() : null;
        const gameData = gameRes.ok ? await gameRes.json() : null;
        const imageUrl = iconData?.data?.[0]?.imageUrl || null;
        const name = gameData?.data?.[0]?.name || null;
        if (!imageUrl && !name) { await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 }); return null; }
        const info = { imageUrl, name };
        await env.SCRIPTS_KV.put(cacheKey, JSON.stringify(info), { expirationTtl: 86400 });
        return info;
    } catch (err) { return null; }
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
    if (!env.ADMIN_EMAILS || !email) return false;
    const list = env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase());
    return list.includes(email.toLowerCase());
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

  <footer class="reveal">
    <span>dakait.online</span>
    <span>operated by Dakait Shah &amp; Dakait Guri</span>
  </footer>
</main>

<script>
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
  fetch('/api/me').then(r => r.json()).then(me => {
    const row = document.getElementById('accountRow');
    if (me.loggedIn) row.innerHTML = '<span class="seal-text" style="opacity:0.75;">Signed in as ' + me.name + '</span><a class="btn" href="/auth/logout">Log out</a>';
    else row.innerHTML = '<a class="btn" href="/auth/login">Sign in with Google</a>';
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
const GALLERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Free Roblox Scripts — Silk Road Script Hub | dakait.online",
    "Browse hundreds of free Roblox scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon and more. Filter by game, tags, or key system. Keyless scripts updated daily.",
    "https://dakait.online/scripts"
)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
  :root {
    --bg: #0a0b0e;
    --surface: #12141a;
    --surface2: #1a1d26;
    --border: #22253000;
    --border-v: #222530;
    --text: #e4e6ed;
    --muted: #7a7f90;
    --accent: #f5a623;
    --accent2: #e8913a;
    --green: #4ecb7a;
    --red: #f05656;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'Inter', sans-serif;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--sans); line-height: 1.5; overflow-x: hidden; }

  /* ── Grain texture overlay ── */
  body::before {
    content: '';
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E");
    opacity: 0.025; mix-blend-mode: overlay;
  }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 100px; position: relative; z-index: 1; }

  /* ── Nav ── */
  nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 40px; gap: 12px; flex-wrap: wrap; }
  .brand { font-family: var(--mono); font-weight: 700; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; }
  .brand a { color: var(--muted); text-decoration: none; }
  .brand span { color: var(--accent); }
  .nav-pill { font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 8px 16px; border-radius: 100px; border: 1px solid rgba(245,166,35,0.35); color: var(--accent); text-decoration: none; transition: background 0.2s, border-color 0.2s; }
  .nav-pill:hover { background: rgba(245,166,35,0.1); border-color: var(--accent); }

  /* ── Hero ── */
  .hero { margin-bottom: 36px; overflow: hidden; }
  .hero-eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; opacity: 0; animation: fadeSlideUp 0.6s 0.1s cubic-bezier(0.16,1,0.3,1) forwards; }
  .hero-title { font-family: var(--mono); font-size: clamp(32px, 6vw, 54px); font-weight: 700; line-height: 1; margin: 0 0 12px; letter-spacing: -0.02em; clip-path: inset(0 100% 0 0); animation: revealRight 0.7s 0.25s cubic-bezier(0.77,0,0.18,1) forwards; }
  .hero-title .hl { color: var(--accent); }
  .hero-sub { font-size: 15px; color: var(--muted); max-width: 52ch; opacity: 0; animation: fadeSlideUp 0.6s 0.5s cubic-bezier(0.16,1,0.3,1) forwards; }

  @keyframes revealRight { to { clip-path: inset(0 0% 0 0); } }
  @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }

  /* ── Search ── */
  .search-wrap { position: relative; margin-bottom: 16px; opacity: 0; animation: fadeSlideUp 0.5s 0.6s cubic-bezier(0.16,1,0.3,1) forwards; }
  .search-wrap::before { content: '⌕'; position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 18px; pointer-events: none; }
  #searchBox { width: 100%; background: var(--surface); border: 1px solid var(--border-v); border-radius: 10px; color: var(--text); padding: 14px 16px 14px 44px; font-family: var(--sans); font-size: 14px; transition: border-color 0.25s, box-shadow 0.25s; outline: none; }
  #searchBox:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(245,166,35,0.12); }
  #searchBox::placeholder { color: var(--muted); }

  /* ── Filter pills ── */
  .filter-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 28px; opacity: 0; animation: fadeSlideUp 0.5s 0.7s cubic-bezier(0.16,1,0.3,1) forwards; }
  .pill-filter { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.05em; text-transform: uppercase; padding: 6px 14px; border-radius: 100px; border: 1px solid var(--border-v); color: var(--muted); background: transparent; cursor: pointer; transition: all 0.2s; }
  .pill-filter:hover { border-color: var(--accent); color: var(--accent); }
  .pill-filter.active { background: rgba(245,166,35,0.12); border-color: var(--accent); color: var(--accent); }
  .pill-filter.kl.active { background: rgba(78,203,122,0.1); border-color: var(--green); color: var(--green); }

  /* ── List header ── */
  .list-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
  .list-head h2 { font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; color: var(--muted); margin: 0; }
  #count { font-family: var(--mono); font-size: 11px; color: rgba(245,166,35,0.5); }

  /* ── Grid ── */
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
  .grid.filtering { opacity: 0; transform: translateY(6px); transition: opacity 0.15s, transform 0.15s; }
  .grid.settled { opacity: 1; transform: translateY(0); transition: opacity 0.25s, transform 0.25s; }

  /* ── Shimmer ── */
  @keyframes shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }
  .skel { height: 310px; border-radius: 14px; background: linear-gradient(90deg, var(--surface) 25%, var(--surface2) 50%, var(--surface) 75%); background-size: 800px 100%; animation: shimmer 1.5s infinite; }

  /* ── Card deal animation ── */
  @keyframes cardDeal {
    from { opacity: 0; transform: translateY(20px) rotate(1.5deg) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)   rotate(0deg)   scale(1); }
  }

  /* ── Card ── */
  .card { background: var(--surface); border: 1px solid var(--border-v); border-radius: 14px; overflow: hidden; text-decoration: none; color: var(--text); display: flex; flex-direction:column; position: relative; cursor: pointer; transform-origin: center bottom; transition: transform 0.28s cubic-bezier(0.34,1.56,0.64,1), border-color 0.25s, box-shadow 0.25s; animation: cardDeal 0.45s cubic-bezier(0.16,1,0.3,1) both; }
  .card:hover { transform: translateY(-6px) scale(1.012); border-color: rgba(245,166,35,0.5); box-shadow: 0 12px 40px rgba(245,166,35,0.1), 0 2px 8px rgba(0,0,0,0.4); }
  .card:active { transform: translateY(-2px) scale(1.005); }

  /* Shimmer sweep on hover */
  .card::after { content: ''; position: absolute; inset: 0; background: linear-gradient(115deg, transparent 40%, rgba(245,166,35,0.06) 50%, transparent 60%); transform: translateX(-100%); transition: transform 0.5s ease; pointer-events: none; border-radius: 14px; }
  .card:hover::after { transform: translateX(100%); }

  .card-img { width: 100%; aspect-ratio: 16/9; object-fit: cover; background: linear-gradient(135deg, #14161d, #0c0d11); }
  .card-img-ph { width: 100%; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #14161d, #0c0d11); font-size: 32px; color: rgba(245,166,35,0.2); font-family: var(--mono); }

  .key-badge { position: absolute; top: 10px; right: 10px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; padding: 3px 9px; border-radius: 6px; backdrop-filter: blur(8px); }
  .key-badge.kl { color: var(--green); background: rgba(10,12,16,0.85); border: 1px solid rgba(78,203,122,0.35); }
  .key-badge.hk { color: var(--red); background: rgba(10,12,16,0.85); border: 1px solid rgba(240,86,86,0.35); }

  .card-body { padding: 13px 15px 15px; display: flex; flex-direction: column; flex: 1; }
  .game-label { font-family: var(--mono); font-size: 10px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 4px; opacity: 0.8; }
  .card-title { font-weight: 700; font-size: 14.5px; margin: 0 0 5px; line-height: 1.3; }
  .card-desc { color: var(--muted); font-size: 12px; margin: 0 0 10px; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }

  .tag-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
  .tag { font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.04em; padding: 2px 8px; border-radius: 5px; background: rgba(245,166,35,0.09); color: var(--accent); border: 1px solid rgba(245,166,35,0.2); }
  .tag.hub { background: rgba(78,203,122,0.08); color: var(--green); border-color: rgba(78,203,122,0.22); }

  .card-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11.5px; color: var(--muted); padding-top: 8px; border-top: 1px solid var(--border-v); font-family: var(--mono); }
  .card-foot .user::before { content: '@'; color: var(--accent); }
  .view-arrow { color: var(--accent); font-size: 14px; transition: transform 0.2s; }
  .card:hover .view-arrow { transform: translateX(4px); }

  /* ── Empty state ── */
  .empty { grid-column: 1/-1; text-align: center; padding: 80px 20px; }
  .empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.3; animation: floatIcon 3s ease-in-out infinite; }
  @keyframes floatIcon { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
  .empty p { font-family: var(--mono); font-size: 13px; color: var(--muted); }

  @media(prefers-reduced-motion:reduce){ *, *::before, *::after{animation:none !important;transition:none !important;clip-path:none !important;} }
  @media(max-width:520px){ .hero-title{font-size:32px;} }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
    <a class="nav-pill" href="/upload-scripts">+ Drop a script</a>
  </nav>

  <div class="hero">
    <div class="hero-eyebrow">Silk Road · Script Hub</div>
    <h1 class="hero-title"><span class="hl">Loot</span> the gallery.</h1>
    <p class="hero-sub">Scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon — free, searchable, filterable. Click any card to copy.</p>
  </div>

  <div class="search-wrap">
    <input id="searchBox" type="text" placeholder="Search by title, game, tag — e.g. grow a garden autofarm" autocomplete="off" spellcheck="false"/>
  </div>

  <div class="filter-row">
    <button class="pill-filter active" data-f="all">All</button>
    <button class="pill-filter kl" data-f="keyless">Keyless only</button>
    <button class="pill-filter" data-f="blox">Blox Fruits</button>
    <button class="pill-filter" data-f="garden">Grow a Garden</button>
    <button class="pill-filter" data-f="rivals">Rivals</button>
    <button class="pill-filter" data-f="lumber">Lumber Tycoon</button>
    <button class="pill-filter" data-f="steal">Steal a Brainrot</button>
  </div>

  <div class="list-head">
    <h2>Latest drops</h2>
    <span id="count"></span>
  </div>
  <div id="grid" class="grid"></div>
</div>

<script>
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function ago(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}

  const grid=document.getElementById("grid"), count=document.getElementById("count"), box=document.getElementById("searchBox");
  let all=[], filter="all";

  function shimmers(n=8){ grid.innerHTML=Array.from({length:n},()=>'<div class="skel"></div>').join(""); }

  function matches(m){
    if(filter==="keyless") return !m.keysystem;
    if(filter==="all") return true;
    const map={blox:"blox",garden:"garden",rivals:"rivals",lumber:"lumber",steal:"steal"};
    const hay=[m.title,m.description,m.gameName,...(m.tags||[])].join(" ").toLowerCase();
    return hay.includes(map[filter]||filter);
  }

  function render(scripts){
    grid.classList.remove("settled"); grid.classList.add("filtering");
    requestAnimationFrame(()=>{
      requestAnimationFrame(()=>{
        if(!scripts.length){
          grid.innerHTML='<div class="empty"><div class="empty-icon">🏜</div><p>Nothing matches — try a different search or filter.</p></div>';
          grid.classList.remove("filtering"); grid.classList.add("settled"); return;
        }
        grid.innerHTML="";
        scripts.forEach((m,i)=>{
          const a=document.createElement("a");
          a.href="/scripts/"+m.id; a.className="card";
          a.style.animationDelay=(i*45)+"ms";
          const img=m.placeId
            ? '<img class="card-img" src="/api/roblox-thumbnail?placeId='+encodeURIComponent(m.placeId)+'" loading="lazy" alt="'+esc(m.title)+'" onerror="this.outerHTML=\'<div class=\\"card-img-ph\\">⌗</div>\'"/>'
            : '<div class="card-img-ph">⌗</div>';
          const badge=m.keysystem?'<span class="key-badge hk">Key</span>':'<span class="key-badge kl">Keyless</span>';
          const tags=(m.tags||[]).map(t=>'<span class="tag">'+esc(t)+'</span>').join("");
          const hub=m.hubName?'<span class="tag hub">'+esc(m.hubName)+'</span>':"";
          const game=m.gameName?'<div class="game-label">'+esc(m.gameName)+'</div>':"";
          a.innerHTML=img+badge+'<div class="card-body">'+game+'<p class="card-title">'+esc(m.title)+'</p><p class="card-desc">'+esc(m.description||"No description.")+'</p><div class="tag-row">'+hub+tags+'</div><div class="card-foot"><span class="user">'+esc(m.username)+'&nbsp;·&nbsp;'+ago(m.createdAt)+'</span><span class="view-arrow">→</span></div></div>';
          grid.appendChild(a);
        });
        grid.classList.remove("filtering"); grid.classList.add("settled");
      });
    });
  }

  function applyFilters(){
    const q=box.value.trim().toLowerCase();
    let list=all.filter(matches);
    if(q) list=list.filter(m=>[m.title,m.description,m.gameName,m.hubName,...(m.tags||[])].join(" ").toLowerCase().includes(q));
    count.textContent=list.length+(list.length===1?" script":" scripts");
    render(list);
  }

  async function load(){
    shimmers();
    try{
      const r=await fetch("/api/scripts"), d=await r.json();
      all=(d.scripts||[]);
      applyFilters();
    }catch{ grid.innerHTML='<div class="empty"><div class="empty-icon">🏜</div><p>Couldn\'t load scripts — try refreshing.</p></div>'; }
  }

  box.addEventListener("input",applyFilters);
  document.querySelectorAll(".pill-filter").forEach(b=>{
    b.addEventListener("click",()=>{
      document.querySelectorAll(".pill-filter").forEach(x=>x.classList.remove("active"));
      b.classList.add("active"); filter=b.dataset.f; applyFilters();
    });
  });

  load();
</script>
</body>
</html>`;

const UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Upload a Roblox Script — Silk Road Script Hub | dakait.online",
    "Share your Roblox script with the community. Free, no account required. Drop your script and it goes live instantly.",
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
    <p class="hero-sub">Paste it. Tag it. It goes live immediately — no review, no waitlist. Anyone can copy it.</p>
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
</div>

<script>
  let keysys=false;
  const optKl=document.getElementById("optKl"), optHk=document.getElementById("optHk");
  const fmsg=document.getElementById("fmsg"), form=document.getElementById("uform");
  const card=document.getElementById("previewCard");

  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

  optKl.addEventListener("click",()=>{ keysys=false; optKl.className="kt-opt active-kl"; optHk.className="kt-opt"; updatePreview(); });
  optHk.addEventListener("click",()=>{ keysys=true; optHk.className="kt-opt active-hk"; optKl.className="kt-opt"; updatePreview(); });

  fetch('/api/me').then(r=>r.json()).then(me=>{
    const b=document.getElementById("loginBanner");
    if(me.loggedIn){ b.innerHTML='Signed in as <b>'+esc(me.name)+'</b> — uploads are tied to your account. <a href="/auth/logout">Log out</a>'; document.getElementById("username").value=me.name; }
    else b.innerHTML='Not signed in — upload anonymously or <a href="/auth/login">Sign in with Google</a> to edit/delete later.';
    updatePreview();
  }).catch(()=>{ document.getElementById("loginBanner").textContent=""; });

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

function buildDetailHtml(script, thumbnailUrl) {
    const safeTitle = escapeHtml(script.title);
    const safeDesc = escapeHtml(script.description || "No description provided.");
    const safeUser = escapeHtml(script.username || "anonymous");
    const safeGame = script.gameName ? escapeHtml(script.gameName) : null;
    const codeHtml = renderCodeWithLineNumbers(script.code);
    const tags = script.tags || [];
    const tagPills = tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");
    const hubPill = script.hubName ? `<span class="pill hub">${escapeHtml(script.hubName)}</span>` : "";
    const keyBadge = script.keysystem ? `<span class="key-badge haskey">Key System</span>` : `<span class="key-badge keyless">Keyless / No Key</span>`;
    const imgBlock = thumbnailUrl ? `<img class="hero-img" src="${thumbnailUrl}" alt="${safeTitle} thumbnail"/>` : `<div class="hero-img placeholder">⌗</div>`;

    // SEO: descriptive title Google will show in results
    const pageTitle = safeGame
        ? `${script.title} — ${script.gameName} Script | dakait.online`
        : `${script.title} | Silk Road Script Hub — dakait.online`;
    const pageDesc = safeGame
        ? `Free ${script.gameName} script. ${(script.description || "").slice(0, 120)}. ${script.keysystem ? "Requires key." : "Keyless."} Copy and use instantly.`
        : `${(script.description || script.title).slice(0, 155)}. Free Roblox script on dakait.online.`;
    const canonical = `https://dakait.online/scripts/${script.id}`;

    // JSON-LD structured data — makes Google show rich results
    const jsonLd = safeJsonForHtml({
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "name": script.title,
        "description": (script.description || script.title).slice(0, 250),
        "url": canonical,
        "programmingLanguage": "Lua",
        "author": { "@type": "Person", "name": script.username || "anonymous" },
        "dateCreated": new Date(script.createdAt).toISOString(),
        "codeRepository": "https://dakait.online/scripts",
        "keywords": ["roblox script", "roblox", script.gameName, ...(script.tags || [])].filter(Boolean).join(", "),
        "isAccessibleForFree": true,
        "publisher": { "@type": "Organization", "name": "Silk Road Script Hub", "url": "https://dakait.online" },
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(pageTitle, pageDesc.slice(0, 160), canonical, thumbnailUrl || "https://dakait.online/og-image.png")}
<script type="application/ld+json">${jsonLd}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
  :root{ --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed; --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --green:#5cd98a; --red:#ff5d5d; --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif; }
  *{box-sizing:border-box;} html,body{margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6;}
  .wrap{max-width:820px;margin:0 auto;padding:32px 20px 80px;}
  header.page-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
  .brand{font-family:var(--mono);font-weight:700;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);}
  .brand a{color:var(--muted);text-decoration:none;} .brand span{color:var(--accent);}
  .nav-link{font-family:var(--mono);font-size:12px;color:var(--accent);text-decoration:none;}
  .hero{display:flex;gap:20px;margin-bottom:16px;flex-wrap:wrap;}
  .hero-img{width:120px;height:120px;border-radius:12px;object-fit:cover;border:1px solid var(--panel-line);flex-shrink:0;}
  .hero-img.placeholder{display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1c22,#0e0f12);color:var(--accent-dim);font-size:36px;}
  .hero-text{flex:1;min-width:200px;}
  .game-tag{font-family:var(--mono);font-size:11.5px;color:var(--accent);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;}
  h1{font-family:var(--mono);font-size:clamp(22px,4vw,30px);font-weight:700;margin:0 0 8px;}
  .meta{font-size:12.5px;color:var(--muted);font-family:var(--mono);}
  .meta .user::before{content:"@";color:var(--accent);}
  .desc{color:var(--text);opacity:0.85;font-size:14.5px;margin-top:10px;}
  .key-badge{font-family:var(--mono);font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;padding:4px 10px;border-radius:6px;display:inline-block;margin-top:8px;}
  .key-badge.keyless{color:var(--green);border:1px solid rgba(92,217,138,0.4);background:rgba(92,217,138,0.06);}
  .key-badge.haskey{color:var(--red);border:1px solid rgba(255,93,93,0.4);background:rgba(255,93,93,0.06);}
  .tag-row{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px;}
  .pill{font-family:var(--mono);font-size:10.5px;letter-spacing:0.04em;padding:3px 9px;border-radius:5px;background:rgba(255,178,56,0.1);color:var(--accent);border:1px solid rgba(255,178,56,0.25);}
  .pill.hub{background:rgba(92,217,138,0.08);color:var(--green);border-color:rgba(92,217,138,0.25);}
  .owner-actions{display:flex;gap:8px;margin-top:12px;}
  .owner-actions a,.owner-actions button{font-family:var(--mono);font-size:11.5px;padding:6px 12px;border-radius:6px;text-decoration:none;cursor:pointer;border:1px solid var(--panel-line);background:transparent;color:var(--text);}
  .owner-actions .edit-link{color:var(--accent);border-color:var(--accent-dim);}
  .owner-actions .delete-btn{color:var(--red);border-color:rgba(255,93,93,0.3);}
  .code-panel{background:var(--panel);border:1px solid var(--panel-line);border-radius:10px;padding:18px;margin-bottom:28px;}
  .code-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
  .code-head span{font-family:var(--mono);font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);}
  pre.code-block{background:#0a0b0e;border:1px solid var(--panel-line);border-radius:6px;padding:14px 0;overflow-x:auto;font-family:var(--mono);font-size:12.5px;color:#c9e6c4;margin:0;max-height:480px;}
  .code-line{display:block;padding:0 14px;white-space:pre;}
  .code-line .ln{color:var(--accent-dim);margin-right:14px;user-select:none;}
  .copy-btn{background:var(--accent);color:#1a1305;border:none;font-family:var(--mono);font-weight:700;font-size:12px;padding:8px 16px;border-radius:6px;cursor:pointer;}
  .copy-btn:hover{background:#ffc561;} .copy-btn.copied{background:#5cd98a;}
  .rating-panel{background:var(--panel);border:1px solid var(--panel-line);border-radius:10px;padding:18px;margin-bottom:16px;}
  .rating-head{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;}
  .rating-panel h3{font-family:var(--mono);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin:0 0 6px;}
  .rating-summary{font-family:var(--mono);font-size:13px;color:var(--text);}
  .stars{display:flex;gap:2px;}
  .stars button{border:0;background:none;color:#4a4d55;font-size:25px;line-height:1;padding:2px;cursor:pointer;}
  .stars button.active,.stars button:hover{color:var(--accent);}
  .rating-bars{display:flex;flex-direction:column;gap:5px;margin-top:14px;}
  .rating-row{display:grid;grid-template-columns:42px 1fr 44px;gap:8px;align-items:center;font-family:var(--mono);font-size:10px;color:var(--muted);}
  .rating-track{height:7px;background:#0a0b0e;border-radius:99px;overflow:hidden;}
  .rating-fill{height:100%;background:var(--accent);border-radius:99px;}
  .rating-note{margin:10px 0 0;font-family:var(--mono);font-size:10.5px;color:var(--muted);}
  .comments-panel{background:var(--panel);border:1px solid var(--panel-line);border-radius:10px;padding:18px;}
  .comments-panel h3{font-family:var(--mono);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--muted);margin:0 0 14px;}
  .comment{border-bottom:1px dashed var(--panel-line);padding:10px 0;font-size:13.5px;}
  .comment:last-child{border-bottom:none;}
  .comment .c-meta{font-family:var(--mono);font-size:11px;color:var(--accent-dim);margin-bottom:3px;}
  .comment-form{margin-top:14px;display:flex;flex-direction:column;gap:8px;}
  .comment-form input,.comment-form textarea{background:#0a0b0e;border:1px solid var(--panel-line);border-radius:6px;color:var(--text);padding:9px 11px;font-family:var(--sans);font-size:13px;}
  .comment-form button{align-self:flex-start;background:var(--accent);color:#1a1305;border:none;font-family:var(--mono);font-weight:700;font-size:12px;padding:8px 16px;border-radius:6px;cursor:pointer;}
  .no-comments{color:var(--muted);font-size:13px;font-family:var(--mono);}
</style>
</head>
<body>
<div class="wrap">
  <header class="page-head">
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
    <a class="nav-link" href="/scripts">← Back to all scripts</a>
  </header>
  <div class="hero">
    ${imgBlock}
    <div class="hero-text">
      ${safeGame ? `<div class="game-tag">For: ${safeGame}</div>` : ""}
      <h1>${safeTitle}</h1>
      <div class="meta"><span class="user">${safeUser}</span></div>
      <div class="tag-row">${hubPill}${tagPills}</div>
      ${keyBadge}
      <p class="desc">${safeDesc}</p>
      <div class="owner-actions" id="ownerActions" style="display:none;">
        <a class="edit-link" href="/scripts/${script.id}/edit">Edit</a>
        <button class="delete-btn" id="deleteBtn">Delete</button>
      </div>
    </div>
  </div>
  <div class="code-panel">
    <div class="code-head">
      <span>script.lua</span>
      <button class="copy-btn" id="copyBtn">Copy</button>
    </div>
    <pre class="code-block" id="codeBlock">${codeHtml}</pre>
  </div>
  <div class="rating-panel" id="ratingPanel">
    <div class="rating-head">
      <div><h3>Community rating</h3><div class="rating-summary" id="ratingSummary">Loading ratings…</div></div>
      <div class="stars" id="ratingStars" aria-label="Rate this script">
        <button type="button" data-rating="1" aria-label="1 star">★</button>
        <button type="button" data-rating="2" aria-label="2 stars">★</button>
        <button type="button" data-rating="3" aria-label="3 stars">★</button>
        <button type="button" data-rating="4" aria-label="4 stars">★</button>
        <button type="button" data-rating="5" aria-label="5 stars">★</button>
      </div>
    </div>
    <div class="rating-bars" id="ratingBars"></div>
    <p class="rating-note" id="ratingNote">Sign in with Google to rate this script.</p>
  </div>
  <div class="comments-panel">
    <h3>Comments</h3>
    <div id="commentsList"><p class="no-comments">Loading…</p></div>
    <form class="comment-form" id="commentForm">
      <input type="text" id="commentName" maxlength="40" placeholder="Your name (optional)"/>
      <textarea id="commentText" maxlength="400" rows="2" placeholder="Leave a comment — does it still work for you?" required></textarea>
      <button type="submit">Post comment</button>
    </form>
  </div>
</div>
<script>
  const SCRIPT_ID=${JSON.stringify(script.id)};
  const RAW_CODE=${safeJsonForHtml(script.code)};
  const copyBtn=document.getElementById("copyBtn");
  copyBtn.addEventListener("click",async()=>{
    try{ await navigator.clipboard.writeText(RAW_CODE); copyBtn.textContent="Copied"; copyBtn.classList.add("copied"); setTimeout(()=>{copyBtn.textContent="Copy";copyBtn.classList.remove("copied");},1500); }
    catch{ copyBtn.textContent="Press Ctrl+C"; }
  });
  fetch('/api/me').then(r=>r.json()).then(me=>{
    loggedIn=!!me.loggedIn;
    if(loggedIn) ratingNote.textContent="Choose a star rating to rate this script.";
    const isOwner=me.loggedIn&&me.sub===${JSON.stringify(script.ownerSub||null)};
    const isAdmin=me.loggedIn&&me.isAdmin;
    if(isOwner||isAdmin) document.getElementById("ownerActions").style.display="flex";
    document.getElementById("deleteBtn").addEventListener("click",async()=>{
      if(!confirm("Delete this script?")) return;
      const res=await fetch('/api/scripts/'+SCRIPT_ID,{method:"DELETE"});
      if(res.ok) window.location.href="/scripts"; else alert("Couldn't delete.");
    });
  }).catch(()=>{});
  function escapeHtml(s){return s.replace(/[&<>"']/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function timeAgo(ts){const s=Math.floor((Date.now()-ts)/1000);if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";}
  const ratingSummary=document.getElementById("ratingSummary");
  const ratingBars=document.getElementById("ratingBars");
  const ratingNote=document.getElementById("ratingNote");
  const ratingButtons=[...document.querySelectorAll("#ratingStars button")];
  let loggedIn=false;
  function renderRatings(data){
    const total=data.total||0, avg=Number(data.average||0);
    ratingSummary.textContent=total ? (avg.toFixed(1)+"/5 · "+total+" "+(total===1?"rating":"ratings")) : "No ratings yet";
    ratingBars.innerHTML=[5,4,3,2,1].map(star=>{const count=data.distribution?.[star]||0; const pct=total?Math.round(count*100/total):0; return '<div class="rating-row"><span>'+star+' star'+(star===1?"":"s")+'</span><div class="rating-track"><div class="rating-fill" style="width:'+pct+'%"></div></div><span>'+pct+'%</span></div>';}).join("");
    ratingButtons.forEach(b=>b.classList.toggle("active", Number(b.dataset.rating)<=Number(data.myRating||0)));
  }
  async function loadRatings(){
    try{const r=await fetch('/api/scripts/'+SCRIPT_ID+'/ratings'); const d=await r.json(); renderRatings(d);}
    catch{ratingSummary.textContent="Couldn't load ratings.";}
  }
  ratingButtons.forEach(btn=>btn.addEventListener("click",async()=>{
    if(!loggedIn){ratingNote.textContent="Sign in with Google to rate this script."; window.location.href='/auth/login'; return;}
    const rating=Number(btn.dataset.rating);
    try{const r=await fetch('/api/scripts/'+SCRIPT_ID+'/ratings',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rating})}); const d=await r.json(); if(!r.ok) throw new Error(d.error||"Rating failed"); renderRatings(d); ratingNote.textContent="Your rating is saved. You can change it anytime.";}catch(e){ratingNote.textContent=e.message||"Couldn't save rating.";}
  }));
    const commentsList=document.getElementById("commentsList");
  async function loadComments(){
    try{
      const res=await fetch('/api/scripts/'+SCRIPT_ID+'/comments');
      const data=await res.json(); const comments=data.comments||[];
      if(comments.length===0){commentsList.innerHTML='<p class="no-comments">No comments yet.</p>';return;}
      commentsList.innerHTML=comments.map(c=>'<div class="comment"><div class="c-meta">'+escapeHtml(c.author||"anonymous")+' · '+timeAgo(c.createdAt)+'</div>'+escapeHtml(c.text)+'</div>').join('');
    }catch{commentsList.innerHTML='<p class="no-comments">Couldn\'t load comments.</p>';}
  }
  document.getElementById("commentForm").addEventListener("submit",async(e)=>{
    e.preventDefault();
    const author=document.getElementById("commentName").value.trim();
    const text=document.getElementById("commentText").value.trim();
    if(!text) return;
    try{ await fetch('/api/scripts/'+SCRIPT_ID+'/comments',{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({author,text})}); document.getElementById("commentText").value=""; loadComments(); }catch{}
  });
  loadRatings();
  loadComments();
</script>
</body>
</html>`;
}

/* ─────────────────── EDIT PAGE ─────────────────── */
function buildEditHtml(script) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD("Edit Script — dakait.online", "Edit your script on Silk Road Script Hub.", `https://dakait.online/scripts/${script.id}/edit`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<meta name="robots" content="noindex"/>
<style>
  :root{--bg:#0c0d10;--panel:#14161b;--panel-line:#232631;--text:#e8e9ed;--muted:#8b8f9c;--accent:#ffb238;--danger:#ff5d5d;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif;}
  *{box-sizing:border-box;} html,body{margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5;}
  .wrap{max-width:680px;margin:0 auto;padding:32px 20px 80px;}
  .brand{font-family:var(--mono);font-weight:700;font-size:14px;letter-spacing:0.12em;text-transform:uppercase;color:var(--muted);margin-bottom:20px;}
  .brand a{color:var(--muted);text-decoration:none;} .brand span{color:var(--accent);}
  h1{font-family:var(--mono);font-size:26px;margin:0 0 18px;}
  .panel{background:var(--panel);border:1px solid var(--panel-line);border-radius:10px;padding:22px;}
  label{display:block;font-size:12px;color:var(--muted);margin-bottom:6px;margin-top:14px;text-transform:uppercase;letter-spacing:0.06em;}
  label:first-of-type{margin-top:0;}
  input[type="text"],textarea{width:100%;background:#0a0b0e;border:1px solid var(--panel-line);border-radius:6px;color:var(--text);padding:10px 12px;font-family:var(--sans);font-size:14px;}
  textarea#code{font-family:var(--mono);font-size:13px;min-height:180px;}
  .row{display:flex;gap:14px;flex-wrap:wrap;} .row>div{flex:1;min-width:180px;}
  .submit-btn{margin-top:18px;background:var(--accent);color:#1a1305;border:none;font-family:var(--mono);font-weight:700;font-size:13px;letter-spacing:0.05em;text-transform:uppercase;padding:11px 20px;border-radius:6px;cursor:pointer;}
  .form-msg{font-size:13px;margin-top:10px;}
  .form-msg.error{color:var(--danger);} .form-msg.ok{color:#5cd98a;}
  .toggle-group{display:flex;gap:10px;margin-top:6px;}
  .toggle-opt{flex:1;text-align:center;padding:10px;border:1px solid var(--panel-line);border-radius:6px;cursor:pointer;font-size:12.5px;font-family:var(--mono);color:var(--muted);}
  .toggle-opt.active.keyless{border-color:#5cd98a;color:#5cd98a;}
  .toggle-opt.active.haskey{border-color:var(--danger);color:var(--danger);}
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><a href="/">dakait<span>.online</span></a></div>
  <h1>Edit Script</h1>
  <section class="panel">
    <form id="edit-form">
      <label for="title">Title</label>
      <input type="text" id="title" maxlength="120" value="${escapeHtml(script.title)}" required/>
      <div class="row">
        <div><label for="placeId">Roblox Place ID</label><input type="text" id="placeId" value="${escapeHtml(script.placeId||"")}"/></div>
        <div><label for="hubName">Hub name</label><input type="text" id="hubName" value="${escapeHtml(script.hubName||"")}"/></div>
      </div>
      <label for="tags">Tags (comma separated)</label>
      <input type="text" id="tags" value="${escapeHtml((script.tags||[]).join(", "))}"/>
      <label>Key system</label>
      <div class="toggle-group">
        <div class="toggle-opt keyless" id="optKeyless">Keyless / No key</div>
        <div class="toggle-opt haskey" id="optHaskey">Has key system</div>
      </div>
      <label for="description">Description</label>
      <textarea id="description" maxlength="500" rows="2">${escapeHtml(script.description||"")}</textarea>
      <label for="code">Script code</label>
      <textarea id="code">${escapeHtml(script.code)}</textarea>
      <button type="submit" class="submit-btn">Save changes</button>
      <p class="form-msg" id="form-msg"></p>
    </form>
  </section>
</div>
<script>
  let keysystemVal=${script.keysystem?"true":"false"};
  const optKeyless=document.getElementById("optKeyless"),optHaskey=document.getElementById("optHaskey");
  function refreshToggle(){optKeyless.classList.toggle("active",!keysystemVal);optHaskey.classList.toggle("active",keysystemVal);}
  optKeyless.addEventListener("click",()=>{keysystemVal=false;refreshToggle();});
  optHaskey.addEventListener("click",()=>{keysystemVal=true;refreshToggle();});
  refreshToggle();
  document.getElementById("edit-form").addEventListener("submit",async(e)=>{
    e.preventDefault();
    const formMsg=document.getElementById("form-msg"); formMsg.textContent=""; formMsg.className="form-msg";
    try{
      const res=await fetch('/api/scripts/${script.id}',{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({title:document.getElementById("title").value.trim(),placeId:document.getElementById("placeId").value.trim()||null,hubName:document.getElementById("hubName").value.trim(),tags:document.getElementById("tags").value.trim(),description:document.getElementById("description").value.trim(),code:document.getElementById("code").value,keysystem:keysystemVal})});
      if(!res.ok){const err=await res.json();throw new Error(err.error||"Save failed");}
      formMsg.textContent="Saved."; formMsg.className="form-msg ok";
      setTimeout(()=>{window.location.href='/scripts/${script.id}';},700);
    }catch(err){formMsg.textContent=err.message||"Something went wrong.";formMsg.className="form-msg error";}
  });
</script>
</body>
</html>`;
}

/* ─────────────────── Scripts API ─────────────────── */
async function handleScriptsApi(request, env, path) {
    const method = request.method;
    const url = new URL(request.url);
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });

    if (path === "/api/scripts" && method === "GET") {
        const index = await getScriptsIndex(env);
        return jsonResponse({ scripts: [...index].sort((a, b) => b.createdAt - a.createdAt) });
    }

    if (path === "/api/scripts" && method === "POST") {
        if (!(await rateLimit(request, env, "upload", 5, 3600))) return jsonResponse({ error: "Too many uploads. Try again later." }, 429);
        let body; try { body = await readJson(request); } catch (err) { return jsonResponse({ error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body" }, 400); }
        const session = await getSession(request, env);
        const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        const description = sanitizeText(body.description, MAX_DESC_LENGTH);
        const username = session ? sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user" : sanitizeText(body.username, MAX_USERNAME_LENGTH) || "anonymous";
        const code = typeof body.code === "string" ? body.code.slice(0, MAX_CODE_LENGTH) : "";
        const hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        const tags = sanitizeTags(body.tags);
        const keysystem = !!body.keysystem;
        let placeId = body.placeId ? String(body.placeId).trim() : null;
        if (placeId && !/^\d+$/.test(placeId)) placeId = null;
        if (!title || !code) return jsonResponse({ error: "title and code are required" }, 400);
        let gameName = null;
        if (placeId) { const info = await getRobloxGameInfo(env, placeId); if (info) gameName = info.name; }
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const record = { id, title, description, username, code, placeId, gameName, hubName, tags, keysystem, createdAt, ownerSub: session ? session.sub : null };
        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(record));
        const index = await getScriptsIndex(env);
        index.push({ id, title, description, username, placeId, gameName, hubName, tags, keysystem, createdAt, length: code.length });
        await saveScriptsIndex(env, index);
        await sendDiscordWebhook(env, { title, gameName, link: `https://dakait.online/scripts/${id}`, tags, username });
        return jsonResponse({ script: record }, 201);
    }

    const singleMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)$/);
    if (singleMatch && method === "GET") {
        const raw = await env.SCRIPTS_KV.get(`script:${singleMatch[1]}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);
        return jsonResponse({ script: JSON.parse(raw) });
    }
    if (singleMatch && method === "PUT") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);
        const script = JSON.parse(raw);
        const session = await getSession(request, env);
        const isOwner = session && script.ownerSub && session.sub === script.ownerSub;
        const isAdmin = session && isAdminEmail(env, session.email);
        if (!isOwner && !isAdmin) return jsonResponse({ error: "Unauthorized" }, 401);
        let body; try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
        if (typeof body.title === "string") script.title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        if (typeof body.description === "string") script.description = sanitizeText(body.description, MAX_DESC_LENGTH);
        if (typeof body.code === "string") script.code = body.code.slice(0, MAX_CODE_LENGTH);
        if (typeof body.hubName === "string") script.hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        if (body.tags !== undefined) script.tags = sanitizeTags(body.tags);
        if (body.keysystem !== undefined) script.keysystem = !!body.keysystem;
        if (body.placeId !== undefined) {
            let placeId = body.placeId ? String(body.placeId).trim() : null;
            if (placeId && !/^\d+$/.test(placeId)) placeId = null;
            script.placeId = placeId; script.gameName = null;
            if (placeId) { const info = await getRobloxGameInfo(env, placeId); if (info) script.gameName = info.name; }
        }
        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(script));
        const index = await getScriptsIndex(env);
        await saveScriptsIndex(env, index.map(m => m.id === id ? { ...m, title: script.title, description: script.description, placeId: script.placeId, gameName: script.gameName, hubName: script.hubName, tags: script.tags, keysystem: script.keysystem, length: script.code.length } : m));
        return jsonResponse({ script });
    }
    if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);
        const script = JSON.parse(raw);
        const auth = request.headers.get("Authorization") || "";
        const masterAuthorized = !!env.DELETE_KEY && auth === `Bearer ${env.DELETE_KEY}`;
        const session = await getSession(request, env);
        const isOwner = session && script.ownerSub && session.sub === script.ownerSub;
        const isAdmin = session && isAdminEmail(env, session.email);
        if (!masterAuthorized && !isOwner && !isAdmin) return jsonResponse({ error: "Unauthorized" }, 401);
        await env.SCRIPTS_KV.delete(`script:${id}`);
        await env.SCRIPTS_KV.delete(`comments:${id}`);
        await env.SCRIPTS_KV.delete(`ratings:${id}`);
        const index = await getScriptsIndex(env);
        await saveScriptsIndex(env, index.filter(s => s.id !== id));
        return jsonResponse({ deleted: id });
    }

    const commentsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/comments$/);
    if (commentsMatch && method === "GET") {
        const raw = await env.SCRIPTS_KV.get(`comments:${commentsMatch[1]}`);
        const comments = raw ? JSON.parse(raw) : [];
        return jsonResponse({ comments: comments.sort((a, b) => b.createdAt - a.createdAt) });
    }
    if (commentsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "comment", 10, 600))) return jsonResponse({ error: "Too many comments. Try again later." }, 429);
        const id = commentsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);
        let body; try { body = await readJson(request, 5000); } catch (err) { return jsonResponse({ error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body" }, 400); }
        const text = sanitizeText(body.text, MAX_COMMENT_LENGTH);
        if (!text) return jsonResponse({ error: "Comment text required" }, 400);
        const session = await getSession(request, env);
        const author = session ? sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user" : sanitizeText(body.author, MAX_USERNAME_LENGTH) || "anonymous";
        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        const comments = raw ? JSON.parse(raw) : [];
        comments.push({ id: crypto.randomUUID(), author, text, createdAt: Date.now() });
        await env.SCRIPTS_KV.put(`comments:${id}`, JSON.stringify(comments.slice(-200)));
        return jsonResponse({ ok: true }, 201);
    }


    const ratingsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/ratings$/);
    if (ratingsMatch && method === "GET") {
        const id = ratingsMatch[1];
        const scriptRaw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!scriptRaw) return jsonResponse({ error: "Not found" }, 404);
        const raw = await env.SCRIPTS_KV.get(`ratings:${id}`);
        const ratings = raw ? JSON.parse(raw) : {};
        const counts = { 1:0, 2:0, 3:0, 4:0, 5:0 };
        let total = 0, sum = 0;
        for (const value of Object.values(ratings)) { const r = Number(value?.rating); if (r >= 1 && r <= 5) { counts[r]++; total++; sum += r; } }
        const session = await getSession(request, env);
        const myRating = session?.sub && ratings[session.sub] ? Number(ratings[session.sub].rating) : 0;
        return jsonResponse({ total, average: total ? sum / total : 0, distribution: counts, myRating });
    }
    if (ratingsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "rating", 20, 600))) return jsonResponse({ error: "Too many rating requests. Try again later." }, 429);
        const id = ratingsMatch[1];
        const scriptRaw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!scriptRaw) return jsonResponse({ error: "Not found" }, 404);
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in with Google to rate scripts" }, 401);
        let body; try { body = await readJson(request, 2000); } catch (err) { return jsonResponse({ error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body" }, 400); }
        const rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
        const raw = await env.SCRIPTS_KV.get(`ratings:${id}`);
        const ratings = raw ? JSON.parse(raw) : {};
        ratings[session.sub] = { rating, updatedAt: Date.now() };
        await env.SCRIPTS_KV.put(`ratings:${id}`, JSON.stringify(ratings));
        const counts = { 1:0, 2:0, 3:0, 4:0, 5:0 };
        let total = 0, sum = 0;
        for (const value of Object.values(ratings)) { const r = Number(value?.rating); if (r >= 1 && r <= 5) { counts[r]++; total++; sum += r; } }
        return jsonResponse({ total, average: total ? sum / total : 0, distribution: counts, myRating: rating });
    }

    return jsonResponse({ error: "Not found" }, 404);
}

/* ─────────────────── Google OAuth ─────────────────── */
const REDIRECT_URI = "https://dakait.online/auth/callback";

async function handleAuthLogin(request, env) {
    const state = crypto.randomUUID();
    await env.SESSIONS_KV.put(`oauthstate:${state}`, "1", { expirationTtl: 600 });
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` } });
}

async function handleAuthCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing code/state", { status: 400 });
    const stateOk = await env.SESSIONS_KV.get(`oauthstate:${state}`);
    if (!stateOk) return new Response("Invalid state", { status: 400 });
    await env.SESSIONS_KV.delete(`oauthstate:${state}`);
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }) });
    if (!tokenRes.ok) return new Response("Token exchange failed", { status: 400 });
    const tokenData = await tokenRes.json();
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
    if (!userRes.ok) return new Response("Failed to fetch profile", { status: 400 });
    const profile = await userRes.json();
    const sessionId = crypto.randomUUID();
    const session = { sub: profile.sub, email: profile.email, name: profile.name || profile.email, picture: profile.picture || null };
    await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 2592000 });
    return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": `session=${sessionId}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax` } });
}

function handleAuthLogout() {
    return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": "session=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax" } });
}

async function handleApiMe(request, env) {
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ loggedIn: false });
    return jsonResponse({ loggedIn: true, sub: session.sub, name: session.name, email: session.email, isAdmin: isAdminEmail(env, session.email) });
}

/* ─────────────────── Sitemap (helps Google index every script) ─────────────────── */
async function buildSitemap(env) {
    const index = await getScriptsIndex(env);
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
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // Favicon
        if (path === "/favicon.svg" || path === "/favicon.ico") {
            return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
        }

        // robots.txt — tells Google what to crawl + where sitemap is
        if (path === "/robots.txt") {
            return new Response(
                "User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nDisallow: /register-commands\nSitemap: https://dakait.online/sitemap.xml\n",
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

        // Edit page
        const editMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)\/edit$/);
        if (editMatch && request.method === "GET") {
            const raw = await env.SCRIPTS_KV.get(`script:${editMatch[1]}`);
            if (!raw) return new Response("Script not found", { status: 404 });
            const script = JSON.parse(raw);
            const session = await getSession(request, env);
            const isOwner = session && script.ownerSub && session.sub === script.ownerSub;
            const isAdmin = session && isAdminEmail(env, session.email);
            if (!isOwner && !isAdmin) return new Response("Not authorized", { status: 403 });
            return new Response(buildEditHtml(script), { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Script detail page (server-rendered — Google indexes each one)
        const detailMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)$/);
        if (detailMatch && request.method === "GET") {
            const raw = await env.SCRIPTS_KV.get(`script:${detailMatch[1]}`);
            if (!raw) return new Response("Script not found", { status: 404 });
            const script = JSON.parse(raw);
            const thumbnailUrl = script.placeId ? `/api/roblox-thumbnail?placeId=${encodeURIComponent(script.placeId)}` : null;
            return new Response(buildDetailHtml(script, thumbnailUrl), { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Scripts JSON API
        if (path.startsWith("/api/scripts")) {
            const resp = await handleScriptsApi(request, env, path);
            resp.headers.set("Access-Control-Allow-Origin", "*");
            return resp;
        }

        // Discord interaction/bot + Roblox server queue endpoints were intentionally removed.
        // Discord upload notifications via DISCORD_WEBHOOK_URL remain enabled.

        return new Response(SILK_ROAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
    }
};


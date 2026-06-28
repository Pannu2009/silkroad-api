async function verifyDiscordSignature(request, publicKey) {
    const signature = request.headers.get('X-Signature-Ed25519');
    const timestamp = request.headers.get('X-Signature-Timestamp');
    const body = await request.clone().text();
    if (!signature || !timestamp) return false;
    const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    try {
        const key = await crypto.subtle.importKey('raw', hexToBytes(publicKey), { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['verify']);
        const encoder = new TextEncoder();
        const data = encoder.encode(timestamp + body);
        const sigBytes = hexToBytes(signature);
        return await crypto.subtle.verify('NODE-ED25519', key, sigBytes, data);
    } catch (err) { return false; }
}

function getOption(options, name) {
    const opt = options.find(o => o.name === name);
    return opt ? opt.value : null;
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function sanitizeText(value, maxLen) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

const SCRIPTS_INDEX_KEY = "scripts:index";
const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;

async function getScriptsIndex(env) {
    const raw = await env.SCRIPTS_KV.get(SCRIPTS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
}
async function saveScriptsIndex(env, index) {
    await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(index));
}

// ---- Roblox thumbnail lookup (placeId -> game icon URL), cached in KV ----
async function getRobloxThumbnail(env, placeId) {
    if (!placeId || !/^\d+$/.test(String(placeId))) return null;

    const cacheKey = `robloximg:${placeId}`;
    const cached = await env.SCRIPTS_KV.get(cacheKey);
    if (cached) return cached === "NONE" ? null : cached;

    try {
        const uniRes = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        if (!uniRes.ok) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }
        const uniData = await uniRes.json();
        const universeId = uniData.universeId;
        if (!universeId) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }

        const iconRes = await fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`);
        if (!iconRes.ok) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }
        const iconData = await iconRes.json();
        const imageUrl = iconData.data?.[0]?.imageUrl;
        if (!imageUrl) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }

        await env.SCRIPTS_KV.put(cacheKey, imageUrl, { expirationTtl: 86400 });
        return imageUrl;
    } catch (err) {
        return null;
    }
}
const SILK_ROAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Silk Road — API Manifest</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root{
    --night: #1a1f2e; --ink: #0d0f14; --sand: #d4a574;
    --parchment: #e8dcc8; --vermilion: #c1502e; --green: #5fbf7a;
  }
  *{ box-sizing:border-box; margin:0; padding:0; }
  html{ scroll-behavior: smooth; }
  body{
    background: var(--ink);
    background-image:
      radial-gradient(ellipse at 20% 0%, rgba(212,165,116,0.08), transparent 60%),
      radial-gradient(ellipse at 80% 30%, rgba(193,80,46,0.06), transparent 60%),
      radial-gradient(ellipse at 50% 100%, rgba(212,165,116,0.05), transparent 60%);
    color: var(--parchment);
    font-family: 'JetBrains Mono', monospace;
    min-height: 100vh;
    padding: 8vh 6vw 6vh;
    display:flex; justify-content:center;
  }
  .manifest{ max-width: 760px; width: 100%; position: relative; z-index: 1; }
  .route-line{
    display:flex; align-items:center; gap: 10px; margin-bottom: 2.2rem;
    color: var(--sand); font-size: 0.72rem; letter-spacing: 0.18em;
    text-transform: uppercase; opacity: 0.75;
  }
  .route-line::before, .route-line::after{
    content:""; flex:1; height:1px;
    background: linear-gradient(90deg, transparent, var(--sand), transparent);
    opacity: 0.4;
  }
  h1{
    font-family: 'Fraunces', serif; font-weight: 600;
    font-size: clamp(2.6rem, 7vw, 4.4rem); line-height: 1.02; letter-spacing: -0.01em;
  }
  h1 em{ font-style: italic; color: var(--sand); }
  .tagline{ margin-top: 1.1rem; font-size: 0.95rem; opacity: 0.62; max-width: 50ch; line-height: 1.6; }
  .seal-row{ margin-top: 2.6rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.9rem; }
  .seal{
    display: inline-flex; align-items: center; gap: 0.7rem;
    padding: 0.85rem 1.3rem; border: 1px solid rgba(212,165,116,0.35);
    border-radius: 999px; background: rgba(212,165,116,0.05);
  }
  .dot{ width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2.2s infinite; }
  @keyframes pulse{
    0%{ box-shadow: 0 0 0 0 rgba(95,191,122,0.55); }
    70%{ box-shadow: 0 0 0 8px rgba(95,191,122,0); }
    100%{ box-shadow: 0 0 0 0 rgba(95,191,122,0); }
  }
  .seal-text{ font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.85; }
  .seal-text b{ color: var(--green); font-weight:500; }

  .btn{
    appearance: none; border: 1px solid rgba(193,80,46,0.5);
    background: rgba(193,80,46,0.1); color: var(--parchment);
    font-family: 'JetBrains Mono', monospace; font-size: 0.72rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    padding: 0.85rem 1.4rem; border-radius: 999px; cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    display: inline-flex; align-items: center; gap: 0.5rem;
    text-decoration: none;
  }
  .btn:hover{ background: rgba(193,80,46,0.22); border-color: var(--vermilion); }
  .btn:active{ transform: scale(0.97); }
  .btn.primary{
    background: rgba(95,191,122,0.12); border-color: rgba(95,191,122,0.45);
  }
  .btn.primary:hover{ background: rgba(95,191,122,0.22); border-color: var(--green); }
  .arrow{ transition: transform 0.25s ease; font-size: 0.85em; }
  .info-btn.open .arrow{ transform: rotate(90deg); }

  .info-panel{ max-height: 0; overflow: hidden; transition: max-height 0.45s ease; }
  .info-panel.open{ max-height: 900px; }
  .info-inner{
    margin-top: 1.8rem; padding: 1.6rem 1.8rem;
    border: 1px solid rgba(212,165,116,0.18); border-radius: 10px;
    background: rgba(232,220,200,0.03); font-size: 0.85rem; line-height: 1.75; opacity: 0.85;
  }
  .info-inner p{ margin-bottom: 1rem; }
  .info-inner p:last-child{ margin-bottom: 0; }

  section{ margin-top: 3.4rem; }
  .ledger{ border-top: 1px solid rgba(212,165,116,0.18); padding-top: 1.8rem; }
  .ledger-label{
    font-size: 0.66rem; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--vermilion); opacity: 0.85; margin-bottom: 1.1rem;
  }
  .routes{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.4rem 1.5rem; }
  .route{
    display:flex; justify-content: space-between; padding: 0.6rem 0;
    border-bottom: 1px dashed rgba(232,220,200,0.08); font-size: 0.82rem;
    transition: padding-left 0.25s ease, border-color 0.25s ease;
  }
  .route:hover{ padding-left: 0.4rem; border-color: rgba(212,165,116,0.3); }
  .route-name{ opacity: 0.9; color: var(--parchment); text-decoration:none; }
  .route-status{ color: var(--sand); opacity: 0.6; font-size: 0.74rem; }

  .crew{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.2rem; }
  .crew-card{
    border: 1px solid rgba(212,165,116,0.18); border-radius: 10px;
    padding: 1.4rem 1.6rem; background: rgba(232,220,200,0.02);
    transition: transform 0.3s ease, border-color 0.3s ease, background 0.3s ease;
  }
  .crew-card:hover{ transform: translateY(-3px); border-color: rgba(212,165,116,0.4); background: rgba(232,220,200,0.04); }
  .crew-name{ font-family: 'Fraunces', serif; font-size: 1.25rem; color: var(--sand); margin-bottom: 0.3rem; }
  .crew-role{ font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.55; margin-bottom: 0.8rem; }
  .crew-desc{ font-size: 0.82rem; opacity: 0.75; line-height: 1.6; }

  .quote-block{
    border-left: 2px solid var(--vermilion); padding-left: 1.4rem;
    font-family: 'Fraunces', serif; font-style: italic; font-size: 1.15rem;
    opacity: 0.85; line-height: 1.55;
  }
  .quote-attr{
    margin-top: 0.8rem; font-family: 'JetBrains Mono', monospace; font-style: normal;
    font-size: 0.7rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.5;
  }
  footer{
    margin-top: 3.5rem; padding-top: 1.5rem; border-top: 1px solid rgba(212,165,116,0.1);
    font-size: 0.7rem; opacity: 0.4; letter-spacing: 0.05em;
    display:flex; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem;
  }
  a{ color: var(--sand); }
  .route-name:hover{ color: var(--sand); }

  @keyframes fadeUp{ from{ opacity: 0; transform: translateY(14px); } to{ opacity: 1; transform: translateY(0); } }
  .load-in{ opacity: 0; animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
  .load-in.d1{ animation-delay: 0.05s; }
  .load-in.d2{ animation-delay: 0.2s; }
  .load-in.d3{ animation-delay: 0.35s; }
  .reveal{ opacity: 0; transform: translateY(18px); transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1); }
  .reveal.in-view{ opacity: 1; transform: translateY(0); }
  #dust{ position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; opacity: 0.5; }

  @media (prefers-reduced-motion: reduce){
    .dot{ animation: none; } html{ scroll-behavior: auto; }
    .load-in, .reveal{ animation: none !important; opacity: 1 !important; transform: none !important; transition: none !important; }
    #dust{ display: none; }
  }
</style>
</head>
<body>
  <canvas id="dust"></canvas>
  <main class="manifest">
    <div class="route-line load-in d1">Caravan Manifest</div>

    <h1 class="load-in d2">The <em>Silk Road</em><br>API</h1>
    <p class="tagline load-in d2">Backend trade routes for the realm — handling player data, currency sync, and Discord caravan dispatches.</p>

    <div class="seal-row load-in d3">
      <div class="seal">
        <span class="dot"></span>
        <span class="seal-text">Route status: <b>open</b></span>
      </div>
      <button class="btn info-btn" id="infoToggle" onclick="toggleInfo()">
        <span>More about this route</span>
        <span class="arrow">›</span>
      </button>
    </div>

    <div class="seal-row load-in d3" style="margin-top: 1rem;">
      <a class="btn primary" href="/scripts">Explore Scripts</a>
      <a class="btn" href="/upload-scripts">Upload Script</a>
    </div>

    <div class="info-panel" id="infoPanel">
      <div class="info-inner">
        <p>This API is the backbone connecting the Silk Road game servers to the outside world — it relays Discord caravan commands (rewards, lookups, verification codes), keeps a ledger of playtime per traveler, and issues one-time seals (codes) used to confirm a player's identity across platforms.</p>
        <p>Every checkpoint below is gated: owner-only commands check a Discord user ID before responding, seals expire after ten minutes, and currency never moves based on a number the client claims — only what the server itself calculates and confirms.</p>
        <p>Built and maintained out of <a href="https://dakait.online">dakait.online</a>, running on Cloudflare Workers with KV as the ledger store.</p>
      </div>
    </div>

    <section class="ledger reveal">
      <div class="ledger-label">Active Checkpoints</div>
      <div class="routes">
        <div class="route"><span class="route-name">/poll</span><span class="route-status">dispatch queue</span></div>
        <div class="route"><span class="route-name">/sync-playtime</span><span class="route-status">caravan log</span></div>
        <div class="route"><span class="route-name">/get-playtime</span><span class="route-status">caravan log</span></div>
        <div class="route"><span class="route-name">/check-existing-code</span><span class="route-status">seal registry</span></div>
        <div class="route"><span class="route-name">/store-code</span><span class="route-status">seal registry</span></div>
        <div class="route"><span class="route-name">/check-code</span><span class="route-status">seal registry</span></div>
        <div class="route"><span class="route-name">/register-commands</span><span class="route-status">Discord setup</span></div>
        <div class="route"><a href="/scripts" class="route-name">/scripts</a><span class="route-status">public loot drop</span></div>
        <div class="route"><a href="/upload-scripts" class="route-name">/upload-scripts</a><span class="route-status">drop point</span></div>
      </div>
    </section>

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
    function toggleInfo(){
      const panel = document.getElementById('infoPanel');
      const btn = document.getElementById('infoToggle');
      const isOpen = panel.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.querySelector('span').textContent = isOpen ? 'Less detail' : 'More about this route';
    }
    const revealEls = document.querySelectorAll('.reveal');
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting){ entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => observer.observe(el));

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion){
      const canvas = document.getElementById('dust');
      const ctx = canvas.getContext('2d');
      let w, h, particles;
      function resize(){ w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
      function makeParticles(){
        const count = Math.min(60, Math.floor(w / 22));
        particles = Array.from({ length: count }, () => ({
          x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.4 + 0.3,
          speedX: (Math.random() - 0.5) * 0.12, speedY: Math.random() * 0.08 + 0.02,
          alpha: Math.random() * 0.35 + 0.08
        }));
      }
      function tick(){
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
          p.x += p.speedX; p.y += p.speedY;
          if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
          if (p.x > w) p.x = 0;
          if (p.x < 0) p.x = w;
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = \`rgba(212,165,116,\${p.alpha})\`; ctx.fill();
        });
        requestAnimationFrame(tick);
      }
      resize(); makeParticles(); tick();
      window.addEventListener('resize', () => { resize(); makeParticles(); });
    }
  </script>
</body>
</html>
`;
const GALLERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scripts — dakait.online</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ background:var(--bg); color:var(--text); font-family:var(--sans); line-height:1.5; }
  @media (prefers-reduced-motion: reduce){ *{ animation:none !important; transition:none !important; } }

  .wrap{ max-width: 1080px; margin:0 auto; padding: 32px 20px 80px; }
  header.page-head{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:8px; flex-wrap:wrap; }
  .brand{ font-family:var(--mono); font-weight:700; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); }
  .brand a{ color:var(--muted); text-decoration:none; }
  .brand span{ color:var(--accent); }
  .nav-link{ font-family: var(--mono); font-size: 12px; color: var(--accent); text-decoration: none; border: 1px solid var(--accent-dim); padding: 8px 14px; border-radius: 6px; }
  .nav-link:hover{ border-color: var(--accent); }

  h1{ font-family:var(--mono); font-size:clamp(28px,5vw,40px); font-weight:700; margin:4px 0 6px; letter-spacing:-0.01em; }
  h1 .stamp{ display:inline-block; border:2px solid var(--accent); color:var(--accent); font-size:0.4em; padding:3px 8px; border-radius:3px; transform:rotate(-3deg); vertical-align:middle; margin-left:10px; letter-spacing:0.08em; }
  .tagline{ color:var(--muted); font-size:15px; margin-bottom: 22px; max-width:60ch; }

  .ad-slot{
    border: 1px dashed var(--panel-line); border-radius: 10px; padding: 18px;
    text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 28px;
  }

  .list-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; }
  .list-head h2{ font-family:var(--mono); font-size:13px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); margin:0; }
  .count{ font-family:var(--mono); font-size:12px; color:var(--accent-dim); }

  .grid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 18px; }

  .card{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:12px;
    overflow:hidden; text-decoration:none; color:var(--text);
    transition: transform 0.2s ease, border-color 0.2s ease;
    display:flex; flex-direction:column;
  }
  .card:hover{ transform: translateY(-3px); border-color: rgba(255,178,56,0.35); }

  .card-img{
    width:100%; aspect-ratio: 1/1; object-fit: cover;
    background: linear-gradient(135deg, #1a1c22, #0e0f12);
  }
  .card-img-placeholder{
    width:100%; aspect-ratio: 1/1; display:flex; align-items:center; justify-content:center;
    background: linear-gradient(135deg, #1a1c22, #0e0f12); color: var(--accent-dim);
    font-family: var(--mono); font-size: 28px;
  }

  .card-body{ padding: 14px 16px 16px; display:flex; flex-direction:column; flex:1; }
  .card-title{ font-weight:700; font-size:14.5px; margin:0 0 4px; line-height:1.3; }
  .card-desc{ color:var(--muted); font-size:12.5px; margin:0 0 10px; flex:1;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
  .card-foot{ display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--muted); margin-top:auto; }
  .card-foot .user{ font-family:var(--mono); }
  .card-foot .user::before{ content:"@"; color:var(--accent); }
  .view-tag{ font-family: var(--mono); font-size: 11px; color: var(--accent); }

  .empty{ text-align:center; color:var(--muted); font-family:var(--mono); font-size:13px; padding:60px 0; }
</style>
</head>
<body>
<div class="wrap">
  <header class="page-head">
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
    <a class="nav-link" href="/upload-scripts">+ Upload a script</a>
  </header>

  <h1>Scripts<span class="stamp">loot drop</span></h1>
  <p class="tagline">Browse what's been dropped. Click any card to read the full script, the description, and copy it.</p>

  <div class="ad-slot">Ad space — reserved</div>

  <div class="list-head">
    <h2>Latest drops</h2>
    <span class="count" id="count"></span>
  </div>

  <div id="list" class="grid"></div>
</div>

<script>
  function escapeHtml(str){
    return str.replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }
  function timeAgo(ts){
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s/60) + "m ago";
    if (s < 86400) return Math.floor(s/3600) + "h ago";
    return Math.floor(s/86400) + "d ago";
  }

  const listEl = document.getElementById("list");
  const countEl = document.getElementById("count");

  async function loadScripts(){
    listEl.innerHTML = '<p class="empty">Loading…</p>';
    try {
      const res = await fetch('/api/scripts');
      const data = await res.json();
      const scripts = data.scripts || [];
      countEl.textContent = scripts.length + (scripts.length === 1 ? " script" : " scripts");

      if (scripts.length === 0){
        listEl.innerHTML = '<p class="empty">Nothing dropped yet. Be the first.</p>';
        return;
      }

      listEl.innerHTML = "";
      scripts.forEach((meta) => {
        const a = document.createElement("a");
        a.href = '/scripts/' + meta.id;
        a.className = "card";

        const imgPart = meta.placeId
          ? '<img class="card-img" src="/api/roblox-thumbnail?placeId=' + encodeURIComponent(meta.placeId) + '" loading="lazy" onerror="this.outerHTML=\\'<div class=\\\\\\'card-img-placeholder\\\\\\'>⌗</div>\\'" />'
          : '<div class="card-img-placeholder">⌗</div>';

        a.innerHTML = imgPart +
          '<div class="card-body">' +
            '<p class="card-title">' + escapeHtml(meta.title) + '</p>' +
            '<p class="card-desc">' + escapeHtml(meta.description || "No description.") + '</p>' +
            '<div class="card-foot">' +
              '<span class="user">' + escapeHtml(meta.username) + ' · ' + timeAgo(meta.createdAt) + '</span>' +
              '<span class="view-tag">View →</span>' +
            '</div>' +
          '</div>';
        listEl.appendChild(a);
      });
    } catch (err){
      listEl.innerHTML = '<p class="empty">Couldn\\'t load scripts. Try refreshing.</p>';
    }
  }

  loadScripts();
</script>
</body>
</html>
`;
const UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Upload a Script — dakait.online</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --danger:#ff5d5d;
    --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ background:var(--bg); color:var(--text); font-family:var(--sans); line-height:1.5; }
  @media (prefers-reduced-motion: reduce){ *{ animation:none !important; transition:none !important; } }

  .wrap{ max-width: 680px; margin:0 auto; padding: 32px 20px 80px; }
  header.page-head{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:8px; flex-wrap:wrap; }
  .brand{ font-family:var(--mono); font-weight:700; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); }
  .brand a{ color:var(--muted); text-decoration:none; }
  .brand span{ color:var(--accent); }
  .nav-link{ font-family: var(--mono); font-size: 12px; color: var(--accent); text-decoration: none; border: 1px solid var(--accent-dim); padding: 8px 14px; border-radius: 6px; }
  .nav-link:hover{ border-color: var(--accent); }

  h1{ font-family:var(--mono); font-size:clamp(26px,5vw,36px); font-weight:700; margin:4px 0 6px; letter-spacing:-0.01em; }
  .tagline{ color:var(--muted); font-size:14.5px; margin-bottom: 26px; max-width:58ch; }

  .panel{ background:var(--panel); border:1px solid var(--panel-line); border-radius:10px; padding:22px; }

  label{ display:block; font-size:12px; color:var(--muted); margin-bottom:6px; margin-top:14px; text-transform:uppercase; letter-spacing:0.06em; }
  label:first-of-type{ margin-top:0; }
  .hint{ font-size: 11.5px; color: var(--accent-dim); margin-top: 4px; }

  input[type="text"], textarea{
    width:100%; background:#0a0b0e; border:1px solid var(--panel-line); border-radius:6px;
    color:var(--text); padding:10px 12px; font-family:var(--sans); font-size:14px;
  }
  textarea#code{ font-family:var(--mono); font-size:13px; min-height:180px; resize:vertical; }
  input:focus, textarea:focus{ outline:2px solid var(--accent); outline-offset:1px; }

  .row{ display:flex; gap:14px; flex-wrap:wrap; }
  .row > div{ flex:1; min-width:180px; }

  .submit-btn{
    margin-top:18px; background:var(--accent); color:#1a1305; border:none;
    font-family:var(--mono); font-weight:700; font-size:13px; letter-spacing:0.05em;
    text-transform:uppercase; padding:11px 20px; border-radius:6px; cursor:pointer;
  }
  .submit-btn:hover{ background:#ffc561; }
  .submit-btn:disabled{ opacity:0.5; cursor:not-allowed; }

  .form-msg{ font-size:13px; margin-top:10px; min-height:18px; }
  .form-msg.error{ color:var(--danger); }
  .form-msg.ok{ color:#5cd98a; }
  .form-msg.ok a{ color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header class="page-head">
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
    <a class="nav-link" href="/scripts">Browse scripts →</a>
  </header>

  <h1>Upload a Script</h1>
  <p class="tagline">No accounts. Paste your script, give it a title, and it's live on the route for anyone to find.</p>

  <section class="panel">
    <form id="upload-form">
      <label for="title">Title</label>
      <input type="text" id="title" maxlength="120" required placeholder="e.g. Auto-clicker for X" />

      <div class="row">
        <div>
          <label for="username">Your name / handle</label>
          <input type="text" id="username" maxlength="40" placeholder="anonymous" />
        </div>
        <div>
          <label for="placeId">Roblox Place ID (optional)</label>
          <input type="text" id="placeId" inputmode="numeric" placeholder="e.g. 920587237" />
        </div>
      </div>
      <p class="hint">If you add a Place ID, we'll pull that game's icon to show on the card.</p>

      <label for="description">Description</label>
      <textarea id="description" maxlength="500" rows="2" placeholder="What does it do, where does it work, anything to know before using it?"></textarea>

      <label for="code">Script code</label>
      <textarea id="code" required placeholder="Paste your code here"></textarea>

      <button type="submit" class="submit-btn">Drop it</button>
      <p class="form-msg" id="form-msg"></p>
    </form>
  </section>
</div>

<script>
  const form = document.getElementById("upload-form");
  const formMsg = document.getElementById("form-msg");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formMsg.textContent = "";
    formMsg.className = "form-msg";

    const title = document.getElementById("title").value.trim();
    const username = document.getElementById("username").value.trim();
    const placeId = document.getElementById("placeId").value.trim();
    const description = document.getElementById("description").value.trim();
    const code = document.getElementById("code").value;

    if (!title || !code.trim()){
      formMsg.textContent = "Title and script code are required.";
      formMsg.className = "form-msg error";
      return;
    }
    if (placeId && !/^\\d+$/.test(placeId)){
      formMsg.textContent = "Place ID should be numbers only.";
      formMsg.className = "form-msg error";
      return;
    }

    const submitBtn = form.querySelector(".submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Dropping…";

    try {
      const res = await fetch('/api/scripts', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, username, description, code, placeId: placeId || null }),
      });
      if (!res.ok){
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      const data = await res.json();
      formMsg.innerHTML = 'Dropped. <a href="/scripts/' + data.script.id + '">View it here</a> or check the gallery.';
      formMsg.className = "form-msg ok";
      form.reset();
    } catch (err){
      formMsg.textContent = err.message || "Something went wrong. Try again.";
      formMsg.className = "form-msg error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Drop it";
    }
  });
</script>
</body>
</html>
`;
function buildDetailHtml(script, thumbnailUrl) {
    const safeTitle = escapeHtml(script.title);
    const safeDesc = escapeHtml(script.description || "No description provided.");
    const safeUser = escapeHtml(script.username || "anonymous");
    const safeCode = escapeHtml(script.code);
    const imgBlock = thumbnailUrl
        ? `<img class="hero-img" src="${thumbnailUrl}" alt="${safeTitle} thumbnail" />`
        : `<div class="hero-img placeholder">⌗</div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${safeTitle} — dakait.online</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326;
    --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif;
  }
  *{ box-sizing:border-box; }
  html,body{ margin:0; padding:0; }
  body{ background:var(--bg); color:var(--text); font-family:var(--sans); line-height:1.6; }
  .wrap{ max-width: 820px; margin:0 auto; padding: 32px 20px 80px; }
  header.page-head{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; margin-bottom:24px; flex-wrap:wrap; }
  .brand{ font-family:var(--mono); font-weight:700; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); }
  .brand a{ color:var(--muted); text-decoration:none; }
  .brand span{ color:var(--accent); }
  .nav-link{ font-family: var(--mono); font-size: 12px; color: var(--accent); text-decoration: none; }

  .hero{ display:flex; gap: 20px; margin-bottom: 24px; flex-wrap: wrap; }
  .hero-img{ width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 1px solid var(--panel-line); flex-shrink: 0; }
  .hero-img.placeholder{ display:flex; align-items:center; justify-content:center; background: linear-gradient(135deg, #1a1c22, #0e0f12); color: var(--accent-dim); font-size: 36px; }
  .hero-text{ flex: 1; min-width: 200px; }
  h1{ font-family:var(--mono); font-size:clamp(22px,4vw,30px); font-weight:700; margin:0 0 8px; letter-spacing:-0.01em; }
  .meta{ font-size:12.5px; color:var(--muted); font-family: var(--mono); }
  .meta .user::before{ content:"@"; color:var(--accent); }
  .desc{ color: var(--text); opacity: 0.85; font-size: 14.5px; margin-top: 10px; }

  .ad-slot{
    border: 1px dashed var(--panel-line); border-radius: 10px; padding: 16px;
    text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 24px;
  }

  .code-panel{ background:var(--panel); border:1px solid var(--panel-line); border-radius:10px; padding: 18px; }
  .code-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; }
  .code-head span{ font-family:var(--mono); font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color: var(--muted); }
  pre.code-block{
    background:#0a0b0e; border:1px solid var(--panel-line); border-radius:6px;
    padding:14px 16px; overflow-x:auto; font-family:var(--mono); font-size:13px; color:#c9e6c4; margin:0;
  }
  .copy-btn{
    background: var(--accent); color: #1a1305; border:none; font-family:var(--mono);
    font-weight: 700; font-size:12px; padding:8px 16px; border-radius:6px; cursor:pointer;
  }
  .copy-btn:hover{ background:#ffc561; }
  .copy-btn.copied{ background:#5cd98a; }
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
      <h1>${safeTitle}</h1>
      <div class="meta"><span class="user">${safeUser}</span></div>
      <p class="desc">${safeDesc}</p>
    </div>
  </div>

  <div class="ad-slot">Ad space — reserved</div>

  <div class="code-panel">
    <div class="code-head">
      <span>script.lua</span>
      <button class="copy-btn" id="copyBtn">Copy</button>
    </div>
    <pre class="code-block" id="codeBlock">${safeCode}</pre>
  </div>
</div>

<script>
  const codeBlock = document.getElementById("codeBlock");
  const copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(codeBlock.textContent);
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("copied"); }, 1500);
    } catch {
      copyBtn.textContent = "Press Ctrl+C";
    }
  });
</script>
</body>
</html>
`;
}

/* ───────────────────────── Scripts API ───────────────────────── */

async function handleScriptsApi(request, env, path) {
    const method = request.method;
    const url = new URL(request.url);

    if (method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    if (path === "/api/scripts" && method === "GET") {
        const index = await getScriptsIndex(env);
        const sorted = [...index].sort((a, b) => b.createdAt - a.createdAt);
        return jsonResponse({ scripts: sorted });
    }

    if (path === "/api/scripts" && method === "POST") {
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

        const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        const description = sanitizeText(body.description, MAX_DESC_LENGTH);
        const username = sanitizeText(body.username, MAX_USERNAME_LENGTH) || "anonymous";
        const code = typeof body.code === "string" ? body.code.slice(0, MAX_CODE_LENGTH) : "";
        let placeId = body.placeId ? String(body.placeId).trim() : null;
        if (placeId && !/^\d+$/.test(placeId)) placeId = null;

        if (!title || !code) return jsonResponse({ error: "title and code are required" }, 400);

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const record = { id, title, description, username, code, placeId, createdAt };

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(record));

        const index = await getScriptsIndex(env);
        index.push({ id, title, description, username, placeId, createdAt, length: code.length });
        await saveScriptsIndex(env, index);

        return jsonResponse({ script: record }, 201);
    }

    const singleMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)$/);
    if (singleMatch && method === "GET") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);
        return jsonResponse({ script: JSON.parse(raw) });
    }

    if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        const key = url.searchParams.get("key");
        if (!env.DELETE_KEY || key !== env.DELETE_KEY) return jsonResponse({ error: "Unauthorized" }, 401);
        await env.SCRIPTS_KV.delete(`script:${id}`);
        const index = await getScriptsIndex(env);
        await saveScriptsIndex(env, index.filter((s) => s.id !== id));
        return jsonResponse({ deleted: id });
    }

    return jsonResponse({ error: "Not found" }, 404);
}

/* ───────────────────────── Main fetch handler ───────────────────────── */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const OWNER_ID = "991408492780986398";
        const path = url.pathname;

        // Gallery
        if (path === "/scripts" || path === "/scripts/") {
            return new Response(GALLERY_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Upload page
        if (path === "/upload-scripts" || path === "/upload-scripts/") {
            return new Response(UPLOAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Roblox thumbnail proxy
        if (path === "/api/roblox-thumbnail" && request.method === "GET") {
            const placeId = url.searchParams.get("placeId");
            const imageUrl = await getRobloxThumbnail(env, placeId);
            if (!imageUrl) return new Response("Not found", { status: 404 });
            const imgRes = await fetch(imageUrl);
            return new Response(imgRes.body, {
                headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/png", "Cache-Control": "public, max-age=86400" },
            });
        }

        // Script detail page (server-rendered)
        const detailMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)$/);
        if (detailMatch && request.method === "GET") {
            const id = detailMatch[1];
            const raw = await env.SCRIPTS_KV.get(`script:${id}`);
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

        if (path === "/register-commands") {
            const commandData = [
                { name: "finduser", description: "Fetch stats (Owner Only)", options: [{ name: "userid", description: "Target UserID", type: 10, required: true }] },
                { name: "reward", description: "Admin reward (Owner Only)", options: [
                    { name: "type", description: "Reward", type: 3, required: true, choices: [{name: "Dinars", value: "dinars"}, {name: "XP", value: "xp"}] },
                    { name: "userid", description: "Target UserID", type: 10, required: true },
                    { name: "amount", description: "Quantity", type: 10, required: true }
                ]},
                { name: "verify", description: "Get your reward code", options: [{ name: "userid", description: "Your UserID", type: 10, required: true }] }
            ];
            const response = await fetch(`https://discord.com/api/v10/applications/1451040870689411193/commands`, {
                method: "PUT",
                headers: { "Authorization": `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
                body: JSON.stringify(commandData)
            });
            return new Response(await response.text(), { status: response.status });
        }

        if (request.method === "POST") {
            const isValid = await verifyDiscordSignature(request, env.DISCORD_PUBLIC_KEY);
            if (!isValid) return new Response("Unauthorized", { status: 401 });

            const interaction = await request.json();
            if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

            const userId = interaction.member.user.id;
            const cmd = interaction.data.name;
            const options = interaction.data.options || [];

            if ((cmd === "finduser" || cmd === "reward") && userId !== OWNER_ID) {
                return new Response(JSON.stringify({ type: 4, data: { content: "❌ Access Denied." } }), { headers: { "Content-Type": "application/json" } });
            }

            const commandId = Date.now().toString();
            let cmdData = { command: cmd, token: interaction.token };

            if (cmd === "reward") {
                cmdData.type = getOption(options, "type");
                cmdData.userId = getOption(options, "userid");
                cmdData.amount = getOption(options, "amount");
            } else {
                cmdData.userId = getOption(options, "userid");
            }

            await env.SILK_ROAD_KV.put(`CMD_${commandId}`, JSON.stringify(cmdData));
            const list = JSON.parse(await env.SILK_ROAD_KV.get("CMD_LIST") || "[]");
            list.push(commandId);
            await env.SILK_ROAD_KV.put("CMD_LIST", JSON.stringify(list));

            return new Response(JSON.stringify({ type: 5 }), { headers: { "Content-Type": "application/json" } });
        }

        if (path === "/poll") {
            const list = JSON.parse(await env.SILK_ROAD_KV.get("CMD_LIST") || "[]");
            if (list.length > 0) {
                const cmdId = list.shift();
                const data = await env.SILK_ROAD_KV.get(`CMD_${cmdId}`);
                await env.SILK_ROAD_KV.put("CMD_LIST", JSON.stringify(list));
                await env.SILK_ROAD_KV.delete(`CMD_${cmdId}`);
                return new Response(data, { headers: { "Content-Type": "application/json" } });
            }
            return new Response(null, { status: 204 });
        }

        if (path === "/sync-playtime") {
            await env.SILK_ROAD_KV.put(`PLAYTIME_${url.searchParams.get("userid")}`, url.searchParams.get("time"));
            return new Response("OK", { status: 200 });
        }
        if (path === "/get-playtime") {
            const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${url.searchParams.get("userid")}`) || "0";
            return new Response(playtime, { status: 200 });
        }

        if (path === "/check-existing-code") {
            const userId = url.searchParams.get("userid");
            const existingCode = await env.SILK_ROAD_KV.get(`CODE_BY_USER_${userId}`);
            return new Response(existingCode || "None", { status: 200 });
        }
        if (path === "/store-code") {
            const code = url.searchParams.get("code");
            const userId = url.searchParams.get("userid");
            await env.SILK_ROAD_KV.put(`CODE_${code}`, userId, { expirationTtl: 600 });
            await env.SILK_ROAD_KV.put(`CODE_BY_USER_${userId}`, code, { expirationTtl: 600 });
            return new Response("OK", { status: 200 });
        }
        if (path === "/check-code") {
            const originalId = await env.SILK_ROAD_KV.get(`CODE_${url.searchParams.get("code")}`);
            if (originalId && originalId === url.searchParams.get("userid")) {
                await env.SILK_ROAD_KV.delete(`CODE_${url.searchParams.get("code")}`);
                await env.SILK_ROAD_KV.put(`USED_${url.searchParams.get("userid")}`, "true");
                return new Response("VALID", { status: 200 });
            }
            return new Response("INVALID", { status: 403 });
        }

        return new Response(SILK_ROAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
    }
};


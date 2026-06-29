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

function jsonResponse(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json", ...extraHeaders },
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

function sanitizeTags(input) {
    if (!input) return [];
    let arr;
    if (Array.isArray(input)) arr = input;
    else if (typeof input === "string") arr = input.split(",");
    else return [];
    return arr
        .map((t) => String(t).trim().toUpperCase().replace(/[\[\]]/g, ""))
        .filter((t) => t.length > 0 && t.length <= 24)
        .slice(0, 10);
}

function renderCodeWithLineNumbers(code) {
    const lines = code.split("\n");
    return lines
        .map((line, i) => {
            const num = String(i + 1).padStart(3, " ");
            return `<span class="code-line"><span class="ln">${num}</span><span class="lt">${escapeHtml(line) || " "}</span></span>`;
        })
        .join("\n");
}

const SCRIPTS_INDEX_KEY = "scripts:index";
const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;
const MAX_HUB_LENGTH = 40;
const MAX_COMMENT_LENGTH = 400;

async function getScriptsIndex(env) {
    const raw = await env.SCRIPTS_KV.get(SCRIPTS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
}
async function saveScriptsIndex(env, index) {
    await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(index));
}

// ---- Roblox game info (name + icon), cached together in KV ----
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
    } catch (err) {
        return null;
    }
}

// ---- Session / Google OAuth helpers ----
function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const out = {};
    header.split(";").forEach((part) => {
        const [k, ...v] = part.trim().split("=");
        if (k) out[k] = decodeURIComponent(v.join("="));
    });
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
        `Title: ${title}`,
        link,
        tags && tags.length ? `Tags: ${tags.map((t) => `\`${t}\``).join(" ")}` : null,
    ].filter(Boolean);

    try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: lines.join("\n") }),
        });
    } catch (err) { /* ignore webhook failures */ }
}
const SILK_ROAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Silk Road - Script Hub - Free Roblox Scripts</title>
<meta name="description" content="Free Roblox scripts for BlocFruits, Grow a Garden, Block Local,Rivals and more Browser keyless scripts, upload your own and discover new scripts daily">
<meta property="og:type" content="website">
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
    <div class="route-line load-in d1">SilkRoad Scripts Caravan Manifest</div>

    <h1 class="load-in d2">The <em>Silk Road</em><br>Script Hub</h1>
    <p class="tagline load-in d2">Explore The World Biggest Route and Finds Scripts you like., BloxFruits, Grow A Garden, Rivals, LumberTyccon 2 - All Avaibile Here</p>

    <div class="seal-row load-in d3">
      <div class="seal">
        <span class="dot"></span>
        <span class="seal-text">Route : <b>open</b></span>
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

    <div class="seal-row load-in d3" style="margin-top: 1rem;" id="accountRow"></div>

    <div class="info-panel" id="infoPanel">
      <div class="info-inner">
        <p>This Route has many Scripts for you to use From being a Route connecting to our Api Apps and more now a Script Hub for players Who Want a ShortCut in games , Soon we will add Pc Games also Stay Connected </p>
        <p>Every Script of our Hub has a Mark of SilkRoad , Now Get on the route, carry your wagons and get your Own Scripts Now.</p>
        <p>Built and maintained out of <a href="https://dakait.online">dakait.online</a>, .</p>
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
      <span>operated by Dakait SHAH  &amp; Dakait GURI</span>
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

    fetch('/api/me').then(r => r.json()).then(me => {
      const row = document.getElementById('accountRow');
      if (me.loggedIn) {
        row.innerHTML = '<span class="seal-text" style="opacity:0.75;">Signed in as ' + me.name + '</span><a class="btn" href="/auth/logout">Log out</a>';
      } else {
        row.innerHTML = '<a class="btn" href="/auth/login">Sign in with Google</a>';
      }
    }).catch(() => {});
  </script>
</body>
</html>
`;
const GALLERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Roblox Scripts — Silk Road Script Hub</title>
<meta name="description" content="Browse free Roblox scripts on Silk Road — tagged, searchable, with key system status and game thumbnails for every drop.">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --green:#5cd98a; --red:#ff5d5d;
    --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif;
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

  .search-row{ margin-bottom: 22px; }
  input#searchBox{
    width: 100%; background:var(--panel); border:1px solid var(--panel-line); border-radius:8px;
    color:var(--text); padding:12px 14px; font-family:var(--sans); font-size:14px;
  }
  input#searchBox:focus{ outline:2px solid var(--accent); outline-offset:1px; }

  .ad-slot{
    border: 1px dashed var(--panel-line); border-radius: 10px; padding: 18px;
    text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 28px;
  }

  .list-head{ display:flex; justify-content:space-between; align-items:baseline; margin-bottom:16px; }
  .list-head h2{ font-family:var(--mono); font-size:13px; text-transform:uppercase; letter-spacing:0.1em; color:var(--muted); margin:0; }
  .count{ font-family:var(--mono); font-size:12px; color:var(--accent-dim); }

  .grid{ display:grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 18px; }

  .card{
    background:var(--panel); border:1px solid var(--panel-line); border-radius:12px;
    overflow:hidden; text-decoration:none; color:var(--text);
    transition: transform 0.2s ease, border-color 0.2s ease;
    display:flex; flex-direction:column; position: relative;
  }
  .card:hover{ transform: translateY(-3px); border-color: rgba(255,178,56,0.35); }

  .card-img{ width:100%; aspect-ratio: 1/1; object-fit: cover; background: linear-gradient(135deg, #1a1c22, #0e0f12); }
  .card-img-placeholder{
    width:100%; aspect-ratio: 1/1; display:flex; align-items:center; justify-content:center;
    background: linear-gradient(135deg, #1a1c22, #0e0f12); color: var(--accent-dim); font-family: var(--mono); font-size: 28px;
  }

  .key-badge{
    position: absolute; top: 8px; right: 8px; font-family: var(--mono); font-size: 9.5px;
    letter-spacing: 0.06em; text-transform: uppercase; padding: 3px 8px; border-radius: 5px;
    background: rgba(12,13,16,0.85);
  }
  .key-badge.keyless{ color: var(--green); border: 1px solid rgba(92,217,138,0.4); }
  .key-badge.haskey{ color: var(--red); border: 1px solid rgba(255,93,93,0.4); }

  .card-body{ padding: 12px 14px 14px; display:flex; flex-direction:column; flex:1; }
  .game-tag{ font-family: var(--mono); font-size: 10.5px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px; }
  .card-title{ font-weight:700; font-size:14px; margin:0 0 4px; line-height:1.3; }
  .card-desc{ color:var(--muted); font-size:12px; margin:0 0 8px; flex:1;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }

  .tag-row{ display:flex; flex-wrap:wrap; gap:4px; margin-bottom: 8px; }
  .pill{ font-family: var(--mono); font-size: 9.5px; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 4px; background: rgba(255,178,56,0.1); color: var(--accent); border: 1px solid rgba(255,178,56,0.25); }
  .pill.hub{ background: rgba(92,217,138,0.08); color: var(--green); border-color: rgba(92,217,138,0.25); }

  .card-foot{ display:flex; justify-content:space-between; align-items:center; font-size:11px; color:var(--muted); margin-top:auto; }
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

  <div class="search-row">
    <input id="searchBox" type="text" placeholder="Search by title, game, or tag — e.g. blox fruit, ESP, auto-farm" />
  </div>

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
  const searchBox = document.getElementById("searchBox");
  let allScripts = [];

  function render(scripts){
    if (scripts.length === 0){
      listEl.innerHTML = '<p class="empty">Nothing matches. Try a different search.</p>';
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

      const keyBadge = meta.keysystem
        ? '<span class="key-badge haskey">Key System</span>'
        : '<span class="key-badge keyless">Keyless</span>';

      const tags = (meta.tags || []).map(t => '<span class="pill">' + escapeHtml(t) + '</span>').join('');
      const hubPill = meta.hubName ? '<span class="pill hub">' + escapeHtml(meta.hubName) + '</span>' : '';
      const gameTag = meta.gameName ? '<div class="game-tag">' + escapeHtml(meta.gameName) + '</div>' : '';

      a.innerHTML = imgPart + keyBadge +
        '<div class="card-body">' +
          gameTag +
          '<p class="card-title">' + escapeHtml(meta.title) + '</p>' +
          '<p class="card-desc">' + escapeHtml(meta.description || "No description.") + '</p>' +
          '<div class="tag-row">' + hubPill + tags + '</div>' +
          '<div class="card-foot">' +
            '<span class="user">' + escapeHtml(meta.username) + ' · ' + timeAgo(meta.createdAt) + '</span>' +
            '<span class="view-tag">View →</span>' +
          '</div>' +
        '</div>';
      listEl.appendChild(a);
    });
  }

  async function loadScripts(){
    listEl.innerHTML = '<p class="empty">Loading…</p>';
    try {
      const res = await fetch('/api/scripts');
      const data = await res.json();
      allScripts = data.scripts || [];
      countEl.textContent = allScripts.length + (allScripts.length === 1 ? " script" : " scripts");
      render(allScripts);
    } catch (err){
      listEl.innerHTML = '<p class="empty">Couldn\\'t load scripts. Try refreshing.</p>';
    }
  }

  searchBox.addEventListener("input", () => {
    const q = searchBox.value.trim().toLowerCase();
    if (!q) { render(allScripts); return; }
    const filtered = allScripts.filter(m => {
      const hay = [m.title, m.description, m.gameName, m.hubName, ...(m.tags||[])].join(" ").toLowerCase();
      return hay.includes(q);
    });
    render(filtered);
  });

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
<title>Upload a Script — Silk Road Script Hub</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --danger:#ff5d5d; --green:#5cd98a;
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
  .tagline{ color:var(--muted); font-size:14.5px; margin-bottom: 18px; max-width:58ch; }

  .login-banner{
    display:flex; justify-content:space-between; align-items:center; gap: 10px;
    border:1px solid var(--panel-line); border-radius:8px; padding: 10px 14px;
    margin-bottom: 22px; font-size: 13px; color: var(--muted); flex-wrap: wrap;
  }
  .login-banner a{ color: var(--accent); text-decoration: none; font-family: var(--mono); font-size: 12px; }

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

  .toggle-group{ display:flex; gap: 10px; margin-top: 6px; }
  .toggle-opt{
    flex:1; text-align:center; padding: 10px; border:1px solid var(--panel-line); border-radius:6px;
    cursor:pointer; font-size: 12.5px; font-family: var(--mono); color: var(--muted); user-select: none;
  }
  .toggle-opt.active.keyless{ border-color: var(--green); color: var(--green); background: rgba(92,217,138,0.08); }
  .toggle-opt.active.haskey{ border-color: var(--danger); color: var(--danger); background: rgba(255,93,93,0.08); }

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
  <p class="tagline">Paste your script, give it a title, and it's live for anyone to find.</p>

  <div class="login-banner" id="loginBanner">Checking login status…</div>

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
      <p class="hint">If you add a Place ID, we'll pull that game's name and icon automatically.</p>

      <div class="row">
        <div>
          <label for="hubName">Made by a hub? (optional)</label>
          <input type="text" id="hubName" maxlength="40" placeholder="e.g. SpeedXHub, ZenithHub" />
        </div>
        <div>
          <label for="tags">Tags (up to 10, comma separated)</label>
          <input type="text" id="tags" placeholder="e.g. AUTO-FARM, ESP, GUI" />
        </div>
      </div>

      <label>Key system</label>
      <div class="toggle-group">
        <div class="toggle-opt active keyless" id="optKeyless" data-val="false">Keyless / No key</div>
        <div class="toggle-opt haskey" id="optHaskey" data-val="true">Has key system</div>
      </div>

      <label for="description" style="margin-top:14px;">Description</label>
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
  const loginBanner = document.getElementById("loginBanner");
  const optKeyless = document.getElementById("optKeyless");
  const optHaskey = document.getElementById("optHaskey");
  let keysystemVal = false;

  optKeyless.addEventListener("click", () => {
    keysystemVal = false;
    optKeyless.classList.add("active"); optHaskey.classList.remove("active");
  });
  optHaskey.addEventListener("click", () => {
    keysystemVal = true;
    optHaskey.classList.add("active"); optKeyless.classList.remove("active");
  });

  fetch('/api/me').then(r => r.json()).then(me => {
    if (me.loggedIn) {
      loginBanner.innerHTML = 'Signed in as <b>' + me.name + '</b> — uploads will be tied to your account so you can edit or delete them later. <a href="/auth/logout">Log out</a>';
      document.getElementById("username").value = me.name;
    } else {
      loginBanner.innerHTML = 'Not signed in — you can still upload anonymously, but you won\\'t be able to edit/delete it later. <a href="/auth/login">Sign in with Google</a>';
    }
  }).catch(() => { loginBanner.textContent = ''; });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formMsg.textContent = "";
    formMsg.className = "form-msg";

    const title = document.getElementById("title").value.trim();
    const username = document.getElementById("username").value.trim();
    const placeId = document.getElementById("placeId").value.trim();
    const hubName = document.getElementById("hubName").value.trim();
    const tags = document.getElementById("tags").value.trim();
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
        body: JSON.stringify({ title, username, description, code, placeId: placeId || null, hubName, tags, keysystem: keysystemVal }),
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
    const safeGame = script.gameName ? escapeHtml(script.gameName) : null;
    const codeHtml = renderCodeWithLineNumbers(script.code);
    const tags = script.tags || [];
    const tagPills = tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");
    const hubPill = script.hubName ? `<span class="pill hub">${escapeHtml(script.hubName)}</span>` : "";
    const keyBadge = script.keysystem
        ? `<span class="key-badge haskey">Key System</span>`
        : `<span class="key-badge keyless">Keyless / No Key</span>`;

    const imgBlock = thumbnailUrl
        ? `<img class="hero-img" src="${thumbnailUrl}" alt="${safeTitle} thumbnail" />`
        : `<div class="hero-img placeholder">⌗</div>`;

    const metaTitle = safeGame ? `${safeTitle} — Script for ${safeGame}` : safeTitle;
    const metaDesc = safeGame
        ? `Free Roblox script for ${safeGame}. ${safeDesc}`.slice(0, 160)
        : safeDesc.slice(0, 160);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${metaTitle} — dakait.online</title>
<meta name="description" content="${metaDesc}">
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{
    --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed;
    --muted:#8b8f9c; --accent:#ffb238; --accent-dim:#6b5326; --green:#5cd98a; --red:#ff5d5d;
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

  .hero{ display:flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; position: relative; }
  .hero-img{ width: 120px; height: 120px; border-radius: 12px; object-fit: cover; border: 1px solid var(--panel-line); flex-shrink: 0; }
  .hero-img.placeholder{ display:flex; align-items:center; justify-content:center; background: linear-gradient(135deg, #1a1c22, #0e0f12); color: var(--accent-dim); font-size: 36px; }
  .hero-text{ flex: 1; min-width: 200px; }
  .game-tag{ font-family: var(--mono); font-size: 11.5px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  h1{ font-family:var(--mono); font-size:clamp(22px,4vw,30px); font-weight:700; margin:0 0 8px; letter-spacing:-0.01em; }
  .meta{ font-size:12.5px; color:var(--muted); font-family: var(--mono); }
  .meta .user::before{ content:"@"; color:var(--accent); }
  .desc{ color: var(--text); opacity: 0.85; font-size: 14.5px; margin-top: 10px; }

  .key-badge{ font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 10px; border-radius: 6px; display:inline-block; margin-top: 8px; }
  .key-badge.keyless{ color: var(--green); border: 1px solid rgba(92,217,138,0.4); background: rgba(92,217,138,0.06); }
  .key-badge.haskey{ color: var(--red); border: 1px solid rgba(255,93,93,0.4); background: rgba(255,93,93,0.06); }

  .tag-row{ display:flex; flex-wrap:wrap; gap:6px; margin: 10px 0 4px; }
  .pill{ font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.04em; padding: 3px 9px; border-radius: 5px; background: rgba(255,178,56,0.1); color: var(--accent); border: 1px solid rgba(255,178,56,0.25); }
  .pill.hub{ background: rgba(92,217,138,0.08); color: var(--green); border-color: rgba(92,217,138,0.25); }

  .owner-actions{ display:flex; gap: 8px; margin-top: 12px; }
  .owner-actions a, .owner-actions button{
    font-family: var(--mono); font-size: 11.5px; padding: 6px 12px; border-radius: 6px;
    text-decoration: none; cursor: pointer; border: 1px solid var(--panel-line); background: transparent; color: var(--text);
  }
  .owner-actions .edit-link{ color: var(--accent); border-color: var(--accent-dim); }
  .owner-actions .delete-btn{ color: var(--red); border-color: rgba(255,93,93,0.3); }

  .ad-slot{
    border: 1px dashed var(--panel-line); border-radius: 10px; padding: 16px;
    text-align: center; color: var(--muted); font-family: var(--mono); font-size: 11px;
    letter-spacing: 0.08em; text-transform: uppercase; margin: 20px 0 24px;
  }

  .code-panel{ background:var(--panel); border:1px solid var(--panel-line); border-radius:10px; padding: 18px; margin-bottom: 28px; }
  .code-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom: 12px; }
  .code-head span{ font-family:var(--mono); font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color: var(--muted); }
  pre.code-block{
    background:#0a0b0e; border:1px solid var(--panel-line); border-radius:6px;
    padding:14px 0; overflow-x:auto; font-family:var(--mono); font-size:12.5px; color:#c9e6c4; margin:0;
    max-height: 480px;
  }
  .code-line{ display:block; padding: 0 14px; white-space: pre; }
  .code-line .ln{ color: var(--accent-dim); margin-right: 14px; user-select: none; }
  .copy-btn{
    background: var(--accent); color: #1a1305; border:none; font-family:var(--mono);
    font-weight: 700; font-size:12px; padding:8px 16px; border-radius:6px; cursor:pointer;
  }
  .copy-btn:hover{ background:#ffc561; }
  .copy-btn.copied{ background:#5cd98a; }

  .comments-panel{ background:var(--panel); border:1px solid var(--panel-line); border-radius:10px; padding: 18px; }
  .comments-panel h3{ font-family: var(--mono); font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 14px; }
  .comment{ border-bottom: 1px dashed var(--panel-line); padding: 10px 0; font-size: 13.5px; }
  .comment:last-child{ border-bottom: none; }
  .comment .c-meta{ font-family: var(--mono); font-size: 11px; color: var(--accent-dim); margin-bottom: 3px; }
  .comment-form{ margin-top: 14px; display:flex; flex-direction: column; gap: 8px; }
  .comment-form input, .comment-form textarea{
    background:#0a0b0e; border:1px solid var(--panel-line); border-radius:6px; color:var(--text);
    padding:9px 11px; font-family:var(--sans); font-size:13px;
  }
  .comment-form button{
    align-self: flex-start; background: var(--accent); color:#1a1305; border:none; font-family: var(--mono);
    font-weight:700; font-size:12px; padding:8px 16px; border-radius:6px; cursor:pointer;
  }
  .no-comments{ color: var(--muted); font-size: 13px; font-family: var(--mono); }
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

  <div class="ad-slot">Ad space — reserved</div>

  <div class="code-panel">
    <div class="code-head">
      <span>script.lua</span>
      <button class="copy-btn" id="copyBtn">Copy</button>
    </div>
    <pre class="code-block" id="codeBlock">${codeHtml}</pre>
  </div>

  <div class="comments-panel">
    <h3>Comments</h3>
    <div id="commentsList"><p class="no-comments">Loading…</p></div>
    <form class="comment-form" id="commentForm">
      <input type="text" id="commentName" maxlength="40" placeholder="Your name (optional)" />
      <textarea id="commentText" maxlength="400" rows="2" placeholder="Leave a comment — does it still work for you?" required></textarea>
      <button type="submit">Post comment</button>
    </form>
  </div>
</div>

<script>
  const SCRIPT_ID = ${JSON.stringify(script.id)};

  // Raw code for copy (line numbers stripped)
  const RAW_CODE = ${JSON.stringify(script.code)};
  const copyBtn = document.getElementById("copyBtn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(RAW_CODE);
      copyBtn.textContent = "Copied";
      copyBtn.classList.add("copied");
      setTimeout(() => { copyBtn.textContent = "Copy"; copyBtn.classList.remove("copied"); }, 1500);
    } catch {
      copyBtn.textContent = "Press Ctrl+C";
    }
  });

  // Owner / admin actions
  fetch('/api/me').then(r => r.json()).then(me => {
    const isOwner = me.loggedIn && me.sub === ${JSON.stringify(script.ownerSub || null)};
    const isAdmin = me.loggedIn && me.isAdmin;
    if (isOwner || isAdmin) {
      document.getElementById("ownerActions").style.display = "flex";
    }
    document.getElementById("deleteBtn").addEventListener("click", async () => {
      if (!confirm("Delete this script? This can't be undone.")) return;
      const res = await fetch('/api/scripts/' + SCRIPT_ID, { method: "DELETE" });
      if (res.ok) { window.location.href = "/scripts"; }
      else { alert("Couldn't delete — you may not have permission."); }
    });
  }).catch(() => {});

  // Comments
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
  const commentsList = document.getElementById("commentsList");

  async function loadComments(){
    try {
      const res = await fetch('/api/scripts/' + SCRIPT_ID + '/comments');
      const data = await res.json();
      const comments = data.comments || [];
      if (comments.length === 0){
        commentsList.innerHTML = '<p class="no-comments">No comments yet — be the first.</p>';
        return;
      }
      commentsList.innerHTML = comments.map(c =>
        '<div class="comment"><div class="c-meta">' + escapeHtml(c.author || "anonymous") + ' · ' + timeAgo(c.createdAt) + '</div>' + escapeHtml(c.text) + '</div>'
      ).join('');
    } catch {
      commentsList.innerHTML = '<p class="no-comments">Couldn\\'t load comments.</p>';
    }
  }

  document.getElementById("commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const author = document.getElementById("commentName").value.trim();
    const text = document.getElementById("commentText").value.trim();
    if (!text) return;
    try {
      await fetch('/api/scripts/' + SCRIPT_ID + '/comments', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ author, text }),
      });
      document.getElementById("commentText").value = "";
      loadComments();
    } catch {}
  });

  loadComments();
</script>
</body>
</html>
`;
}

function buildEditHtml(script) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Edit — ${escapeHtml(script.title)} — dakait.online</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');
  :root{ --bg:#0c0d10; --panel:#14161b; --panel-line:#232631; --text:#e8e9ed; --muted:#8b8f9c; --accent:#ffb238; --danger:#ff5d5d; --mono:'JetBrains Mono',monospace; --sans:'Inter',sans-serif; }
  *{ box-sizing:border-box; } html,body{ margin:0; padding:0; }
  body{ background:var(--bg); color:var(--text); font-family:var(--sans); line-height:1.5; }
  .wrap{ max-width: 680px; margin:0 auto; padding: 32px 20px 80px; }
  .brand{ font-family:var(--mono); font-weight:700; font-size:14px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom: 20px; }
  .brand a{ color:var(--muted); text-decoration:none; } .brand span{ color:var(--accent); }
  h1{ font-family:var(--mono); font-size:26px; margin: 0 0 18px; }
  .panel{ background:var(--panel); border:1px solid var(--panel-line); border-radius:10px; padding:22px; }
  label{ display:block; font-size:12px; color:var(--muted); margin-bottom:6px; margin-top:14px; text-transform:uppercase; letter-spacing:0.06em; }
  label:first-of-type{ margin-top:0; }
  input[type="text"], textarea{ width:100%; background:#0a0b0e; border:1px solid var(--panel-line); border-radius:6px; color:var(--text); padding:10px 12px; font-family:var(--sans); font-size:14px; }
  textarea#code{ font-family:var(--mono); font-size:13px; min-height:180px; }
  .row{ display:flex; gap:14px; flex-wrap:wrap; } .row > div{ flex:1; min-width:180px; }
  .submit-btn{ margin-top:18px; background:var(--accent); color:#1a1305; border:none; font-family:var(--mono); font-weight:700; font-size:13px; letter-spacing:0.05em; text-transform:uppercase; padding:11px 20px; border-radius:6px; cursor:pointer; }
  .form-msg{ font-size:13px; margin-top:10px; }
  .form-msg.error{ color:var(--danger); } .form-msg.ok{ color:#5cd98a; }
  .toggle-group{ display:flex; gap: 10px; margin-top: 6px; }
  .toggle-opt{ flex:1; text-align:center; padding: 10px; border:1px solid var(--panel-line); border-radius:6px; cursor:pointer; font-size: 12.5px; font-family: var(--mono); color: var(--muted); }
  .toggle-opt.active.keyless{ border-color: #5cd98a; color: #5cd98a; }
  .toggle-opt.active.haskey{ border-color: var(--danger); color: var(--danger); }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand"><a href="/">dakait<span>.online</span></a></div>
  <h1>Edit Script</h1>
  <section class="panel">
    <form id="edit-form">
      <label for="title">Title</label>
      <input type="text" id="title" maxlength="120" value="${escapeHtml(script.title)}" required />
      <div class="row">
        <div><label for="placeId">Roblox Place ID</label><input type="text" id="placeId" value="${escapeHtml(script.placeId || "")}" /></div>
        <div><label for="hubName">Hub name</label><input type="text" id="hubName" value="${escapeHtml(script.hubName || "")}" /></div>
      </div>
      <label for="tags">Tags (comma separated)</label>
      <input type="text" id="tags" value="${escapeHtml((script.tags || []).join(", "))}" />
      <label>Key system</label>
      <div class="toggle-group">
        <div class="toggle-opt keyless" id="optKeyless" data-val="false">Keyless / No key</div>
        <div class="toggle-opt haskey" id="optHaskey" data-val="true">Has key system</div>
      </div>
      <label for="description">Description</label>
      <textarea id="description" maxlength="500" rows="2">${escapeHtml(script.description || "")}</textarea>
      <label for="code">Script code</label>
      <textarea id="code">${escapeHtml(script.code)}</textarea>
      <button type="submit" class="submit-btn">Save changes</button>
      <p class="form-msg" id="form-msg"></p>
    </form>
  </section>
</div>
<script>
  let keysystemVal = ${script.keysystem ? "true" : "false"};
  const optKeyless = document.getElementById("optKeyless");
  const optHaskey = document.getElementById("optHaskey");
  function refreshToggle(){
    optKeyless.classList.toggle("active", !keysystemVal);
    optHaskey.classList.toggle("active", keysystemVal);
  }
  optKeyless.addEventListener("click", () => { keysystemVal = false; refreshToggle(); });
  optHaskey.addEventListener("click", () => { keysystemVal = true; refreshToggle(); });
  refreshToggle();

  document.getElementById("edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formMsg = document.getElementById("form-msg");
    formMsg.textContent = ""; formMsg.className = "form-msg";
    try {
      const res = await fetch('/api/scripts/${script.id}', {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: document.getElementById("title").value.trim(),
          placeId: document.getElementById("placeId").value.trim() || null,
          hubName: document.getElementById("hubName").value.trim(),
          tags: document.getElementById("tags").value.trim(),
          description: document.getElementById("description").value.trim(),
          code: document.getElementById("code").value,
          keysystem: keysystemVal,
        }),
      });
      if (!res.ok){ const err = await res.json(); throw new Error(err.error || "Save failed"); }
      formMsg.textContent = "Saved.";
      formMsg.className = "form-msg ok";
      setTimeout(() => { window.location.href = '/scripts/${script.id}'; }, 700);
    } catch (err){
      formMsg.textContent = err.message || "Something went wrong.";
      formMsg.className = "form-msg error";
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
                "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
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

        const session = await getSession(request, env);

        const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        const description = sanitizeText(body.description, MAX_DESC_LENGTH);
        const username = sanitizeText(body.username, MAX_USERNAME_LENGTH) || (session ? session.name : "anonymous");
        const code = typeof body.code === "string" ? body.code.slice(0, MAX_CODE_LENGTH) : "";
        const hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        const tags = sanitizeTags(body.tags);
        const keysystem = !!body.keysystem;
        let placeId = body.placeId ? String(body.placeId).trim() : null;
        if (placeId && !/^\d+$/.test(placeId)) placeId = null;

        if (!title || !code) return jsonResponse({ error: "title and code are required" }, 400);

        let gameName = null;
        if (placeId) {
            const info = await getRobloxGameInfo(env, placeId);
            if (info) gameName = info.name;
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const record = {
            id, title, description, username, code, placeId, gameName,
            hubName, tags, keysystem, createdAt,
            ownerSub: session ? session.sub : null,
        };

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(record));

        const index = await getScriptsIndex(env);
        index.push({ id, title, description, username, placeId, gameName, hubName, tags, keysystem, createdAt, length: code.length });
        await saveScriptsIndex(env, index);

        const link = `https://dakait.online/scripts/${id}`;
        await sendDiscordWebhook(env, { title, gameName, link, tags, username });

        return jsonResponse({ script: record }, 201);
    }

    const singleMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)$/);

    if (singleMatch && method === "GET") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
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

        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

        if (typeof body.title === "string") script.title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        if (typeof body.description === "string") script.description = sanitizeText(body.description, MAX_DESC_LENGTH);
        if (typeof body.code === "string") script.code = body.code.slice(0, MAX_CODE_LENGTH);
        if (typeof body.hubName === "string") script.hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        if (body.tags !== undefined) script.tags = sanitizeTags(body.tags);
        if (body.keysystem !== undefined) script.keysystem = !!body.keysystem;
        if (body.placeId !== undefined) {
            let placeId = body.placeId ? String(body.placeId).trim() : null;
            if (placeId && !/^\d+$/.test(placeId)) placeId = null;
            script.placeId = placeId;
            script.gameName = null;
            if (placeId) {
                const info = await getRobloxGameInfo(env, placeId);
                if (info) script.gameName = info.name;
            }
        }

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(script));
        const index = await getScriptsIndex(env);
        const updatedIndex = index.map((m) => m.id === id
            ? { ...m, title: script.title, description: script.description, placeId: script.placeId, gameName: script.gameName, hubName: script.hubName, tags: script.tags, keysystem: script.keysystem, length: script.code.length }
            : m
        );
        await saveScriptsIndex(env, updatedIndex);

        return jsonResponse({ script });
    }

    if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);
        const script = JSON.parse(raw);

        const masterKey = url.searchParams.get("key");
        const masterAuthorized = env.DELETE_KEY && masterKey === env.DELETE_KEY;

        const session = await getSession(request, env);
        const isOwner = session && script.ownerSub && session.sub === script.ownerSub;
        const isAdmin = session && isAdminEmail(env, session.email);

        if (!masterAuthorized && !isOwner && !isAdmin) return jsonResponse({ error: "Unauthorized" }, 401);

        await env.SCRIPTS_KV.delete(`script:${id}`);
        await env.SCRIPTS_KV.delete(`comments:${id}`);
        const index = await getScriptsIndex(env);
        await saveScriptsIndex(env, index.filter((s) => s.id !== id));
        return jsonResponse({ deleted: id });
    }

    // Comments
    const commentsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/comments$/);
    if (commentsMatch && method === "GET") {
        const id = commentsMatch[1];
        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        const comments = raw ? JSON.parse(raw) : [];
        return jsonResponse({ comments: comments.sort((a, b) => b.createdAt - a.createdAt) });
    }
    if (commentsMatch && method === "POST") {
        const id = commentsMatch[1];
        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

        const text = sanitizeText(body.text, MAX_COMMENT_LENGTH);
        if (!text) return jsonResponse({ error: "Comment text required" }, 400);

        const session = await getSession(request, env);
        const author = sanitizeText(body.author, MAX_USERNAME_LENGTH) || (session ? session.name : "anonymous");

        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        const comments = raw ? JSON.parse(raw) : [];
        comments.push({ id: crypto.randomUUID(), author, text, createdAt: Date.now() });
        await env.SCRIPTS_KV.put(`comments:${id}`, JSON.stringify(comments.slice(-200)));

        return jsonResponse({ ok: true }, 201);
    }

    return jsonResponse({ error: "Not found" }, 404);
}

/* ───────────────────────── Google OAuth ───────────────────────── */

const REDIRECT_URI = "https://dakait.online/auth/callback";

async function handleAuthLogin(request, env) {
    const state = crypto.randomUUID();
    await env.SESSIONS_KV.put(`oauthstate:${state}`, "1", { expirationTtl: 600 });

    const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: "code",
        scope: "openid email profile",
        state,
        prompt: "select_account",
    });

    return new Response(null, {
        status: 302,
        headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
    });
}

async function handleAuthCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) return new Response("Missing code/state", { status: 400 });

    const stateOk = await env.SESSIONS_KV.get(`oauthstate:${state}`);
    if (!stateOk) return new Response("Invalid or expired state", { status: 400 });
    await env.SESSIONS_KV.delete(`oauthstate:${state}`);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: REDIRECT_URI,
            grant_type: "authorization_code",
        }),
    });
    if (!tokenRes.ok) return new Response("Token exchange failed", { status: 400 });
    const tokenData = await tokenRes.json();

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) return new Response("Failed to fetch profile", { status: 400 });
    const profile = await userRes.json();

    const sessionId = crypto.randomUUID();
    const session = {
        sub: profile.sub,
        email: profile.email,
        name: profile.name || profile.email,
        picture: profile.picture || null,
    };
    await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 2592000 });

    return new Response(null, {
        status: 302,
        headers: {
            Location: "/",
            "Set-Cookie": `session=${sessionId}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax`,
        },
    });
}

function handleAuthLogout() {
    return new Response(null, {
        status: 302,
        headers: {
            Location: "/",
            "Set-Cookie": "session=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax",
        },
    });
}

async function handleApiMe(request, env) {
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ loggedIn: false });
    return jsonResponse({
        loggedIn: true,
        sub: session.sub,
        name: session.name,
        email: session.email,
        isAdmin: isAdminEmail(env, session.email),
    });
}
/* ───────────────────────── Main fetch handler ───────────────────────── */

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const OWNER_ID = "991408492780986398";
        const path = url.pathname;

        // Auth routes
        if (path === "/auth/login") return handleAuthLogin(request, env);
        if (path === "/auth/callback") return handleAuthCallback(request, env);
        if (path === "/auth/logout") return handleAuthLogout();
        if (path === "/api/me") return handleApiMe(request, env);

        // Gallery
        if (path === "/scripts" || path === "/scripts/") {
            return new Response(GALLERY_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Upload page
        if (path === "/upload-scripts" || path === "/upload-scripts/") {
            return new Response(UPLOAD_HTML, { headers: { "Content-Type": "text/html" }, status: 200 });
        }

        // Roblox thumbnail proxy (image bytes)
        if (path === "/api/roblox-thumbnail" && request.method === "GET") {
            const placeId = url.searchParams.get("placeId");
            const info = await getRobloxGameInfo(env, placeId);
            if (!info || !info.imageUrl) return new Response("Not found", { status: 404 });
            const imgRes = await fetch(info.imageUrl);
            return new Response(imgRes.body, {
                headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/png", "Cache-Control": "public, max-age=86400" },
            });
        }

        // Edit page (server-rendered)
        const editMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)\/edit$/);
        if (editMatch && request.method === "GET") {
            const id = editMatch[1];
            const raw = await env.SCRIPTS_KV.get(`script:${id}`);
            if (!raw) return new Response("Script not found", { status: 404 });
            const script = JSON.parse(raw);

            const session = await getSession(request, env);
            const isOwner = session && script.ownerSub && session.sub === script.ownerSub;
            const isAdmin = session && isAdminEmail(env, session.email);
            if (!isOwner && !isAdmin) return new Response("Not authorized to edit this script", { status: 403 });

            return new Response(buildEditHtml(script), { headers: { "Content-Type": "text/html" }, status: 200 });
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

        if (request.method === "POST" && !path.startsWith("/api/")) {
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


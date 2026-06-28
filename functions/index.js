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

const SILK_ROAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Silk Road — API Manifest</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap');

  :root{
    --night: #1a1f2e;
    --ink: #0d0f14;
    --sand: #d4a574;
    --parchment: #e8dcc8;
    --vermilion: #c1502e;
    --green: #5fbf7a;
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
    display:flex;
    justify-content:center;
  }

  .manifest{ max-width: 760px; width: 100%; position: relative; z-index: 1; }

  .route-line{
    display:flex; align-items:center; gap: 10px;
    margin-bottom: 2.2rem;
    color: var(--sand);
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.75;
  }
  .route-line::before, .route-line::after{
    content:""; flex:1; height:1px;
    background: linear-gradient(90deg, transparent, var(--sand), transparent);
    opacity: 0.4;
  }

  h1{
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(2.6rem, 7vw, 4.4rem);
    line-height: 1.02;
    letter-spacing: -0.01em;
  }
  h1 em{ font-style: italic; color: var(--sand); }

  .tagline{
    margin-top: 1.1rem;
    font-size: 0.95rem;
    opacity: 0.62;
    max-width: 50ch;
    line-height: 1.6;
  }

  .seal-row{
    margin-top: 2.6rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.9rem;
  }

  .seal{
    display: inline-flex; align-items: center; gap: 0.7rem;
    padding: 0.85rem 1.3rem;
    border: 1px solid rgba(212,165,116,0.35);
    border-radius: 999px;
    background: rgba(212,165,116,0.05);
  }
  .dot{
    width: 8px; height: 8px; border-radius: 50%;
    background: var(--green);
    animation: pulse 2.2s infinite;
  }
  @keyframes pulse{
    0%{ box-shadow: 0 0 0 0 rgba(95,191,122,0.55); }
    70%{ box-shadow: 0 0 0 8px rgba(95,191,122,0); }
    100%{ box-shadow: 0 0 0 0 rgba(95,191,122,0); }
  }
  .seal-text{ font-size: 0.74rem; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.85; }
  .seal-text b{ color: var(--green); font-weight:500; }

  .info-btn{
    appearance: none;
    border: 1px solid rgba(193,80,46,0.5);
    background: rgba(193,80,46,0.1);
    color: var(--parchment);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.85rem 1.4rem;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.2s ease, border-color 0.2s ease, transform 0.15s ease;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .info-btn:hover{ background: rgba(193,80,46,0.22); border-color: var(--vermilion); }
  .info-btn:active{ transform: scale(0.97); }
  .info-btn .arrow{ transition: transform 0.25s ease; font-size: 0.85em; }
  .info-btn.open .arrow{ transform: rotate(90deg); }

  .info-panel{ max-height: 0; overflow: hidden; transition: max-height 0.45s ease; }
  .info-panel.open{ max-height: 900px; }
  .info-inner{
    margin-top: 1.8rem;
    padding: 1.6rem 1.8rem;
    border: 1px solid rgba(212,165,116,0.18);
    border-radius: 10px;
    background: rgba(232,220,200,0.03);
    font-size: 0.85rem;
    line-height: 1.75;
    opacity: 0.85;
  }
  .info-inner p{ margin-bottom: 1rem; }
  .info-inner p:last-child{ margin-bottom: 0; }

  section{ margin-top: 3.4rem; }
  .ledger{ border-top: 1px solid rgba(212,165,116,0.18); padding-top: 1.8rem; }
  .ledger-label{
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--vermilion);
    opacity: 0.85;
    margin-bottom: 1.1rem;
  }

  .routes{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 0.4rem 1.5rem; }
  .route{
    display:flex; justify-content: space-between;
    padding: 0.6rem 0;
    border-bottom: 1px dashed rgba(232,220,200,0.08);
    font-size: 0.82rem;
    transition: padding-left 0.25s ease, border-color 0.25s ease;
  }
  .route:hover{ padding-left: 0.4rem; border-color: rgba(212,165,116,0.3); }
  .route-name{ opacity: 0.9; }
  .route-status{ color: var(--sand); opacity: 0.6; font-size: 0.74rem; }

  .crew{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.2rem; }
  .crew-card{
    border: 1px solid rgba(212,165,116,0.18);
    border-radius: 10px;
    padding: 1.4rem 1.6rem;
    background: rgba(232,220,200,0.02);
    transition: transform 0.3s ease, border-color 0.3s ease, background 0.3s ease;
  }
  .crew-card:hover{
    transform: translateY(-3px);
    border-color: rgba(212,165,116,0.4);
    background: rgba(232,220,200,0.04);
  }
  .crew-name{ font-family: 'Fraunces', serif; font-size: 1.25rem; color: var(--sand); margin-bottom: 0.3rem; }
  .crew-role{ font-size: 0.68rem; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.55; margin-bottom: 0.8rem; }
  .crew-desc{ font-size: 0.82rem; opacity: 0.75; line-height: 1.6; }

  .quote-block{
    border-left: 2px solid var(--vermilion);
    padding-left: 1.4rem;
    font-family: 'Fraunces', serif;
    font-style: italic;
    font-size: 1.15rem;
    opacity: 0.85;
    line-height: 1.55;
  }
  .quote-attr{
    margin-top: 0.8rem;
    font-family: 'JetBrains Mono', monospace;
    font-style: normal;
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.5;
  }

  footer{
    margin-top: 3.5rem;
    padding-top: 1.5rem;
    border-top: 1px solid rgba(212,165,116,0.1);
    font-size: 0.7rem;
    opacity: 0.4;
    letter-spacing: 0.05em;
    display:flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  a{ color: var(--sand); text-decoration: none; border-bottom: 1px dotted rgba(212,165,116,0.4); }
  a:hover{ border-bottom-color: var(--sand); }

  @keyframes fadeUp{
    from{ opacity: 0; transform: translateY(14px); }
    to{ opacity: 1; transform: translateY(0); }
  }

  .load-in{
    opacity: 0;
    animation: fadeUp 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .load-in.d1{ animation-delay: 0.05s; }
  .load-in.d2{ animation-delay: 0.2s; }
  .load-in.d3{ animation-delay: 0.35s; }

  .reveal{
    opacity: 0;
    transform: translateY(18px);
    transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .reveal.in-view{ opacity: 1; transform: translateY(0); }

  #dust{
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
    opacity: 0.5;
  }

  @media (prefers-reduced-motion: reduce){
    .dot{ animation: none; }
    html{ scroll-behavior: auto; }
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
      <button class="info-btn" id="infoToggle" onclick="toggleInfo()">
        <span>More about this route</span>
        <span class="arrow">›</span>
      </button>
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
        if (entry.isIntersecting){
          entry.target.classList.add('in-view');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });
    revealEls.forEach(el => observer.observe(el));

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!prefersReducedMotion){
      const canvas = document.getElementById('dust');
      const ctx = canvas.getContext('2d');
      let w, h, particles;

      function resize(){
        w = canvas.width = window.innerWidth;
        h = canvas.height = window.innerHeight;
      }
      function makeParticles(){
        const count = Math.min(60, Math.floor(w / 22));
        particles = Array.from({ length: count }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.4 + 0.3,
          speedX: (Math.random() - 0.5) * 0.12,
          speedY: Math.random() * 0.08 + 0.02,
          alpha: Math.random() * 0.35 + 0.08
        }));
      }
      function tick(){
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
          p.x += p.speedX;
          p.y += p.speedY;
          if (p.y > h) { p.y = -4; p.x = Math.random() * w; }
          if (p.x > w) p.x = 0;
          if (p.x < 0) p.x = w;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fillStyle = \`rgba(212,165,116,\${p.alpha})\`;
          ctx.fill();
        });
        requestAnimationFrame(tick);
      }

      resize();
      makeParticles();
      tick();
      window.addEventListener('resize', () => { resize(); makeParticles(); });
    }
  </script>
</body>
</html>
`;

/* ───────────────────────── Scripts page (KV-backed) ───────────────────────── */

const SCRIPTS_INDEX_KEY = "scripts:index";
const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;

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

async function getScriptsIndex(env) {
    const raw = await env.SCRIPTS_KV.get(SCRIPTS_INDEX_KEY);
    return raw ? JSON.parse(raw) : [];
}

async function saveScriptsIndex(env, index) {
    await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(index));
}

const SCRIPTS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Scripts — dakait.online</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');

  :root {
    --bg: #0c0d10;
    --panel: #14161b;
    --panel-line: #232631;
    --text: #e8e9ed;
    --muted: #8b8f9c;
    --accent: #ffb238;
    --accent-dim: #6b5326;
    --danger: #ff5d5d;
    --mono: 'JetBrains Mono', monospace;
    --sans: 'Inter', sans-serif;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    line-height: 1.5;
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
  }

  .wrap {
    max-width: 920px;
    margin: 0 auto;
    padding: 32px 20px 80px;
  }

  header.page-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 8px;
    flex-wrap: wrap;
  }

  .brand {
    font-family: var(--mono);
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .brand a { color: var(--muted); text-decoration: none; }
  .brand span { color: var(--accent); }

  h1 {
    font-family: var(--mono);
    font-size: clamp(28px, 5vw, 40px);
    font-weight: 700;
    margin: 4px 0 6px;
    letter-spacing: -0.01em;
  }
  h1 .stamp {
    display: inline-block;
    border: 2px solid var(--accent);
    color: var(--accent);
    font-size: 0.4em;
    padding: 3px 8px;
    border-radius: 3px;
    transform: rotate(-3deg);
    vertical-align: middle;
    margin-left: 10px;
    letter-spacing: 0.08em;
  }

  .tagline {
    color: var(--muted);
    font-size: 15px;
    margin-bottom: 28px;
    max-width: 56ch;
  }

  .panel {
    background: var(--panel);
    border: 1px solid var(--panel-line);
    border-radius: 10px;
    padding: 22px;
    margin-bottom: 36px;
  }
  .panel-title {
    font-family: var(--mono);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin: 0 0 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .panel-title::before { content: "▸"; }

  label {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    margin-top: 14px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  label:first-of-type { margin-top: 0; }

  input[type="text"], textarea {
    width: 100%;
    background: #0a0b0e;
    border: 1px solid var(--panel-line);
    border-radius: 6px;
    color: var(--text);
    padding: 10px 12px;
    font-family: var(--sans);
    font-size: 14px;
  }
  textarea#code {
    font-family: var(--mono);
    font-size: 13px;
    min-height: 140px;
    resize: vertical;
  }
  input:focus, textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .row { display: flex; gap: 14px; flex-wrap: wrap; }
  .row > div { flex: 1; min-width: 180px; }

  .submit-btn {
    margin-top: 18px;
    background: var(--accent);
    color: #1a1305;
    border: none;
    font-family: var(--mono);
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 11px 20px;
    border-radius: 6px;
    cursor: pointer;
  }
  .submit-btn:hover { background: #ffc561; }
  .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .form-msg { font-size: 13px; margin-top: 10px; min-height: 18px; }
  .form-msg.error { color: var(--danger); }
  .form-msg.ok { color: #5cd98a; }

  .list-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 14px;
  }
  .list-head h2 {
    font-family: var(--mono);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--muted);
    margin: 0;
  }
  .count { font-family: var(--mono); font-size: 12px; color: var(--accent-dim); }

  .card {
    background: var(--panel);
    border: 1px solid var(--panel-line);
    border-radius: 10px;
    padding: 18px 18px 16px;
    margin-bottom: 14px;
    position: relative;
  }
  .card-tag {
    position: absolute;
    top: -9px;
    right: 16px;
    background: var(--bg);
    border: 1px solid var(--accent-dim);
    color: var(--accent);
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .card-title { font-weight: 700; font-size: 15px; margin: 0 0 4px; padding-right: 70px; }
  .card-desc { color: var(--muted); font-size: 13.5px; margin: 0 0 12px; }

  pre.code-block {
    background: #0a0b0e;
    border: 1px solid var(--panel-line);
    border-radius: 6px;
    padding: 12px 14px;
    overflow-x: auto;
    font-family: var(--mono);
    font-size: 12.5px;
    color: #c9e6c4;
    margin: 0 0 12px;
    max-height: 220px;
  }

  .card-foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    color: var(--muted);
  }
  .card-foot .user { font-family: var(--mono); }
  .card-foot .user::before { content: "@"; color: var(--accent); }

  .copy-btn {
    background: transparent;
    border: 1px solid var(--panel-line);
    color: var(--text);
    font-family: var(--mono);
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
  }
  .copy-btn:hover { border-color: var(--accent); color: var(--accent); }
  .copy-btn.copied { border-color: #5cd98a; color: #5cd98a; }

  .empty {
    text-align: center;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 13px;
    padding: 40px 0;
  }
</style>
</head>
<body>
<div class="wrap">

  <header class="page-head">
    <div class="brand"><a href="/">dakait<span>.online</span></a></div>
  </header>

  <h1>Scripts<span class="stamp">loot drop</span></h1>
  <p class="tagline">Drop a script. Take a script. No accounts, no gatekeeping — just paste it and someone else copies it.</p>

  <section class="panel">
    <p class="panel-title">Upload a script</p>
    <form id="upload-form">
      <label for="title">Title</label>
      <input type="text" id="title" maxlength="120" required placeholder="e.g. Auto-clicker for X" />

      <div class="row">
        <div>
          <label for="username">Your name / handle</label>
          <input type="text" id="username" maxlength="40" placeholder="anonymous" />
        </div>
      </div>

      <label for="description">Description</label>
      <textarea id="description" maxlength="500" rows="2" placeholder="What does it do, where does it work, anything to know before using it?"></textarea>

      <label for="code">Script code</label>
      <textarea id="code" required placeholder="Paste your code here"></textarea>

      <button type="submit" class="submit-btn">Drop it</button>
      <p class="form-msg" id="form-msg"></p>
    </form>
  </section>

  <div class="list-head">
    <h2>Latest drops</h2>
    <span class="count" id="count"></span>
  </div>

  <div id="list"></div>
</div>

<script>
  const API_BASE = "";

  const listEl = document.getElementById("list");
  const countEl = document.getElementById("count");
  const formMsg = document.getElementById("form-msg");
  const form = document.getElementById("upload-form");

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return Math.floor(s / 86400) + "d ago";
  }

  async function loadScripts() {
    listEl.innerHTML = '<p class="empty">Loading…</p>';
    try {
      const res = await fetch(\`\${API_BASE}/api/scripts\`);
      const data = await res.json();
      const scripts = data.scripts || [];
      countEl.textContent = scripts.length + (scripts.length === 1 ? " script" : " scripts");

      if (scripts.length === 0) {
        listEl.innerHTML = '<p class="empty">Nothing dropped yet. Be the first.</p>';
        return;
      }

      listEl.innerHTML = "";
      scripts.forEach((meta, i) => {
        const card = document.createElement("div");
        card.className = "card";
        card.innerHTML = \`
          <span class="card-tag">#\${String(scripts.length - i).padStart(3, "0")}</span>
          <p class="card-title">\${escapeHtml(meta.title)}</p>
          <p class="card-desc">\${escapeHtml(meta.description || "")}</p>
          <pre class="code-block" id="code-\${meta.id}">loading…</pre>
          <div class="card-foot">
            <span class="user">\${escapeHtml(meta.username)} · \${timeAgo(meta.createdAt)}</span>
            <button class="copy-btn" data-id="\${meta.id}">Copy</button>
          </div>
        \`;
        listEl.appendChild(card);
        loadFullScript(meta.id);
      });

      listEl.querySelectorAll(".copy-btn").forEach((btn) => {
        btn.addEventListener("click", () => copyScript(btn));
      });
    } catch (err) {
      listEl.innerHTML = '<p class="empty">Couldn\\'t load scripts. Check your connection and try again.</p>';
    }
  }

  const fullCache = {};

  async function loadFullScript(id) {
    try {
      const res = await fetch(\`\${API_BASE}/api/scripts/\${id}\`);
      const data = await res.json();
      fullCache[id] = data.script.code;
      const pre = document.getElementById(\`code-\${id}\`);
      if (pre) pre.textContent = data.script.code;
    } catch {
      const pre = document.getElementById(\`code-\${id}\`);
      if (pre) pre.textContent = "// failed to load code";
    }
  }

  async function copyScript(btn) {
    const id = btn.dataset.id;
    const code = fullCache[id];
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1500);
    } catch {
      btn.textContent = "Press Ctrl+C";
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formMsg.textContent = "";
    formMsg.className = "form-msg";

    const title = document.getElementById("title").value.trim();
    const username = document.getElementById("username").value.trim();
    const description = document.getElementById("description").value.trim();
    const code = document.getElementById("code").value;

    if (!title || !code.trim()) {
      formMsg.textContent = "Title and script code are required.";
      formMsg.className = "form-msg error";
      return;
    }

    const submitBtn = form.querySelector(".submit-btn");
    submitBtn.disabled = true;
    submitBtn.textContent = "Dropping…";

    try {
      const res = await fetch(\`\${API_BASE}/api/scripts\`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, username, description, code }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Upload failed");
      }
      formMsg.textContent = "Dropped. Scroll down to see it.";
      formMsg.className = "form-msg ok";
      form.reset();
      loadScripts();
    } catch (err) {
      formMsg.textContent = err.message || "Something went wrong. Try again.";
      formMsg.className = "form-msg error";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Drop it";
    }
  });

  loadScripts();
</script>
</body>
</html>
`;

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
        try {
            body = await request.json();
        } catch {
            return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        const description = sanitizeText(body.description, MAX_DESC_LENGTH);
        const username = sanitizeText(body.username, MAX_USERNAME_LENGTH) || "anonymous";
        const code = typeof body.code === "string" ? body.code.slice(0, MAX_CODE_LENGTH) : "";

        if (!title || !code) {
            return jsonResponse({ error: "title and code are required" }, 400);
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const record = { id, title, description, username, code, createdAt };

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(record));

        const index = await getScriptsIndex(env);
        index.push({ id, title, description, username, createdAt, length: code.length });
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
        if (!env.DELETE_KEY || key !== env.DELETE_KEY) {
            return jsonResponse({ error: "Unauthorized" }, 401);
        }
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

        // Scripts page + its API
        if (path === "/scripts" || path === "/scripts/") {
            return new Response(SCRIPTS_HTML, {
                headers: { "Content-Type": "text/html" },
                status: 200,
            });
        }
        if (path.startsWith("/api/scripts")) {
            const resp = await handleScriptsApi(request, env, path);
            resp.headers.set("Access-Control-Allow-Origin", "*");
            return resp;
        }

        if (url.pathname === "/register-commands") {
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

        if (url.pathname === "/poll") {
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

        if (url.pathname === "/sync-playtime") {
            await env.SILK_ROAD_KV.put(`PLAYTIME_${url.searchParams.get("userid")}`, url.searchParams.get("time"));
            return new Response("OK", { status: 200 });
        }
        if (url.pathname === "/get-playtime") {
            const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${url.searchParams.get("userid")}`) || "0";
            return new Response(playtime, { status: 200 });
        }

        if (url.pathname === "/check-existing-code") {
            const userId = url.searchParams.get("userid");
            const existingCode = await env.SILK_ROAD_KV.get(`CODE_BY_USER_${userId}`);
            return new Response(existingCode || "None", { status: 200 });
        }
        if (url.pathname === "/store-code") {
            const code = url.searchParams.get("code");
            const userId = url.searchParams.get("userid");
            await env.SILK_ROAD_KV.put(`CODE_${code}`, userId, { expirationTtl: 600 });
            await env.SILK_ROAD_KV.put(`CODE_BY_USER_${userId}`, code, { expirationTtl: 600 });
            return new Response("OK", { status: 200 });
        }
        if (url.pathname === "/check-code") {
            const originalId = await env.SILK_ROAD_KV.get(`CODE_${url.searchParams.get("code")}`);
            if (originalId && originalId === url.searchParams.get("userid")) {
                await env.SILK_ROAD_KV.delete(`CODE_${url.searchParams.get("code")}`);
                await env.SILK_ROAD_KV.put(`USED_${url.searchParams.get("userid")}`, "true");
                return new Response("VALID", { status: 200 });
            }
            return new Response("INVALID", { status: 403 });
        }

        return new Response(SILK_ROAD_HTML, {
            headers: { "Content-Type": "text/html" },
            status: 200
        });
    }
};

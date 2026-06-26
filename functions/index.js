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

  .manifest{ max-width: 760px; width: 100%; }

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
  }
  .route-name{ opacity: 0.9; }
  .route-status{ color: var(--sand); opacity: 0.6; font-size: 0.74rem; }

  .crew{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.2rem; }
  .crew-card{
    border: 1px solid rgba(212,165,116,0.18);
    border-radius: 10px;
    padding: 1.4rem 1.6rem;
    background: rgba(232,220,200,0.02);
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
  .load-in.d4{ animation-delay: 0.5s; }

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

  .manifest{ position: relative; z-index: 1; }

  .crew-card{ transition: transform 0.3s ease, border-color 0.3s ease, background 0.3s ease; }
  .crew-card:hover{
    transform: translateY(-3px);
    border-color: rgba(212,165,116,0.4);
    background: rgba(232,220,200,0.04);
  }

  .route{ transition: padding-left 0.25s ease, border-color 0.25s ease; }
  .route:hover{ padding-left: 0.4rem; border-color: rgba(212,165,116,0.3); }

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

    // Scroll reveal
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

    // Ambient drifting dust (subtle, desert-night feel)
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

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const OWNER_ID = "991408492780986398";

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


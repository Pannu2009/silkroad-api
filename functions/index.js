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
  }

  *{ box-sizing:border-box; margin:0; padding:0; }

  body{
    background: var(--ink);
    background-image:
      radial-gradient(ellipse at 20% 0%, rgba(212,165,116,0.08), transparent 60%),
      radial-gradient(ellipse at 80% 100%, rgba(193,80,46,0.06), transparent 60%);
    color: var(--parchment);
    font-family: 'JetBrains Mono', monospace;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5vh 6vw;
  }

  .manifest{
    max-width: 760px;
    width: 100%;
  }

  .route-line{
    display:flex;
    align-items:center;
    gap: 10px;
    margin-bottom: 2.2rem;
    color: var(--sand);
    font-size: 0.72rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    opacity: 0.75;
  }
  .route-line::before, .route-line::after{
    content:"";
    flex:1;
    height:1px;
    background: linear-gradient(90deg, transparent, var(--sand), transparent);
    opacity: 0.4;
  }

  h1{
    font-family: 'Fraunces', serif;
    font-weight: 600;
    font-size: clamp(2.6rem, 7vw, 4.4rem);
    line-height: 1.02;
    color: var(--parchment);
    letter-spacing: -0.01em;
  }
  h1 em{
    font-style: italic;
    color: var(--sand);
  }

  .tagline{
    margin-top: 1.1rem;
    font-size: 0.95rem;
    color: var(--parchment);
    opacity: 0.62;
    max-width: 46ch;
    line-height: 1.6;
    font-family: 'JetBrains Mono', monospace;
  }

  .seal{
    margin-top: 3rem;
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    padding: 0.85rem 1.3rem;
    border: 1px solid rgba(212,165,116,0.35);
    border-radius: 999px;
    background: rgba(212,165,116,0.05);
  }

  .dot{
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #5fbf7a;
    box-shadow: 0 0 0 0 rgba(95,191,122,0.6);
    animation: pulse 2.2s infinite;
  }
  @keyframes pulse{
    0%{ box-shadow: 0 0 0 0 rgba(95,191,122,0.55); }
    70%{ box-shadow: 0 0 0 8px rgba(95,191,122,0); }
    100%{ box-shadow: 0 0 0 0 rgba(95,191,122,0); }
  }

  .seal-text{
    font-size: 0.74rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--parchment);
    opacity: 0.85;
  }
  .seal-text b{ color:#5fbf7a; font-weight:500; }

  .ledger{
    margin-top: 3.4rem;
    border-top: 1px solid rgba(212,165,116,0.18);
    padding-top: 1.8rem;
  }
  .ledger-label{
    font-size: 0.66rem;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--vermilion);
    opacity: 0.85;
    margin-bottom: 1rem;
  }

  .routes{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0.4rem 1.5rem;
  }
  .route{
    display:flex;
    justify-content: space-between;
    padding: 0.6rem 0;
    border-bottom: 1px dashed rgba(232,220,200,0.08);
    font-size: 0.82rem;
  }
  .route-name{ color: var(--parchment); opacity: 0.9; }
  .route-status{ color: var(--sand); opacity: 0.6; font-size: 0.74rem; }

  footer{
    margin-top: 3rem;
    font-size: 0.7rem;
    color: var(--parchment);
    opacity: 0.35;
    letter-spacing: 0.05em;
  }

  @media (prefers-reduced-motion: reduce){
    .dot{ animation: none; }
  }
</style>
</head>
<body>
  <main class="manifest">
    <div class="route-line">Caravan Manifest</div>

    <h1>The <em>Silk Road</em><br>API</h1>
    <p class="tagline">Backend trade routes for the realm — handling player data, currency sync, and Discord caravan dispatches.</p>

    <div class="seal">
      <span class="dot"></span>
      <span class="seal-text">Route status: <b>open</b></span>
    </div>

    <div class="ledger">
      <div class="ledger-label">Active Checkpoints</div>
      <div class="routes">
        <div class="route"><span class="route-name">/poll</span><span class="route-status">dispatch queue</span></div>
        <div class="route"><span class="route-name">/sync-playtime</span><span class="route-status">caravan log</span></div>
        <div class="route"><span class="route-name">/get-playtime</span><span class="route-status">caravan log</span></div>
        <div class="route"><span class="route-name">/check-existing-code</span><span class="route-status">seal registry</span></div>
        <div class="route"><span class="route-name">/store-code</span><span class="route-status">seal registry</span></div>
        <div class="route"><span class="route-name">/check-code</span><span class="route-status">seal registry</span></div>
      </div>
    </div>

    <footer>dakait.online — operated by Panth Riar, Dakait Shah</footer>
  </main>
</body>
</html>
`;

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const OWNER_ID = "991408492780986398";

        // 1. REGISTER COMMANDS
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

        // 2. INTERACTION HANDLER (POST)
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

            // Robust Option Mapping
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

        // 3. POLL ROUTE
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

        // 4. SYNC & PLAYTIME
        if (url.pathname === "/sync-playtime") {
            await env.SILK_ROAD_KV.put(`PLAYTIME_${url.searchParams.get("userid")}`, url.searchParams.get("time"));
            return new Response("OK", { status: 200 });
        }
        if (url.pathname === "/get-playtime") {
            const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${url.searchParams.get("userid")}`) || "0";
            return new Response(playtime, { status: 200 });
        }

        // 5. STORE & CHECK CODE
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

        // Base URL response — Silk Road landing page
        return new Response(SILK_ROAD_HTML, {
            headers: { "Content-Type": "text/html" },
            status: 200
        });
    }
};

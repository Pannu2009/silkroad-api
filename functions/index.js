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

      if ((cmd === "finduser" || cmd === "reward") && userId !== OWNER_ID) {
        return new Response(JSON.stringify({ type: 4, data: { content: "❌ Access Denied." } }), { headers: { "Content-Type": "application/json" } });
      }

      if (cmd === "verify") {
        const inputId = interaction.data.options[0].value.toString();
        const alreadyUsed = await env.SILK_ROAD_KV.get(`USED_${inputId}`);
        if (alreadyUsed) return new Response(JSON.stringify({ type: 4, data: { content: "❌ You have already claimed a reward." } }), { headers: { "Content-Type": "application/json" } });
        const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${inputId}`);
        if (!playtime || parseInt(playtime) < 1000) return new Response(JSON.stringify({ type: 4, data: { content: "❌ Not enough playtime." } }), { headers: { "Content-Type": "application/json" } });
        const salt = Math.floor(1000 + Math.random() * 9000);
        const code = `DRB${salt}${inputId}`;
        await env.SILK_ROAD_KV.put(`CODE_${code}`, inputId);
        return new Response(JSON.stringify({ type: 4, data: { content: `✅ Your code: **${code}**` } }), { headers: { "Content-Type": "application/json" } });
      }
      
      if (cmd === "reward") {
        const commandId = Date.now().toString();
        const cmdData = { command: "admin-reward", type: interaction.data.options[0].value, userId: interaction.data.options[1].value, amount: interaction.data.options[2].value };
        await env.SILK_ROAD_KV.put(`CMD_${commandId}`, JSON.stringify(cmdData));
        const list = JSON.parse(await env.SILK_ROAD_KV.get("CMD_LIST") || "[]");
        list.push(commandId);
        await env.SILK_ROAD_KV.put("CMD_LIST", JSON.stringify(list));
        return new Response(JSON.stringify({ type: 4, data: { content: "🎁 Reward queued." } }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 3. POLL ROUTE (Compatible with coworker's script)
    if (url.pathname === "/poll") {
        const list = JSON.parse(await env.SILK_ROAD_KV.get("CMD_LIST") || "[]");
        if (list.length === 0) return new Response("None", { status: 200 });
        const cmdId = list.shift();
        const data = await env.SILK_ROAD_KV.get(`CMD_${cmdId}`);
        await env.SILK_ROAD_KV.put("CMD_LIST", JSON.stringify(list));
        await env.SILK_ROAD_KV.delete(`CMD_${cmdId}`);
        return new Response(data, { headers: { "Content-Type": "application/json" } });
    }

    // 4. SYNC PLAYTIME
    if (url.pathname === "/sync-playtime") {
        await env.SILK_ROAD_KV.put(`PLAYTIME_${url.searchParams.get("userid")}`, url.searchParams.get("time"));
        return new Response("OK", { status: 200 });
    }

    // 5. CHECK CODE
    if (url.pathname === "/check-code") {
        const originalId = await env.SILK_ROAD_KV.get(`CODE_${url.searchParams.get("code")}`);
        if (originalId && originalId === url.searchParams.get("userid")) {
            await env.SILK_ROAD_KV.delete(`CODE_${url.searchParams.get("code")}`);
            await env.SILK_ROAD_KV.put(`USED_${url.searchParams.get("userid")}`, "true");
            return new Response("VALID", { status: 200 });
        }
        return new Response("INVALID", { status: 403 });
    }

    return new Response("Operational", { status: 200 });
  }
};

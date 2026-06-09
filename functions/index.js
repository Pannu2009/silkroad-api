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

    // 1. REGISTER ROUTE
    if (url.pathname === "/register-commands") {
      const commandData = [
        { name: "finduser", description: "Fetch stats (Owner Only)", options: [{ name: "userid", description: "Target UserID", type: 10, required: true }] },
        { name: "reward", description: "Admin reward (Owner Only)", options: [
            { name: "type", description: "Reward", type: 3, required: true, choices: [{name: "Dinars", value: "dinars"}, {name: "XP", value: "xp"}] },
            { name: "userid", description: "Target UserID", type: 10, required: true }
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

      // OWNER GATING
      if ((cmd === "finduser" || cmd === "reward") && userId !== OWNER_ID) {
        return new Response(JSON.stringify({ type: 4, data: { content: "❌ Access Denied." } }), { headers: { "Content-Type": "application/json" } });
      }

      // VERIFY COMMAND
      if (cmd === "verify") {
        const inputId = interaction.data.options[0].value.toString();
        
        // Check if ALREADY USED
        const alreadyUsed = await env.SILK_ROAD_KV.get(`USED_${inputId}`);
        if (alreadyUsed) return new Response(JSON.stringify({ type: 4, data: { content: "❌ You have already claimed a reward." } }), { headers: { "Content-Type": "application/json" } });

        // Check Playtime
        const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${inputId}`);
        if (!playtime || parseInt(playtime) < 1000) return new Response(JSON.stringify({ type: 4, data: { content: "❌ Not enough playtime (1000s required)." } }), { headers: { "Content-Type": "application/json" } });

        const salt = Math.floor(1000 + Math.random() * 9000);
        const code = `DRB${salt}${inputId}`;
        await env.SILK_ROAD_KV.put(`CODE_${code}`, inputId);
        
        return new Response(JSON.stringify({ type: 4, data: { content: `✅ Your code: **${code}**` } }), { headers: { "Content-Type": "application/json" } });
      }
      
      // REWARD COMMAND (Queuing for Roblox)
      if (cmd === "reward") {
        await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
            command: "admin-reward",
            type: interaction.data.options[0].value,
            userId: interaction.data.options[1].value
        }));
        return new Response(JSON.stringify({ type: 4, data: { content: "🎁 Reward queued." } }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 3. CHECK CODE (Roblox endpoint)
    if (url.pathname === "/check-code") {
        const code = url.searchParams.get("code");
        const userId = url.searchParams.get("userid");
        const originalId = await env.SILK_ROAD_KV.get(`CODE_${code}`);
        
        if (originalId && originalId === userId) {
            await env.SILK_ROAD_KV.delete(`CODE_${code}`);
            await env.SILK_ROAD_KV.put(`USED_${userId}`, "true");
            return new Response("VALID", { status: 200 });
        }
        return new Response("INVALID", { status: 403 });
    }

    return new Response("Operational", { status: 200 });
  }
};

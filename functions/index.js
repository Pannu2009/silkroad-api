// Verification logic remains the same
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

    // 1. REGISTER ROUTE: Updated to /FindUser
    if (url.pathname === "/register-commands") {
      const commandData = [{
        name: "finduser",
        description: "Fetch stats for a specific user by ID",
        options: [{ name: "userid", description: "The Roblox player UserID", type: 10, required: true }] // type 10 is for Integer
      }];
      const response = await fetch(`https://discord.com/api/v10/applications/1451040870689411193/commands`, {
        method: "PUT",
        headers: { "Authorization": `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(commandData)
      });
      return new Response(`Discord API Response: ${await response.text()}`, { status: response.status });
    }

    // 2. REPLY ROUTE: Used by Roblox to send data back
    if (url.pathname === "/reply-to-discord" && request.method === "POST") {
      const body = await request.json();
      await fetch(`https://discord.com/api/v10/webhooks/1451040870689411193/${body.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: body.message })
      });
      return new Response("Replied!", { status: 200 });
    }

    // 3. POST ROUTE: Discord Interactions
    if (request.method === "POST") {
      const isValid = await verifyDiscordSignature(request, env.DISCORD_PUBLIC_KEY);
      if (!isValid) return new Response("Unauthorized", { status: 401 });
      const interaction = await request.json();
      if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

      if (interaction.type === 2 && interaction.data.name === "finduser") {
        const userId = interaction.data.options[0].value;
        await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
          command: "finduser",
          userId: userId,
          token: interaction.token
        }));
        return new Response(JSON.stringify({ type: 4, data: { content: `🔍 Searching for UserID: ${userId}...` } }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 4. GET ROUTE: Roblox Polling
    if (request.method === "GET") {
      const data = await env.SILK_ROAD_KV.get("latest_command");
      if (data) {
        await env.SILK_ROAD_KV.delete("latest_command");
        return new Response(data, { headers: { "Content-Type": "application/json" } });
      }
      return new Response("None", { status: 200 });
    }
    return new Response("Silk Road Engine Operational", { status: 200 });
  }
};

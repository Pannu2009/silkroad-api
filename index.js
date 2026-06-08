
// Lightweight web standard cryptographic signature verification
async function verifyDiscordSignature(request, publicKey) {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  const body = await request.clone().text();

  if (!signature || !timestamp) return false;

  const hexToBytes = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  
  try {
    const key = await crypto.subtle.importKey(
      'raw', hexToBytes(publicKey), 
      { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, 
      false, ['verify']
    );
    
    const encoder = new TextEncoder();
    const data = encoder.encode(timestamp + body);
    const sigBytes = hexToBytes(signature);
    
    return await crypto.subtle.verify('NODE-ED25519', key, sigBytes, data);
  } catch (err) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. DISCORD HANDSHAKE & COMMAND ENTRYPOINT
    if (request.method === "POST" && url.pathname === "/") {
      const isValid = await verifyDiscordSignature(request, env.DISCORD_PUBLIC_KEY);
      if (!isValid) return new Response("Invalid request signature", { status: 401 });

      const interaction = await request.json();

      // Type 1 is Discord's verification PING. We MUST return Type 1 back!
      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Type 2 means someone used a slash command (like /user)
      if (interaction.type === 2) {
        const commandName = interaction.data.name;
        
        if (commandName === "user") {
          // Extract the username argument the player typed
          const targetUser = interaction.data.options[0].value;

          // Queue the lookup command into your Cloudflare KV database for Roblox
          await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
            command: "user",
            targetUser: targetUser
          }));

          // Send an immediate confirmation text message right back to the Discord chat channel
          return new Response(JSON.stringify({
            type: 4, 
            data: {
              content: `🔍 **[Silk Road Engine]** Data lookup request sent to live servers. Fetching stats for **${targetUser}**...`
            }
          }), { headers: { "Content-Type": "application/json" } });
        }
      }
    }

    // 2. ROBLOX ROUTE: Roblox loops and pings this endpoint to pull down commands
    if (request.method === "GET" && url.pathname === "/get-commands") {
      const data = await env.SILK_ROAD_KV.get("latest_command");
      if (data) {
        await env.SILK_ROAD_KV.delete("latest_command"); // Wipe queue instantly so it doesn't double-trigger
        return new Response(data, { headers: { "Content-Type": "application/json" } });
      }
      return new Response("None", { status: 200 });
    }

    return new Response("Silk Road API Layer Operational", { status: 200 });
  }
};

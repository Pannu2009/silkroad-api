// Verification logic for Discord security handshakes
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

// Standard Cloudflare Worker entry point
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. GET ROUTE: Roblox loops and pings this url to check for commands
    if (request.method === "GET") {
      const data = await env.SILK_ROAD_KV.get("latest_command");
      if (data) {
        await env.SILK_ROAD_KV.delete("latest_command"); // Clear queue
        return new Response(data, { headers: { "Content-Type": "application/json" } });
      }
      return new Response("None", { status: 200 });
    }

    // 2. POST ROUTE: Discord hits this to send Slash Commands or Pings
    if (request.method === "POST") {
      const isValid = await verifyDiscordSignature(request, env.DISCORD_PUBLIC_KEY);
      if (!isValid) return new Response("Invalid request signature", { status: 401 });

      const interaction = await request.json();

      // Type 1 is Discord's security handshake verification ping
      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // Type 2 means a user used your slash command
      if (interaction.type === 2) {
        const commandName = interaction.data.name;
        
        if (commandName === "user") {
          // Robust checking for option arguments
          const options = interaction.data.options;
          const targetUser = (options && options.length > 0) ? options[0].value : "Unknown Player";

          // Save command metadata payload to your KV database namespace
          await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
            command: "user",
            targetUser: targetUser
          }));

          // Send an immediate interactive message block back to the channel channel
          return new Response(JSON.stringify({
            type: 4,
            data: {
              content: `🔍 **[Silk Road Engine]** Data lookup request sent to live servers. Fetching stats for **${targetUser}**...`
            }
          }), { headers: { "Content-Type": "application/json" } });
        }
      }
    }

    // Default response for tying the link into a browser
    return new Response("Silk Road Engine Api Operational", { status: 200 });
  }
};

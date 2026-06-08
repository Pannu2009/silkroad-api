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

    // 1. REGISTER ROUTE: This MUST run first when you visit the link
    if (url.pathname === "/register-commands") {
      const commandData = [
        {
          name: "user",
          description: "Fetch stats for a specific user from Journeys of Silk Road",
          options: [
            {
              name: "username",
              description: "The Roblox player username to look up",
              type: 3,
              required: true
            }
          ]
        }
      ];

      const applicationId = "1451040870689411193"; 
      
      const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
        method: "PUT",
        headers: {
          "Authorization": `Bot ${env.DISCORD_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(commandData)
      });

      const resText = await response.text();
      return new Response(`Discord API Response: ${resText}`, { status: response.status });
    }

    // 2. POST ROUTE: Discord hits this to send Slash Commands or Pings
    if (request.method === "POST") {
      const isValid = await verifyDiscordSignature(request, env.DISCORD_PUBLIC_KEY);
      if (!isValid) return new Response("Invalid request signature", { status: 401 });

      const interaction = await request.json();

      if (interaction.type === 1) {
        return new Response(JSON.stringify({ type: 1 }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      if (interaction.type === 2) {
        const commandName = interaction.data.name;
        
        if (commandName === "user") {
          const options = interaction.data.options;
          const targetUser = (options && options.length > 0) ? options[0].value : "Unknown Player";

          await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
            command: "user",
            targetUser: targetUser
          }));

          return new Response(JSON.stringify({
            type: 4,
            data: {
              content: `🔍 **[Silk Road Engine]** Data lookup request sent to live servers. Fetching stats for **${targetUser}**...`
            }
          }), { headers: { "Content-Type": "application/json" } });
        }
      }
    }

    // 3. GET ROUTE: Roblox loops and pings this url to check for commands
    if (request.method === "GET") {
      const data = await env.SILK_ROAD_KV.get("latest_command");
      if (data) {
        await env.SILK_ROAD_KV.delete("latest_command"); // Clear queue
        return new Response(data, { headers: { "Content-Type": "application/json" } });
      }
      return new Response("None", { status: 200 });
    }

    return new Response("Silk Road Engine Api Operational", { status: 200 });
  }
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const OWNER_ID = "991408492780986398";

    // 1. REGISTER ROUTE
    if (url.pathname === "/register-commands") {
      const commandData = [
        {
          name: "finduser",
          description: "Fetch stats (Owner Only)",
          options: [{ name: "userid", description: "Target UserID", type: 10, required: true }]
        },
        {
          name: "reward",
          description: "Admin reward (Owner Only)",
          options: [
            { name: "type", description: "Reward", type: 3, required: true, choices: [{name: "Dinars", value: "dinars"}, {name: "XP", value: "xp"}] },
            { name: "userid", description: "Target UserID", type: 10, required: true }
          ]
        },
        {
          name: "verify",
          description: "Get your reward code",
          options: [{ name: "userid", description: "Your Roblox UserID", type: 10, required: true }]
        }
      ];
      const response = await fetch(`https://discord.com/api/v10/applications/1451040870689411193/commands`, {
        method: "PUT",
        headers: { "Authorization": `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(commandData)
      });
      return new Response(await response.text(), { status: response.status });
    }

    // 2. INTERACTION HANDLER
    if (request.method === "POST") {
      const interaction = await request.json();
      if (interaction.type === 1) return new Response(JSON.stringify({ type: 1 }), { headers: { "Content-Type": "application/json" } });

      const userId = interaction.member.user.id;
      const cmd = interaction.data.name;

      // OWNER ONLY GATING
      if ((cmd === "finduser" || cmd === "reward") && userId !== OWNER_ID) {
        return new Response(JSON.stringify({ type: 4, data: { content: "❌ Access Denied." } }), { headers: { "Content-Type": "application/json" } });
      }

      // VERIFY COMMAND
      if (cmd === "verify") {
        const inputId = interaction.data.options[0].value.toString();
        
        // CHECK PLAYTIME in KV (Assumes Roblox saves "PLAYTIME_ID" key)
        const playtime = await env.SILK_ROAD_KV.get(`PLAYTIME_${inputId}`);
        if (!playtime || parseInt(playtime) < 1000) {
          return new Response(JSON.stringify({ type: 4, data: { content: "❌ You need 1000s+ playtime to verify!" } }), { headers: { "Content-Type": "application/json" } });
        }

        // GENERATE SCRAMBLED CODE
        const salt = Math.floor(1000 + Math.random() * 9000);
        const code = `DRB${salt}${inputId}`;
        await env.SILK_ROAD_KV.put(`CODE_${code}`, inputId);
        
        return new Response(JSON.stringify({ type: 4, data: { content: `✅ Code: **${code}**\nPaste this in-game to claim.` } }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 3. GET/POLLING ROUTE (For Roblox to check codes)
    if (url.pathname === "/check-code") {
        const code = url.searchParams.get("code");
        const currentUserId = url.searchParams.get("userid");
        const originalId = await env.SILK_ROAD_KV.get(`CODE_${code}`);
        
        if (originalId && originalId === currentUserId) {
            await env.SILK_ROAD_KV.delete(`CODE_${code}`); // Delete after use
            return new Response("VALID", { status: 200 });
        }
        return new Response("INVALID", { status: 403 });
    }

    return new Response("Operational", { status: 200 });
  }
};

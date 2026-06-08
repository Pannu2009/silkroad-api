export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Create a simple database state inside the script memory (or use Cloudflare KV for persistence)
    // For a 0$ setup, we'll handle routing here
    
    // 1. ENDPOINT: Discord hits this to drop a command into the queue
    if (request.method === "POST" && url.pathname === "/add-command") {
      const body = await request.json();
      
      // Store the command inside Cloudflare's global cache or KV
      await env.SILK_ROAD_KV.put("latest_command", JSON.stringify({
        command: body.command,
        targetUser: body.targetUser,
        channelId: body.channelId
      }));

      return new Response("Command queued successfully", { status: 200 });
    }

    // 2. ENDPOINT: Roblox loops and pings this to pull the queued command
    if (request.method === "GET" && url.pathname === "/get-commands") {
      const data = await env.SILK_ROAD_KV.get("latest_command");
      
      if (data) {
        // Clear the queue once Roblox has read it so it doesn't repeat
        await env.SILK_ROAD_KV.delete("latest_command");
        return new Response(data, {
          headers: { "Content-Type": "application/json" }
        });
      }
      
      return new Response("None", { status: 200 });
    }

    return new Response("Silk Road API Layer Operational", { status: 200 });
  }
};

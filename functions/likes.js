/* likes.js — Likes, favorites, copy-count tracking, and abuse reports. */

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
}

async function getSession(request, env) {
    const header = request.headers.get("Cookie") || "";
    const match  = header.split(";").map(v => v.trim()).find(v => v.startsWith("session="));
    if (!match) return null;
    const sid = decodeURIComponent(match.slice(8));
    if (!sid) return null;
    const raw = await env.SESSIONS_KV.get(`session:${sid}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// ─── Likes ────────────────────────────────────────────────────────────────────

export async function getLikeCount(env, scriptId) {
    const raw = await env.SCRIPTS_KV.get(`likecount:${scriptId}`);
    return raw ? Number(raw) : 0;
}

export async function hasLiked(env, scriptId, sub) {
    if (!sub) return false;
    const raw = await env.SCRIPTS_KV.get(`like:${scriptId}:${sub}`);
    return !!raw;
}

export async function getLikeSummary(env, scriptId, sub = null) {
    const [count, liked] = await Promise.all([
        getLikeCount(env, scriptId),
        sub ? hasLiked(env, scriptId, sub) : Promise.resolve(false),
    ]);
    return { count, liked };
}

async function toggleLikeInner(env, scriptId, sub) {
    const liked = await hasLiked(env, scriptId, sub);
    const countRaw = await env.SCRIPTS_KV.get(`likecount:${scriptId}`);
    let count = countRaw ? Number(countRaw) : 0;
    if (liked) {
        await env.SCRIPTS_KV.delete(`like:${scriptId}:${sub}`);
        count = Math.max(0, count - 1);
    } else {
        await env.SCRIPTS_KV.put(`like:${scriptId}:${sub}`, "1");
        count = count + 1;
    }
    await env.SCRIPTS_KV.put(`likecount:${scriptId}`, String(count));
    return { liked: !liked, count };
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function hasFavorited(env, scriptId, sub) {
    if (!sub) return false;
    const raw = await env.SCRIPTS_KV.get(`fav:${sub}:${scriptId}`);
    return !!raw;
}

async function toggleFavoriteInner(env, scriptId, sub) {
    const favorited = await hasFavorited(env, scriptId, sub);
    if (favorited) {
        await env.SCRIPTS_KV.delete(`fav:${sub}:${scriptId}`);
    } else {
        await env.SCRIPTS_KV.put(`fav:${sub}:${scriptId}`, JSON.stringify({ scriptId, savedAt: Date.now() }));
    }
    return { favorited: !favorited };
}

export async function getUserFavorites(env, sub) {
    const results = [];
    let cursor;
    do {
        const list = await env.SCRIPTS_KV.list({ prefix: `fav:${sub}:`, ...(cursor ? { cursor } : {}) });
        for (const key of list.keys || []) {
            const scriptId = key.name.slice(`fav:${sub}:`.length);
            if (scriptId) results.push(scriptId);
        }
        cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
    return results;
}

// ─── Copy tracking ────────────────────────────────────────────────────────────

export async function recordCopy(env, scriptId) {
    const key = `copies:${scriptId}`;
    const raw = await env.SCRIPTS_KV.get(key);
    const count = (raw ? Number(raw) : 0) + 1;
    await env.SCRIPTS_KV.put(key, String(count));
    return count;
}

export async function getCopyCount(env, scriptId) {
    const raw = await env.SCRIPTS_KV.get(`copies:${scriptId}`);
    return raw ? Number(raw) : 0;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

const VALID_REASONS = ["spam", "malware", "stolen", "broken", "inappropriate", "other"];

async function reportScript(env, scriptId, sub, reason) {
    const validReason = VALID_REASONS.includes(reason) ? reason : "other";
    await env.SCRIPTS_KV.put(
        `report:${scriptId}:${sub}`,
        JSON.stringify({ sub, reason: validReason, createdAt: Date.now() })
    );
    return { reported: true };
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function handleLikesApi(request, env, path) {
    const method = request.method;

    if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    const likeMatch     = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/likes$/);
    const favMatch      = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/favorites$/);
    const copyMatch     = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/copy$/);
    const reportMatch   = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/report$/);
    const myFavsMatch   = path === "/api/me/favorites";
    const id            = (likeMatch || favMatch || copyMatch || reportMatch)?.[1];

    // GET /api/me/favorites
    if (myFavsMatch && method === "GET") {
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in to view favorites" }, 401);
        const ids = await getUserFavorites(env, session.sub);
        return jsonResponse({ favorites: ids });
    }

    if (!id) return jsonResponse({ error: "Not found" }, 404);

    // Check script exists
    const scriptExists = await env.SCRIPTS_KV.get(`script:${id}`);
    if (!scriptExists) return jsonResponse({ error: "Script not found" }, 404);

    const session = await getSession(request, env);

    // GET /api/scripts/:id/likes
    if (likeMatch && method === "GET") {
        return jsonResponse(await getLikeSummary(env, id, session?.sub));
    }

    // POST /api/scripts/:id/likes — toggle
    if (likeMatch && method === "POST") {
        if (!session?.sub) return jsonResponse({ error: "Sign in to like scripts" }, 401);
        return jsonResponse(await toggleLikeInner(env, id, session.sub));
    }

    // GET /api/scripts/:id/favorites
    if (favMatch && method === "GET") {
        return jsonResponse({ favorited: await hasFavorited(env, id, session?.sub) });
    }

    // POST /api/scripts/:id/favorites — toggle
    if (favMatch && method === "POST") {
        if (!session?.sub) return jsonResponse({ error: "Sign in to save favorites" }, 401);
        return jsonResponse(await toggleFavoriteInner(env, id, session.sub));
    }

    // POST /api/scripts/:id/copy — record a copy event (no auth needed)
    if (copyMatch && method === "POST") {
        const count = await recordCopy(env, id);
        // Check rewards for script owner
        try {
            const scriptRaw = await env.SCRIPTS_KV.get(`script:${id}`);
            if (scriptRaw) {
                const script = JSON.parse(scriptRaw);
                if (script.ownerSub) {
                    const { checkAndGrantRewards } = await import("./profiles.js");
                    await checkAndGrantRewards(env, script.ownerSub, "copies", count);
                }
            }
        } catch {}
        return jsonResponse({ copies: count });
    }

    // POST /api/scripts/:id/report
    if (reportMatch && method === "POST") {
        if (!session?.sub) return jsonResponse({ error: "Sign in to report scripts" }, 401);
        let body = {};
        try { body = await request.json(); } catch {}
        return jsonResponse(await reportScript(env, id, session.sub, body.reason || "other"));
    }

    return jsonResponse({ error: "Not found" }, 404);
}


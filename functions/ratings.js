/* ratings.js — server-side rating storage and summaries. */

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
}

async function getSession(request, env) {
    const header = request.headers.get("Cookie") || "";
    const match = header.split(";").map(v => v.trim()).find(v => v.startsWith("session="));
    if (!match) return null;
    const sid = decodeURIComponent(match.slice(8));
    if (!sid) return null;
    const raw = await env.SESSIONS_KV.get(`session:${sid}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function loadRatings(env, id) {
    const ratings = {};

    // Legacy format: ratings:<scriptId> = { sub: { rating, updatedAt } }
    const legacyRaw = await env.SCRIPTS_KV.get(`ratings:${id}`);
    if (legacyRaw) {
        try {
            const legacy = JSON.parse(legacyRaw);
            if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
                Object.assign(ratings, legacy);
            }
        } catch {}
    }

    // New format: rating:<scriptId>:<sub>. Individual KV records avoid lost-update races.
    let cursor;
    do {
        const result = await env.SCRIPTS_KV.list({ prefix: `rating:${id}:`, ...(cursor ? { cursor } : {}) });
        for (const key of result.keys || []) {
            const raw = await env.SCRIPTS_KV.get(key.name);
            if (!raw) continue;
            try {
                const value = JSON.parse(raw);
                const sub = key.name.slice(`rating:${id}:`.length);
                if (sub) ratings[sub] = value;
            } catch {}
        }
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return ratings;
}

export async function getRatingSummary(env, id, sessionSub = null) {
    const ratings = await loadRatings(env, id);
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0;
    let sum = 0;

    for (const value of Object.values(ratings)) {
        const r = Number(value?.rating);
        if (Number.isInteger(r) && r >= 1 && r <= 5) {
            counts[r]++;
            total++;
            sum += r;
        }
    }

    return {
        total,
        average: total ? Math.round((sum / total) * 10) / 10 : 0,
        distribution: counts,
        worksPercent: total ? Math.round((counts[5] * 100) / total) : 0,
        myRating: sessionSub && ratings[sessionSub] ? Number(ratings[sessionSub].rating) : 0
    };
}

export async function updateRating(env, id, sessionSub, rating) {
    const key = `rating:${id}:${sessionSub}`;
    await env.SCRIPTS_KV.put(key, JSON.stringify({ rating, updatedAt: Date.now() }));
    return getRatingSummary(env, id, sessionSub);
}

export async function deleteRatings(env, id) {
    const keys = [];
    let cursor;
    do {
        const result = await env.SCRIPTS_KV.list({ prefix: `rating:${id}:`, ...(cursor ? { cursor } : {}) });
        keys.push(...(result.keys || []).map(k => k.name));
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
    await Promise.all(keys.map(key => env.SCRIPTS_KV.delete(key)));
    await env.SCRIPTS_KV.delete(`ratings:${id}`); // legacy cleanup
}

export async function handleRatingApi(request, env, id, method, rateLimitFn) {
    if (method === "GET") {
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Not found" }, 404);
        const session = await getSession(request, env);
        return jsonResponse(await getRatingSummary(env, id, session?.sub || null));
    }

    if (method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    if (!(await rateLimitFn(request, env, "rating", 20, 600))) {
        return jsonResponse({ error: "Too many rating requests. Try again later." }, 429);
    }

    const exists = await env.SCRIPTS_KV.get(`script:${id}`);
    if (!exists) return jsonResponse({ error: "Not found" }, 404);

    const session = await getSession(request, env);
    if (!session?.sub) return jsonResponse({ error: "Sign in with Google to rate scripts" }, 401);

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
    }

    return jsonResponse(await updateRating(env, id, session.sub, rating));
}


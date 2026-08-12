/* comments.js — authenticated community comments. */

const MAX_COMMENT_LENGTH = 400;
const MAX_USERNAME_LENGTH = 40;

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
    });
}

function sanitizeText(value, maxLen) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
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

export async function getComments(env, id) {
    const comments = [];

    // Legacy format: comments:<scriptId> = [ ... ]
    const legacyRaw = await env.SCRIPTS_KV.get(`comments:${id}`);
    if (legacyRaw) {
        try {
            const legacy = JSON.parse(legacyRaw);
            if (Array.isArray(legacy)) comments.push(...legacy);
        } catch {}
    }

    // New format: one KV record per comment, preventing simultaneous comments from overwriting each other.
    let cursor;
    do {
        const result = await env.SCRIPTS_KV.list({ prefix: `comment:${id}:`, ...(cursor ? { cursor } : {}) });
        for (const key of result.keys || []) {
            const raw = await env.SCRIPTS_KV.get(key.name);
            if (!raw) continue;
            try { comments.push(JSON.parse(raw)); } catch {}
        }
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    const seen = new Set();
    return comments
        .filter(c => c && c.id && !seen.has(c.id) && seen.add(c.id))
        .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
        .slice(0, 200);
}

export async function deleteComments(env, id) {
    const keys = [];
    let cursor;
    do {
        const result = await env.SCRIPTS_KV.list({ prefix: `comment:${id}:`, ...(cursor ? { cursor } : {}) });
        keys.push(...(result.keys || []).map(k => k.name));
        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);
    await Promise.all(keys.map(key => env.SCRIPTS_KV.delete(key)));
    await env.SCRIPTS_KV.delete(`comments:${id}`); // legacy cleanup
}

export async function deleteComment(env, scriptId, commentId) {
    const key = `comment:${scriptId}:${commentId}`;
    const exists = await env.SCRIPTS_KV.get(key);
    if (exists) {
        await env.SCRIPTS_KV.delete(key);
        return true;
    }

    // Legacy comments need a small rewrite because they were stored as one array.
    const legacyRaw = await env.SCRIPTS_KV.get(`comments:${scriptId}`);
    if (!legacyRaw) return false;
    try {
        const list = JSON.parse(legacyRaw);
        if (!Array.isArray(list)) return false;
        const next = list.filter(c => c?.id !== commentId);
        if (next.length === list.length) return false;
        await env.SCRIPTS_KV.put(`comments:${scriptId}`, JSON.stringify(next));
        return true;
    } catch { return false; }
}

export async function handleCommentsApi(request, env, id, method, rateLimitFn, updateRatingFn) {
    const exists = await env.SCRIPTS_KV.get(`script:${id}`);
    if (!exists) return jsonResponse({ error: "Script not found" }, 404);

    if (method === "GET") return jsonResponse({ comments: await getComments(env, id) });
    if (method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const session = await getSession(request, env);
    if (!session?.sub) return jsonResponse({ error: "Sign in with Google before commenting or rating." }, 401);

    if (!(await rateLimitFn(request, env, "comment", 10, 600))) {
        return jsonResponse({ error: "Too many comments. Try again later." }, 429);
    }

    let body;
    try { body = await request.json(); }
    catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

    const text = sanitizeText(body.text, MAX_COMMENT_LENGTH);
    const hasRating = body.rating !== undefined && body.rating !== null && body.rating !== "";
    if (!text && !hasRating) return jsonResponse({ error: "Please add a comment or a star rating." }, 400);

    let rating = null;
    if (hasRating) {
        rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
        }
    }

    const comment = {
        id: crypto.randomUUID(),
        author: sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user",
        text,
        rating,
        createdAt: Date.now(),
        authorSub: session.sub
    };

    await env.SCRIPTS_KV.put(`comment:${id}:${comment.id}`, JSON.stringify(comment));

    let ratingSummary = null;
    if (rating !== null) ratingSummary = await updateRatingFn(env, id, session.sub, rating);

    return jsonResponse({ ok: true, comment, rating: ratingSummary }, 201);
}

// comments.js — All comment and rating logic
// Imported by index.js and scripts.js

import { sanitizeText, parseCookies } from "./utils.js";
import { getRatingSummary, updateRating } from "./ratings.js";

const MAX_COMMENT_LENGTH = 400;
const MAX_USERNAME_LENGTH = 40;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
}

export async function getSession(request, env) {
    const cookies = parseCookies(request);
    const sid = cookies.session;
    if (!sid) return null;
    const raw = await env.SESSIONS_KV.get(`session:${sid}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

async function rateLimit(request, env, name, limit, windowSeconds) {
    if (!env.SCRIPTS_KV) return true;
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `rate:${name}:${ip}:${bucket}`;
    const raw = await env.SCRIPTS_KV.get(key);
    const count = raw ? Number(raw) : 0;
    if (count >= limit) return false;
    await env.SCRIPTS_KV.put(key, String(count + 1), { expirationTtl: windowSeconds + 30 });
    return true;
}

// ─── Comments API ─────────────────────────────────────────────────────────────

export async function handleCommentsApi(request, env, path) {
    const method = request.method;

    if (method === "OPTIONS") {
        return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    // GET /api/scripts/:id/comments
    const commentsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/comments$/);
    if (commentsMatch && method === "GET") {
        const id = commentsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);
        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        let comments = [];
        try { comments = raw ? JSON.parse(raw) : []; } catch {}
        if (!Array.isArray(comments)) comments = [];
        comments.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
        return jsonResponse({ comments });
    }

    // POST /api/scripts/:id/comments
    // FIX: text OR rating (or both) required — not both mandatory
    if (commentsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "comment", 10, 600)))
            return jsonResponse({ error: "Too many comments. Wait a bit and try again." }, 429);

        const id = commentsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);

        let body;
        try {
            const text = await request.text();
            if (new TextEncoder().encode(text).byteLength > 6000) return jsonResponse({ error: "Request too large" }, 400);
            body = JSON.parse(text);
        } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }

        const text      = sanitizeText(body.text || "", MAX_COMMENT_LENGTH);
        const hasRating = body.rating !== undefined && body.rating !== null && body.rating !== "";
        let rating      = null;

        if (hasRating) {
            rating = Number(body.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5)
                return jsonResponse({ error: "Rating must be 1–5" }, 400);
            // Rating requires sign-in so it's tied to a specific user
            const session = await getSession(request, env);
            if (!session?.sub)
                return jsonResponse({ error: "Sign in with Google to leave a star rating." }, 401);
        }

        // Need at least text OR rating
        if (!text && !hasRating)
            return jsonResponse({ error: "Please write a comment or give a star rating (or both)." }, 400);

        const session  = await getSession(request, env);
        const author   = session
            ? sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user"
            : sanitizeText(body.author, MAX_USERNAME_LENGTH) || "anonymous";

        const raw      = await env.SCRIPTS_KV.get(`comments:${id}`);
        let comments   = [];
        try { comments = raw ? JSON.parse(raw) : []; } catch {}
        if (!Array.isArray(comments)) comments = [];

        const comment = {
            id:        crypto.randomUUID(),
            author,
            text,
            rating,
            createdAt: Date.now(),
            authorSub: session?.sub || null,
        };
        comments.push(comment);
        await env.SCRIPTS_KV.put(`comments:${id}`, JSON.stringify(comments.slice(-200)));

        let ratingSummary = null;
        if (rating !== null && session?.sub)
            ratingSummary = await updateRating(env, id, session.sub, rating);

        return jsonResponse({ ok: true, comment, ratingSummary }, 201);
    }

    // GET /api/scripts/:id/ratings
    const ratingsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/ratings$/);
    if (ratingsMatch && method === "GET") {
        const id = ratingsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);
        const session = await getSession(request, env);
        return jsonResponse(await getRatingSummary(env, id, session?.sub || null));
    }

    // POST /api/scripts/:id/ratings — standalone rating without a comment
    if (ratingsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "rating", 20, 600)))
            return jsonResponse({ error: "Too many rating requests." }, 429);
        const id = ratingsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Not found" }, 404);
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in with Google to rate scripts." }, 401);
        let body;
        try { body = JSON.parse(await request.text()); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
        const rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5)
            return jsonResponse({ error: "Rating must be 1–5" }, 400);
        return jsonResponse(await updateRating(env, id, session.sub, rating));
    }

    return jsonResponse({ error: "Not found" }, 404);
}



// Shared comment helpers used by the script/admin modules.
export async function getComments(env, id) {
    const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
    let comments = [];
    try { comments = raw ? JSON.parse(raw) : []; } catch {}
    return Array.isArray(comments) ? comments.sort((a,b) => Number(b.createdAt) - Number(a.createdAt)) : [];
}

export async function deleteComment(env, id, commentId) {
    const comments = await getComments(env, id);
    const next = comments.filter(c => String(c.id) !== String(commentId));
    if (next.length === comments.length) return false;
    await env.SCRIPTS_KV.put(`comments:${id}`, JSON.stringify(next.slice(-200)));
    return true;
}

export async function deleteComments(env, id) {
    await env.SCRIPTS_KV.delete(`comments:${id}`);
    return true;
}



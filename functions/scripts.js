/* scripts.js — Script gallery, script API, ratings, comments, views and Roblox thumbnail support. */

const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;
const MAX_HUB_LENGTH = 40;
const MAX_COMMENT_LENGTH = 400;
const MAX_TAGS = 10;

const SCRIPTS_INDEX_KEY = "scripts:index";

function sanitizeText(value, maxLen) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function safeJsonForHtml(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

async function readJson(request, maxBytes = 35000) {
    const length = Number(request.headers.get("Content-Length") || 0);
    if (length && length > maxBytes) throw new Error("BODY_TOO_LARGE");
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new Error("BODY_TOO_LARGE");
    return JSON.parse(text);
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

function sanitizeTags(input) {
    if (!input) return [];
    let arr;
    if (Array.isArray(input)) arr = input;
    else if (typeof input === "string") arr = input.split(",");
    else return [];
    return arr.map((t) => String(t).trim().toUpperCase().replace(/[\[\]]/g, ""))
        .filter((t) => t.length > 0 && t.length <= 24)
        .slice(0, MAX_TAGS);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }
    });
}

function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const out = {};
    header.split(";").forEach((part) => {
        const [k, ...v] = part.trim().split("=");
        if (k) out[k] = decodeURIComponent(v.join("="));
    });
    return out;
}

async function getSession(request, env) {
    const sid = parseCookies(request).session;
    if (!sid) return null;
    const raw = await env.SESSIONS_KV.get(`session:${sid}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

function isAdminEmail(env, email) {
    if (!email) return false;
    const configured = [
        env.ADMIN_EMAILS || "",
        env.ADMIN_EMAIL || ""
    ].join(",");
    const list = configured
        .split(/[,\s;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
    return list.includes(String(email).trim().toLowerCase());
}

function renderCodeWithLineNumbers(code) {
    return String(code || "").split("\n").map((line, i) => {
        const num = String(i + 1).padStart(3, " ");
        return `<span class="code-line"><span class="ln">${num}</span><span class="lt">${escapeHtml(line) || " "}</span></span>`;
    }).join("\n");
}

const SHARED_HEAD = (title, desc, canonical, ogImage = "https://dakait.online/og-image.png") => `
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<link rel="canonical" href="${escapeHtml(canonical)}"/>
<meta name="robots" content="index, follow"/>
<meta name="keywords" content="roblox scripts, free roblox scripts, roblox executor scripts, keyless roblox scripts, blox fruits script, grow a garden script, rivals script, lumber tycoon script, dakait"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:url" content="${escapeHtml(canonical)}"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/>
<meta property="og:site_name" content="Silk Road Script Hub — dakait.online"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="/favicon.svg"/>
`;

async function listAllScriptRecords(env) {
    const records = [];
    let cursor = undefined;

    do {
        const result = await env.SCRIPTS_KV.list({
            prefix: "script:",
            ...(cursor ? { cursor } : {})
        });

        for (const key of result.keys || []) {
            const raw = await env.SCRIPTS_KV.get(key.name);
            if (!raw) continue;
            try {
                const script = JSON.parse(raw);
                if (script?.id) records.push(script);
            } catch {}
        }

        cursor = result.list_complete ? undefined : result.cursor;
    } while (cursor);

    return records;
}

function toSummary(script, rating) {
    return {
        id: script.id,
        title: script.title,
        description: script.description || "",
        username: script.username || "anonymous",
        placeId: script.placeId || null,
        gameName: script.gameName || null,
        hubName: script.hubName || "",
        tags: Array.isArray(script.tags) ? script.tags : [],
        keysystem: !!script.keysystem,
        createdAt: Number(script.createdAt) || 0,
        updatedAt: Number(script.updatedAt) || Number(script.createdAt) || 0,
        length: typeof script.code === "string" ? script.code.length : Number(script.length) || 0,
        views: Number(script.views) || 0,
        rating
    };
}

async function getRatingSummary(env, id, sessionSub = null) {
    const raw = await env.SCRIPTS_KV.get(`ratings:${id}`);
    const ratings = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
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

async function getGalleryScripts(env, sessionSub = null) {
    const records = await listAllScriptRecords(env);
    const summaries = await Promise.all(records.map(async (script) => {
        const [rating, views] = await Promise.all([
            getRatingSummary(env, script.id, sessionSub),
            getViews(env, script.id)
        ]);
        const summary = toSummary(script, rating);
        summary.views = views || summary.views || 0;
        return summary;
    }));
    return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

async function getScriptIndex(env) {
    const scripts = await getGalleryScripts(env);
    // Keep the old index as a cache/compatibility layer, but the gallery's
    // source of truth is now the individual script:<id> records.
    try {
        const compact = scripts.map((s) => ({ ...s }));
        await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(compact));
    } catch {}
    return scripts;
}

async function saveScriptIndexCache(env, scripts) {
    try { await env.SCRIPTS_KV.put(SCRIPTS_INDEX_KEY, JSON.stringify(scripts)); } catch {}
}

export async function getAllScriptSummaries(env) {
    return getGalleryScripts(env);
}

export async function recordScriptView(env, id) {
    const key = `views:${id}`;
    const raw = await env.SCRIPTS_KV.get(key);
    const current = raw ? Number(raw) : 0;
    const next = Number.isFinite(current) ? current + 1 : 1;
    await env.SCRIPTS_KV.put(key, String(next));
    return next;
}

async function getViews(env, id) {
    const raw = await env.SCRIPTS_KV.get(`views:${id}`);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
}

async function syncViewsIntoScript(env, script) {
    const views = await getViews(env, script.id);
    if (views !== Number(script.views || 0)) {
        script.views = views;
        await env.SCRIPTS_KV.put(`script:${script.id}`, JSON.stringify(script));
    }
    return views;
}

export async function getRobloxGameInfo(env, placeId) {
    if (!placeId || !/^\d+$/.test(String(placeId))) return null;

    const cacheKey = `robloxinfo:${placeId}`;
    const cached = await env.SCRIPTS_KV.get(cacheKey);
    if (cached) {
        if (cached === "NONE") return null;
        try { return JSON.parse(cached); } catch {}
    }

    try {
        const uniRes = await fetch(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`);
        if (!uniRes.ok) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }

        const uniData = await uniRes.json();
        const universeId = uniData.universeId;
        if (!universeId) return null;

        const [iconRes, gameRes] = await Promise.all([
            fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${universeId}&size=512x512&format=Png&isCircular=false`),
            fetch(`https://games.roblox.com/v1/games?universeIds=${universeId}`)
        ]);

        const iconData = iconRes.ok ? await iconRes.json() : null;
        const gameData = gameRes.ok ? await gameRes.json() : null;
        const imageUrl = iconData?.data?.[0]?.imageUrl || null;
        const name = gameData?.data?.[0]?.name || null;

        if (!imageUrl && !name) {
            await env.SCRIPTS_KV.put(cacheKey, "NONE", { expirationTtl: 3600 });
            return null;
        }

        const info = { imageUrl, name };
        await env.SCRIPTS_KV.put(cacheKey, JSON.stringify(info), { expirationTtl: 86400 });
        return info;
    } catch {
        return null;
    }
}

async function sendDiscordWebhook(env, { title, gameName, link, tags, username }) {
    if (!env.DISCORD_WEBHOOK_URL) return;

    const lines = [
        `**New script uploaded**`,
        `**${title}**`,
        gameName ? `Game: ${gameName}` : null,
        `Uploader: ${username || "anonymous"}`,
        tags?.length ? `Tags: ${tags.join(", ")}` : null,
        `[Open script](${link})`
    ].filter(Boolean);

    try {
        await fetch(env.DISCORD_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: lines.join("\n") })
        });
    } catch {}
}

async function updateRating(env, id, sessionSub, rating) {
    const key = `ratings:${id}`;
    const raw = await env.SCRIPTS_KV.get(key);
    const ratings = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    ratings[sessionSub] = { rating, updatedAt: Date.now() };
    await env.SCRIPTS_KV.put(key, JSON.stringify(ratings));
    return getRatingSummary(env, id, sessionSub);
}

function buildCommentStars(rating) {
    const r = Number(rating) || 0;
    return Array.from({ length: 5 }, (_, i) =>
        `<span class="${i < r ? "on" : ""}">★</span>`
    ).join("");
}

export async function handleScriptsApi(request, env, path) {
    const method = request.method;
    const url = new URL(request.url);

    if (method === "OPTIONS") {
        return new Response(null, {
            status: 204,
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            }
        });
    }

    /* ───────────── Gallery API ───────────── */
    if (path === "/api/scripts" && method === "GET") {
        const session = await getSession(request, env);
        const scripts = await getGalleryScripts(env, session?.sub || null);
        await saveScriptIndexCache(env, scripts);
        return jsonResponse({ scripts });
    }

    /* ───────────── Upload ───────────── */
    if (path === "/api/scripts" && method === "POST") {
        if (!(await rateLimit(request, env, "upload", 5, 3600))) {
            return jsonResponse({ error: "Too many uploads. Try again later." }, 429);
        }

        let body;
        try {
            body = await readJson(request);
        } catch (err) {
            return jsonResponse({
                error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body"
            }, 400);
        }

        const session = await getSession(request, env);
        const title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        const description = sanitizeText(body.description, MAX_DESC_LENGTH);
        const username = session
            ? sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user"
            : sanitizeText(body.username, MAX_USERNAME_LENGTH) || "anonymous";
        const code = typeof body.code === "string" ? body.code.slice(0, MAX_CODE_LENGTH) : "";
        const hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        const tags = sanitizeTags(body.tags);
        const keysystem = !!body.keysystem;

        let placeId = body.placeId ? String(body.placeId).trim() : null;
        if (placeId && !/^\d+$/.test(placeId)) placeId = null;

        if (!title || !code) return jsonResponse({ error: "title and code are required" }, 400);

        let gameName = null;
        if (placeId) {
            const info = await getRobloxGameInfo(env, placeId);
            if (info) gameName = info.name;
        }

        const id = crypto.randomUUID();
        const createdAt = Date.now();
        const record = {
            id,
            title,
            description,
            username,
            code,
            placeId,
            gameName,
            hubName,
            tags,
            keysystem,
            createdAt,
            updatedAt: createdAt,
            views: 0,
            ownerSub: session ? session.sub : null
        };

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(record));

        // Refresh the compatibility index from source-of-truth records.
        const scripts = await getGalleryScripts(env);
        await saveScriptIndexCache(env, scripts);

        // Webhook is only a notification. No Discord <-> Roblox queue remains.
        await sendDiscordWebhook(env, {
            title,
            gameName,
            link: `https://dakait.online/scripts/${id}`,
            tags,
            username
        });

        return jsonResponse({ script: record }, 201);
    }

    const singleMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)$/);

    /* ───────────── Single script ───────────── */
    if (singleMatch && method === "GET") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);

        const script = JSON.parse(raw);
        const views = await getViews(env, id);
        script.views = views;
        return jsonResponse({ script });
    }

    if (singleMatch && method === "PUT") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);

        const script = JSON.parse(raw);
        const session = await getSession(request, env);
        const isOwner = !!(session?.sub && script.ownerSub && session.sub === script.ownerSub);
        const isAdmin = !!(session?.email && isAdminEmail(env, session.email));

        if (!isOwner && !isAdmin) return jsonResponse({ error: "Unauthorized" }, 401);

        let body;
        try { body = await readJson(request, 35000); }
        catch (err) {
            return jsonResponse({
                error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body"
            }, 400);
        }

        if (typeof body.title === "string") script.title = sanitizeText(body.title, MAX_TITLE_LENGTH);
        if (typeof body.description === "string") script.description = sanitizeText(body.description, MAX_DESC_LENGTH);
        if (typeof body.code === "string") script.code = body.code.slice(0, MAX_CODE_LENGTH);
        if (typeof body.hubName === "string") script.hubName = sanitizeText(body.hubName, MAX_HUB_LENGTH);
        if (body.tags !== undefined) script.tags = sanitizeTags(body.tags);
        if (body.keysystem !== undefined) script.keysystem = !!body.keysystem;

        if (body.placeId !== undefined) {
            let placeId = body.placeId ? String(body.placeId).trim() : null;
            if (placeId && !/^\d+$/.test(placeId)) placeId = null;
            script.placeId = placeId;
            script.gameName = null;

            if (placeId) {
                const info = await getRobloxGameInfo(env, placeId);
                if (info) script.gameName = info.name;
            }
        }

        script.updatedAt = Date.now();
        script.views = await getViews(env, id);

        if (!script.title || !script.code) {
            return jsonResponse({ error: "title and code are required" }, 400);
        }

        await env.SCRIPTS_KV.put(`script:${id}`, JSON.stringify(script));
        await saveScriptIndexCache(env, await getGalleryScripts(env));

        return jsonResponse({ script });
    }

    /* ───────────── Delete ───────────── */
    if (singleMatch && method === "DELETE") {
        const id = singleMatch[1];
        const raw = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!raw) return jsonResponse({ error: "Not found" }, 404);

        const script = JSON.parse(raw);
        const auth = request.headers.get("Authorization") || "";
        const masterAuthorized = !!env.DELETE_KEY && auth === `Bearer ${env.DELETE_KEY}`;
        const session = await getSession(request, env);
        const isOwner = !!(session?.sub && script.ownerSub && session.sub === script.ownerSub);
        const isAdmin = !!(session?.email && isAdminEmail(env, session.email));

        if (!masterAuthorized && !isOwner && !isAdmin) {
            return jsonResponse({
                error: "Unauthorized",
                reason: session ? `Admin=${isAdmin}, Owner=${isOwner}` : "Not signed in"
            }, 401);
        }

        await Promise.all([
            env.SCRIPTS_KV.delete(`script:${id}`),
            env.SCRIPTS_KV.delete(`comments:${id}`),
            env.SCRIPTS_KV.delete(`ratings:${id}`),
            env.SCRIPTS_KV.delete(`views:${id}`)
        ]);

        await saveScriptIndexCache(env, await getGalleryScripts(env));
        return jsonResponse({ deleted: id });
    }

    /* ───────────── Comments ───────────── */
    const commentsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/comments$/);

    if (commentsMatch && method === "GET") {
        const id = commentsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);

        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        let comments = [];
        try { comments = raw ? JSON.parse(raw) : []; } catch {}

        comments = Array.isArray(comments) ? comments : [];
        comments.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));

        return jsonResponse({ comments });
    }

    if (commentsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "comment", 10, 600))) {
            return jsonResponse({ error: "Too many comments. Try again later." }, 429);
        }

        const id = commentsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Script not found" }, 404);

        let body;
        try { body = await readJson(request, 6000); }
        catch (err) {
            return jsonResponse({
                error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body"
            }, 400);
        }

        const text = sanitizeText(body.text, MAX_COMMENT_LENGTH);
        if (!text) return jsonResponse({ error: "Comment text required" }, 400);

        const session = await getSession(request, env);
        const author = session
            ? sanitizeText(session.name, MAX_USERNAME_LENGTH) || "user"
            : sanitizeText(body.author, MAX_USERNAME_LENGTH) || "anonymous";

        const hasRating = body.rating !== undefined && body.rating !== null && body.rating !== "";
        let rating = null;

        if (hasRating) {
            rating = Number(body.rating);
            if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
                return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
            }
            if (!session?.sub) {
                return jsonResponse({ error: "Sign in with Google to attach a star rating." }, 401);
            }
        }

        const raw = await env.SCRIPTS_KV.get(`comments:${id}`);
        let comments = [];
        try { comments = raw ? JSON.parse(raw) : []; } catch {}
        if (!Array.isArray(comments)) comments = [];

        const comment = {
            id: crypto.randomUUID(),
            author,
            text,
            rating,
            createdAt: Date.now(),
            authorSub: session?.sub || null
        };

        comments.push(comment);
        await env.SCRIPTS_KV.put(`comments:${id}`, JSON.stringify(comments.slice(-200)));

        let ratingSummary = null;
        if (rating !== null && session?.sub) {
            ratingSummary = await updateRating(env, id, session.sub, rating);
        }

        return jsonResponse({ ok: true, comment, rating: ratingSummary }, 201);
    }

    /* ───────────── Ratings (kept for changing a rating without a new comment) ───────────── */
    const ratingsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/ratings$/);

    if (ratingsMatch && method === "GET") {
        const id = ratingsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Not found" }, 404);

        const session = await getSession(request, env);
        return jsonResponse(await getRatingSummary(env, id, session?.sub || null));
    }

    if (ratingsMatch && method === "POST") {
        if (!(await rateLimit(request, env, "rating", 20, 600))) {
            return jsonResponse({ error: "Too many rating requests. Try again later." }, 429);
        }

        const id = ratingsMatch[1];
        const exists = await env.SCRIPTS_KV.get(`script:${id}`);
        if (!exists) return jsonResponse({ error: "Not found" }, 404);

        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in with Google to rate scripts" }, 401);

        let body;
        try { body = await readJson(request, 2000); }
        catch (err) {
            return jsonResponse({
                error: err.message === "BODY_TOO_LARGE" ? "Request body too large" : "Invalid JSON body"
            }, 400);
        }

        const rating = Number(body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return jsonResponse({ error: "Rating must be an integer from 1 to 5" }, 400);
        }

        return jsonResponse(await updateRating(env, id, session.sub, rating));
    }

    return jsonResponse({ error: "Not found" }, 404);
}

/* ─────────────────── Gallery page ─────────────────── */

export const GALLERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Roblox Scripts — All, Most Viewed & Latest | dakait.online",
    "Browse free Roblox scripts. Sort by all, most viewed, or latest. Search Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon and more.",
    "https://dakait.online/scripts"
)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#090a0d;--panel:#111319;--panel2:#171922;--line:#22252f;--text:#e9ebf0;--muted:#777d8d;--accent:#ffb238;--green:#5cd98a;--red:#ff6666;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--sans);overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.025;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.wrap{max-width:1100px;margin:auto;padding:26px 18px 100px;position:relative}
nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:54px}
.brand{font:700 12px var(--mono);letter-spacing:.15em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}
.nav-pill{font:11px var(--mono);color:var(--accent);border:1px solid #4c3b20;border-radius:999px;padding:7px 12px;text-decoration:none}
.hero{margin-bottom:30px}.eyebrow{font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:8px}
h1{font:700 clamp(32px,6vw,56px)/1 var(--mono);margin:0 0 12px}.hl{color:var(--accent)}.hero-sub{max-width:680px;color:var(--muted);font-size:14px}
.search{margin-top:24px}.search input{width:100%;background:#111218;border:1px solid var(--line);border-radius:9px;padding:13px 15px;color:var(--text);outline:none;font:13px var(--sans)}.search input:focus{border-color:#60471d}
.tabs{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0 9px}.tab,.filter{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:8px 12px;font:10px var(--mono);cursor:pointer;text-transform:uppercase;letter-spacing:.05em}.tab.active,.tab:hover,.filter.active,.filter:hover{border-color:#765321;color:var(--accent);background:rgba(255,178,56,.06)}
.filter-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:32px}.filter{padding:6px 9px;font-size:9px}
.list-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.list-head h2{font:10px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:0}.count{font:10px var(--mono);color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.card{display:block;position:relative;background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden;color:inherit;text-decoration:none;transform:translateY(12px);opacity:0;animation:cardIn .55s cubic-bezier(.16,1,.3,1) forwards;transition:border-color .2s,transform .2s,background .2s}.card:hover{border-color:#51401f;background:var(--panel2);transform:translateY(-3px)}
@keyframes cardIn{to{transform:translateY(0);opacity:1}}.card-img{display:block;width:100%;height:150px;object-fit:cover;background:#0e0f13}.card-img-ph{height:150px;display:grid;place-items:center;background:linear-gradient(135deg,#181a20,#0c0d10);font:35px var(--mono);color:#4d432e}
.card-body{padding:13px 14px 14px}.game{font:9px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title{font:700 15px var(--mono);margin:5px 0 6px}.desc{font-size:12px;line-height:1.5;color:var(--muted);min-height:36px}.tag-row{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.tag{font:9px var(--mono);padding:3px 6px;border-radius:5px;color:var(--muted);background:#0b0c10;border:1px solid var(--line)}.tag.green{color:var(--green);border-color:#245637}.stats{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px;font:9px var(--mono);color:var(--muted)}.stats b{color:var(--text);font-weight:500}.works{color:var(--green)!important}.card-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);margin-top:12px;padding-top:10px;font:9px var(--mono);color:#606675}.arrow{color:var(--accent);font-size:14px}.badge{position:absolute;right:9px;top:9px;font:9px var(--mono);padding:4px 7px;border-radius:5px;background:#090a0ddd;border:1px solid var(--line)}.badge.keyless{color:var(--green)}.badge.key{color:var(--red)}
.empty{grid-column:1/-1;padding:70px 20px;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font:11px var(--mono)}.empty-icon{font-size:30px;margin-bottom:10px}
.skel{height:300px;border-radius:11px;background:linear-gradient(90deg,#101117,#171922,#101117);background-size:200% 100%;animation:sh 1.2s infinite}@keyframes sh{to{background-position:-200% 0}}
@media(max-width:820px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:540px){.wrap{padding:20px 14px 80px}.grid{grid-template-columns:1fr}.card-img{height:170px}nav{margin-bottom:38px}}
</style>
</head>
<body>
<div class="wrap">
<nav><div class="brand"><a href="/">dakait<span>.online</span></a></div><a class="nav-pill" href="/upload-scripts">+ Drop a script</a></nav>
<section class="hero">
<div class="eyebrow">Silk Road · Script Hub</div>
<h1><span class="hl">Loot</span> the gallery.</h1>
<p class="hero-sub">Free Roblox scripts. Sort by what's new, what's popular, or browse everything. Rate scripts and tell the community if they still work.</p>
<div class="search"><input id="search" placeholder="Search by title, game, tag — e.g. grow a garden autofarm" autocomplete="off" spellcheck="false"/></div>
</section>

<div class="tabs" id="tabs">
<button class="tab active" data-sort="all">All</button>
<button class="tab" data-sort="views">Most Viewed</button>
<button class="tab" data-sort="latest">Latest</button>
</div>
<div class="filter-row" id="filters">
<button class="filter active" data-filter="all">All</button>
<button class="filter" data-filter="keyless">Keyless</button>
<button class="filter" data-filter="blox">Blox Fruits</button>
<button class="filter" data-filter="garden">Grow a Garden</button>
<button class="filter" data-filter="rivals">Rivals</button>
<button class="filter" data-filter="lumber">Lumber Tycoon</button>
<button class="filter" data-filter="steal">Steal a Brainrot</button>
</div>

<div class="list-head"><h2 id="sectionTitle">All scripts</h2><span class="count" id="count"></span></div>
<div id="grid" class="grid"></div>
</div>
<script>
const grid=document.getElementById("grid"),search=document.getElementById("search"),count=document.getElementById("count"),sectionTitle=document.getElementById("sectionTitle");
let all=[],sort="all",filter="all";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ago=ts=>{const s=Math.max(0,Math.floor((Date.now()-Number(ts||0))/1000));if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";};
function shimmer(){grid.innerHTML=Array.from({length:6},()=>'<div class="skel"></div>').join("")}
function matches(s){
 if(filter==="keyless")return !s.keysystem;
 if(filter==="all")return true;
 const hay=[s.title,s.description,s.gameName,s.hubName,...(s.tags||[])].join(" ").toLowerCase();
 return hay.includes(filter);
}
function render(){
 let list=all.filter(matches);
 const q=search.value.trim().toLowerCase();
 if(q)list=list.filter(s=>[s.title,s.description,s.gameName,s.hubName,...(s.tags||[])].join(" ").toLowerCase().includes(q));
 if(sort==="views")list.sort((a,b)=>(b.views||0)-(a.views||0)||(b.createdAt-a.createdAt));
 else list.sort((a,b)=>b.createdAt-a.createdAt);
 sectionTitle.textContent=sort==="views"?"Most viewed":sort==="latest"?"Latest drops":"All scripts";
 count.textContent=list.length+(list.length===1?" script":" scripts");
 if(!list.length){grid.innerHTML='<div class="empty"><div class="empty-icon">🏜</div><p>No scripts match this view yet.</p></div>';return}
 grid.innerHTML="";
 list.forEach((s,i)=>{
   const a=document.createElement("a");a.href="/scripts/"+encodeURIComponent(s.id);a.className="card";a.style.animationDelay=(i*45)+"ms";
   const img=s.placeId?'<img class="card-img" src="/api/roblox-thumbnail?placeId='+encodeURIComponent(s.placeId)+'" loading="lazy" alt="'+esc(s.title)+'" onerror="this.outerHTML=\\'<div class="card-img-ph">⌗</div>\\'"/>':'<div class="card-img-ph">⌗</div>';
   const rating=s.rating||{};const avg=Number(rating.average||0);const works=Number(rating.worksPercent||0);
   const ratingText=rating.total?('★ '+avg.toFixed(1)+' · '+rating.total):'No ratings';
   const worksText=rating.total?('✓ '+works+'% works'):'— no ratings';
   const badge=s.keysystem?'<span class="badge key">KEY</span>':'<span class="badge keyless">KEYLESS</span>';
   const tags=(s.tags||[]).slice(0,4).map(t=>'<span class="tag">'+esc(t)+'</span>').join("");
   a.innerHTML=img+badge+'<div class="card-body">'+(s.gameName?'<div class="game">'+esc(s.gameName)+'</div>':'')+'<div class="title">'+esc(s.title)+'</div><div class="desc">'+esc(s.description||"No description.")+'</div><div class="tag-row">'+(s.hubName?'<span class="tag green">'+esc(s.hubName)+'</span>':'')+tags+'</div><div class="stats"><span>'+esc(ratingText)+'</span><span class="works">'+esc(worksText)+'</span><span>◉ '+Number(s.views||0)+' views</span></div><div class="card-foot"><span>'+esc(s.username||"anonymous")+' · '+ago(s.createdAt)+'</span><span class="arrow">→</span></div></div>';
   grid.appendChild(a);
 });
}
function setSort(v){sort=v;document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.sort===v));render()}
document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setSort(b.dataset.sort));
document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));render()});
search.oninput=render;
shimmer();
fetch("/api/scripts").then(r=>{if(!r.ok)throw new Error();return r.json()}).then(d=>{all=d.scripts||[];render()}).catch(()=>{grid.innerHTML='<div class="empty"><div class="empty-icon">⚠</div><p>Couldn\\'t load scripts. Refresh and try again.</p></div>'});
</script>
</body>
</html>`;

export function buildDetailHtml(script, thumbnailUrl) {
    const safeTitle = escapeHtml(script.title);
    const safeDesc = escapeHtml(script.description || "No description provided.");
    const safeUser = escapeHtml(script.username || "anonymous");
    const safeGame = script.gameName ? escapeHtml(script.gameName) : null;
    const codeHtml = renderCodeWithLineNumbers(script.code);
    const tags = Array.isArray(script.tags) ? script.tags : [];
    const tagPills = tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");
    const hubPill = script.hubName ? `<span class="pill hub">${escapeHtml(script.hubName)}</span>` : "";
    const keyBadge = script.keysystem
        ? `<span class="key-badge haskey">Key System</span>`
        : `<span class="key-badge keyless">Keyless / No Key</span>`;
    const imgBlock = thumbnailUrl
        ? `<img class="hero-img" src="${escapeHtml(thumbnailUrl)}" alt="${safeTitle} thumbnail"/>`
        : `<div class="hero-img placeholder">⌗</div>`;

    const pageTitle = script.gameName
        ? `${script.title} — ${script.gameName} Script | dakait.online`
        : `${script.title} | Silk Road Script Hub — dakait.online`;
    const pageDesc = safeGame
        ? `Free ${script.gameName} script. ${(script.description || "").slice(0, 120)}. ${script.keysystem ? "Requires key." : "Keyless."}`
        : `${(script.description || script.title).slice(0, 155)}. Free Roblox script on dakait.online.`;
    const canonical = `https://dakait.online/scripts/${script.id}`;

    const jsonLd = safeJsonForHtml({
        "@context": "https://schema.org",
        "@type": "SoftwareSourceCode",
        "name": script.title,
        "description": (script.description || script.title).slice(0, 250),
        "url": canonical,
        "programmingLanguage": "Lua",
        "author": { "@type": "Person", "name": script.username || "anonymous" },
        "dateCreated": new Date(script.createdAt).toISOString(),
        "codeRepository": "https://dakait.online/scripts",
        "keywords": ["roblox script", "roblox", script.gameName, ...(script.tags || [])].filter(Boolean).join(", "),
        "isAccessibleForFree": true,
        "publisher": { "@type": "Organization", "name": "Silk Road Script Hub", "url": "https://dakait.online" }
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(pageTitle, pageDesc.slice(0,160), canonical, thumbnailUrl || "https://dakait.online/og-image.png")}
<script type="application/ld+json">${jsonLd}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#0c0d10;--panel:#14161b;--line:#232631;--text:#e8e9ed;--muted:#8b8f9c;--accent:#ffb238;--green:#5cd98a;--red:#ff5d5d;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6}
.wrap{max-width:820px;margin:auto;padding:30px 20px 80px}.page-head{display:flex;justify-content:space-between;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:25px}.brand{font:700 13px var(--mono);letter-spacing:.12em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}.nav-link{font:11px var(--mono);color:var(--accent);text-decoration:none}
.hero{display:flex;gap:20px;flex-wrap:wrap;margin-bottom:18px}.hero-img{width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--line);flex-shrink:0}.hero-img.placeholder{display:grid;place-items:center;background:#111319;color:#5c4b2b;font:36px var(--mono)}.hero-text{flex:1;min-width:210px}.game-tag{font:10px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.06em}.hero h1{font:700 clamp(23px,5vw,32px) var(--mono);margin:5px 0 7px}.meta{font:11px var(--mono);color:var(--muted)}.desc{font-size:14px;color:#c9cbd1}.tag-row{display:flex;gap:6px;flex-wrap:wrap;margin:9px 0}.pill{font:9px var(--mono);padding:3px 8px;border:1px solid #4d3a1c;border-radius:5px;color:var(--accent);background:#ffb23810}.pill.hub{color:var(--green);border-color:#28583b;background:#5cd98a0d}.key-badge{display:inline-block;font:10px var(--mono);padding:4px 9px;border-radius:6px}.keyless{color:var(--green);border:1px solid #2c6943}.haskey{color:var(--red);border:1px solid #693434}
.owner-actions{display:flex;gap:7px;margin-top:11px}.owner-actions a,.owner-actions button{font:11px var(--mono);padding:6px 11px;border-radius:6px;background:transparent;border:1px solid var(--line);color:var(--text);cursor:pointer;text-decoration:none}.delete-btn{color:var(--red)!important;border-color:#663333!important}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:17px;margin-bottom:16px}.code-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px}.code-head span{font:10px var(--mono);color:var(--muted);text-transform:uppercase}.copy-btn{background:var(--accent);border:0;border-radius:6px;padding:8px 15px;color:#191205;font:700 11px var(--mono);cursor:pointer}
pre{margin:0;max-height:480px;overflow:auto;background:#090a0d;border:1px solid var(--line);border-radius:7px;padding:13px 0;font:12px var(--mono);color:#c9e6c4}.code-line{display:block;padding:0 12px;white-space:pre}.ln{color:#5c4a28;margin-right:13px;user-select:none}
.rating-summary-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.panel h3{font:11px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:0 0 6px}.summary{font:13px var(--mono)}.big-stars{color:var(--accent);font-size:18px;letter-spacing:1px}.bars{display:flex;flex-direction:column;gap:6px;margin-top:14px}.bar-row{display:grid;grid-template-columns:44px 1fr 46px;gap:8px;align-items:center;font:9px var(--mono);color:var(--muted)}.track{height:7px;background:#090a0d;border-radius:99px;overflow:hidden}.fill{height:100%;background:var(--accent);border-radius:99px}.works-callout{margin-top:12px;padding:10px 12px;border:1px solid #245637;background:#5cd98a0a;border-radius:7px;color:var(--green);font:11px var(--mono)}
.comment{padding:12px 0;border-bottom:1px dashed var(--line)}.comment:last-child{border-bottom:0}.comment-meta{font:10px var(--mono);color:#a17a3c;margin-bottom:5px}.comment-stars span{color:#3d4048}.comment-stars span.on{color:var(--accent)}.comment-text{font-size:13px;color:#d4d6dc}.comment-form{margin-top:13px;display:flex;flex-direction:column;gap:8px}.comment-form input,.comment-form textarea{background:#090a0d;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:9px 11px;font:13px var(--sans)}.rating-picker{display:flex;align-items:center;gap:7px;color:var(--muted);font:10px var(--mono)}.pick-stars{display:flex;gap:1px}.pick-stars button{border:0;background:transparent;color:#454851;font-size:24px;padding:0;cursor:pointer}.pick-stars button.on,.pick-stars button:hover{color:var(--accent)}.comment-form button{align-self:flex-start;background:var(--accent);border:0;border-radius:6px;padding:8px 15px;color:#1a1305;font:700 11px var(--mono);cursor:pointer}.note{font:10px var(--mono);color:var(--muted)}.empty-comments{font:11px var(--mono);color:var(--muted)}
@media(max-width:520px){.wrap{padding:20px 14px 70px}.hero-img{width:92px;height:92px}}
</style>
</head>
<body>
<div class="wrap">
<header class="page-head"><div class="brand"><a href="/">dakait<span>.online</span></a></div><a class="nav-link" href="/scripts">← Gallery</a></header>
<div class="hero">
${imgBlock}
<div class="hero-text">
${safeGame?`<div class="game-tag">For: ${safeGame}</div>`:""}
<h1>${safeTitle}</h1>
<div class="meta">@${safeUser} · ${Number(script.views||0)} views</div>
<div class="tag-row">${hubPill}${tagPills}</div>
${keyBadge}
<p class="desc">${safeDesc}</p>
<div class="owner-actions" id="ownerActions" style="display:none"><a href="/scripts/${encodeURIComponent(script.id)}/edit">Edit</a><button class="delete-btn" id="deleteBtn">Delete</button></div>
</div>
</div>

<section class="panel">
<div class="code-head"><span>script.lua</span><button class="copy-btn" id="copyBtn">Copy</button></div>
<pre id="codeBlock">${codeHtml}</pre>
</section>

<section class="panel">
<div class="rating-summary-row">
<div><h3>Community rating</h3><div class="summary" id="ratingSummary">Loading ratings…</div></div>
<div class="big-stars" id="bigStars">★★★★★</div>
</div>
<div class="bars" id="ratingBars"></div>
<div class="works-callout" id="worksCallout">Loading community feedback…</div>
<p class="note" id="ratingNote">To leave a star rating, sign in with Google and post a comment below.</p>
</section>

<section class="panel">
<h3>Community comments</h3>
<div id="commentsList"><p class="empty-comments">Loading…</p></div>
<form class="comment-form" id="commentForm">
<input id="commentName" maxlength="40" placeholder="Your name (optional for comments)"/>
<div class="rating-picker"><span>Your rating:</span><div class="pick-stars" id="pickStars">
${[1,2,3,4,5].map(n=>`<button type="button" data-rating="${n}" aria-label="${n} stars">★</button>`).join("")}
</div><span id="pickLabel">No rating</span></div>
<textarea id="commentText" maxlength="400" rows="3" placeholder="Does it still work? What do you like about it?" required></textarea>
<button type="submit">Post comment</button>
<div class="note" id="commentNote">A rating is optional. Google sign-in is required to attach a rating.</div>
</form>
</section>
</div>
<script>
const SCRIPT_ID=${safeJsonForHtml(script.id)}, RAW_CODE=${safeJsonForHtml(script.code)};
const copyBtn=document.getElementById("copyBtn");
copyBtn.onclick=async()=>{try{await navigator.clipboard.writeText(RAW_CODE);copyBtn.textContent="Copied";setTimeout(()=>copyBtn.textContent="Copy",1300)}catch{copyBtn.textContent="Select and copy"}};

let me={loggedIn:false,isAdmin:false,sub:null};
fetch("/api/me").then(r=>r.json()).then(data=>{
 me=data;
 const ownerSub=${safeJsonForHtml(script.ownerSub||null)};
 if((me.loggedIn&&me.sub===ownerSub)||(me.loggedIn&&me.isAdmin)){
   document.getElementById("ownerActions").style.display="flex";
 }
 const deleteBtn=document.getElementById("deleteBtn");
 if(deleteBtn)deleteBtn.onclick=async()=>{
   if(!confirm("Delete this script? This also removes its comments and ratings."))return;
   deleteBtn.disabled=true;deleteBtn.textContent="Deleting…";
   const res=await fetch("/api/scripts/"+encodeURIComponent(SCRIPT_ID),{method:"DELETE",credentials:"same-origin"});
   const data=await res.json().catch(()=>({}));
   if(res.ok){window.location.href="/scripts";return}
   deleteBtn.disabled=false;deleteBtn.textContent="Delete";
   alert(data.error||"Couldn't delete. Check that your admin email is configured in ADMIN_EMAILS.");
 };
}).catch(()=>{});

const summary=document.getElementById("ratingSummary"),bars=document.getElementById("ratingBars"),big=document.getElementById("bigStars"),works=document.getElementById("worksCallout"),ratingNote=document.getElementById("ratingNote");
function renderRatings(d){
 const total=Number(d.total||0),avg=Number(d.average||0),dist=d.distribution||{};
 summary.textContent=total?avg.toFixed(1)+"/5 · "+total+(total===1?" rating":" ratings"):"No ratings yet";
 big.textContent=[1,2,3,4,5].map(n=>n<=Math.round(avg)?"★":"☆").join("");
 bars.innerHTML=[5,4,3,2,1].map(n=>{const c=Number(dist[n]||0),p=total?Math.round(c*100/total):0;return '<div class="bar-row"><span>'+n+' star'+(n===1?'':'s')+'</span><div class="track"><div class="fill" style="width:'+p+'%"></div></div><span>'+p+'%</span></div>'}).join("");
 if(total)works.textContent=d.worksPercent+"% of rated users gave 5 stars — the community says it works.";
 else works.textContent="No ratings yet — be the first to test it.";
 if(d.myRating)ratingNote.textContent="Your current rating: "+d.myRating+"/5. You can change it by posting another rating.";
}
async function loadRatings(){try{const r=await fetch("/api/scripts/"+SCRIPT_ID+"/ratings");renderRatings(await r.json())}catch{summary.textContent="Couldn't load ratings."}}
const pick=[...document.querySelectorAll("#pickStars button")],pickLabel=document.getElementById("pickLabel");
let selectedRating=0;
function selectRating(n){selectedRating=n;pick.forEach(b=>b.classList.toggle("on",Number(b.dataset.rating)<=n));pickLabel.textContent=n?n+"/5":"No rating"}
pick.forEach(b=>b.onclick=()=>{if(!me.loggedIn){window.location.href="/auth/login";return}selectRating(Number(b.dataset.rating))});

const commentsList=document.getElementById("commentsList");
function ago(ts){const s=Math.max(0,Math.floor((Date.now()-Number(ts||0))/1000));if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago"}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function stars(r){return [1,2,3,4,5].map(n=>'<span class="'+(n<=Number(r||0)?"on":"")+'">★</span>').join("")}
async function loadComments(){
 try{
  const r=await fetch("/api/scripts/"+SCRIPT_ID+"/comments");const d=await r.json();const list=d.comments||[];
  if(!list.length){commentsList.innerHTML='<p class="empty-comments">No comments yet.</p>';return}
  commentsList.innerHTML=list.map(c=>'<div class="comment"><div class="comment-meta">@'+esc(c.author||"anonymous")+' · '+ago(c.createdAt)+(c.rating?'<span class="comment-stars"> · '+stars(c.rating)+'</span>':"")+'</div><div class="comment-text">'+esc(c.text)+'</div></div>').join("");
 }catch{commentsList.innerHTML='<p class="empty-comments">Couldn\\'t load comments.</p>'}
}
document.getElementById("commentForm").onsubmit=async e=>{
 e.preventDefault();
 const note=document.getElementById("commentNote"),btn=e.currentTarget.querySelector("button[type=submit]");
 const text=document.getElementById("commentText").value.trim(),author=document.getElementById("commentName").value.trim();
 if(!text)return;
 btn.disabled=true;btn.textContent="Posting…";
 try{
  const r=await fetch("/api/scripts/"+SCRIPT_ID+"/comments",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({text,author,rating:selectedRating||null})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||"Couldn't post comment");
  document.getElementById("commentText").value="";
  selectRating(0);
  note.textContent=d.rating?"Comment and rating posted.":"Comment posted.";
  loadComments();loadRatings();
 }catch(err){note.textContent=err.message||"Couldn't post comment."}
 finally{btn.disabled=false;btn.textContent="Post comment"}
};
loadRatings();loadComments();
</script>
</body>
</html>`;
}

export function buildEditHtml(script) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD("Edit Script — dakait.online", "Edit your script on Silk Road Script Hub.", `https://dakait.online/scripts/${script.id}/edit`)}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<meta name="robots" content="noindex"/>
<style>
:root{--bg:#0c0d10;--panel:#14161b;--line:#232631;--text:#e8e9ed;--muted:#8b8f9c;--accent:#ffb238;--danger:#ff5d5d;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans)}.wrap{max-width:680px;margin:auto;padding:30px 20px 80px}.brand{font:700 13px var(--mono);letter-spacing:.12em;text-transform:uppercase;margin-bottom:20px}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}h1{font:700 27px var(--mono)}.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:20px}label{display:block;font:10px var(--mono);color:var(--muted);text-transform:uppercase;margin:15px 0 6px}label:first-child{margin-top:0}input,textarea{width:100%;box-sizing:border-box;background:#090a0d;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:10px 11px;font:13px var(--sans)}textarea#code{min-height:240px;font-family:var(--mono);font-size:12px}.row{display:flex;gap:12px}.row>div{flex:1}.toggle{display:flex;gap:8px}.opt{flex:1;text-align:center;border:1px solid var(--line);padding:9px;border-radius:6px;font:11px var(--mono);color:var(--muted);cursor:pointer}.activeKl{border-color:#2c6943;color:#5cd98a}.activeHk{border-color:#693434;color:#ff5d5d}.submit{margin-top:17px;background:var(--accent);border:0;border-radius:6px;padding:10px 17px;font:700 11px var(--mono);cursor:pointer}.msg{font:11px var(--mono);color:var(--muted)}.msg.ok{color:#5cd98a}.msg.err{color:#ff5d5d}@media(max-width:560px){.row{flex-direction:column}}
</style>
</head>
<body><div class="wrap">
<div class="brand"><a href="/">dakait<span>.online</span></a></div>
<h1>Edit Script</h1>
<section class="panel">
<form id="edit-form">
<label>Title</label><input id="title" maxlength="120" value="${escapeHtml(script.title)}" required/>
<div class="row"><div><label>Roblox Place ID</label><input id="placeId" value="${escapeHtml(script.placeId||"")}"/></div><div><label>Hub name</label><input id="hubName" value="${escapeHtml(script.hubName||"")}"/></div></div>
<label>Tags</label><input id="tags" value="${escapeHtml((script.tags||[]).join(", "))}"/>
<label>Key system</label><div class="toggle"><div class="opt ${script.keysystem?"":"activeKl"}" id="optKl">Keyless / No key</div><div class="opt ${script.keysystem?"activeHk":""}" id="optHk">Has key system</div></div>
<label>Description</label><textarea id="description" maxlength="500" rows="3">${escapeHtml(script.description||"")}</textarea>
<label>Script code</label><textarea id="code">${escapeHtml(script.code)}</textarea>
<button class="submit" type="submit">Save changes</button><p class="msg" id="msg"></p>
</form></section></div>
<script>
const ID=${safeJsonForHtml(script.id)};let keysys=${script.keysystem?"true":"false"};const kl=document.getElementById("optKl"),hk=document.getElementById("optHk"),msg=document.getElementById("msg");
function upd(){kl.className="opt"+(!keysys?" activeKl":"");hk.className="opt"+(keysys?" activeHk":"")}kl.onclick=()=>{keysys=false;upd()};hk.onclick=()=>{keysys=true;upd()};
document.getElementById("edit-form").onsubmit=async e=>{e.preventDefault();msg.textContent="Saving…";msg.className="msg";const body={title:document.getElementById("title").value,placeId:document.getElementById("placeId").value,hubName:document.getElementById("hubName").value,tags:document.getElementById("tags").value,keysystem:keysys,description:document.getElementById("description").value,code:document.getElementById("code").value};try{const r=await fetch("/api/scripts/"+ID,{method:"PUT",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Save failed");msg.textContent="Saved. Opening script…";msg.className="msg ok";setTimeout(()=>location.href="/scripts/"+ID,400)}catch(err){msg.textContent=err.message;msg.className="msg err"}};
</script>
</body></html>`;
}

/* Routes used by the main Worker. */
export async function canManageScript(request, env, script) {
    const session = await getSession(request, env);
    const isOwner = !!(session?.sub && script.ownerSub && session.sub === script.ownerSub);
    const isAdmin = !!(session?.email && isAdminEmail(env, session.email));
    return { session, isOwner, isAdmin, allowed: isOwner || isAdmin };
}

export async function getScript(env, id) {
    const raw = await env.SCRIPTS_KV.get(`script:${id}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

export async function prepareScriptForPage(env, id) {
    const script = await getScript(env, id);
    if (!script) return null;
    script.views = await getViews(env, id);
    return script;
}

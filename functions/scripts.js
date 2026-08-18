/* scripts.js — Script gallery, script CRUD, views and Roblox thumbnail support. */

import { getRatingSummary, updateRating, handleRatingApi, deleteRatings } from "./ratings.js";
import { handleCommentsApi, getComments, deleteComment, deleteComments } from "./comments.js";
import { getLikeSummary, getLikeCount, getCopyCount, handleLikesApi, deleteScriptEngagementData } from "./likes.js";
import { getProfile, getOrCreateProfile } from "./profiles.js";
import { sanitizeText } from "./utils.js";

const MAX_CODE_LENGTH = 20000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 500;
const MAX_USERNAME_LENGTH = 40;
const MAX_HUB_LENGTH = 40;
const MAX_COMMENT_LENGTH = 400;
const MAX_TAGS = 10;

const SCRIPTS_INDEX_KEY = "scripts:index";

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

async function getD1ScriptRecords(env) {
    if (!env.DB) return [];
    try {
        const result = await env.DB.prepare(
            `SELECT id,title,description,username,owner_sub,place_id,game_name,hub_name,tags,keysystem,views,created_at,updated_at FROM scripts ORDER BY created_at DESC`
        ).all();
        return (result?.results || []).map(row => ({
            id: row.id,
            title: row.title,
            description: row.description || "",
            username: row.username || "anonymous",
            ownerSub: row.owner_sub || null,
            placeId: row.place_id || null,
            gameName: row.game_name || null,
            hubName: row.hub_name || "",
            tags: (() => { try { return JSON.parse(row.tags || "[]"); } catch { return []; } })(),
            keysystem: !!row.keysystem,
            views: Number(row.views) || 0,
            createdAt: Number(row.created_at) || 0,
            updatedAt: Number(row.updated_at) || Number(row.created_at) || 0
        }));
    } catch {
        return [];
    }
}

async function getGalleryScripts(env, sessionSub = null) {
    // Build the gallery from every available source. KV is the source of truth
    // for full script records, while D1 and the compact index are recovery
    // sources. Never allow one transient source failure to turn a real gallery
    // into an empty response.
    const byId = new Map();

    try {
        const kvRecords = await listAllScriptRecords(env);
        for (const script of kvRecords) if (script?.id) byId.set(String(script.id), script);
    } catch {}

    try {
        const d1Records = await getD1ScriptRecords(env);
        for (const script of d1Records) {
            if (script?.id && !byId.has(String(script.id))) byId.set(String(script.id), script);
        }
    } catch {}

    try {
        const cachedRaw = await env.SCRIPTS_KV.get(SCRIPTS_INDEX_KEY);
        if (cachedRaw) {
            const cached = JSON.parse(cachedRaw);
            if (Array.isArray(cached)) {
                for (const script of cached) {
                    if (script?.id && !byId.has(String(script.id))) byId.set(String(script.id), script);
                }
            }
        }
    } catch {}

    const records = [...byId.values()];
    const noRating = {
        total: 0, average: 0,
        distribution: {1:0,2:0,3:0,4:0,5:0},
        worksPercent: 0, myRating: 0
    };

    const settled = await Promise.allSettled(records.map(async (script) => {
        let rating = noRating;
        let views = Number(script.views) || 0;

        const [ratingResult, viewResult] = await Promise.allSettled([
            getRatingSummary(env, script.id, sessionSub),
            getViews(env, script.id)
        ]);

        if (ratingResult.status === "fulfilled" && ratingResult.value) rating = ratingResult.value;
        if (viewResult.status === "fulfilled" && Number.isFinite(Number(viewResult.value))) {
            views = Number(viewResult.value);
        }

        const summary = toSummary(script, rating);
        summary.views = views;
        return summary;
    }));

    return settled
        .filter(r => r.status === "fulfilled")
        .map(r => r.value)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
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
    // An empty result can be caused by transient KV/D1 failures. Never replace
    // a known-good index with [] because that makes the next request lose the
    // recovery source as well.
    if (!Array.isArray(scripts) || scripts.length === 0) return;
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
        return jsonResponse({ scripts, count: scripts.length });
    }

    /* ───────────── Upload ───────────── */
    if (path === "/api/scripts" && method === "POST") {
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in with Google before uploading a script." }, 401);

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

        // D1 dual-write — best-effort; KV is source of truth for legacy data
        if (env.DB) { try { await env.DB.prepare(
            `INSERT OR REPLACE INTO scripts (id,title,description,username,owner_sub,place_id,game_name,hub_name,tags,keysystem,views,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?)`
        ).bind(id,title,description||"",username,record.ownerSub||null,placeId||null,gameName||null,hubName||"",JSON.stringify(tags),keysystem?1:0,createdAt,createdAt).run(); } catch {} }

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
        const session = await getSession(request, env);
        const isOwner = !!(session?.sub && script.ownerSub && session.sub === script.ownerSub);
        const isAdmin = !!(session?.email && isAdminEmail(env, session.email));

        if (!isOwner && !isAdmin) {
            return jsonResponse({
                error: "Unauthorized",
                reason: session ? `Admin=${isAdmin}, Owner=${isOwner}` : "Not signed in"
            }, 401);
        }

        await Promise.all([
            env.SCRIPTS_KV.delete(`script:${id}`),
            deleteComments(env, id),
            deleteRatings(env, id),
            env.SCRIPTS_KV.delete(`views:${id}`),
            deleteScriptEngagementData(env, id)
        ]);
        if (env.DB) { try { await env.DB.prepare("DELETE FROM scripts WHERE id=?").bind(id).run(); } catch {} }

        await saveScriptIndexCache(env, await getGalleryScripts(env));
        return jsonResponse({ deleted: id });
    }

    /* ───────────── Admin comment moderation ───────────── */
    const commentDeleteMatch = path.match(/^\/api\/admin\/scripts\/([a-zA-Z0-9-]+)\/comments\/([a-zA-Z0-9-]+)$/);
    if (commentDeleteMatch && method === "DELETE") {
        const session = await getSession(request, env);
        if (!session?.email || !isAdminEmail(env, session.email)) return jsonResponse({ error: "Admin access required" }, 403);
        const ok = await deleteComment(env, commentDeleteMatch[1], commentDeleteMatch[2]);
        return ok ? jsonResponse({ deleted: commentDeleteMatch[2] }) : jsonResponse({ error: "Comment not found" }, 404);
    }

    /* ───────────── Comments / Ratings delegated modules ───────────── */
    const commentsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/comments$/);
    if (commentsMatch) {
        return handleCommentsApi(request, env, path); // FIX: full path, not UUID
    }

    const ratingsMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/ratings$/);
    if (ratingsMatch) {
        return handleRatingApi(request, env, ratingsMatch[1], method, rateLimit);
    }

    return jsonResponse({ error: "Not found" }, 404);
}



export const GALLERY_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(
    "Roblox Scripts — Browse, Search & Filter | dakait.online",
    "Browse free Roblox scripts. Sort by trending, most viewed, or latest. Filter by game. Search Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon and more.",
    "https://dakait.online/scripts"
)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#090a0d;--panel:#111319;--panel2:#171922;--line:#22252f;--text:#e9ebf0;--muted:#777d8d;--accent:#ffb238;--green:#5cd98a;--red:#ff6262;--blue:#6ea8ff;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--sans);overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.025;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.wrap{max-width:1100px;margin:auto;padding:26px 18px 100px;position:relative}
nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:44px;gap:10px;flex-wrap:wrap}
.brand{font:700 12px var(--mono);letter-spacing:.15em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}
.nav-right{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.nav-pill{font:11px var(--mono);color:var(--accent);border:1px solid #4c3b20;border-radius:999px;padding:7px 12px;text-decoration:none;white-space:nowrap}
.nav-muted{color:var(--muted);border-color:var(--line)}
.hero{margin-bottom:26px}.eyebrow{font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;opacity:0;animation:fup .5s .05s cubic-bezier(.16,1,.3,1) forwards}
@keyframes fup{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
h1{font:700 clamp(30px,6vw,54px)/1 var(--mono);margin:0 0 12px;clip-path:inset(0 100% 0 0);animation:revR .7s .2s cubic-bezier(.77,0,.18,1) forwards}
@keyframes revR{to{clip-path:inset(0 0% 0 0)}}.hl{color:var(--accent)}
.hero-sub{color:var(--muted);font-size:14px;max-width:680px;opacity:0;animation:fup .5s .45s cubic-bezier(.16,1,.3,1) forwards}
/* Search */
.search-wrap{margin-top:20px;position:relative;opacity:0;animation:fup .5s .55s cubic-bezier(.16,1,.3,1) forwards}
.search-wrap:before{content:"⌕";position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:16px;pointer-events:none}
.search-wrap input{width:100%;background:#0d0e12;border:1px solid var(--line);border-radius:9px;padding:12px 14px 12px 38px;color:var(--text);outline:none;font:13px var(--sans);transition:border-color .2s}
.search-wrap input:focus{border-color:#60471d}.search-wrap input::placeholder{color:var(--muted)}
/* Tabs */
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 8px;opacity:0;animation:fup .4s .65s cubic-bezier(.16,1,.3,1) forwards}
.tab{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:8px 13px;font:10px var(--mono);cursor:pointer;text-transform:uppercase;letter-spacing:.05em;transition:all .15s}
.tab.active,.tab:hover{border-color:#765321;color:var(--accent);background:rgba(255,178,56,.07)}
.tab.trending.active{border-color:#4c3b8a;color:#a78bfa;background:rgba(167,139,250,.07)}
/* Filters */
.filter-row{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:28px;opacity:0;animation:fup .4s .72s cubic-bezier(.16,1,.3,1) forwards}
.filter{border:1px solid var(--line);background:transparent;color:var(--muted);border-radius:999px;padding:5px 10px;font:9px var(--mono);cursor:pointer;text-transform:uppercase;letter-spacing:.05em;transition:all .15s}
.filter.active,.filter:hover{border-color:#765321;color:var(--accent);background:rgba(255,178,56,.07)}
.filter.kl.active{border-color:#245637;color:var(--green);background:rgba(92,217,138,.07)}
.filter.verified.active{border-color:#2c4a8a;color:var(--blue);background:rgba(110,168,255,.07)}
/* Active URL filter chip */
.active-filter-chip{display:inline-flex;align-items:center;gap:5px;background:rgba(255,178,56,.1);border:1px solid #765321;color:var(--accent);border-radius:999px;padding:4px 10px;font:9px var(--mono);cursor:pointer;margin-bottom:10px}
.active-filter-chip:hover{background:rgba(255,178,56,.18)}
/* List head */
.list-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}
.list-head h2{font:10px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin:0}
.count{font:10px var(--mono);color:var(--muted)}
/* Grid */
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
@keyframes cardIn{to{transform:translateY(0);opacity:1}}
.card{display:block;position:relative;background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden;color:inherit;text-decoration:none;transform:translateY(14px);opacity:0;animation:cardIn .5s cubic-bezier(.16,1,.3,1) forwards;transition:border-color .2s,transform .22s,background .2s}
.card:hover{border-color:#51401f;background:var(--panel2);transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.5)}
.card-img{display:block;width:100%;height:148px;object-fit:cover;background:#0e0f13}
.card-img-ph{height:148px;display:grid;place-items:center;background:linear-gradient(135deg,#181a20,#0c0d10);font:32px var(--mono);color:#4d432e}
.card-body{padding:12px 13px 13px}
.game{font:9px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctitle{font:700 14.5px var(--mono);margin:5px 0 5px;line-height:1.3}
.desc{font-size:12px;line-height:1.5;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:36px}
.tag-row{display:flex;gap:4px;flex-wrap:wrap;margin-top:9px}
.tag{font:9px var(--mono);padding:2px 6px;border-radius:5px;color:var(--muted);background:#0b0c10;border:1px solid var(--line)}
.tag.green{color:var(--green);border-color:#245637}
.tag.blue{color:var(--blue);border-color:#2c4a8a}
.stats{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px;font:9px var(--mono);color:var(--muted)}
.stats .works{color:var(--green)}
.card-foot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--line);margin-top:10px;padding-top:9px;font:9px var(--mono);color:#606675}
.arrow{color:var(--accent);font-size:13px;transition:transform .18s}.card:hover .arrow{transform:translateX(3px)}
.badge{position:absolute;right:9px;top:9px;font:9px var(--mono);padding:3px 7px;border-radius:5px;background:#090a0ddd;border:1px solid var(--line)}
.badge.keyless{color:var(--green);border-color:#245637}.badge.key{color:var(--red);border-color:#693434}
.vbadge{position:absolute;left:9px;top:9px;font:8px var(--mono);padding:3px 6px;border-radius:5px;background:#090a0dcc;border:1px solid #2c4a8a;color:var(--blue)}
.empty{grid-column:1/-1;padding:70px 20px;text-align:center;border:1px dashed var(--line);border-radius:12px;color:var(--muted);font:11px var(--mono)}.empty-icon{font-size:28px;margin-bottom:10px}
.skel{height:296px;border-radius:11px;background:linear-gradient(90deg,#101117 25%,#171922 50%,#101117 75%);background-size:200% 100%;animation:sh 1.2s infinite}@keyframes sh{to{background-position:-200% 0}}
@media(max-width:820px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:540px){.wrap{padding:20px 14px 80px}.grid{grid-template-columns:1fr}nav{margin-bottom:30px}}
@media(prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important;clip-path:none !important}}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <div class="brand"><a href="/">dakait<span>.online</span></a></div>
  <div class="nav-right">
    <span id="accountNav"></span>
    <a class="nav-pill" href="/upload-scripts">+ Drop a script</a>
  </div>
</nav>
<section class="hero">
  <div class="eyebrow">Silk Road · Script Hub</div>
  <h1><span class="hl">Loot</span> the gallery.</h1>
  <p class="hero-sub">Free Roblox scripts. Trending, most viewed, or brand new — search, filter by game, and grab what you need.</p>
  <div class="search-wrap"><input id="search" placeholder="Search by title, game, tag — e.g. grow a garden autofarm" autocomplete="off" spellcheck="false"/></div>
</section>

<div id="activeChip"></div>

<div class="tabs">
  <button class="tab" data-sort="latest">Latest</button>
  <button class="tab trending" data-sort="trending">🔥 Trending</button>
  <button class="tab" data-sort="views">Most Viewed</button>
  <button class="tab" data-sort="all">All (A–Z)</button>
</div>
<div class="filter-row">
  <button class="filter" data-filter="all">All</button>
  <button class="filter kl" data-filter="keyless">Keyless</button>
  <button class="filter verified" data-filter="verified">✓ Verified</button>
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
const grid=document.getElementById("grid"),search=document.getElementById("search"),
  count=document.getElementById("count"),sectionTitle=document.getElementById("sectionTitle");
let all=[],sort="latest",filter="all";

const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ago=ts=>{const s=Math.max(0,Math.floor((Date.now()-Number(ts||0))/1000));if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";};\ndocument.addEventListener("error",e=>{const img=e.target;if(img&&img.matches&&img.matches(".creator-avatar")){const ph=document.createElement("span");ph.className="creator-avatar-ph";ph.textContent=img.dataset.fallback||"?";img.replaceWith(ph);}},true);

// Trending score (Hacker News-style: views / (age_hours + 2)^1.5)
function trendScore(s){
  const ageHours=Math.max(0,(Date.now()-Number(s.createdAt||0))/(3600*1000));
  return (Number(s.views||0)+Number(s.likes||0)*2) / Math.pow(ageHours+2,1.5);
}

function shimmer(){grid.innerHTML=Array.from({length:6},()=>'<div class="skel"></div>').join("")}

function matchFilter(s){
  if(filter==="keyless")return !s.keysystem;
  if(filter==="verified")return !!(s.creatorVerified);
  if(filter==="all")return true;
  const hay=[s.title,s.description,s.gameName,s.hubName,...(s.tags||[])].join(" ").toLowerCase();
  return hay.includes(filter);
}

function render(){
  let list=all.filter(matchFilter);
  const q=search.value.trim().toLowerCase();
  if(q)list=list.filter(s=>[s.title,s.description,s.gameName,s.hubName,...(s.tags||[])].join(" ").toLowerCase().includes(q));
  if(sort==="views")list.sort((a,b)=>(b.views||0)-(a.views||0)||(b.createdAt-a.createdAt));
  else if(sort==="trending")list.sort((a,b)=>trendScore(b)-trendScore(a));
  else if(sort==="all")list.sort((a,b)=>a.title.localeCompare(b.title));
  else list.sort((a,b)=>b.createdAt-a.createdAt);
  const labels={latest:"Latest drops",trending:"🔥 Trending",views:"Most viewed",all:"All scripts (A–Z)"};
  sectionTitle.textContent=labels[sort]||"Scripts";
  count.textContent=list.length+(list.length===1?" script":" scripts");
  if(!list.length){grid.innerHTML='<div class="empty"><div class="empty-icon">🏜</div><p>No scripts match. Try a different filter or search.</p></div>';return;}
  grid.innerHTML="";
  list.forEach((s,i)=>{
    const a=document.createElement("a");a.href="/scripts/"+encodeURIComponent(s.id);a.className="card";a.style.animationDelay=(i*38)+"ms";
    const img=s.placeId?'<img class="card-img" src="/api/roblox-thumbnail?placeId='+encodeURIComponent(s.placeId)+'" loading="lazy" alt="'+esc(s.title)+'" onerror="this.outerHTML=\'<div class=\\"card-img-ph\\">⌗</div>\'"/>':'<div class="card-img-ph">⌗</div>';
    const r=s.rating||{};const avg=Number(r.average||0);const wp=Number(r.worksPercent||0);
    const ratingText=r.total?("★ "+avg.toFixed(1)+" · "+r.total):"No ratings";
    const worksText=r.total?("✓ "+wp+"% works"):"";
    const badge=s.keysystem?'<span class="badge key">KEY</span>':'<span class="badge keyless">KEYLESS</span>';
    const vbadge=s.creatorVerified?'<span class="vbadge">✓ VERIFIED</span>':"";
    const tags=(s.tags||[]).slice(0,3).map(t=>'<span class="tag">'+esc(t)+'</span>').join("");
    const hubTag=s.hubName?'<span class="tag green">'+esc(s.hubName)+'</span>':"";
    a.innerHTML=img+badge+vbadge+'<div class="card-body">'+(s.gameName?'<div class="game">'+esc(s.gameName)+'</div>':'')+'<div class="ctitle">'+esc(s.title)+'</div><div class="desc">'+esc(s.description||"No description.")+'</div><div class="tag-row">'+hubTag+tags+'</div><div class="stats"><span>'+esc(ratingText)+'</span>'+(worksText?'<span class="works">'+esc(worksText)+'</span>':'')+'<span>◉ '+Number(s.views||0)+' views</span>'+(s.likes?'<span>❤ '+s.likes+'</span>':'')+'</div><div class="card-foot"><span>'+esc(s.username||"anonymous")+' · '+ago(s.createdAt)+'</span><span class="arrow">→</span></div></div>';
    grid.appendChild(a);
  });
}

// URL param support: /scripts?sort=trending&filter=garden&q=autofarm
function readUrlParams(){
  const p=new URLSearchParams(location.search);
  const s=p.get("sort");if(s&&["latest","trending","views","all"].includes(s))sort=s;
  const f=p.get("filter")||p.get("game");
  if(f){
    const map={blox:"blox",garden:"garden",rivals:"rivals",lumber:"lumber",steal:"steal",keyless:"keyless",verified:"verified"};
    const norm=f.toLowerCase().replace(/\s+/g,"-");
    filter=map[norm]||map[Object.keys(map).find(k=>norm.includes(k))||""]||"all";
  }
  const q=p.get("q");if(q)search.value=q;
  // Show active chip
  if(filter!=="all"||sort!=="latest"){
    const chip=document.getElementById("activeChip");
    const parts=[];
    if(sort!=="latest")parts.push(sort);
    if(filter!=="all")parts.push(filter);
    if(parts.length)chip.innerHTML='<span class="active-filter-chip" onclick="clearFilters()">'+parts.join(" · ")+" ✕</span>";
  }
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.sort===sort));
  document.querySelectorAll(".filter").forEach(b=>b.classList.toggle("active",b.dataset.filter===filter));
}

function clearFilters(){sort="latest";filter="all";search.value="";pushState();readUrlParams();render();}

function pushState(){
  const p=new URLSearchParams();
  if(sort!=="latest")p.set("sort",sort);
  if(filter!=="all")p.set("filter",filter);
  if(search.value.trim())p.set("q",search.value.trim());
  const qs=p.toString();
  history.replaceState(null,"",qs?"/scripts?"+qs:"/scripts");
  document.getElementById("activeChip").innerHTML="";
  if(filter!=="all"||sort!=="latest"){
    const parts=[];if(sort!=="latest")parts.push(sort);if(filter!=="all")parts.push(filter);
    if(parts.length)document.getElementById("activeChip").innerHTML='<span class="active-filter-chip" onclick="clearFilters()">'+parts.join(" · ")+" ✕</span>";
  }
}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{sort=b.dataset.sort;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));pushState();render();});
document.querySelectorAll(".filter").forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));pushState();render();});
search.oninput=()=>{pushState();render();};

fetch("/api/me",{credentials:"same-origin",cache:"no-store"}).then(r=>r.json()).then(me=>{
  const el=document.getElementById("accountNav");
  if(me.loggedIn)el.innerHTML='<a href="/creator/'+encodeURIComponent(me.sub)+'" class="nav-pill nav-muted" style="color:var(--green)">● '+esc(me.name)+(me.isAdmin?' · ADMIN':'')+'</a><a href="/auth/logout" class="nav-pill nav-muted">logout</a>';
  else el.innerHTML='<a href="/auth/login?return=%2Fscripts" class="nav-pill nav-muted">Sign in</a>';
}).catch(()=>{});

shimmer();
fetch("/api/scripts",{credentials:"same-origin",cache:"no-store"}).then(async r=>{
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||"Gallery API error");
  return d;
}).then(d=>{
  all=Array.isArray(d.scripts)?d.scripts:[];
  readUrlParams();
  render();
}).catch(err=>{
  console.error("Dakait gallery failed:",err);
  grid.innerHTML='<div class="empty"><div class="empty-icon">⚠</div><p>Couldn\'t load the gallery right now.</p><small style="opacity:.6">Refresh in a moment — your scripts are not deleted.</small></div>';
});
</script>
</body>
</html>`;



export function buildDetailHtml(script, thumbnailUrl, profile, likes) {
    const safeTitle  = escapeHtml(script.title);
    const safeDesc   = escapeHtml(script.description || "No description provided.");
    const safeUser   = escapeHtml(script.username || "anonymous");
    const safeGame   = script.gameName ? escapeHtml(script.gameName) : null;
    const codeHtml   = renderCodeWithLineNumbers(script.code);
    const tags       = Array.isArray(script.tags) ? script.tags : [];
    const tagPills   = tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join("");
    const hubPill    = script.hubName ? `<span class="pill hub">${escapeHtml(script.hubName)}</span>` : "";
    const keyBadge   = script.keysystem ? `<span class="kbadge hk">Key System</span>` : `<span class="kbadge kl">Keyless</span>`;
    const updatedAgo = script.updatedAt && script.updatedAt !== script.createdAt
        ? `Updated ${Math.floor((Date.now() - script.updatedAt) / 86400000)}d ago` : "";
    const createdDate = new Date(script.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const isVerified  = !!(profile?.verified);
    const verifiedBadge = isVerified ? `<span class="creator-verified">✓ Verified</span>` : "";
    const avatarLetter = escapeHtml(script.username?.slice(0,1)?.toUpperCase() || "?");
    const creatorAvatar = profile?.picture
        ? `<img class="creator-avatar" src="${escapeHtml(profile.picture)}" alt="${safeUser}" data-fallback="${avatarLetter}"/>`
        : `<span class="creator-avatar-ph">${avatarLetter}</span>`;

    const likeCount = likes?.count || 0;
    const thumbBg   = thumbnailUrl ? `style="background-image:url('${escapeHtml(thumbnailUrl)}')"` : "";

    const pageTitle  = script.gameName
        ? `${script.title} — ${script.gameName} Script | dakait.online`
        : `${script.title} | Silk Road Script Hub`;
    const pageDesc   = [script.gameName ? `Free ${script.gameName} script.` : "", script.description || script.title, script.keysystem ? "Requires key." : "Keyless."].filter(Boolean).join(" ").slice(0, 160);
    const canonical  = `https://dakait.online/scripts/${script.id}`;

    const jsonLd = safeJsonForHtml({
        "@context": "https://schema.org", "@type": "SoftwareSourceCode",
        name: script.title, description: (script.description || script.title).slice(0, 250),
        url: canonical, programmingLanguage: "Lua",
        author: { "@type": "Person", name: script.username || "anonymous" },
        dateCreated: new Date(script.createdAt).toISOString(),
        dateModified: new Date(script.updatedAt || script.createdAt).toISOString(),
        keywords: ["roblox script", script.gameName, ...(script.tags || [])].filter(Boolean).join(", "),
        isAccessibleForFree: true,
        publisher: { "@type": "Organization", name: "Silk Road Script Hub", url: "https://dakait.online" }
    });

    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD(pageTitle, pageDesc, canonical, thumbnailUrl || "https://dakait.online/og-image.png")}
<script type="application/ld+json">${jsonLd}<\/script>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#090a0d;--panel:#111319;--panel2:#171922;--line:#22252f;--text:#e9ebf0;--muted:#777d8d;--accent:#ffb238;--green:#5cd98a;--red:#ff6262;--blue:#6ea8ff;--purple:#a78bfa;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.6;overflow-x:hidden}
.wrap{max-width:900px;margin:auto;padding:22px 18px 80px}
/* NAV */
.top-nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;gap:10px;flex-wrap:wrap}
.brand{font:700 12px var(--mono);letter-spacing:.15em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}
.back-link{font:11px var(--mono);color:var(--muted);text-decoration:none;display:flex;align-items:center;gap:5px;transition:color .15s}.back-link:hover{color:var(--accent)}
/* HERO */
.script-hero{position:relative;background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-bottom:14px}
.hero-bg{position:absolute;inset:-10px;background-size:cover;background-position:center;filter:blur(22px) brightness(.18);transform:scale(1.1);pointer-events:none}
.hero-content{position:relative;display:flex;gap:18px;padding:22px;align-items:flex-start;flex-wrap:wrap}
.game-thumb-wrap{flex-shrink:0}
.game-thumb{width:96px;height:96px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,178,56,.2);background:var(--panel2);display:block}
.game-thumb img{width:100%;height:100%;object-fit:cover}
.game-thumb-ph{width:96px;height:96px;border-radius:12px;border:1px solid var(--line);background:var(--panel2);display:grid;place-items:center;font:36px var(--mono);color:#4d432e}
.hero-info{flex:1;min-width:220px}
.breadcrumb{font:9px var(--mono);color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:5px}
.breadcrumb a{color:var(--accent);text-decoration:none}.breadcrumb a:hover{text-decoration:underline}
.breadcrumb-sep{opacity:.4}
h1.script-title{font:700 clamp(20px,4vw,28px)/1.2 var(--mono);margin:0 0 12px;letter-spacing:-.01em}
/* Creator row */
.creator-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.creator-link{display:flex;align-items:center;gap:7px;text-decoration:none;color:var(--text);transition:opacity .15s}.creator-link:hover{opacity:.8}
.creator-avatar{width:26px;height:26px;border-radius:50%;border:1px solid var(--line);object-fit:cover;flex-shrink:0}
.creator-avatar-ph{width:26px;height:26px;border-radius:50%;border:1px solid var(--line);background:#1e2028;display:grid;place-items:center;font:11px var(--mono);color:var(--accent);flex-shrink:0}
.creator-name{font:12px var(--mono);color:var(--accent)}
.creator-verified{display:inline-flex;align-items:center;background:rgba(110,168,255,.1);border:1px solid rgba(110,168,255,.3);color:var(--blue);border-radius:4px;padding:2px 7px;font:8px var(--mono);letter-spacing:.07em;text-transform:uppercase}
/* Metadata */
.meta-strip{display:flex;gap:12px;flex-wrap:wrap;font:10px var(--mono);color:var(--muted);margin-bottom:10px;align-items:center}
.meta-sep{opacity:.3}
/* Tags */
.tag-row{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.pill{font:9px var(--mono);padding:3px 8px;border:1px solid #4d3a1c;border-radius:5px;color:var(--accent);background:rgba(255,178,56,.07)}
.pill.hub{color:var(--green);border-color:#28583b;background:rgba(92,217,138,.06)}
.kbadge{display:inline-flex;align-items:center;font:9px var(--mono);padding:4px 9px;border-radius:6px;letter-spacing:.05em}
.kl{color:var(--green);border:1px solid #2c6943;background:rgba(92,217,138,.07)}
.hk{color:var(--red);border:1px solid #693434;background:rgba(255,98,98,.07)}
/* Description */
.script-desc{font-size:13.5px;color:#c0c3cc;line-height:1.65;margin-top:8px}
/* ACTION BAR */
.action-bar{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.action-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:transparent;color:var(--text);border-radius:8px;padding:9px 14px;font:12px var(--mono);cursor:pointer;transition:all .18s;text-decoration:none;white-space:nowrap}
.action-btn:hover{border-color:var(--muted)}
.copy-main{background:var(--accent);border-color:var(--accent);color:#1a0f00;font-weight:700}
.copy-main:hover{background:#ffca5c;border-color:#ffca5c}
@keyframes copyPop{0%{transform:scale(1)}30%{transform:scale(1.07)}100%{transform:scale(1)}}
.copy-main.done{background:var(--green);border-color:var(--green);animation:copyPop .4s ease}
.like-btn.liked{border-color:#e53e3e;color:#e53e3e;background:rgba(229,62,62,.08)}
.fav-btn.saved{border-color:var(--accent);color:var(--accent);background:rgba(255,178,56,.08)}
.report-btn{color:var(--muted);font-size:14px}
/* Owner actions */
.owner-bar{display:none;gap:7px;margin-top:8px;flex-wrap:wrap}
.owner-btn{font:11px var(--mono);padding:6px 11px;border-radius:6px;background:transparent;border:1px solid var(--line);color:var(--text);cursor:pointer;text-decoration:none}
.owner-btn.del{color:var(--red);border-color:#693434}
/* REPORT DROPDOWN */
.report-wrap{position:relative;display:inline-block}
.report-dropdown{position:absolute;top:calc(100% + 6px);right:0;background:#1a1d24;border:1px solid var(--line);border-radius:10px;padding:10px;display:none;flex-direction:column;gap:5px;z-index:99;min-width:180px;box-shadow:0 8px 24px rgba(0,0,0,.6)}
.report-dropdown.open{display:flex}
.report-option{font:11px var(--mono);padding:7px 10px;border-radius:6px;cursor:pointer;color:var(--muted);background:transparent;border:1px solid transparent;transition:all .15s;text-align:left}
.report-option:hover{border-color:var(--red);color:var(--red);background:rgba(255,98,98,.07)}
/* STATS GRID */
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
.stat-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}
.stat-n{font:700 22px var(--mono);color:var(--accent);line-height:1}
.stat-l{font:8px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-top:5px}
/* CODE SECTION */
.code-section{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px}
.code-header{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line);background:#0d0e12}
.code-lang{font:10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.1em;display:flex;align-items:center;gap:6px}
.code-lang:before{content:"";width:7px;height:7px;border-radius:50%;background:#5cd98a}
.code-actions{display:flex;gap:7px;align-items:center}
.copy-code-btn{background:var(--accent);border:0;border-radius:6px;padding:7px 14px;color:#1a0f00;font:700 10px var(--mono);cursor:pointer;transition:background .15s;text-transform:uppercase;letter-spacing:.05em}
.copy-code-btn:hover{background:#ffca5c}.copy-code-btn.done{background:var(--green)}
pre{margin:0;max-height:500px;overflow:auto;background:#070809;padding:14px 0;font:12.5px/1.6 var(--mono);color:#c9e6c4}
.code-line{display:block;padding:0 14px;white-space:pre}.ln{color:#3a3f2c;margin-right:14px;user-select:none}
/* RELATED + CREATOR SECTIONS */
.section-header{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px}
.section-header h2{font:700 13px var(--mono);margin:0;color:var(--text)}
.section-header a{font:10px var(--mono);color:var(--accent);text-decoration:none}
.mini-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px}
.mini-card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;transition:border-color .18s,background .18s}
.mini-card:hover{border-color:#51401f;background:var(--panel2)}
.mini-img{width:100%;height:80px;object-fit:cover;background:#0d0e12}
.mini-img-ph{height:80px;display:grid;place-items:center;background:var(--panel2);font:22px var(--mono);color:#4d432e}
.mini-body{padding:9px 10px 10px}
.mini-title{font:700 12px var(--mono);margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.mini-meta{font:9px var(--mono);color:var(--muted)}
/* COMMUNITY */
.community{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:14px}
.community h3{font:10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin:0 0 14px}
.rating-overview{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.rating-score-big{text-align:center;min-width:80px}
.rscore{font:700 40px var(--mono);color:var(--accent);line-height:1}
.rstars{font-size:16px;color:var(--accent);letter-spacing:1px}
.rcount{font:9px var(--mono);color:var(--muted);margin-top:3px}
.rbar-section{flex:1;min-width:160px}
.rbar-row{display:grid;grid-template-columns:52px 1fr 42px;gap:8px;align-items:center;margin-bottom:5px;font:9px var(--mono);color:var(--muted)}
.rtrack{height:6px;background:#0b0c10;border-radius:99px;overflow:hidden}
.rfill{height:100%;background:var(--accent);border-radius:99px;transition:width .5s ease}
.works-tag{display:inline-flex;align-items:center;gap:5px;margin-top:10px;background:rgba(92,217,138,.08);border:1px solid #245637;border-radius:6px;padding:6px 10px;font:10px var(--mono);color:var(--green)}
/* Comments */
.comment{padding:12px 0;border-bottom:1px dashed var(--line)}.comment:last-of-type{border-bottom:0}
.cmeta{font:9px var(--mono);color:#a17a3c;margin-bottom:5px;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.cstars{color:var(--accent)}
.ctext{font-size:13px;color:#d0d3da}
.no-comments{font:11px var(--mono);color:var(--muted)}
/* Comment form */
.comment-form-section{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
.comment-form-section h4{font:10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.1em;margin:0 0 12px}
.cf-input{width:100%;background:#0a0b0e;border:1px solid var(--line);border-radius:7px;color:var(--text);padding:10px 12px;font:13px var(--sans);outline:none;transition:border-color .2s;margin-bottom:8px}
.cf-input:focus{border-color:#60471d}
textarea.cf-input{resize:vertical;min-height:72px;font-family:var(--sans)}
.star-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.star-row label{font:9px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.pick-stars{display:flex;gap:0}
.pick-stars button{border:0;background:transparent;color:#2e3040;font-size:26px;padding:1px 2px;cursor:pointer;transition:color .1s,transform .1s;line-height:1}
.pick-stars button.on,.pick-stars button.hover{color:var(--accent)}
.pick-stars button:hover{transform:scale(1.2)}
.star-hint{font:9px var(--mono);color:var(--muted);min-width:50px}
.cf-submit{background:var(--accent);border:0;border-radius:7px;padding:10px 18px;color:#1a0f00;font:700 11px var(--mono);cursor:pointer;transition:background .15s;text-transform:uppercase;letter-spacing:.05em}
.cf-submit:hover{background:#ffca5c}.cf-submit:disabled{opacity:.5;cursor:not-allowed}
.cf-note{font:9px var(--mono);color:var(--muted);margin-top:8px;line-height:1.5}
@media(max-width:600px){.stats-grid{grid-template-columns:repeat(2,1fr)}.mini-grid{grid-template-columns:repeat(2,1fr)}.hero-content{padding:16px}.game-thumb,.game-thumb-ph{width:72px;height:72px}}
@media(max-width:440px){.mini-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
</style>
</head>
<body>
<div class="wrap">

<header class="top-nav">
  <div class="brand"><a href="/">dakait<span>.online</span></a></div>
  <a class="back-link" href="/scripts">← Gallery</a>
</header>

<!-- HERO -->
<div class="script-hero">
  ${thumbnailUrl ? `<div class="hero-bg" ${thumbBg}></div>` : ""}
  <div class="hero-content">
    <div class="game-thumb-wrap">
      ${thumbnailUrl
        ? `<div class="game-thumb"><img src="${escapeHtml(thumbnailUrl)}" alt="${safeGame || "Game"} icon"/></div>`
        : `<div class="game-thumb-ph">⌗</div>`}
    </div>
    <div class="hero-info">
      <div class="breadcrumb">
        <a href="/scripts">Scripts</a>
        ${safeGame ? `<span class="breadcrumb-sep">›</span><a href="/scripts?filter=${encodeURIComponent(script.gameName || "")}">${safeGame}</a>` : ""}
      </div>
      <h1 class="script-title">${safeTitle}</h1>
      <div class="creator-row">
        <a class="creator-link" href="/creator/${encodeURIComponent(script.ownerSub || script.username || "unknown")}">
          ${creatorAvatar}
          <span class="creator-name">@${safeUser}</span>
        </a>
        ${verifiedBadge}
      </div>
      <div class="meta-strip">
        <span>Added ${createdDate}</span>
        ${updatedAgo ? `<span class="meta-sep">·</span><span>${updatedAgo}</span>` : ""}
        <span class="meta-sep">·</span>
        <span id="viewCount">${Number(script.views || 0).toLocaleString()}</span> views
      </div>
      <div class="tag-row">
        ${hubPill}${tagPills}
        ${keyBadge}
      </div>
      <p class="script-desc">${safeDesc}</p>
      <div class="action-bar">
        <button class="action-btn copy-main" id="copyMainBtn">⧉ Copy Script</button>
        <button class="action-btn like-btn" id="likeBtn">❤ <span id="likeCount">${likeCount}</span></button>
        <button class="action-btn fav-btn" id="favBtn">★ Save</button>
        <div class="report-wrap">
          <button class="action-btn report-btn" id="reportToggle" title="Report this script">⚑</button>
          <div class="report-dropdown" id="reportDropdown">
            ${["spam","malware","stolen","broken","inappropriate","other"].map(r =>
              `<button class="report-option" data-reason="${r}">${{spam:"Spam",malware:"Malware / Dangerous",stolen:"Stolen content",broken:"Broken / Not working",inappropriate:"Inappropriate",other:"Other"}[r]}</button>`
            ).join("")}
          </div>
        </div>
      </div>
      <div class="owner-bar" id="ownerBar">
        <a class="owner-btn" href="/scripts/${encodeURIComponent(script.id)}/edit">Edit</a>
        <button class="owner-btn del" id="deleteBtn">Delete</button>
      </div>
    </div>
  </div>
</div>

<!-- STATS -->
<div class="stats-grid">
  <div class="stat-card"><div class="stat-n" id="statViews">${Number(script.views || 0).toLocaleString()}</div><div class="stat-l">Views</div></div>
  <div class="stat-card"><div class="stat-n" id="statCopies">—</div><div class="stat-l">Copies</div></div>
  <div class="stat-card"><div class="stat-n" id="statLikes">${likeCount}</div><div class="stat-l">Likes</div></div>
  <div class="stat-card"><div class="stat-n" id="statRating">—</div><div class="stat-l">Avg Rating</div></div>
</div>

<!-- CODE -->
<section class="code-section">
  <div class="code-header">
    <div class="code-lang">script.lua</div>
    <div class="code-actions">
      <button class="copy-code-btn" id="copyCodeBtn">Copy</button>
    </div>
  </div>
  <pre id="codeBlock">${codeHtml}</pre>
</section>

<!-- RELATED SCRIPTS -->
<section id="relatedSection" style="display:none">
  <div class="section-header">
    <h2 id="relatedTitle">More scripts for this game</h2>
    ${safeGame ? `<a href="/scripts?filter=${encodeURIComponent(script.gameName || "")}">See all →</a>` : ""}
  </div>
  <div class="mini-grid" id="relatedGrid"></div>
</section>

<!-- MORE FROM CREATOR -->
<section id="creatorSection" style="display:none">
  <div class="section-header">
    <h2>More from <span style="color:var(--accent)">@${safeUser}</span></h2>
    <a href="/creator/${encodeURIComponent(script.ownerSub || script.username || "unknown")}">View profile →</a>
  </div>
  <div class="mini-grid" id="creatorGrid"></div>
</section>

<!-- COMMUNITY -->
<section class="community">
  <h3>Community rating</h3>
  <div class="rating-overview" id="ratingOverview">
    <div class="rating-score-big"><div class="rscore" id="rscoreNum">—</div><div class="rstars" id="rscoreStars">☆☆☆☆☆</div><div class="rcount" id="rscoreCount">No ratings</div></div>
    <div class="rbar-section" id="rbarSection"></div>
  </div>
  <div id="worksTag"></div>
  <div style="height:16px"></div>
  <h3>Comments</h3>
  <div id="commentsList"><p class="no-comments">Loading…</p></div>
  <div class="comment-form-section">
    <h4>Leave a review</h4>
    <input class="cf-input" id="cfName" maxlength="40" placeholder="Your name (optional)"/>
    <div class="star-row">
      <label>Rating</label>
      <div class="pick-stars" id="pickStars">
        ${[1,2,3,4,5].map(n=>`<button type="button" data-r="${n}" aria-label="${n} stars">★</button>`).join("")}
      </div>
      <span class="star-hint" id="starHint">No rating</span>
    </div>
    <textarea class="cf-input" id="cfText" maxlength="400" rows="3" placeholder="Write a comment — does it work? Tips? (optional if you give a rating)"></textarea>
    <button class="cf-submit" id="cfSubmit">Post review</button>
    <p class="cf-note" id="cfNote">Rating requires Google sign-in. Text comments can be posted anonymously.</p>
  </div>
</section>

</div>

<script>
const SCRIPT_ID=${safeJsonForHtml(script.id)},RAW_CODE=${safeJsonForHtml(script.code)};
const OWNER_SUB=${safeJsonForHtml(script.ownerSub||null)};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ago=ts=>{const s=Math.max(0,Math.floor((Date.now()-Number(ts||0))/1000));if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago";};

/* ── Copy animations ── */
async function doCopy(code,mainBtn,codeBtn){
  let copied=false;
  try{
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(code);copied=true;}
  }catch{}
  if(!copied){
    try{
      const ta=document.createElement("textarea");ta.value=code;ta.setAttribute("readonly","");ta.style.position="fixed";ta.style.left="-9999px";document.body.appendChild(ta);ta.select();copied=document.execCommand("copy");ta.remove();
    }catch{}
  }
  if(!copied){if(mainBtn)mainBtn.textContent="Copy failed";setTimeout(()=>{if(mainBtn)mainBtn.textContent="⧉ Copy Script";},1500);return;}
  [mainBtn,codeBtn].forEach(b=>{if(!b)return;b.classList.add("done");const orig=b.textContent;b.textContent=b===mainBtn?"✓ Copied!":"Copied";setTimeout(()=>{b.classList.remove("done");b.textContent=orig;},1500);});
  fetch("/api/scripts/"+SCRIPT_ID+"/copy",{method:"POST",credentials:"same-origin"}).then(r=>r.json()).then(d=>{if(d.copies!=null)document.getElementById("statCopies").textContent=Number(d.copies).toLocaleString();}).catch(()=>{});
}
document.getElementById("copyMainBtn").onclick=()=>doCopy(RAW_CODE,document.getElementById("copyMainBtn"),document.getElementById("copyCodeBtn"));
document.getElementById("copyCodeBtn").onclick=()=>doCopy(RAW_CODE,document.getElementById("copyMainBtn"),document.getElementById("copyCodeBtn"));

/* ── Auth & owner actions ── */
let me={loggedIn:false,isAdmin:false,sub:null};
const authP=fetch("/api/me",{credentials:"same-origin",cache:"no-store"}).then(r=>r.ok?r.json():{loggedIn:false}).then(d=>{me=d;
  const isMine=(me.loggedIn&&me.sub===OWNER_SUB)||(me.loggedIn&&me.isAdmin);
  if(isMine)document.getElementById("ownerBar").style.display="flex";
  const pr=Number(new URLSearchParams(location.search).get("rate")||0);
  if(me.loggedIn&&pr>=1&&pr<=5){selectStar(pr);history.replaceState({},"",location.pathname);}
  updateNote();
  return d;
}).catch(()=>{me={loggedIn:false,isAdmin:false,sub:null};return me;});

document.getElementById("deleteBtn").onclick=async()=>{
  await authP;
  if(!confirm("Delete this script? Also removes comments, ratings, and likes."))return;
  const btn=document.getElementById("deleteBtn");btn.disabled=true;btn.textContent="Deleting…";
  const r=await fetch("/api/scripts/"+encodeURIComponent(SCRIPT_ID),{method:"DELETE",credentials:"same-origin"});
  const d=await r.json().catch(()=>({}));
  if(r.ok){location.href="/scripts";}
  else{btn.disabled=false;btn.textContent="Delete";alert(d.error||"Couldn't delete. "+JSON.stringify(d.details||{}));}
};

function showActionMessage(message){
  let el=document.getElementById("actionMessage");
  if(!el){
    el=document.createElement("div");el.id="actionMessage";
    el.style.cssText="margin-top:8px;font:12px var(--mono);color:var(--muted);min-height:18px";
    const bar=document.querySelector(".action-bar"); if(bar) bar.after(el);
  }
  el.textContent=message||"";
  clearTimeout(window.__dakaitActionTimer);
  window.__dakaitActionTimer=setTimeout(()=>{el.textContent="";},3500);
}

/* ── Likes ── */

let likeCount=${likeCount},liked=false;
fetch("/api/scripts/"+SCRIPT_ID+"/likes",{credentials:"same-origin",cache:"no-store"}).then(r=>r.json()).then(d=>{
  liked=!!d.liked;likeCount=Number(d.count||0);updateLikeBtn();
  document.getElementById("statLikes").textContent=likeCount;
}).catch(()=>{});
function updateLikeBtn(){const b=document.getElementById("likeBtn");b.innerHTML="❤ <span>"+likeCount+"</span>";b.classList.toggle("liked",liked);}
document.getElementById("likeBtn").onclick=async()=>{
  await authP;
  if(!me.loggedIn){location.href="/auth/login?return="+encodeURIComponent(location.pathname);return;}
  const previous={liked,likeCount};
  liked=!liked;likeCount=Math.max(0,likeCount+(liked?1:-1));updateLikeBtn();document.getElementById("statLikes").textContent=likeCount;
  try{
    const r=await fetch("/api/scripts/"+SCRIPT_ID+"/likes",{method:"POST",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||"Like failed");
    liked=!!d.liked;likeCount=Number(d.count||0);updateLikeBtn();document.getElementById("statLikes").textContent=likeCount;
  }catch(err){
    liked=previous.liked;likeCount=previous.likeCount;updateLikeBtn();document.getElementById("statLikes").textContent=likeCount;
    showActionMessage(err.message||"Like failed");
  }
};

/* ── Favorites ── */
let saved=false;
fetch("/api/scripts/"+SCRIPT_ID+"/favorites",{credentials:"same-origin",cache:"no-store"}).then(r=>r.json()).then(d=>{saved=!!d.favorited;updateFavBtn();}).catch(()=>{});
function updateFavBtn(){const b=document.getElementById("favBtn");b.textContent=saved?"★ Saved":"★ Save";b.classList.toggle("saved",saved);}
document.getElementById("favBtn").onclick=async()=>{
  await authP;
  if(!me.loggedIn){location.href="/auth/login?return="+encodeURIComponent(location.pathname);return;}
  const previous=saved; saved=!saved;updateFavBtn();
  try{
    const r=await fetch("/api/scripts/"+SCRIPT_ID+"/favorites",{method:"POST",credentials:"same-origin"});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||"Save failed");
    saved=!!d.favorited;updateFavBtn();
  }catch(err){saved=previous;updateFavBtn();showActionMessage(err.message||"Save failed");}
};

/* ── Report ── */
const reportToggle=document.getElementById("reportToggle"),reportDrop=document.getElementById("reportDropdown");
reportToggle.onclick=e=>{e.stopPropagation();reportDrop.classList.toggle("open");};
document.addEventListener("click",()=>reportDrop.classList.remove("open"));
reportDrop.querySelectorAll(".report-option").forEach(b=>b.onclick=async()=>{
  await authP;
  if(!me.loggedIn){location.href="/auth/login?return="+encodeURIComponent(location.pathname);return;}
  reportDrop.classList.remove("open");
  try{
    const r=await fetch("/api/scripts/"+SCRIPT_ID+"/report",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({reason:b.dataset.reason})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(d.error||"Report failed");
    reportToggle.textContent="✓";reportToggle.title="Reported — thank you.";setTimeout(()=>{reportToggle.textContent="⚑";reportToggle.title="Report this script";},2500);
  }catch(err){reportToggle.textContent="!";reportToggle.title=err.message||"Report failed";showActionMessage(err.message||"Report failed");setTimeout(()=>{reportToggle.textContent="⚑";reportToggle.title="Report this script";},2500);}
});

/* ── Copies stat ── */
fetch("/api/scripts/"+SCRIPT_ID+"/copies").then(r=>r.json()).then(d=>document.getElementById("statCopies").textContent=Number(d.count||0).toLocaleString()).catch(()=>document.getElementById("statCopies").textContent="—");

/* ── Ratings ── */
function renderRatings(d){
  const total=Number(d.total||0),avg=Number(d.average||0),dist=d.distribution||{};
  document.getElementById("rscoreNum").textContent=total?avg.toFixed(1):"—";
  document.getElementById("rscoreStars").textContent=[1,2,3,4,5].map(n=>n<=Math.round(avg)?"★":"☆").join("");
  document.getElementById("rscoreCount").textContent=total?total+(total===1?" rating":" ratings"):"No ratings yet";
  document.getElementById("statRating").textContent=total?avg.toFixed(1)+" ★":"—";
  const bars=document.getElementById("rbarSection");
  bars.innerHTML=[5,4,3,2,1].map(n=>{const c=Number(dist[n]||0),p=total?Math.round(c*100/total):0;
    return '<div class="rbar-row"><span>'+n+'★</span><div class="rtrack"><div class="rfill" style="width:'+p+'%"></div></div><span style="text-align:right">'+p+'%</span></div>';}).join("");
  const wt=document.getElementById("worksTag");
  if(total&&d.worksPercent>0)wt.innerHTML='<div class="works-tag">✓ '+d.worksPercent+'% gave 5 stars — community says it works</div>';
  if(d.myRating)document.getElementById("cfNote").textContent="Your rating: "+d.myRating+"/5. Submit again to update it.";
}
async function loadRatings(){try{const r=await fetch("/api/scripts/"+SCRIPT_ID+"/ratings",{credentials:"same-origin",cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Ratings unavailable");renderRatings(d);}catch(err){console.warn("Ratings load failed",err);document.getElementById("rscoreNum").textContent="—";document.getElementById("rscoreCount").textContent="Ratings unavailable";}}

/* ── Comments ── */
async function loadComments(){
  const cl=document.getElementById("commentsList");
  try{
    const r=await fetch("/api/scripts/"+SCRIPT_ID+"/comments",{credentials:"same-origin",cache:"no-store"});const d=await r.json();if(!r.ok)throw new Error(d.error||"Comments unavailable");const list=Array.isArray(d.comments)?d.comments:[];
    if(!list.length){cl.innerHTML='<p class="no-comments">No reviews yet — be the first.</p>';return;}
    cl.innerHTML=list.map(c=>'<div class="comment"><div class="cmeta"><b>@'+esc(c.author||"anonymous")+'</b> · '+ago(c.createdAt)+(c.rating?'<span class="cstars"> '+"★".repeat(c.rating)+"☆".repeat(5-c.rating)+'</span>':'')+'</div>'+(c.text?'<div class="ctext">'+esc(c.text)+'</div>':'')+'</div>').join("");
  }catch{cl.innerHTML='<p class="no-comments">Couldn\'t load comments.</p>';}
}

/* ── Star picker ── */
let selectedStar=0;
const picks=[...document.querySelectorAll("#pickStars button")],starHint=document.getElementById("starHint");
function selectStar(n){selectedStar=n;picks.forEach(b=>b.classList.toggle("on",Number(b.dataset.r)<=n));starHint.textContent=n?n+"/5 stars":"No rating";}
picks.forEach(b=>{
  b.onmouseover=()=>picks.forEach(x=>x.classList.toggle("hover",Number(x.dataset.r)<=Number(b.dataset.r)));
  b.onmouseleave=()=>picks.forEach(x=>x.classList.remove("hover"));
  b.onclick=()=>selectStar(Number(b.dataset.r));
});
function updateNote(){const n=document.getElementById("cfNote");if(!n)return;if(selectedStar&&!me.loggedIn)n.textContent="⚠ Sign-in required to save a rating — clicking Post will redirect you to sign in first.";else if(me.loggedIn&&selectedStar)n.textContent="Your rating will be saved to your account.";else n.textContent="Rating requires Google sign-in. Text comments can be posted anonymously.";}
picks.forEach(b=>b.addEventListener("click",updateNote));

/* ── Submit review ── */
document.getElementById("cfSubmit").onclick=async()=>{
  const text=document.getElementById("cfText").value.trim(),note=document.getElementById("cfNote"),btn=document.getElementById("cfSubmit");
  if(!text&&!selectedStar){note.textContent="Write a comment or give a star rating.";return;}
  await authP;
  if(selectedStar&&!me.loggedIn){const ret=new URL(location.href);ret.searchParams.set("rate",String(selectedStar));location.href="/auth/login?return="+encodeURIComponent(ret.pathname+ret.search);return;}
  btn.disabled=true;btn.textContent="Posting…";
  try{
    const r=await fetch("/api/scripts/"+SCRIPT_ID+"/comments",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({text,rating:selectedStar||null,author:document.getElementById("cfName").value.trim()})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.error||"Couldn't post");
    document.getElementById("cfText").value="";document.getElementById("cfName").value="";selectStar(0);note.textContent=d.rating?"Review posted with rating!":"Comment posted.";
    await Promise.all([loadComments(),loadRatings()]);
  }catch(err){note.textContent=err.message||"Couldn't post. Try again.";}
  finally{btn.disabled=false;btn.textContent="Post review";}
};

/* ── Related scripts ── */
fetch("/api/scripts").then(r=>r.json()).then(d=>{
  const all=d.scripts||[].filter(s=>s.id!==SCRIPT_ID);
  const gameName=${safeJsonForHtml(script.gameName||null)};
  const ownerSub=${safeJsonForHtml(script.ownerSub||null)};
  const related=gameName?all.filter(s=>s.gameName===gameName&&s.id!==SCRIPT_ID).slice(0,3):[];
  const creator=all.filter(s=>s.ownerSub===ownerSub&&s.id!==SCRIPT_ID&&ownerSub).slice(0,3);
  function miniCard(s){
    const img=s.placeId?'<img class="mini-img" src="/api/roblox-thumbnail?placeId='+encodeURIComponent(s.placeId)+'" loading="lazy" alt="'+esc(s.title)+'" onerror="this.outerHTML=\'<div class=\\"mini-img-ph\\">⌗</div>\'"/>':'<div class="mini-img-ph">⌗</div>';
    return '<a class="mini-card" href="/scripts/'+encodeURIComponent(s.id)+'">'+img+'<div class="mini-body"><div class="mini-title">'+esc(s.title)+'</div><div class="mini-meta">'+Number(s.views||0)+' views'+(s.rating?.average?' · ★ '+Number(s.rating.average).toFixed(1):'')+'</div></div></a>';
  }
  if(related.length){document.getElementById("relatedSection").style.display="block";document.getElementById("relatedTitle").textContent="More for "+gameName;document.getElementById("relatedGrid").innerHTML=related.map(miniCard).join("");}
  if(creator.length){document.getElementById("creatorSection").style.display="block";document.getElementById("creatorGrid").innerHTML=creator.map(miniCard).join("");}
}).catch(()=>{});

/* ── Copy count endpoint ── */
fetch("/api/scripts/"+SCRIPT_ID+"/copies",{credentials:"same-origin"}).then(r=>r.json()).then(d=>{document.getElementById("statCopies").textContent=Number(d.count||0).toLocaleString();}).catch(()=>{});

loadRatings();loadComments();
</script>
</body>
</html>`;
}


export function buildEditHtml(script) {
    const _eu = "https://dakait.online/scripts/" + script.id + "/edit";
    return `<!DOCTYPE html>
<html lang="en">
<head>
${SHARED_HEAD("Edit Script — dakait.online", "Edit your script on Silk Road Script Hub.", _eu)}
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








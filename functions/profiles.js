/* profiles.js — Creator profiles, verification badges, and milestone rewards. */

const VIEW_MILESTONES  = [100, 500, 1000, 5000, 10000];
const COPY_MILESTONES  = [10,  50,  100,  500,  1000];

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

// ─── Profile CRUD ─────────────────────────────────────────────────────────────

export async function getProfile(env, sub) {
    const raw = await env.SCRIPTS_KV.get(`profile:${sub}`);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

export async function getOrCreateProfile(env, sub, sessionName, sessionPicture) {
    const existing = await getProfile(env, sub);
    if (existing) return existing;
    const profile = {
        sub,
        displayName: sessionName || "Anonymous",
        bio:         "",
        robloxUsername: "",
        picture:     sessionPicture || null,
        joinedAt:    Date.now(),
        verified:    false,
        verifiedAt:  null,
        badges:      [],
        reputation:  0,
    };
    await env.SCRIPTS_KV.put(`profile:${sub}`, JSON.stringify(profile));
    return profile;
}

async function saveProfile(env, profile) {
    await env.SCRIPTS_KV.put(`profile:${profile.sub}`, JSON.stringify(profile));
}

// ─── Rewards ─────────────────────────────────────────────────────────────────

export async function checkAndGrantRewards(env, scriptOwnerSub, eventType, newCount) {
    if (!scriptOwnerSub) return;
    const milestones = eventType === "views" ? VIEW_MILESTONES : COPY_MILESTONES;
    const milestone  = milestones.find(m => newCount === m);
    if (!milestone) return;

    const profile = await getProfile(env, scriptOwnerSub);
    if (!profile) return;

    const badge = `${milestone}_${eventType}`; // e.g. "100_views"
    if (!profile.badges.includes(badge)) {
        profile.badges.push(badge);
        profile.reputation = (profile.reputation || 0) + Math.floor(Math.log10(milestone) * 10);
        await saveProfile(env, profile);
    }
}

// ─── Admin: verify a creator ──────────────────────────────────────────────────

export async function handleVerifyCreator(request, env) {
    const session = await getSession(request, env);
    if (!session?.sub) return jsonResponse({ error: "Not signed in" }, 401);

    const adminEmails = [env.ADMIN_EMAILS || "", env.ADMIN_EMAIL || ""].join(",")
        .split(/[,\s;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!adminEmails.includes(session.email?.toLowerCase())) {
        return jsonResponse({ error: "Admin access required" }, 403);
    }

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

    const { sub, verified } = body;
    if (!sub) return jsonResponse({ error: "sub required" }, 400);

    const profile = await getProfile(env, sub);
    if (!profile) return jsonResponse({ error: "Profile not found — creator must sign in first" }, 404);

    profile.verified   = !!verified;
    profile.verifiedAt = verified ? Date.now() : null;
    if (verified && !profile.badges.includes("verified")) profile.badges.push("verified");
    if (!verified) profile.badges = profile.badges.filter(b => b !== "verified");
    await saveProfile(env, profile);

    return jsonResponse({ ok: true, profile });
}

// ─── Profile API routes ───────────────────────────────────────────────────────

export async function handleProfileApi(request, env, path) {
    const method = request.method;

    // GET /api/creator/:sub — public profile + their scripts
    const creatorMatch = path.match(/^\/api\/creator\/([^/]+)$/);
    if (creatorMatch && method === "GET") {
        const sub     = decodeURIComponent(creatorMatch[1]);
        const profile = await getProfile(env, sub);
        if (!profile) return jsonResponse({ error: "Profile not found" }, 404);
        // Fetch scripts by this creator
        const allRaw = await env.SCRIPTS_KV.list({ prefix: "script:" });
        const scripts = [];
        for (const key of (allRaw.keys || [])) {
            const r = await env.SCRIPTS_KV.get(key.name);
            if (!r) continue;
            try {
                const s = JSON.parse(r);
                if (s?.id && s.ownerSub === sub) {
                    scripts.push({
                        id: s.id, title: s.title, description: s.description || "",
                        gameName: s.gameName || null, placeId: s.placeId || null,
                        hubName: s.hubName || "", tags: s.tags || [], keysystem: !!s.keysystem,
                        createdAt: s.createdAt, views: s.views || 0,
                    });
                }
            } catch {}
        }
        scripts.sort((a, b) => b.createdAt - a.createdAt);
        return jsonResponse({ profile, scripts });
    }

    // GET /api/creator/me — own profile
    if (path === "/api/creator/me" && method === "GET") {
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Not signed in" }, 401);
        const profile = await getOrCreateProfile(env, session.sub, session.name, session.picture);
        return jsonResponse({ profile });
    }

    // POST /api/creator/profile — update own profile
    if (path === "/api/creator/profile" && method === "POST") {
        const session = await getSession(request, env);
        if (!session?.sub) return jsonResponse({ error: "Sign in to edit your profile" }, 401);

        let body;
        try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }

        const profile = await getOrCreateProfile(env, session.sub, session.name, session.picture);
        if (typeof body.displayName    === "string") profile.displayName    = body.displayName.trim().slice(0, 50);
        if (typeof body.bio            === "string") profile.bio            = body.bio.trim().slice(0, 300);
        if (typeof body.robloxUsername === "string") profile.robloxUsername = body.robloxUsername.trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40);
        // Don't allow updating verified/badges via this endpoint
        await saveProfile(env, profile);
        return jsonResponse({ ok: true, profile });
    }

    return jsonResponse({ error: "Not found" }, 404);
}



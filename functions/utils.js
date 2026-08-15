/* Shared helpers used by feature modules. Keep this file dependency-free. */

export function sanitizeText(value, maxLen) {
    if (typeof value !== "string") return "";
    return value.trim().slice(0, maxLen);
}

export function parseCookies(request) {
    const header = request.headers.get("Cookie") || "";
    const out = {};
    header.split(";").forEach((part) => {
        const [k, ...v] = part.trim().split("=");
        if (k) {
            try { out[k] = decodeURIComponent(v.join("=")); }
            catch { out[k] = v.join("="); }
        }
    });
    return out;
}


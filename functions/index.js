import {
    GALLERY_HTML,
    buildDetailHtml,
    buildEditHtml,
    canManageScript,
    getAllScriptSummaries,
    getRobloxGameInfo,
    getScript,
    handleScriptsApi,
    prepareScriptForPage,
    recordScriptView
} from "./scripts.js";

import { handleLikesApi, getLikeSummary, getCopyCount } from "./likes.js";
import { handleProfileApi, handleVerifyCreator, getProfile, getOrCreateProfile } from "./profiles.js";

function sanitizeText(value, maxLen) { if (typeof value !== "string") return ""; return value.trim().slice(0, maxLen); }
function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeJsonForHtml(value) {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c").replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function sanitizeTags(input) {
    if (!input) return [];
    const arr = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
    return arr.map(t => String(t).trim().toUpperCase().replace(/[\[\]]/g, "")).filter(t => t.length > 0 && t.length <= 24).slice(0, 10);
}
function renderCodeWithLineNumbers(code) {
    return String(code || "").split("\n").map((line, i) => {
        const num = String(i + 1).padStart(3, " ");
        return `<span class="code-line"><span class="ln">${num}</span><span class="lt">${escapeHtml(line) || " "}</span></span>`;
    }).join("\n");
}
function parseCookies(request) {
    const out = {};
    (request.headers.get("Cookie") || "").split(";").forEach(part => { const [k, ...v] = part.trim().split("="); if (k) out[k] = decodeURIComponent(v.join("=")); });
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
    const configured = [env.ADMIN_EMAILS || "", env.ADMIN_EMAIL || ""].join(",");
    const list = configured.split(/[,\s;]+/).map(e => e.trim().toLowerCase()).filter(Boolean);
    return list.includes(String(email).trim().toLowerCase());
}
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ─── Favicon ─── */
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0d0f14"/>
  <g fill="#d4a574">
    <ellipse cx="30" cy="42" rx="16" ry="10"/>
    <ellipse cx="24" cy="33" rx="7" ry="8"/>
    <ellipse cx="44" cy="34" rx="6" ry="5"/>
    <path d="M38 34 Q36 40 30 42" stroke="#d4a574" stroke-width="5" fill="none" stroke-linecap="round"/>
    <ellipse cx="49" cy="36" rx="3.5" ry="2.5"/>
    <rect x="18" y="50" width="4" height="10" rx="2"/><rect x="26" y="51" width="4" height="9" rx="2"/>
    <rect x="33" y="50" width="4" height="10" rx="2"/><rect x="39" y="51" width="4" height="9" rx="2"/>
    <circle cx="46" cy="32.5" r="1.2" fill="#0d0f14"/>
    <ellipse cx="41" cy="30" rx="2" ry="3" transform="rotate(-20 41 30)"/>
  </g>
  <circle cx="14" cy="14" r="2" fill="#d4a574" opacity="0.7"/>
  <circle cx="52" cy="18" r="1.5" fill="#d4a574" opacity="0.5"/>
</svg>`;

const SHARED_HEAD = (title, desc, canonical, ogImage = "https://dakait.online/og-image.png") => `
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(desc)}"/>
<link rel="canonical" href="${escapeHtml(canonical)}"/>
<meta name="robots" content="index, follow"/>
<meta name="keywords" content="roblox scripts, free roblox scripts, keyless roblox scripts, blox fruits script, grow a garden script, rivals script, dakait"/>
<meta property="og:type" content="website"/><meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/><meta property="og:url" content="${escapeHtml(canonical)}"/>
<meta property="og:image" content="${escapeHtml(ogImage)}"/><meta property="og:site_name" content="Silk Road Script Hub — dakait.online"/>
<meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/><meta name="twitter:image" content="${escapeHtml(ogImage)}"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/><link rel="apple-touch-icon" href="/favicon.svg"/>`;

/* ─── Home page ─── */
const SILK_ROAD_HTML = `<!DOCTYPE html>
<html lang="en"><head>
${SHARED_HEAD("Silk Road Script Hub — Free Roblox Scripts | dakait.online","Browse free Roblox scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon and more. Keyless scripts updated daily.","https://dakait.online")}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=JetBrains+Mono:wght@400;500&display=swap"/>
<style>
:root{--ink:#0d0f14;--sand:#d4a574;--parchment:#e8dcc8;--vermilion:#c1502e;--green:#5fbf7a}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{background:var(--ink);background-image:radial-gradient(ellipse at 20% 0%,rgba(212,165,116,.08),transparent 60%),radial-gradient(ellipse at 80% 30%,rgba(193,80,46,.06),transparent 60%);color:var(--parchment);font-family:'JetBrains Mono',monospace;min-height:100vh;padding:8vh 6vw 6vh;display:flex;justify-content:center}
.manifest{max-width:760px;width:100%;position:relative;z-index:1}
.route-line{display:flex;align-items:center;gap:10px;margin-bottom:2.2rem;color:var(--sand);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;opacity:.75}
.route-line::before,.route-line::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--sand),transparent);opacity:.4}
h1{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2.6rem,7vw,4.4rem);line-height:1.02;letter-spacing:-.01em}h1 em{font-style:italic;color:var(--sand)}
.tagline{margin-top:1.1rem;font-size:.95rem;opacity:.62;max-width:50ch;line-height:1.6;min-height:1.6em}
.stat-bar{margin-top:1.4rem;display:flex;gap:1.4rem;flex-wrap:wrap}.stat{display:flex;flex-direction:column}
.stat-num{font-family:'Fraunces',serif;font-size:2rem;color:var(--sand);line-height:1}.stat-label{font-size:.65rem;letter-spacing:.15em;text-transform:uppercase;opacity:.55;margin-top:2px}
.seal-row{margin-top:2.6rem;display:flex;flex-wrap:wrap;align-items:center;gap:.9rem}
.seal{display:inline-flex;align-items:center;gap:.7rem;padding:.85rem 1.3rem;border:1px solid rgba(212,165,116,.35);border-radius:999px;background:rgba(212,165,116,.05)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:pulse 2.2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(95,191,122,.55)}70%{box-shadow:0 0 0 8px rgba(95,191,122,0)}100%{box-shadow:0 0 0 0 rgba(95,191,122,0)}}
.seal-text{font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;opacity:.85}.seal-text b{color:var(--green);font-weight:500}
.btn{appearance:none;border:1px solid rgba(193,80,46,.5);background:rgba(193,80,46,.1);color:var(--parchment);font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;padding:.85rem 1.4rem;border-radius:999px;cursor:pointer;transition:background .2s,border-color .2s,transform .15s;display:inline-flex;align-items:center;gap:.5rem;text-decoration:none}
.btn:hover{background:rgba(193,80,46,.22);border-color:var(--vermilion)}.btn:active{transform:scale(.97)}
.btn.primary{background:rgba(95,191,122,.12);border-color:rgba(95,191,122,.45)}.btn.primary:hover{background:rgba(95,191,122,.22);border-color:var(--green)}
.btn.gold{background:rgba(212,165,116,.12);border-color:rgba(212,165,116,.45)}.btn.gold:hover{background:rgba(212,165,116,.22);border-color:var(--sand)}
.info-panel{max-height:0;overflow:hidden;transition:max-height .45s ease}.info-panel.open{max-height:900px}
.info-inner{margin-top:1.8rem;padding:1.6rem 1.8rem;border:1px solid rgba(212,165,116,.18);border-radius:10px;background:rgba(232,220,200,.03);font-size:.85rem;line-height:1.75;opacity:.85}
.info-inner p{margin-bottom:1rem}.info-inner p:last-child{margin-bottom:0}
.caravan-track{margin:2.8rem 0 0;position:relative;height:28px}
.track-line{position:absolute;top:50%;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(212,165,116,.3),rgba(212,165,116,.6),rgba(212,165,116,.3),transparent);transform:translateY(-50%)}
.track-dot{position:absolute;top:50%;width:6px;height:6px;border-radius:50%;background:var(--sand);transform:translate(-50%,-50%);animation:caravanMove 6s ease-in-out infinite}
.track-dot:nth-child(2){animation-delay:1.5s;opacity:.7;width:5px;height:5px}.track-dot:nth-child(3){animation-delay:3s;opacity:.5;width:4px;height:4px}
@keyframes caravanMove{0%{left:0%;opacity:0}10%{opacity:1}90%{opacity:1}100%{left:100%;opacity:0}}
section{margin-top:3.4rem}.ledger{border-top:1px solid rgba(212,165,116,.18);padding-top:1.8rem}
.ledger-label{font-size:.66rem;letter-spacing:.18em;text-transform:uppercase;color:var(--vermilion);opacity:.85;margin-bottom:1.1rem}
.crew{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1.2rem}
.crew-card{border:1px solid rgba(212,165,116,.18);border-radius:10px;padding:1.4rem 1.6rem;background:rgba(232,220,200,.02);transition:transform .3s,border-color .3s}
.crew-card:hover{transform:translateY(-3px);border-color:rgba(212,165,116,.4)}
.crew-name{font-family:'Fraunces',serif;font-size:1.25rem;color:var(--sand);margin-bottom:.3rem}
.crew-role{font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;opacity:.55;margin-bottom:.8rem}
.crew-desc{font-size:.82rem;opacity:.75;line-height:1.6}
.quote-block{border-left:2px solid var(--vermilion);padding-left:1.4rem;font-family:'Fraunces',serif;font-style:italic;font-size:1.15rem;opacity:.85;line-height:1.55}
.quote-attr{margin-top:.8rem;font-family:'JetBrains Mono',monospace;font-style:normal;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;opacity:.5}
footer{margin-top:3.5rem;padding-top:1.5rem;border-top:1px solid rgba(212,165,116,.1);font-size:.7rem;opacity:.4;letter-spacing:.05em;display:flex;justify-content:space-between;flex-wrap:wrap;gap:.5rem}
a{color:var(--sand)}
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.load-in{opacity:0;animation:fadeUp .9s cubic-bezier(.16,1,.3,1) forwards}.load-in.d1{animation-delay:.05s}.load-in.d2{animation-delay:.2s}.load-in.d3{animation-delay:.35s}.load-in.d4{animation-delay:.5s}
.reveal{opacity:0;transform:translateY(18px);transition:opacity .8s cubic-bezier(.16,1,.3,1),transform .8s cubic-bezier(.16,1,.3,1)}.reveal.in-view{opacity:1;transform:translateY(0)}
#dust{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:.5}
@media(prefers-reduced-motion:reduce){.dot,.track-dot{animation:none}html{scroll-behavior:auto}.load-in,.reveal{animation:none !important;opacity:1 !important;transform:none !important}#dust{display:none}}
</style></head>
<body>
<canvas id="dust"></canvas>
<main class="manifest">
  <div class="route-line load-in d1">Silk Road Script Hub — dakait.online</div>
  <h1 class="load-in d2">The <em>Silk Road</em><br>Script Hub</h1>
  <p class="tagline load-in d2" id="typewriterText"></p>
  <div class="stat-bar load-in d3">
    <div class="stat"><span class="stat-num" id="scriptCount">—</span><span class="stat-label">Scripts dropped</span></div>
    <div class="stat"><span class="stat-num">Free</span><span class="stat-label">Always</span></div>
    <div class="stat"><span class="stat-num">∞</span><span class="stat-label">Games covered</span></div>
  </div>
  <div class="caravan-track load-in d3">
    <div class="track-line"></div><div class="track-dot"></div><div class="track-dot"></div><div class="track-dot"></div>
  </div>
  <div class="seal-row load-in d3">
    <div class="seal"><span class="dot"></span><span class="seal-text">Route: <b>open</b></span></div>
    <button class="btn" id="infoToggle" onclick="toggleInfo()"><span>More about this route</span><span>›</span></button>
  </div>
  <div class="seal-row load-in d4">
    <a class="btn primary" href="/scripts">Explore Scripts</a>
    <a class="btn gold" href="/upload-scripts">Upload Script</a>
  </div>
  <div class="seal-row load-in d4" id="accountRow"></div>
  <div class="info-panel" id="infoPanel">
    <div class="info-inner">
      <p>Silk Road is a free Roblox script hub — find scripts for Blox Fruits, Grow a Garden, Rivals, Lumber Tycoon 2, and more. Community-built, keyless where possible, no account needed to browse.</p>
      <p>Sign in with Google to upload scripts, like, save favorites, and rate what you've used. Verified creators get a badge. Built on Cloudflare Workers.</p>
    </div>
  </div>
  <section class="ledger reveal">
    <div class="ledger-label">Caravan Leadership</div>
    <div class="crew">
      <div class="crew-card"><div class="crew-name">Dakait Shah</div><div class="crew-role">Route Operator</div><div class="crew-desc">Builds and runs the trade route end to end — the API, the game's server logic, and everything that keeps the ledger honest.</div></div>
      <div class="crew-card"><div class="crew-name">Dakait Guri</div><div class="crew-role">Co-Conspirator</div><div class="crew-desc">Rides alongside the route — shaping the world the caravan moves through and keeping watch over the checkpoints.</div></div>
    </div>
  </section>
  <section class="reveal">
    <div class="quote-block">"A route is only as trustworthy as the hands that guard its checkpoints."<div class="quote-attr">— Silk Road Charter</div></div>
  </section>
  <footer class="reveal"><span>dakait.online</span><span>operated by Dakait Shah &amp; Dakait Guri</span></footer>
</main>
<script>
  function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  const phrases=["Blox Fruits, Grow a Garden, Rivals — all here.","Free Roblox scripts. No keys. No paywalls.","Drop a script. Take a script. Community built."];
  let pi=0,ci=0,del=false;const tw=document.getElementById("typewriterText");
  function typeStep(){const p=phrases[pi];if(!del){tw.textContent=p.slice(0,++ci);if(ci===p.length){del=true;setTimeout(typeStep,2200);return;}}else{tw.textContent=p.slice(0,--ci);if(ci===0){del=false;pi=(pi+1)%phrases.length;}}setTimeout(typeStep,del?28:52);}typeStep();
  fetch("/api/scripts").then(r=>r.json()).then(d=>{const n=(d.scripts||[]).length,el=document.getElementById("scriptCount");let cur=0;const step=Math.max(1,Math.floor(n/40));const t=setInterval(()=>{cur=Math.min(cur+step,n);el.textContent=cur;if(cur>=n)clearInterval(t);},30);}).catch(()=>{});
  fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(me=>{
    const row=document.getElementById('accountRow'),name=esc(me.name||'');
    if(me.loggedIn){row.innerHTML='<span class="seal-text" style="opacity:.75">Signed in as <b>'+name+'</b>'+(me.isAdmin?' · <b style="color:var(--sand)">ADMIN</b>':'')+'</span>'+(me.isAdmin?'<a class="btn" href="/admin/">Admin</a>':'')+'<a class="btn" href="/creator/'+encodeURIComponent(me.sub)+'">My Profile</a><a class="btn" href="/auth/logout">Log out</a>';}
    else{row.innerHTML='<a class="btn" href="/auth/login?return=%2F">Sign in with Google</a>';}
  }).catch(()=>{});
  function toggleInfo(){const p=document.getElementById('infoPanel'),b=document.getElementById('infoToggle');const o=p.classList.toggle('open');b.querySelector('span').textContent=o?'Less detail':'More about this route';}
  const obs=new IntersectionObserver(es=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in-view');obs.unobserve(e.target);}});},{threshold:.15});
  document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
  if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    const canvas=document.getElementById('dust'),ctx=canvas.getContext('2d');let w,h,particles;
    function resize(){w=canvas.width=window.innerWidth;h=canvas.height=window.innerHeight;}
    function makeP(){const n=Math.min(60,Math.floor(w/22));particles=Array.from({length:n},()=>({x:Math.random()*w,y:Math.random()*h,r:Math.random()*1.4+.3,sx:(Math.random()-.5)*.12,sy:Math.random()*.08+.02,a:Math.random()*.35+.08}));}
    function tick(){ctx.clearRect(0,0,w,h);particles.forEach(p=>{p.x+=p.sx;p.y+=p.sy;if(p.y>h){p.y=-4;p.x=Math.random()*w;}if(p.x>w)p.x=0;if(p.x<0)p.x=w;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fillStyle=\`rgba(212,165,116,\${p.a})\`;ctx.fill();});requestAnimationFrame(tick);}
    resize();makeP();tick();window.addEventListener('resize',()=>{resize();makeP();});
  }
</script>
</body></html>`;

/* ─── Upload page ─── */
const UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en"><head>
${SHARED_HEAD("Upload a Roblox Script — Silk Road Script Hub | dakait.online","Share your Roblox script with the community. Google sign-in required. Goes live instantly.","https://dakait.online/upload-scripts")}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#0a0b0e;--surface:#12141a;--border:#222530;--text:#e4e6ed;--muted:#7a7f90;--accent:#f5a623;--green:#4ecb7a;--red:#f05656;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*,*::before,*::after{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--text);font-family:var(--sans);line-height:1.5;overflow-x:hidden}
.page{max-width:1060px;margin:auto;padding:28px 20px 100px}
nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:40px;flex-wrap:wrap;gap:10px}
.brand{font:700 13px var(--mono);letter-spacing:.14em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}
.bl{font:11.5px var(--mono);color:var(--muted);text-decoration:none;transition:color .2s}.bl:hover{color:var(--accent)}
.hero{margin-bottom:32px}
.ey{font:10px var(--mono);letter-spacing:.2em;text-transform:uppercase;color:var(--accent);margin-bottom:8px;opacity:0;animation:up .6s .1s cubic-bezier(.16,1,.3,1) forwards}
.ht{font:700 clamp(28px,5vw,44px)/1.05 var(--mono);margin:0 0 10px;clip-path:inset(0 100% 0 0);animation:rv .7s .25s cubic-bezier(.77,0,.18,1) forwards}
.hs{font-size:14.5px;color:var(--muted);max-width:52ch;opacity:0;animation:up .6s .5s cubic-bezier(.16,1,.3,1) forwards}
@keyframes rv{to{clip-path:inset(0 0% 0 0)}}@keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.lbanner{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 16px;margin-bottom:28px;font-size:13px;color:var(--muted);flex-wrap:wrap;opacity:0;animation:up .5s .6s cubic-bezier(.16,1,.3,1) forwards}
.lbanner a{color:var(--accent);text-decoration:none;font:12px var(--mono)}
.layout{display:grid;grid-template-columns:1fr 340px;gap:28px;align-items:start}
@media(max-width:800px){.layout{grid-template-columns:1fr}.psticky{position:static !important}}
.fpanel{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px;opacity:0;animation:up .6s .7s cubic-bezier(.16,1,.3,1) forwards}
.field{margin-bottom:18px}label{display:block;font:11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:7px;transition:color .2s}
.field:focus-within label{color:var(--accent)}
.field input,.field textarea{width:100%;background:#0a0b0e;border:1px solid var(--border);border-radius:8px;color:var(--text);padding:11px 14px;font:14px var(--sans);outline:none;transition:border-color .25s,box-shadow .25s;resize:vertical}
.field textarea{font:12.5px var(--mono);min-height:180px}
.field input:focus,.field textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(245,166,35,.1)}
.field .hint{font:11px var(--mono);color:rgba(245,166,35,.5);margin-top:5px}
.r2{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:500px){.r2{grid-template-columns:1fr}}
.tl{font:11px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:8px}
.ktoggle{display:flex;gap:8px;margin-bottom:18px}
.kto{flex:1;text-align:center;padding:11px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font:12.5px var(--mono);color:var(--muted);transition:all .2s;user-select:none}
.kto.akl{border-color:var(--green);color:var(--green);background:rgba(78,203,122,.08)}
.kto.ahk{border-color:var(--red);color:var(--red);background:rgba(240,86,86,.08)}
.srow{display:flex;align-items:center;gap:14px;margin-top:6px}
.sbtn{background:var(--accent);color:#1a0f00;border:none;font:700 13px var(--mono);letter-spacing:.06em;text-transform:uppercase;padding:13px 24px;border-radius:8px;cursor:pointer;transition:background .2s,transform .15s;position:relative;overflow:hidden}
.sbtn::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.15);transform:translateX(-100%) skewX(-20deg);transition:transform .4s ease}
.sbtn:hover{background:#ffba3e}.sbtn:hover::after{transform:translateX(120%) skewX(-20deg)}.sbtn:active{transform:scale(.97)}.sbtn:disabled{opacity:.5;cursor:not-allowed}
.fm{font:13px var(--mono)}.fm.err{color:var(--red)}.fm.ok{color:var(--green)}.fm.ok a{color:var(--accent)}
.psticky{position:sticky;top:28px;opacity:0;animation:up .6s .9s cubic-bezier(.16,1,.3,1) forwards}
.plabel{font:11px var(--mono);text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin-bottom:12px;display:flex;align-items:center;gap:6px}
.plabel::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--accent);animation:pd 2s infinite}
@keyframes pd{0%{box-shadow:0 0 0 0 rgba(245,166,35,.5)}70%{box-shadow:0 0 0 8px rgba(245,166,35,0)}100%{box-shadow:0 0 0 0 rgba(245,166,35,0)}}
.pcard{background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;transition:border-color .3s}
.pcard.hc{border-color:rgba(245,166,35,.3)}
.pph{width:100%;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#14161d,#0c0d11);font-size:28px;color:rgba(245,166,35,.15);font-family:var(--mono)}
.pbadge{display:inline-block;font:9px var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:6px;margin:12px 14px 0}
.pbadge.kl{color:var(--green);background:rgba(10,12,16,.85);border:1px solid rgba(78,203,122,.35)}
.pbadge.hk{color:var(--red);background:rgba(10,12,16,.85);border:1px solid rgba(240,86,86,.35)}
.pbody{padding:6px 14px 14px}.pgame{font:10px var(--mono);color:var(--accent);text-transform:uppercase;letter-spacing:.07em;opacity:.8;margin-bottom:3px}
.ptitle{font:700 14.5px var(--mono);margin:0 0 4px;line-height:1.3;color:var(--text)}.pdesc{color:var(--muted);font-size:12px;margin:0 0 8px}
.ptags{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px}
.pfoot{display:flex;justify-content:space-between;align-items:center;font:11px var(--mono);color:var(--muted);padding-top:8px;border-top:1px solid var(--border)}
.pfoot .pu::before{content:'@';color:var(--accent)}
.phint{font:11px var(--mono);color:var(--muted);text-align:center;padding:20px;opacity:.6}
</style></head>
<body><div class="page">
<nav><div class="brand"><a href="/">dakait<span>.online</span></a></div><a class="bl" href="/scripts">← Browse scripts</a></nav>
<div class="hero"><div class="ey">Silk Road · Script Hub</div><h1 class="ht">Drop your script.</h1><p class="hs">Sign in with Google, paste your script, tag it. Goes live immediately — every upload has a verified owner who can manage or delete it.</p></div>
<div class="lbanner" id="lbanner">Checking…</div>
<div class="layout">
  <section class="fpanel"><form id="uform">
    <div class="field"><label for="title">Script title</label><input id="title" maxlength="120" required placeholder="e.g. Grow a Garden AutoFarm Script"/></div>
    <div class="r2">
      <div class="field"><label for="username">Your handle</label><input id="username" maxlength="40" placeholder="anonymous"/></div>
      <div class="field"><label for="placeId">Roblox Place ID <span style="opacity:.5">(optional)</span></label><input id="placeId" inputmode="numeric" placeholder="e.g. 920587237"/><p class="hint">Pulls game name + thumbnail.</p></div>
    </div>
    <div class="r2">
      <div class="field"><label for="hubName">Hub name <span style="opacity:.5">(optional)</span></label><input id="hubName" maxlength="40" placeholder="e.g. SpeedXHub"/></div>
      <div class="field"><label for="tags">Tags <span style="opacity:.5">(comma separated)</span></label><input id="tags" placeholder="AUTO-FARM, ESP, GUI"/></div>
    </div>
    <div class="tl">Key system</div>
    <div class="ktoggle"><div class="kto akl" id="optKl">Keyless / No key</div><div class="kto" id="optHk">Has key system</div></div>
    <div class="field"><label for="description">Description</label><input id="description" maxlength="500" placeholder="What does it do, what game, anything to know?"/></div>
    <div class="field"><label for="code">Script code</label><textarea id="code" required placeholder="Paste your Lua code here"></textarea></div>
    <div class="srow"><button type="submit" class="sbtn">Drop it →</button><p class="fm" id="fmsg"></p></div>
  </form></section>
  <aside class="psticky">
    <div class="plabel">Live preview</div>
    <div class="pcard" id="pcard"><div class="pph">⌗</div><p class="phint">Fill in the form to see your card preview.</p></div>
  </aside>
</div>
</div>
<script>
let ks=false;
const optKl=document.getElementById("optKl"),optHk=document.getElementById("optHk"),fm=document.getElementById("fmsg"),form=document.getElementById("uform"),pc=document.getElementById("pcard");
function esc(s){return String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
optKl.onclick=()=>{ks=false;optKl.className="kto akl";optHk.className="kto";uprev();};
optHk.onclick=()=>{ks=true;optHk.className="kto ahk";optKl.className="kto";uprev();};
fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(me=>{
  const b=document.getElementById("lbanner");
  if(me.loggedIn){b.innerHTML='Signed in as <b>'+esc(me.name)+'</b> — upload belongs to your account. <a href="/auth/logout">Log out</a>';document.getElementById("username").value=me.name;}
  else{b.innerHTML='🔒 <b>Google sign-in required to upload.</b> <a href="/auth/login?return=%2Fupload-scripts">Sign in →</a>';document.querySelectorAll('#uform input,#uform textarea,#uform button').forEach(el=>el.disabled=true);setTimeout(()=>{window.location.href='/auth/login?return=%2Fupload-scripts';},600);}
  uprev();
}).catch(()=>{document.getElementById("lbanner").textContent="Please sign in with Google before uploading.";});
function uprev(){
  const t=document.getElementById("title").value.trim(),d=document.getElementById("description").value.trim(),u=document.getElementById("username").value.trim()||"anonymous",h=document.getElementById("hubName").value.trim(),rt=document.getElementById("tags").value.trim();
  const tags=rt?rt.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean).slice(0,5):[];
  const has=!!(t||d||h||tags.length);pc.classList.toggle("hc",has);
  if(!has){pc.innerHTML='<div class="pph">⌗</div><p class="phint">Fill in the form to preview your card.</p>';return;}
  const badge=ks?'<div class="pbadge hk">Key</div>':'<div class="pbadge kl">Keyless</div>';
  const ts=tags.map(x=>'<span style="font:9.5px var(--mono);padding:2px 8px;border-radius:5px;background:rgba(245,166,35,.09);color:var(--accent);border:1px solid rgba(245,166,35,.2)">'+esc(x)+'</span>').join("");
  const hs=h?'<span style="font:9.5px var(--mono);padding:2px 8px;border-radius:5px;background:rgba(78,203,122,.08);color:var(--green);border:1px solid rgba(78,203,122,.22)">'+esc(h)+'</span>':"";
  pc.innerHTML='<div class="pph">⌗</div>'+badge+'<div class="pbody"><div class="pgame"></div><p class="ptitle">'+(esc(t)||'<span style="opacity:.3">Your title here</span>')+'</p><p class="pdesc">'+(esc(d)||'<span style="opacity:.3">Your description…</span>')+'</p><div class="ptags">'+hs+ts+'</div><div class="pfoot"><span class="pu">'+esc(u)+'&nbsp;·&nbsp;just now</span><span style="color:var(--accent)">→</span></div></div>';
}
["title","description","username","hubName","tags"].forEach(id=>document.getElementById(id).addEventListener("input",uprev));
form.onsubmit=async e=>{
  e.preventDefault();fm.textContent="";fm.className="fm";
  const title=document.getElementById("title").value.trim(),code=document.getElementById("code").value;
  if(!title||!code.trim()){fm.textContent="Title and script code are required.";fm.className="fm err";return;}
  const placeId=document.getElementById("placeId").value.trim();
  if(placeId&&!/^\d+$/.test(placeId)){fm.textContent="Place ID should be numbers only.";fm.className="fm err";return;}
  const btn=form.querySelector(".sbtn");btn.disabled=true;btn.textContent="Dropping…";
  try{
    const r=await fetch("/api/scripts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,username:document.getElementById("username").value.trim(),description:document.getElementById("description").value.trim(),code,placeId:placeId||null,hubName:document.getElementById("hubName").value.trim(),tags:document.getElementById("tags").value.trim(),keysystem:ks})});
    if(!r.ok){const e=await r.json();throw new Error(e.error||"Upload failed");}
    const d=await r.json();
    fm.innerHTML='Dropped! <a href="/scripts/'+d.script.id+'">View it →</a>';
    fm.className="fm ok";form.reset();ks=false;optKl.className="kto akl";optHk.className="kto";uprev();
  }catch(e){fm.textContent=e.message||"Something went wrong.";fm.className="fm err";}
  finally{btn.disabled=false;btn.textContent="Drop it →";}
};
uprev();
</script></body></html>`;

/* ─── Admin page ─── */
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en"><head>
${SHARED_HEAD("Admin — dakait.online","Private admin panel.","https://dakait.online/admin/")}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap"/>
<meta name="robots" content="noindex"/>
<style>
:root{--bg:#090a0d;--panel:#111318;--line:#252832;--text:#e8e9ed;--muted:#858a98;--accent:#ffb238;--green:#5cd98a;--red:#ff6262;--blue:#6ea8ff;--mono:'JetBrains Mono',monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--mono)}
.wrap{max-width:1050px;margin:auto;padding:28px 18px 80px}
.top{display:flex;justify-content:space-between;gap:15px;align-items:center;margin-bottom:24px;flex-wrap:wrap}
.brand{font-size:12px;letter-spacing:.14em;text-transform:uppercase}.brand span{color:var(--accent)}a{color:inherit}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.btn{display:inline-block;text-decoration:none;border:1px solid var(--line);background:#151820;color:var(--text);padding:9px 12px;border-radius:7px;font:11px var(--mono);cursor:pointer;transition:border-color .15s}.btn:hover{border-color:#555}
.danger{color:var(--red)!important;border-color:#61383b!important}
.hero{border:1px solid var(--line);background:linear-gradient(135deg,#171a21,#0f1116);border-radius:12px;padding:22px;margin-bottom:18px}
.eyebrow{font-size:10px;color:var(--accent);letter-spacing:.16em;text-transform:uppercase}.hero h1{font-size:28px;margin:8px 0}.hero p{color:var(--muted);font-size:12px;line-height:1.6}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:15px}
.num{font-size:24px;color:var(--accent)}.label{font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-top:4px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px;margin-top:15px}.panel h2{font-size:13px;margin:0 0 12px}
.verify-panel{margin-top:15px}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.controls input{flex:1;min-width:180px;background:#090a0d;border:1px solid var(--line);border-radius:7px;color:var(--text);padding:10px;font:12px var(--mono)}
.script{display:grid;grid-template-columns:1fr auto;gap:12px;padding:13px 0;border-top:1px dashed var(--line);align-items:center}.script:first-child{border-top:0}
.title{font-size:13px}.meta{font-size:9px;color:var(--muted);margin-top:5px}
.script-actions{display:flex;gap:6px;flex-wrap:wrap}
.empty,.msg{color:var(--muted);font-size:11px}.ok{color:var(--green)}.err{color:var(--red)}
@media(max-width:650px){.stats{grid-template-columns:repeat(2,1fr)}.script{grid-template-columns:1fr}}
</style></head><body><main class="wrap">
<div class="top"><div class="brand"><a href="/">DAKAIT<span>.ONLINE</span></a> / ADMIN</div><div class="actions"><a class="btn" href="/scripts">Gallery</a><a class="btn" href="/">Home</a><a class="btn" href="/auth/logout">Log out</a></div></div>
<section class="hero"><div class="eyebrow">Private control room</div><h1>Admin control.</h1><p id="who">Checking administrator session…</p></section>
<div class="stats"><div class="stat"><div class="num" id="sc">—</div><div class="label">Scripts</div></div><div class="stat"><div class="num" id="tv">—</div><div class="label">Total views</div></div><div class="stat"><div class="num" id="tr">—</div><div class="label">Ratings</div></div><div class="stat"><div class="num" id="ta">—</div><div class="label">Avg rating</div></div></div>
<section class="panel"><h2>Script management</h2><div class="controls"><input id="search" placeholder="Search scripts…"/><button class="btn" id="refresh">Refresh</button></div><div id="scripts"><div class="empty">Loading…</div></div></section>
<section class="panel verify-panel"><h2>Verify a creator</h2>
<div class="controls">
  <input id="verifySub" placeholder="Creator sub (Google user ID)" style="flex:2"/>
  <button class="btn" id="verifyBtn">✓ Verify</button>
  <button class="btn danger" id="unverifyBtn">✗ Remove</button>
</div>
<p class="msg" id="verifyMsg"></p>
<p class="empty" style="margin-top:6px">Tip: Find the creator sub from /api/admin/overview script data (ownerSub field).</p>
</section>
<p class="msg" id="msg"></p>
</main>
<script>
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let all=[];
async function load(){const msg=document.getElementById("msg");msg.textContent="Refreshing…";try{const r=await fetch("/api/admin/overview",{credentials:"same-origin",cache:"no-store"});const d=await r.json();if(r.status===401){location.href="/auth/login?return=%2Fadmin%2F";return;}if(!r.ok)throw new Error(d.error||"Access denied");all=d.scripts||[];document.getElementById("who").textContent="Signed in as "+d.user.name+" · "+d.user.email+" · ADMIN";document.getElementById("sc").textContent=d.stats.scripts;document.getElementById("tv").textContent=d.stats.views;document.getElementById("tr").textContent=d.stats.ratings;document.getElementById("ta").textContent=d.stats.average?d.stats.average.toFixed(1)+"/5":"—";render();msg.textContent="Updated.";msg.className="msg ok";}catch(e){msg.textContent=e.message;msg.className="msg err";}}
function render(){const q=document.getElementById("search").value.toLowerCase();const list=all.filter(s=>[s.title,s.username,s.gameName,...(s.tags||[])].join(" ").toLowerCase().includes(q));const el=document.getElementById("scripts");if(!list.length){el.innerHTML='<div class="empty">No matching scripts.</div>';return;}el.innerHTML=list.map(s=>'<div class="script"><div><div class="title">'+esc(s.title)+'</div><div class="meta">'+esc(s.id)+' · @'+esc(s.username||"?")+' · '+Number(s.views||0)+' views · '+(s.rating?.total||0)+' ratings'+(s.ownerSub?' · sub:'+esc(s.ownerSub):'')+'</div></div><div class="script-actions"><a class="btn" href="/scripts/'+encodeURIComponent(s.id)+'">View</a><a class="btn" href="/scripts/'+encodeURIComponent(s.id)+'/edit">Edit</a><button class="btn danger" data-id="'+esc(s.id)+'">Delete</button></div></div>').join("");el.querySelectorAll("button[data-id]").forEach(b=>b.onclick=()=>del(b.dataset.id));}
async function del(id){const s=all.find(x=>x.id===id);if(!s||!confirm("Delete "+s.title+"?"))return;const r=await fetch("/api/scripts/"+encodeURIComponent(id),{method:"DELETE",credentials:"same-origin"});const d=await r.json().catch(()=>({}));if(!r.ok){alert(d.error||"Delete failed");return;}await load();}
document.getElementById("refresh").onclick=load;document.getElementById("search").oninput=render;
async function verifyCreator(verified){const sub=document.getElementById("verifySub").value.trim();if(!sub){document.getElementById("verifyMsg").textContent="Enter a creator sub ID.";return;}const r=await fetch("/api/admin/verify-creator",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({sub,verified})});const d=await r.json().catch(()=>({}));const msg=document.getElementById("verifyMsg");if(r.ok){msg.textContent=verified?"✓ Creator verified.":"✗ Verification removed.";msg.className="msg ok";}else{msg.textContent=d.error||"Failed.";msg.className="msg err";}}
document.getElementById("verifyBtn").onclick=()=>verifyCreator(true);document.getElementById("unverifyBtn").onclick=()=>verifyCreator(false);
load();
</script></body></html>`;

/* ─── Creator profile page ─── */
function buildCreatorHtml(profile, scripts) {
    const name    = escapeHtml(profile.displayName || profile.sub?.slice(0,8) || "Creator");
    const bio     = escapeHtml(profile.bio || "");
    const roblox  = profile.robloxUsername ? escapeHtml(profile.robloxUsername) : null;
    const avatar  = profile.picture ? escapeHtml(profile.picture) : null;
    const joined  = new Date(profile.joinedAt || 0).toLocaleDateString("en-US", { year: "numeric", month: "long" });
    const verified = !!profile.verified;
    const badges  = Array.isArray(profile.badges) ? profile.badges : [];
    const totalViews = scripts.reduce((n, s) => n + Number(s.views || 0), 0);

    function badgeLabel(b) {
        const map = { "100_views":"100 Views","500_views":"500 Views","1000_views":"1K Views","5000_views":"5K Views","10000_views":"10K Views","10_copies":"10 Copies","50_copies":"50 Copies","100_copies":"100 Copies","500_copies":"500 Copies","1000_copies":"1K Copies","verified":"Verified Creator" };
        return map[b] || b;
    }

    const badgeHtml = badges.filter(b => b !== "verified").map(b => `<span class="badge-pill">${badgeLabel(b)}</span>`).join("");
    const scriptCards = scripts.slice(0, 24).map((s, i) => {
        const img = s.placeId
            ? `<img class="mini-img" src="/api/roblox-thumbnail?placeId=${encodeURIComponent(s.placeId)}" loading="lazy" alt="${escapeHtml(s.title)}" onerror="this.outerHTML='<div class=\\"mini-img-ph\\">⌗</div>'"/>`
            : `<div class="mini-img-ph">⌗</div>`;
        return `<a class="mini-card" href="/scripts/${encodeURIComponent(s.id)}" style="animation-delay:${i * 35}ms">${img}<div class="mini-body"><div class="mini-title">${escapeHtml(s.title)}</div><div class="mini-meta">${Number(s.views || 0).toLocaleString()} views${s.gameName ? " · " + escapeHtml(s.gameName) : ""}</div></div></a>`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en"><head>
${SHARED_HEAD(`${profile.displayName || "Creator"} — Silk Road Script Hub | dakait.online`, `Browse scripts by ${profile.displayName || "this creator"} on Silk Road Script Hub.`, `https://dakait.online/creator/${encodeURIComponent(profile.sub)}`)}
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"/>
<style>
:root{--bg:#090a0d;--panel:#111319;--panel2:#171922;--line:#22252f;--text:#e9ebf0;--muted:#777d8d;--accent:#ffb238;--green:#5cd98a;--red:#ff6262;--blue:#6ea8ff;--mono:'JetBrains Mono',monospace;--sans:'Inter',sans-serif}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{background:var(--bg);color:var(--text);font-family:var(--sans);overflow-x:hidden}
.wrap{max-width:960px;margin:auto;padding:26px 18px 80px}
nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;gap:10px;flex-wrap:wrap}
.brand{font:700 12px var(--mono);letter-spacing:.15em;text-transform:uppercase}.brand a{color:var(--muted);text-decoration:none}.brand span{color:var(--accent)}
.back{font:11px var(--mono);color:var(--muted);text-decoration:none;transition:color .15s}.back:hover{color:var(--accent)}
/* Profile hero */
.profile-hero{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:28px;margin-bottom:18px;display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap;opacity:0;animation:fup .6s .05s cubic-bezier(.16,1,.3,1) forwards}
@keyframes fup{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.avatar{width:88px;height:88px;border-radius:50%;border:2px solid rgba(255,178,56,.3);object-fit:cover;flex-shrink:0;background:var(--panel2)}
.avatar-ph{width:88px;height:88px;border-radius:50%;border:2px solid rgba(255,178,56,.3);background:var(--panel2);display:grid;place-items:center;font:700 32px var(--mono);color:var(--accent);flex-shrink:0}
.profile-info{flex:1;min-width:200px}
.name-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
.creator-name{font:700 clamp(20px,4vw,28px)/1.2 var(--mono)}
.verified-badge{display:inline-flex;align-items:center;gap:4px;background:rgba(110,168,255,.1);border:1px solid rgba(110,168,255,.3);color:var(--blue);border-radius:5px;padding:3px 8px;font:9px var(--mono);letter-spacing:.08em;text-transform:uppercase}
.profile-meta{font:10px var(--mono);color:var(--muted);margin-bottom:10px}
.profile-bio{font-size:14px;color:#c0c3cc;line-height:1.65;margin-bottom:12px;max-width:55ch}
.profile-links{display:flex;gap:8px;flex-wrap:wrap}
.profile-link{font:11px var(--mono);padding:6px 12px;border:1px solid var(--line);border-radius:6px;color:var(--muted);text-decoration:none;transition:border-color .15s,color .15s}
.profile-link:hover{border-color:var(--accent);color:var(--accent)}
/* Stats row */
.profile-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:18px;opacity:0;animation:fup .5s .15s cubic-bezier(.16,1,.3,1) forwards}
.pstat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;text-align:center}
.pstat-n{font:700 22px var(--mono);color:var(--accent);line-height:1}.pstat-l{font:8px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-top:4px}
/* Badges */
.badges-section{margin-bottom:18px;opacity:0;animation:fup .5s .22s cubic-bezier(.16,1,.3,1) forwards}
.badges-title{font:10px var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.12em;margin-bottom:10px}
.badges-row{display:flex;gap:6px;flex-wrap:wrap}
.badge-pill{font:9px var(--mono);padding:4px 10px;border:1px solid #51401f;border-radius:5px;color:var(--accent);background:rgba(255,178,56,.07)}
/* Scripts */
.section-head{font:700 13px var(--mono);margin:0 0 14px;opacity:0;animation:fup .5s .3s cubic-bezier(.16,1,.3,1) forwards}
@keyframes cardIn{to{transform:translateY(0);opacity:1}}
.mini-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.mini-card{display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;transform:translateY(12px);opacity:0;animation:cardIn .5s cubic-bezier(.16,1,.3,1) forwards;transition:border-color .2s,background .2s}
.mini-card:hover{border-color:#51401f;background:var(--panel2)}
.mini-img{width:100%;height:90px;object-fit:cover;background:#0d0e12}
.mini-img-ph{height:90px;display:grid;place-items:center;background:linear-gradient(135deg,#181a20,#0c0d10);font:26px var(--mono);color:#4d432e}
.mini-body{padding:10px 11px 11px}
.mini-title{font:700 12.5px var(--mono);margin:0 0 4px;display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
.mini-meta{font:9px var(--mono);color:var(--muted)}
.empty-scripts{color:var(--muted);font:11px var(--mono);padding:20px 0}
/* Edit profile */
.edit-btn{font:11px var(--mono);padding:7px 12px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;transition:border-color .15s}
.edit-btn:hover{border-color:var(--accent);color:var(--accent)}
.edit-panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:18px;margin-top:14px;display:none}
.ef-label{font:10px var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:6px;display:block;margin-top:12px}
.ef-label:first-of-type{margin-top:0}
.ef-input{width:100%;background:#0a0b0e;border:1px solid var(--line);border-radius:6px;color:var(--text);padding:9px 11px;font:13px var(--sans);outline:none;transition:border-color .2s}
.ef-input:focus{border-color:var(--accent)}
.ef-save{margin-top:12px;background:var(--accent);border:0;border-radius:6px;padding:9px 16px;color:#1a0f00;font:700 11px var(--mono);cursor:pointer}
.ef-save:hover{background:#ffca5c}
.ef-msg{font:10px var(--mono);color:var(--muted);margin-top:8px}
@media(max-width:700px){.mini-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.profile-stats{grid-template-columns:repeat(2,1fr)}}
@media(max-width:440px){.mini-grid{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){*{animation:none !important;transition:none !important}}
</style></head>
<body><div class="wrap">
<nav><div class="brand"><a href="/">dakait<span>.online</span></a></div><a class="back" href="/scripts">← Gallery</a></nav>

<div class="profile-hero">
  ${avatar ? `<img class="avatar" src="${avatar}" alt="${name}"/>` : `<div class="avatar-ph">${name.slice(0, 1)}</div>`}
  <div class="profile-info">
    <div class="name-row">
      <div class="creator-name">${name}</div>
      ${verified ? `<span class="verified-badge">✓ Verified Creator</span>` : ""}
    </div>
    <div class="profile-meta">Joined ${joined}${roblox ? ` · Roblox: @${roblox}` : ""} · ${scripts.length} script${scripts.length !== 1 ? "s" : ""}</div>
    ${bio ? `<div class="profile-bio">${bio}</div>` : ""}
    <div class="profile-links">
      ${roblox ? `<a class="profile-link" href="https://www.roblox.com/users/search?keyword=${encodeURIComponent(roblox)}" target="_blank" rel="noopener">Roblox →</a>` : ""}
      <button class="edit-btn" id="editToggle" style="display:none">Edit profile</button>
    </div>
    <div class="edit-panel" id="editPanel">
      <label class="ef-label">Display name</label><input class="ef-input" id="efName" maxlength="50" value="${name}"/>
      <label class="ef-label">Bio</label><input class="ef-input" id="efBio" maxlength="300" value="${bio}"/>
      <label class="ef-label">Roblox username</label><input class="ef-input" id="efRoblox" maxlength="40" value="${roblox || ""}"/>
      <button class="ef-save" id="efSave">Save</button>
      <p class="ef-msg" id="efMsg"></p>
    </div>
  </div>
</div>

<div class="profile-stats">
  <div class="pstat"><div class="pstat-n">${scripts.length}</div><div class="pstat-l">Scripts</div></div>
  <div class="pstat"><div class="pstat-n">${totalViews.toLocaleString()}</div><div class="pstat-l">Total views</div></div>
  <div class="pstat"><div class="pstat-n">${profile.reputation || 0}</div><div class="pstat-l">Reputation</div></div>
</div>

${badgeHtml ? `<div class="badges-section"><div class="badges-title">Badges & milestones</div><div class="badges-row">${badgeHtml}</div></div>` : ""}

<div class="section-head">Scripts by ${name}</div>
${scripts.length ? `<div class="mini-grid">${scriptCards}</div>` : `<p class="empty-scripts">No scripts uploaded yet.</p>`}

</div>
<script>
const PROFILE_SUB=${safeJsonForHtml(profile.sub)};
fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(me=>{
  if(me.loggedIn&&me.sub===PROFILE_SUB){
    document.getElementById("editToggle").style.display="inline-block";
    document.getElementById("editToggle").onclick=()=>{const p=document.getElementById("editPanel");p.style.display=p.style.display==="none"?"block":"none";};
    document.getElementById("efSave").onclick=async()=>{
      const msg=document.getElementById("efMsg");msg.textContent="Saving…";
      const r=await fetch("/api/creator/profile",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({displayName:document.getElementById("efName").value,bio:document.getElementById("efBio").value,robloxUsername:document.getElementById("efRoblox").value})});
      const d=await r.json().catch(()=>({}));
      if(r.ok){msg.textContent="Saved!";setTimeout(()=>location.reload(),700);}
      else{msg.textContent=d.error||"Failed to save.";}
    };
  }
}).catch(()=>{});
</script>
</body></html>`;
}

/* ─── Auth ─── */
const REDIRECT_URI = "https://dakait.online/auth/callback";
function safeReturnPath(v) { try { const p = String(v||"/"); if(!p.startsWith("/")||p.startsWith("//")||p.includes("\\")) return "/"; return p.slice(0,1000); } catch { return "/"; } }

async function handleAuthLogin(request, env) {
    const url = new URL(request.url);
    const returnTo = safeReturnPath(url.searchParams.get("return") || "/");
    const state = crypto.randomUUID();
    await env.SESSIONS_KV.put(`oauthstate:${state}`, JSON.stringify({ returnTo }), { expirationTtl: 600 });
    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` } });
}

async function handleAuthCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (!code || !state) return new Response("Missing code/state", { status: 400 });
    const stateRaw = await env.SESSIONS_KV.get(`oauthstate:${state}`);
    if (!stateRaw) return new Response("Invalid state", { status: 400 });
    await env.SESSIONS_KV.delete(`oauthstate:${state}`);
    let returnTo = "/";
    try { returnTo = safeReturnPath(JSON.parse(stateRaw).returnTo); } catch {}
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }) });
    if (!tokenRes.ok) return new Response("Token exchange failed", { status: 400 });
    const { access_token } = await tokenRes.json();
    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${access_token}` } });
    if (!userRes.ok) return new Response("Failed to fetch profile", { status: 400 });
    const p = await userRes.json();
    const sessionId = crypto.randomUUID();
    const session = { sub: p.sub, email: p.email, name: p.name || p.email, picture: p.picture || null };
    await env.SESSIONS_KV.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 2592000 });
    // Auto-create profile on first login
    try { await getOrCreateProfile(env, p.sub, p.name, p.picture); } catch {}
    return new Response(null, { status: 302, headers: { Location: returnTo, "Cache-Control": "no-store", "Set-Cookie": `session=${sessionId}; HttpOnly; Secure; Path=/; Max-Age=2592000; SameSite=Lax` } });
}

function handleAuthLogout() {
    return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": "session=; HttpOnly; Secure; Path=/; Max-Age=0; SameSite=Lax" } });
}

async function handleApiMe(request, env) {
    const session = await getSession(request, env);
    if (!session) return jsonResponse({ loggedIn: false });
    return jsonResponse({ loggedIn: true, sub: session.sub, name: session.name, email: session.email, picture: session.picture || null, isAdmin: isAdminEmail(env, session.email) });
}

async function handleAdminOverview(request, env) {
    const session = await getSession(request, env);
    if (!session?.sub) return jsonResponse({ error: "Sign in first." }, 401);
    if (!isAdminEmail(env, session.email)) return jsonResponse({ error: "Admin access required." }, 403);
    const scripts = await getAllScriptSummaries(env);
    let ratings = 0, weighted = 0;
    for (const s of scripts) { const t = Number(s.rating?.total || 0); ratings += t; weighted += Number(s.rating?.average || 0) * t; }
    return jsonResponse({ user: { name: session.name, email: session.email }, stats: { scripts: scripts.length, views: scripts.reduce((n, s) => n + Number(s.views || 0), 0), ratings, average: ratings ? weighted / ratings : 0 }, scripts });
}

async function buildSitemap(env) {
    const scripts = await getAllScriptSummaries(env);
    const urls = [
        `<url><loc>https://dakait.online/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
        `<url><loc>https://dakait.online/scripts</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
        `<url><loc>https://dakait.online/upload-scripts</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>`,
        ...scripts.sort((a, b) => b.createdAt - a.createdAt).map(s => `<url><loc>https://dakait.online/scripts/${s.id}</loc><lastmod>${new Date(s.createdAt).toISOString().split("T")[0]}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`),
    ];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

/* ─── Main fetch handler ─── */
export default {
    async fetch(request, env, ctx) {
        const url  = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        if (path === "/favicon.svg" || path === "/favicon.ico")
            return new Response(FAVICON_SVG, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });

        if (path === "/robots.txt")
            return new Response("User-agent: *\nAllow: /\nDisallow: /auth/\nDisallow: /api/\nDisallow: /admin/\nSitemap: https://dakait.online/sitemap.xml\n", { headers: { "Content-Type": "text/plain" } });

        if (path === "/sitemap.xml") {
            const xml = await buildSitemap(env);
            return new Response(xml, { headers: { "Content-Type": "application/xml", "Cache-Control": "public, max-age=3600" } });
        }

        if (path === "/ads.txt")
            return new Response("google.com, pub-1269702947671634, DIRECT, f08c47fec0942fa0", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });

        // ── Auth ──
        if (path === "/auth/login")    return handleAuthLogin(request, env);
        if (path === "/auth/callback") return handleAuthCallback(request, env);
        if (path === "/auth/logout")   return handleAuthLogout();
        if (path === "/api/me")        return handleApiMe(request, env);

        // ── Admin ──
        if (path === "/api/admin/overview" && method === "GET")
            return handleAdminOverview(request, env);

        if (path === "/api/admin/verify-creator" && method === "POST")
            return handleVerifyCreator(request, env);

        if (path === "/api/admin/debug" && method === "GET") {
            const session = await getSession(request, env);
            const adminRaw = env.ADMIN_EMAILS || env.ADMIN_EMAIL || null;
            const isAdmin = !!(session?.email && isAdminEmail(env, session.email));
            return jsonResponse({ session: session ? { email: session.email, name: session.name, sub: session.sub?.slice(0,8)+"…" } : null, isAdmin, adminEmailsConfigured: !!adminRaw, adminEmailsPreview: adminRaw ? adminRaw.slice(0,5)+"…("+adminRaw.length+" chars)" : "NOT SET", diagnosis: session?.email ? (isAdmin ? "✓ Admin confirmed" : "✗ "+session.email+" not in ADMIN_EMAILS") : "Not signed in" });
        }

        if (path === "/admin" || path === "/admin/") {
            const session = await getSession(request, env);
            if (!session?.sub) return new Response(null, { status: 302, headers: { Location: "/auth/login?return=%2Fadmin%2F" } });
            if (!isAdminEmail(env, session.email)) return new Response("Forbidden.", { status: 403, headers: { "Content-Type": "text/plain" } });
            return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
        }

        // ── Creator API & profile pages ──
        if (path === "/api/creator/me" || path === "/api/creator/profile" || path.startsWith("/api/creator/"))
            return handleProfileApi(request, env, path);

        // Creator profile HTML page
        const creatorPageMatch = path.match(/^\/creator\/([^/]+)$/);
        if (creatorPageMatch && method === "GET") {
            const sub = decodeURIComponent(creatorPageMatch[1]);
            const profile = await getProfile(env, sub);
            if (!profile) {
                return new Response(`<!DOCTYPE html><html><head><title>Creator not found</title></head><body style="font-family:monospace;background:#090a0d;color:#777;padding:40px;text-align:center"><h2>Creator not found</h2><p>This creator hasn't signed in yet or doesn't exist.</p><a href="/scripts" style="color:#ffb238">← Back to gallery</a></body></html>`, { status: 404, headers: { "Content-Type": "text/html" } });
            }
            // Fetch their scripts
            const allScripts = await getAllScriptSummaries(env);
            const creatorScripts = allScripts.filter(s => s.ownerSub === sub).sort((a, b) => b.createdAt - a.createdAt);
            return new Response(buildCreatorHtml(profile, creatorScripts), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
        }

        // ── Likes / favorites / copies / reports ──
        if (path === "/api/me/favorites" ||
            (path.startsWith("/api/scripts/") && (path.includes("/likes") || path.includes("/favorites") || path.includes("/copy") || path.includes("/copies") || path.includes("/report")))) {
            // GET /api/scripts/:id/copies (public — no auth needed)
            const copiesMatch = path.match(/^\/api\/scripts\/([a-zA-Z0-9-]+)\/copies$/);
            if (copiesMatch && method === "GET") {
                const count = await getCopyCount(env, copiesMatch[1]);
                return jsonResponse({ count });
            }
            const resp = await handleLikesApi(request, env, path);
            resp.headers.set("Access-Control-Allow-Origin", "*");
            return resp;
        }

        // ── Static pages ──
        if (path === "/scripts" || path === "/scripts/")
            return new Response(GALLERY_HTML, { headers: { "Content-Type": "text/html" } });
        if (path === "/upload-scripts" || path === "/upload-scripts/")
            return new Response(UPLOAD_HTML, { headers: { "Content-Type": "text/html" } });

        // ── Roblox thumbnail proxy ──
        if (path === "/api/roblox-thumbnail" && method === "GET") {
            const placeId = url.searchParams.get("placeId");
            const info = await getRobloxGameInfo(env, placeId);
            if (!info?.imageUrl) return new Response("Not found", { status: 404 });
            const imgRes = await fetch(info.imageUrl);
            return new Response(imgRes.body, { headers: { "Content-Type": imgRes.headers.get("Content-Type") || "image/png", "Cache-Control": "public, max-age=86400" } });
        }

        // ── Script edit page ──
        const editMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)\/edit$/);
        if (editMatch && method === "GET") {
            const script = await getScript(env, editMatch[1]);
            if (!script) return new Response("Script not found", { status: 404 });
            const access = await canManageScript(request, env, script);
            if (!access.allowed) return new Response("Not authorized", { status: 403 });
            return new Response(buildEditHtml(script), { headers: { "Content-Type": "text/html; charset=utf-8" } });
        }

        // ── Script detail page (SSR for SEO) ──
        const detailMatch = path.match(/^\/scripts\/([a-zA-Z0-9-]+)$/);
        if (detailMatch && method === "GET") {
            const script = await prepareScriptForPage(env, detailMatch[1]);
            if (!script) return new Response("Script not found", { status: 404 });

            // Fetch profile + likes in parallel (non-blocking)
            const session = await getSession(request, env);
            const [profile, likeSummary] = await Promise.all([
                script.ownerSub ? getProfile(env, script.ownerSub).catch(() => null) : Promise.resolve(null),
                getLikeSummary(env, script.id, session?.sub || null).catch(() => ({ count: 0, liked: false })),
            ]);

            // Mark creator verified on the script object for gallery display
            if (profile?.verified) script.creatorVerified = true;

            const thumbnailUrl = script.placeId ? `/api/roblox-thumbnail?placeId=${encodeURIComponent(script.placeId)}` : null;

            if (ctx?.waitUntil) ctx.waitUntil(recordScriptView(env, script.id).catch(() => {}));

            return new Response(buildDetailHtml(script, thumbnailUrl, profile, likeSummary), {
                headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }
            });
        }

        // ── Scripts JSON API ──
        if (path.startsWith("/api/scripts")) {
            const resp = await handleScriptsApi(request, env, path);
            resp.headers.set("Access-Control-Allow-Origin", "*");
            return resp;
        }

        return new Response(SILK_ROAD_HTML, { headers: { "Content-Type": "text/html" } });
    }
};


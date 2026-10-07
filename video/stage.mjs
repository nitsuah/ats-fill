/**
 * Frame templates for the feature tour. Laid out on a 1920x1080 CSS canvas and
 * rendered at 2x device pixels, so the video is native 3840x2160. Visual
 * language mirrors the landing page and launch video (site/styles.css "Ledger"
 * tokens): warm paper, ink type, a vermilion stamp accent, Fraunces headings,
 * Instrument Sans body and IBM Plex Mono labels. Fonts are inlined as data URLs
 * so frames render offline.
 *
 * Every template exposes `window.pose(p)`; video/timeline.mjs computes one pose
 * per video frame (paper dip, title rise, camera, crossfades, cursor, stamp).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_DIR = path.join(ROOT, 'site/assets/fonts');

function font(family, file, weight, style = 'normal') {
  const data = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data}) format('woff2');font-weight:${weight};font-style:${style}}`;
}

let fontCss;
function fonts() {
  fontCss ??= [
    font('Fraunces', 'fraunces-wght.woff2', '300 900'),
    font('Fraunces', 'fraunces-wght-italic.woff2', '300 900', 'italic'),
    font('Instrument Sans', 'instrument-sans-wght.woff2', '400 700'),
    font('IBM Plex Mono', 'ibm-plex-mono-400.woff2', '400'),
    font('IBM Plex Mono', 'ibm-plex-mono-500.woff2', '500 700'),
  ].join('');
  return fontCss;
}

export const esc = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-5 12 12)"><rect x="3" y="3" width="18" height="18" rx="2.5" fill="#c4411a"/><path d="m7.5 12.5 3 3 6-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>';

const BASE_CSS = `
*{box-sizing:border-box;margin:0}
html,body{width:1920px;height:1080px;overflow:hidden}
body{background:#f4efe6 radial-gradient(#e2d9c8 1.2px,transparent 1.2px) 0 0/26px 26px;color:#1b2130;font-family:'Instrument Sans',sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.brand{position:absolute;left:72px;top:52px;display:flex;align-items:center;gap:14px;font-family:'Fraunces',serif;font-weight:650;font-size:34px;letter-spacing:-.02em}
.brand svg{width:42px;height:42px}
.mono{font-family:'IBM Plex Mono',monospace;font-weight:500;letter-spacing:.08em;text-transform:uppercase}
.top-right{position:absolute;right:72px;top:64px;font-size:19px;color:#686253}
.top-right b{color:#c4411a;font-weight:500}
h1,h2{font-family:'Fraunces',serif;font-weight:700;letter-spacing:-.03em;line-height:1.02}
.emph{font-style:italic;color:#c4411a;font-weight:600}
.dip{position:absolute;inset:0;z-index:50;background:inherit;opacity:0}
`;

// Cards (intro, chapter title, CTA): fade from paper while .rise items lift in, staggered.
const CARD_POSE = `window.pose=(p)=>{document.querySelector('.dip').style.opacity=p.dip;
document.querySelectorAll('.rise').forEach((el,i)=>{const u=Math.min(1,Math.max(0,p.rise*1.6-i*.12));
el.style.opacity=u;el.style.translate='0 '+((1-u)*34).toFixed(2)+'px';});};`;

function page(css, body, script = CARD_POSE) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts()}${BASE_CSS}${css}</style></head><body><div class="brand">${MARK}ats-fill</div>${body}<div class="dip"></div><script>${script}</script></body></html>`;
}

const CURSOR = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 3.5v22.2l6-5.6 3.9 9 4.2-1.8-3.9-8.9h8.3z" fill="#1b2130" stroke="#fffdf8" stroke-width="2.2" stroke-linejoin="round"/></svg>';

const SCENE_POSE = `{const $=(s)=>document.querySelector(s);
window.pose=(p)=>{
$('.dip').style.opacity=p.dip;
document.querySelectorAll('.shot,.url span,.cap').forEach((el)=>{el.style.opacity=0;});
p.shots.forEach((s,n)=>{const el=$('#shot-'+s.i);el.style.opacity=s.o;el.style.zIndex=1+n;
el.querySelector('img').style.transform='translate('+s.x+'px,'+s.y+'px) scale('+s.s+')';
$('#url-'+s.i).style.opacity=s.o;
const st=el.querySelector('.stamp');if(st){const u=s.st||0;st.style.opacity=Math.min(1,u*2.2);
st.style.transform='rotate(-8deg) scale('+(1+(1-u)*(1-u)*0.9).toFixed(3)+')';}});
for(const c of p.caps){const el=$('#cap-'+c.i);el.style.opacity=c.o;el.style.transform='translateY('+c.dy+'px)';}
const cur=$('.cursor'),ring=$('.ring');
if(!p.cur){cur.style.opacity=0;ring.style.opacity=0;return;}
cur.style.opacity=p.cur.o;cur.style.transform='translate('+p.cur.x+'px,'+p.cur.y+'px) scale('+(1-0.14*p.cur.p).toFixed(3)+')';
const g=p.cur.ring||0;
if(g>0){ring.style.opacity=(1-g).toFixed(3);ring.style.transform='translate('+p.cur.x+'px,'+p.cur.y+'px) scale('+(0.3+g*1.2).toFixed(3)+')';}
else{ring.style.opacity=0;}
};}`;

/**
 * One chapter's steps: product screenshots stacked in one browser window, with
 * the caption panel beside it. The window and panel stay put between steps;
 * only the screenshot, URL and caption crossfade, the camera zooms into each
 * step's focus area, and a cursor clicks through to the next step.
 */
export function sceneFrame({ chapter, chapterCount, chapterTitle, beats }) {
  const label = (n) => String(n).padStart(2, '0');
  const shots = beats.map((b, i) => `<div class="shot" id="shot-${i}"><img src="${b.shot}" alt="">${b.stamp ? `<div class="stamp">${esc(b.stamp)}</div>` : ''}</div>`).join('');
  const urls = beats.map((b, i) => `<span id="url-${i}">${esc(b.url)}</span>`).join('');
  const caps = beats.map((b, i) => {
    const dots = beats.map((_, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('');
    return `<div class="cap" id="cap-${i}"><div class="mono">Step ${i + 1} of ${beats.length}</div><h2>${esc(b.title)}</h2><p>${esc(b.body)}</p><div class="steps">${dots}</div></div>`;
  }).join('');
  return page(`
.window{position:absolute;left:72px;top:138px;width:1236px;border-radius:16px;overflow:hidden;background:#fffdf8;border:1px solid #c7baa2;box-shadow:8px 8px 0 #ded4c2,0 30px 70px -24px rgba(27,33,48,.35)}
.chrome{height:44px;display:flex;align-items:center;gap:9px;padding:0 18px;background:#efe8db;border-bottom:1px solid #ded4c2}
.chrome i{width:13px;height:13px;border-radius:50%;background:#c7baa2}
.url{position:relative;margin-left:16px;flex:1;height:28px;border-radius:8px;background:#fffdf8;border:1px solid #ded4c2;font:500 15px 'IBM Plex Mono',monospace;color:#686253;overflow:hidden}
.url span{position:absolute;left:14px;right:14px;top:0;bottom:0;display:flex;align-items:center;white-space:nowrap;opacity:0}
.view{position:relative;width:1236px;height:772px;overflow:hidden;background:#fffdf8}
.shot{position:absolute;inset:0;opacity:0;background:#fffdf8}
.shot img{position:absolute;left:0;top:0;width:1236px;height:772.5px;transform-origin:0 0}
.stamp{position:absolute;right:64px;top:52px;z-index:3;padding:6px 26px 8px 34px;border:6px solid #c4411a;border-radius:12px;color:#c4411a;background:rgba(255,253,248,.6);font:700 68px 'IBM Plex Mono',monospace;letter-spacing:.2em;text-transform:uppercase;opacity:0}
.cursor,.ring{position:absolute;left:0;top:0;z-index:20;opacity:0;pointer-events:none}
.cursor{width:40px;height:40px;transform-origin:0 0;filter:drop-shadow(0 4px 6px rgba(27,33,48,.28))}
.cursor svg{display:block;width:40px;height:40px;margin:-4px 0 0 -7px}
.ring{width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;border:4px solid #c4411a;background:rgba(196,65,26,.12)}
.panel{position:absolute;left:1376px;right:72px;top:0;bottom:0;display:grid;align-content:center}
.cap{grid-area:1/1;opacity:0}
.panel .mono{font-size:19px;color:#c4411a}
.panel h2{font-size:60px;margin-top:22px}
.panel p{font-size:28px;line-height:1.45;color:#3f4656;margin-top:26px}
.steps{display:flex;gap:10px;margin-top:40px}
.steps i{width:46px;height:6px;border-radius:3px;background:#ded4c2}
.steps i.on{background:#c4411a}
`, `
<div class="top-right mono"><b>${label(chapter)}</b> / ${label(chapterCount)} · ${esc(chapterTitle)}</div>
<div class="window"><div class="chrome"><i></i><i></i><i></i><div class="url">${urls}</div></div><div class="view">${shots}<div class="ring"></div><div class="cursor">${CURSOR}</div></div></div>
<div class="panel">${caps}</div>`, SCENE_POSE);
}

/** Chapter title card: big number, title, summary and the chapter list. */
export function titleFrame({ chapter, chapters, title, summary }) {
  const list = chapters.map((name, i) => `<li class="${i + 1 === chapter ? 'on' : ''}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(name)}</li>`).join('');
  return page(`
.wrap{position:absolute;left:160px;top:0;bottom:0;width:1020px;display:flex;flex-direction:column;justify-content:center}
.num{font:500 30px 'IBM Plex Mono',monospace;color:#c4411a;letter-spacing:.1em}
h1{font-size:118px;margin-top:22px}
.wrap p{font-size:36px;color:#3f4656;margin-top:30px;line-height:1.35}
.rule{width:220px;height:5px;background:#c4411a;margin-top:46px}
ol{position:absolute;right:120px;top:50%;transform:translateY(-50%);list-style:none;padding:28px 34px;background:#fffdf8;border:1px solid #ded4c2;border-radius:16px;box-shadow:6px 6px 0 #ded4c2;width:520px}
ol li{font-size:25px;color:#686253;padding:11px 0;display:flex;gap:18px;align-items:baseline}
ol li+li{border-top:1px dashed #ded4c2}
ol li span{font:500 18px 'IBM Plex Mono',monospace;color:#a69c88}
ol li.on{color:#1b2130;font-weight:600}
ol li.on span{color:#c4411a}
`, `
<div class="wrap"><div class="num rise">CHAPTER ${String(chapter).padStart(2, '0')}</div><h1 class="rise">${esc(title)}</h1><p class="rise">${esc(summary)}</p><div class="rule rise"></div></div>
<ol class="rise">${list}</ol>`);
}

/** Opening card for the combined cut. */
export function introFrame({ kicker, title, body, shot }) {
  return page(`
.wrap{position:absolute;left:120px;top:0;bottom:0;width:860px;display:flex;flex-direction:column;justify-content:center}
.wrap .mono{font-size:22px;color:#686253;display:flex;align-items:center;gap:14px}
.wrap .mono:before{content:'';width:12px;height:12px;background:#c4411a;transform:rotate(45deg)}
h1{font-size:100px;margin-top:28px}
.tag{font-family:'Fraunces',serif;font-style:italic;font-weight:600;font-size:52px;color:#c4411a;margin-top:22px;letter-spacing:-.02em}
.wrap p{font-size:30px;line-height:1.45;color:#3f4656;margin-top:30px}
.shot{position:absolute;right:-90px;top:170px;width:960px;border-radius:16px;overflow:hidden;border:1px solid #c7baa2;box-shadow:8px 8px 0 #ded4c2,0 30px 70px -24px rgba(27,33,48,.35);transform:rotate(-1.5deg)}
.shot img{display:block;width:100%}
`, `
<div class="wrap"><div class="mono rise">${esc(kicker)}</div><h1 class="rise">${esc(title)}</h1><div class="tag rise">Fill the form. Keep the receipts.</div><p class="rise">${esc(body)}</p></div>
<div class="shot rise"><img src="${shot}" alt=""></div>`);
}

/** Closing call to action with the Chrome Web Store listing. */
export function outroFrame({ kicker, title, body, storeUrl, repoUrl, siteUrl }) {
  const short = (u) => u.replace(/^https:\/\//, '').replace(/\/$/, '');
  return page(`
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.wrap .mono{font-size:22px;color:#c4411a}
h1{font-size:128px;margin-top:24px}
.wrap>p{font-size:34px;color:#3f4656;margin-top:28px;max-width:1240px;line-height:1.4}
.cta{margin-top:54px;display:inline-flex;align-items:center;gap:18px;padding:26px 46px;border-radius:16px;background:#c4411a;color:#fff;font-size:40px;font-weight:600;border:2px solid #a3350f;box-shadow:6px 6px 0 #a3350f}
.cta svg{width:46px;height:46px}
.links{margin-top:46px;display:flex;flex-direction:column;gap:12px;font:500 24px 'IBM Plex Mono',monospace;color:#3f4656;text-align:left}
.links b{color:#c4411a;font-weight:500;display:inline-block;width:150px;text-align:right;margin-right:18px}
`, `
<div class="wrap"><div class="mono rise">${esc(kicker)}</div><h1 class="rise">${esc(title)}</h1><p class="rise">${esc(body)}</p>
<div class="cta rise"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#fff"/><path d="M12 8h9M8.5 14 4 6.2M15.5 14 11 21.8" fill="none" stroke="#fff" stroke-width="2"/></svg>Add to Chrome. It’s free.</div>
<div class="links rise"><div><b>STORE</b>${esc(short(storeUrl))}</div><div><b>WEBSITE</b>${esc(short(siteUrl))}</div><div><b>SOURCE</b>${esc(short(repoUrl))}</div></div></div>`);
}

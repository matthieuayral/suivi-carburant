// Recadrage de ticket : détection automatique des 4 coins, ajustement au doigt, redressement.
// Sans dépendance externe. Pensé pour un ticket clair sur fond sombre (siège, tableau de bord).

const OUT_MAX = 2000;   // plus grand côté de l'image finale (px)
const SRC_MAX = 2600;   // plus grand côté de l'image de travail (px)
const DET_MAX = 400;    // résolution de détection (px)

/* ---------- Détection ---------- */

export function detectQuad(src) {
  const w0 = src.width, h0 = src.height;
  const k = DET_MAX / Math.max(w0, h0);
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;

  // "Blancheur" = min(R,G,B) : élevé pour le papier blanc, faible pour le sombre ou le coloré.
  const v = new Uint8Array(w * h), hist = new Array(256).fill(0);
  for (let i = 0, p = 0; p < w * h; i += 4, p++) {
    const m = Math.min(d[i], d[i + 1], d[i + 2]); v[p] = m; hist[m]++;
  }
  const t = otsu(hist, w * h);
  let mask = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) mask[p] = v[p] > t ? 1 : 0;
  mask = close(mask, w, h, 2);   // bouche les trous du texte imprimé
  mask = open(mask, w, h, 1);    // supprime les petits reflets

  const comp = largestComponent(mask, w, h);
  const fallback = defaultQuad(w0, h0);
  if (!comp || comp.area < 0.03 * w * h) return { quad: fallback, found: false };

  // Points de bord (extrêmes gauche/droite par ligne, haut/bas par colonne)
  const pts = [];
  for (let y = 0; y < h; y++) {
    let a = -1, b = -1;
    for (let x = 0; x < w; x++) if (comp.lab[y * w + x]) { if (a < 0) a = x; b = x; }
    if (a >= 0) { pts.push([a, y], [b + 1, y]); }
  }
  for (let x = 0; x < w; x++) {
    let a = -1, b = -1;
    for (let y = 0; y < h; y++) if (comp.lab[y * w + x]) { if (a < 0) a = y; b = y; }
    if (a >= 0) { pts.push([x, a], [x, b + 1]); }
  }
  let hull = convexHull(pts);
  if (hull.length < 4) return { quad: fallback, found: false };
  let quad = hullToQuad(hull);
  quad = quad.map(([x, y]) => [clamp(x / k, 0, w0), clamp(y / k, 0, h0)]);
  return { quad: orderQuad(quad), found: true };
}

function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; t = i; }
  }
  return t;
}

function morph(m, w, h, r, dilate) {
  // Passe séparable horizontale puis verticale (carré de côté 2r+1)
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let val = dilate ? 0 : 1;
    for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx; const s = xx < 0 || xx >= w ? 0 : m[y * w + xx];
      if (dilate ? s : !s) { val = dilate ? 1 : 0; break; }
    }
    tmp[y * w + x] = val;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let val = dilate ? 0 : 1;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy; const s = yy < 0 || yy >= h ? 0 : tmp[yy * w + x];
      if (dilate ? s : !s) { val = dilate ? 1 : 0; break; }
    }
    out[y * w + x] = val;
  }
  return out;
}
const close = (m, w, h, r) => morph(morph(m, w, h, r, true), w, h, r, false);
const open = (m, w, h, r) => morph(morph(m, w, h, r, false), w, h, r, true);

function largestComponent(m, w, h) {
  const seen = new Int32Array(w * h); let id = 0, bestId = 0, bestArea = 0;
  const stack = new Int32Array(w * h);
  for (let p = 0; p < w * h; p++) {
    if (!m[p] || seen[p]) continue;
    id++; let sp = 0, area = 0; stack[sp++] = p; seen[p] = id;
    while (sp) {
      const q = stack[--sp]; area++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && m[q - 1] && !seen[q - 1]) { seen[q - 1] = id; stack[sp++] = q - 1; }
      if (x < w - 1 && m[q + 1] && !seen[q + 1]) { seen[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && m[q - w] && !seen[q - w]) { seen[q - w] = id; stack[sp++] = q - w; }
      if (y < h - 1 && m[q + w] && !seen[q + w]) { seen[q + w] = id; stack[sp++] = q + w; }
    }
    if (area > bestArea) { bestArea = area; bestId = id; }
  }
  if (!bestId) return null;
  const lab = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) lab[p] = seen[p] === bestId ? 1 : 0;
  return { lab, area: bestArea };
}

function convexHull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop(); return lo.concat(up);
}

// Réduit l'enveloppe convexe à 4 sommets : on retire à chaque fois le sommet
// dont la suppression ajoute le moins de surface, en prolongeant les côtés voisins
// (ainsi le quadrilatère englobe le ticket au lieu de rogner ses coins).
function hullToQuad(hull) {
  let P = hull.slice();
  const area = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
  const inter = (p1, p2, p3, p4) => {
    const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]);
    if (Math.abs(d) < 1e-9) return null;
    const a = p1[0] * p2[1] - p1[1] * p2[0], b = p3[0] * p4[1] - p3[1] * p4[0];
    return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d];
  };
  while (P.length > 4) {
    const n = P.length; let best = null;
    for (let i = 0; i < n; i++) {
      // Supprimer le côté (i, i+1) : ses deux sommets sont remplacés par l'intersection des côtés voisins
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n], e = P[(i + 2) % n];
      const x = inter(a, b, c, e);
      if (!x) continue;
      // L'intersection doit être à l'extérieur du côté supprimé, sinon ce côté n'est pas supprimable
      const g = P.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
      const side = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (side(b, c, x) * side(b, c, g) >= 0) continue;
      const add = area([b, x, c]);
      if (!best || add < best.add) best = { i, x, add };
    }
    if (!best || best.add > 1e9) { // repli : suppression simple du sommet le moins utile
      let mi = 0, ma = Infinity;
      for (let i = 0; i < n; i++) { const t = area([P[(i - 1 + n) % n], P[i], P[(i + 1) % n]]); if (t < ma) { ma = t; mi = i; } }
      P.splice(mi, 1); continue;
    }
    const i = best.i, j = (i + 1) % n;
    if (j === 0) { P.splice(i, 1); P[0] = best.x; } else { P.splice(i, 2, best.x); }
  }
  return P;
}

function orderQuad(q) {
  // Ordre : haut-gauche, haut-droit, bas-droit, bas-gauche
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  q = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let s = 0; for (let i = 1; i < 4; i++) if (q[i][0] + q[i][1] < q[s][0] + q[s][1]) s = i;
  return [0, 1, 2, 3].map(i => q[(s + i) % 4]);
}
function defaultQuad(w, h) { const mx = w * 0.12, my = h * 0.12; return [[mx, my], [w - mx, my], [w - mx, h - my], [mx, h - my]]; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/* ---------- Redressement (homographie) ---------- */

function homography(from, to) {
  // Résout H (8 inconnues) tel que H·from[i] ≈ to[i]
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i], [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [B[c], B[piv]] = [B[piv], B[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue; const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c];
    }
  }
  return B.map((b, i) => b / A[i][i]).concat(1);
}

// quad ordonné [c0,c1,c2,c3] ; rot = 0..3 décale le coin qui devient "haut-gauche"
export function warp(src, quad, rot = 0, maxSide = OUT_MAX) {
  const q = [0, 1, 2, 3].map(i => quad[(i + rot) % 4]);
  let W = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  let H = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const s = Math.min(1, maxSide / Math.max(W, H));
  W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));
  const M = homography([[0, 0], [W, 0], [W, H], [0, H]], q);

  const sc = document.createElement("canvas"); sc.width = src.width; sc.height = src.height;
  const sctx = sc.getContext("2d", { willReadFrequently: true }); sctx.drawImage(src, 0, 0);
  const sd = sctx.getImageData(0, 0, sc.width, sc.height).data, sw = sc.width, sh = sc.height;
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const octx = out.getContext("2d"); const od = octx.createImageData(W, H); const o = od.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const z = M[6] * x + M[7] * y + 1;
    const fx = (M[0] * x + M[1] * y + M[2]) / z, fy = (M[3] * x + M[4] * y + M[5]) / z;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const oi = (y * W + x) * 4;
    if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { o[oi] = o[oi + 1] = o[oi + 2] = 255; o[oi + 3] = 255; continue; }
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let ch = 0; ch < 3; ch++)
      o[oi + ch] = (sd[i00 + ch] * (1 - ax) + sd[i10 + ch] * ax) * (1 - ay) + (sd[i01 + ch] * (1 - ax) + sd[i11 + ch] * ax) * ay;
    o[oi + 3] = 255;
  }
  octx.putImageData(od, 0, 0);
  return out;
}

/* ---------- Chargement ---------- */

export async function loadImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch { bmp = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); }); }
  const k = Math.min(1, SRC_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/* ---------- Interface ---------- */

const CSS = `
#tc{position:fixed;inset:0;z-index:9999;background:#000;display:flex;flex-direction:column;touch-action:none;user-select:none;-webkit-user-select:none}
#tc .tc-top{color:#fff;font:600 15px system-ui,sans-serif;padding:10px 14px;padding-top:max(10px,env(safe-area-inset-top))}
#tc .tc-top small{display:block;font-weight:400;color:#bbb;margin-top:2px}
#tc .tc-stage{flex:1;position:relative;overflow:hidden}
#tc canvas.tc-main{position:absolute;left:0;top:0}
#tc .tc-prev{position:absolute;right:8px;bottom:8px;max-width:28%;max-height:45%;border:2px solid #fff;border-radius:6px;background:#fff;box-shadow:0 2px 10px #0008}
#tc .tc-bar{display:grid;grid-template-columns:1fr 1fr 1fr 1.3fr;gap:8px;padding:10px;padding-bottom:max(10px,env(safe-area-inset-bottom))}
#tc .tc-bar button{margin:0;padding:12px 4px;font:700 15px system-ui,sans-serif;border-radius:8px;border:0;background:#333;color:#fff}
#tc .tc-bar button.ok{background:#1e6bff}
`;

// Ouvre l'écran de recadrage. Renvoie un File JPEG recadré, le fichier d'origine ("Photo entière"),
// ou null si l'utilisateur annule.
export async function cropTicket(file) {
  if (!file || !file.type.startsWith("image/")) return file;
  const src = await loadImage(file);
  const det = detectQuad(src);
  let quad = det.quad, rot = 0;
  // Orientation par défaut : ticket en portrait (côté court en haut)
  if (dist(quad[0], quad[1]) > dist(quad[0], quad[3])) rot = 1;

  if (!document.getElementById("tc-style")) { const st = document.createElement("style"); st.id = "tc-style"; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement("div"); root.id = "tc";
  root.innerHTML = `<div class="tc-top">Ajuste les coins sur le ticket<small>${det.found ? "Ticket détecté — vérifie les 4 coins" : "Ticket non détecté — place les 4 coins à la main"}</small></div>
    <div class="tc-stage"><canvas class="tc-main"></canvas><img class="tc-prev" alt=""></div>
    <div class="tc-bar"><button data-a="cancel">Annuler</button><button data-a="full">Photo entière</button><button data-a="rot">↻ Pivoter</button><button data-a="ok" class="ok">Valider</button></div>`;
  document.body.appendChild(root);
  const stage = root.querySelector(".tc-stage"), cv = root.querySelector("canvas"), prev = root.querySelector(".tc-prev");
  const ctx = cv.getContext("2d");
  let scale = 1, ox = 0, oy = 0, dpr = 1, drag = -1, lastPt = null;

  function layout() {
    dpr = window.devicePixelRatio || 1;
    const W = stage.clientWidth, H = stage.clientHeight;
    scale = Math.min(W / src.width, H / src.height) * 0.94;
    const dw = src.width * scale, dh = src.height * scale;
    ox = (W - dw) / 2; oy = (H - dh) / 2;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    draw();
  }
  const toScreen = p => [ox + p[0] * scale, oy + p[1] * scale];
  const toImage = (x, y) => [clamp((x - ox) / scale, 0, src.width), clamp((y - oy) / scale, 0, src.height)];

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, ox, oy, src.width * scale, src.height * scale);
    const s = quad.map(toScreen);
    // Assombrit l'extérieur du ticket
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height);
    ctx.moveTo(...s[0]); for (let i = 3; i >= 0; i--) ctx.lineTo(...s[i]); ctx.closePath();
    ctx.fillStyle = "rgba(0,0,0,.45)"; ctx.fill("evenodd"); ctx.restore();
    ctx.beginPath(); ctx.moveTo(...s[0]); for (let i = 1; i < 4; i++) ctx.lineTo(...s[i]); ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = "#1e90ff"; ctx.stroke();
    ctx.fillStyle = "rgba(30,144,255,.12)"; ctx.fill();
    // Bord "haut" du résultat en surbrillance
    const t0 = s[rot % 4], t1 = s[(rot + 1) % 4];
    ctx.beginPath(); ctx.moveTo(...t0); ctx.lineTo(...t1); ctx.lineWidth = 6; ctx.strokeStyle = "#ffd400"; ctx.stroke();
    for (const p of s) { ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, 7); ctx.fillStyle = "rgba(30,144,255,.35)"; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke(); }
    if (drag >= 0 && lastPt) loupe(s[drag]);
  }
  function loupe(p) {
    const R = 60, Z = 2.5, cx = p[0] < stage.clientWidth / 2 ? stage.clientWidth - R - 12 : R + 12, cy = R + 12;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    ctx.fillStyle = "#000"; ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const ip = quad[drag], ss = scale * Z;
    ctx.drawImage(src, cx - ip[0] * ss, cy - ip[1] * ss, src.width * ss, src.height * ss);
    ctx.strokeStyle = "#1e90ff"; ctx.lineWidth = 2; ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy); ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14); ctx.stroke();
    ctx.restore(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.stroke();
  }
  let prevTimer = 0;
  function updatePreview() {
    clearTimeout(prevTimer);
    prevTimer = setTimeout(() => { prev.src = warp(src, quad, rot, 360).toDataURL("image/jpeg", 0.7); }, 60);
  }

  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener("pointerdown", e => {
    const [x, y] = pos(e); const s = quad.map(toScreen);
    let bi = -1, bd = 48; s.forEach((p, i) => { const dd = Math.hypot(p[0] - x, p[1] - y); if (dd < bd) { bd = dd; bi = i; } });
    if (bi < 0) return;
    drag = bi; lastPt = [x, y]; cv.setPointerCapture(e.pointerId); draw();
  });
  cv.addEventListener("pointermove", e => {
    if (drag < 0) return; const [x, y] = pos(e);
    const s = toScreen(quad[drag]);
    const p = toImage(s[0] + x - lastPt[0], s[1] + y - lastPt[1]); // déplacement relatif : le doigt ne masque pas le coin
    quad[drag] = p; lastPt = [x, y]; draw();
  });
  const end = () => { if (drag < 0) return; drag = -1; lastPt = null; draw(); updatePreview(); };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  const onResize = () => layout(); window.addEventListener("resize", onResize);

  layout(); updatePreview();

  return new Promise(resolve => {
    root.querySelector(".tc-bar").addEventListener("click", async e => {
      const a = e.target.dataset?.a; if (!a) return;
      if (a === "rot") { rot = (rot + 1) % 4; draw(); updatePreview(); return; }
      let result = null;
      if (a === "full") result = file;
      if (a === "ok") {
        e.target.textContent = "…";
        await new Promise(r => setTimeout(r, 20));
        const out = warp(src, quad, rot);
        const blob = await new Promise(r => out.toBlob(r, "image/jpeg", 0.88));
        result = new File([blob], "ticket.jpg", { type: "image/jpeg" });
      }
      window.removeEventListener("resize", onResize); root.remove(); resolve(result);
    });
  });
}

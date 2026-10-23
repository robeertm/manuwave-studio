// Manuwave Studio 3.27 — Equalizer im Mastering: Kurve aller Filter über dem Spektrum des Tracks, Bänder als ziehbare
// Punkte, darunter die Bandliste zum genauen Eintippen. Rechnet NICHTS selbst: die Kurve kommt aus genau den
// BiquadFilterNodes, die auch klingen (eqNodes → getFrequencyResponse), die Bänder leben in m.eq (mastering.js).
import { EQ_TYPES, EQ_MAX, EQ_F, EQ_G, EQ_Q, eqNodes } from "./mastering.js";

const N = 256, F_LO = EQ_F[0], F_HI = EQ_F[1], G_SPAN = 15;               // Anzeige ±15 dB
export const EQ_NAMEN = { lc: "Tiefschnitt", ls: "Bass-Kuhschwanz", pk: "Glocke", hs: "Höhen-Kuhschwanz", hc: "Höhenschnitt" };
const FREQS = new Float32Array(N).map((_, i) => F_LO * Math.pow(F_HI / F_LO, i / (N - 1)));
const fx = (f, w) => Math.log(f / F_LO) / Math.log(F_HI / F_LO) * w;
const xf = (x, w) => F_LO * Math.pow(F_HI / F_LO, Math.max(0, Math.min(1, x / w)));
const gy = (g, h) => h / 2 - g / G_SPAN * (h / 2 - 10);
const yg = (y, h) => (h / 2 - y) / (h / 2 - 10) * G_SPAN;
const rund = (f) => f < 100 ? Math.round(f) : f < 1000 ? Math.round(f / 5) * 5 : Math.round(f / 50) * 50;
const fTxt = (f) => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1).replace(".", window.MWS_LANG === "en" ? "." : ",") + " kHz" : Math.round(f) + " Hz";

let ctx0 = null;
const ctx = () => ctx0 || (ctx0 = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 48000));

// Gesamtantwort in dB auf FREQS — Produkt der Beträge aller Filter der Kette
export function eqResponse(m) {
  const n = eqNodes(ctx(), m), mag = new Float32Array(N).fill(1), one = new Float32Array(N), ph = new Float32Array(N);
  for (const f of n.all) { f.getFrequencyResponse(FREQS, one, ph); for (let i = 0; i < N; i++) mag[i] *= one[i]; }
  return Array.from(mag, (v) => 20 * Math.log10(Math.max(v, 1e-6)));
}

// Gemitteltes Spektrum des Tracks (Mono, 60 Fenster à 8192) auf FREQS, in dB relativ zum Maximum
export function spektrum(buf) {
  const L = 8192, chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const fenster = 60, schritt = Math.max(L, Math.floor((buf.length - L) / fenster)), acc = new Float64Array(L / 2);
  const re = new Float64Array(L), im = new Float64Array(L), hann = new Float64Array(L).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (L - 1)));
  let k = 0;
  for (let s = 0; s + L <= buf.length && k < fenster; s += schritt, k++) {
    for (let i = 0; i < L; i++) { let v = 0; for (const d of chs) v += d[s + i]; re[i] = v / chs.length * hann[i]; im[i] = 0; }
    fft(re, im);
    for (let i = 0; i < L / 2; i++) acc[i] += re[i] * re[i] + im[i] * im[i];
  }
  const sr = buf.sampleRate, out = new Array(N);
  for (let i = 0; i < N; i++) {                       // 1/6 Oktave um jede Anzeigefrequenz mitteln
    const a = Math.max(1, Math.floor(FREQS[i] / Math.pow(2, 1 / 12) / sr * L)), b = Math.min(L / 2 - 1, Math.ceil(FREQS[i] * Math.pow(2, 1 / 12) / sr * L));
    let s = 0, n = 0; for (let j = a; j <= b; j++) { s += acc[j]; n++; }
    out[i] = 10 * Math.log10(Math.max(s / Math.max(1, n), 1e-20));
  }
  const max = Math.max(...out);
  return out.map((v) => v - max);
}
function fft(re, im) {                                 // radix-2, an Ort und Stelle
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = -2 * Math.PI / len, wr = Math.cos(w), wi = Math.sin(w);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Das Bedienteil. getM() liefert die aktuellen Einstellungen (m.eq wird an Ort und Stelle geändert),
// vorher() vor jeder Änderung (Rückgängig), geaendert() danach (speichern + neu rechnen).
export function eqWidget({ canvas, liste, getM, getBuf, vorher, geaendert, T = (s) => s }) {
  let spek = null, spekFuer = null, drag = -1;
  const bands = () => { const m = getM(); if (!m) return []; if (!Array.isArray(m.eq)) m.eq = []; return m.eq; };
  const punkt = (b, w, h) => [fx(b.f, w), b.t === "lc" || b.t === "hc" ? h / 2 : gy(b.g || 0, h)];

  function zeichnen() {
    const m = getM(), dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600, h = canvas.clientHeight || 200;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const c = canvas.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas), akzent = css.getPropertyValue("--neon").trim() || "#22d3ee";
    c.font = "11px system-ui"; c.fillStyle = "rgba(255,255,255,.35)"; c.strokeStyle = "rgba(255,255,255,.08)"; c.lineWidth = 1;
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { const x = fx(f, w); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); c.fillText(fTxt(f).replace(" ", ""), x + 3, h - 4); }
    for (const g of [-12, -6, 0, 6, 12]) { const y = gy(g, h); c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.strokeStyle = g ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.22)"; c.stroke(); c.fillText((g > 0 ? "+" : "") + g, 3, y - 2); }
    const buf = getBuf && getBuf();
    if (buf && spekFuer !== buf) { spekFuer = buf; spek = null; setTimeout(() => { if (spekFuer === buf) { spek = spektrum(buf); zeichnen(); } }, 30); }
    if (spek) {                                         // Spektrum: oberste 60 dB über die untere Hälfte
      c.beginPath(); c.moveTo(0, h);
      for (let i = 0; i < N; i++) c.lineTo(i / (N - 1) * w, h - Math.max(0, (spek[i] + 60) / 60) * (h * 0.55));
      c.lineTo(w, h); c.closePath(); c.fillStyle = "rgba(255,255,255,.07)"; c.fill();
    }
    if (!m) return;
    const r = eqResponse(m);
    c.beginPath(); for (let i = 0; i < N; i++) { const x = i / (N - 1) * w, y = gy(Math.max(-G_SPAN, Math.min(G_SPAN, r[i])), h); i ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = akzent; c.lineWidth = 2.2; c.stroke();
    bands().forEach((b, i) => {
      const [x, y] = punkt(b, w, h);
      c.beginPath(); c.arc(x, y, i === drag ? 9 : 7.5, 0, 2 * Math.PI); c.fillStyle = akzent; c.fill();
      c.fillStyle = "#06121a"; c.font = "bold 10px system-ui"; c.textAlign = "center"; c.fillText(String(i + 1), x, y + 3.5); c.textAlign = "start";
    });
    canvas.dataset.bands = String(bands().length);
    canvas.dataset.kurve = r.filter((_, i) => i % 32 === 0).map((v) => v.toFixed(2)).join(",");   // für den Prüfstand
  }

  function zeile(b, i) {
    const opt = Object.keys(EQ_TYPES).map((t) => `<option value="${t}"${t === b.t ? " selected" : ""}>${T(EQ_NAMEN[t])}</option>`).join("");
    const mitG = b.t !== "lc" && b.t !== "hc", mitQ = b.t === "pk";
    return `<div class="ms-eq-band" data-i="${i}"><b>${i + 1}</b>
      <select data-k="t" aria-label="${T("Bandtyp")}">${opt}</select>
      <label>${T("Frequenz")}<input data-k="f" type="number" min="${EQ_F[0]}" max="${EQ_F[1]}" step="1" value="${Math.round(b.f)}"><span>Hz</span></label>
      ${mitG ? `<label>${T("Pegel")}<input data-k="g" type="number" min="${EQ_G[0]}" max="${EQ_G[1]}" step="0.5" value="${(b.g || 0).toFixed(1)}"><span>dB</span></label>` : ""}
      ${mitQ ? `<label>${T("Breite")} Q<input data-k="q" type="number" min="${EQ_Q[0]}" max="${EQ_Q[1]}" step="0.1" value="${(b.q || 1).toFixed(2)}"></label>` : ""}
      <button type="button" class="ghost btn-s" data-weg aria-label="${T("Band entfernen")}">✕</button></div>`;
  }
  function liste_zeichnen() {
    liste.innerHTML = bands().map(zeile).join("");
  }
  function alles() { liste_zeichnen(); zeichnen(); }

  liste.addEventListener("change", (e) => {
    const row = e.target.closest(".ms-eq-band"); if (!row) return;
    const b = bands()[+row.dataset.i], k = e.target.dataset.k; if (!b || !k) return;
    vorher(true);
    if (k === "t") { b.t = e.target.value; if (b.t === "pk" && !b.q) b.q = 1; if ((b.t === "lc" || b.t === "hc")) delete b.g; else if (b.g == null) b.g = 0; }
    else { const v = +e.target.value; if (!isFinite(v)) return;
      b[k] = k === "f" ? Math.max(EQ_F[0], Math.min(EQ_F[1], v)) : k === "g" ? Math.max(EQ_G[0], Math.min(EQ_G[1], v)) : Math.max(EQ_Q[0], Math.min(EQ_Q[1], v)); }
    alles(); geaendert();
  });
  liste.addEventListener("click", (e) => {
    const x = e.target.closest("[data-weg]"); if (!x) return;
    vorher(true); bands().splice(+x.closest(".ms-eq-band").dataset.i, 1); alles(); geaendert();
  });

  const ort = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, r.width, r.height]; };
  const treffer = (x, y, w, h) => { let best = -1, bd = 16; bands().forEach((b, i) => { const [px, py] = punkt(b, w, h), d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = i; } }); return best; };
  canvas.addEventListener("pointerdown", (e) => {
    if (!getM()) return;
    const [x, y, w, h] = ort(e), i = treffer(x, y, w, h);
    if (i < 0) return;
    drag = i; vorher(true); canvas.setPointerCapture(e.pointerId); e.preventDefault(); zeichnen();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag < 0) { const [x, y, w, h] = ort(e); canvas.style.cursor = treffer(x, y, w, h) >= 0 ? "grab" : "crosshair"; return; }
    const [x, y, w, h] = ort(e), b = bands()[drag]; if (!b) return;
    b.f = rund(xf(x, w));
    if (b.t !== "lc" && b.t !== "hc") b.g = Math.round(Math.max(EQ_G[0], Math.min(EQ_G[1], yg(y, h))) * 2) / 2;
    zeichnen(); geaendert(false);
  });
  const los = () => { if (drag < 0) return; drag = -1; liste_zeichnen(); zeichnen(); geaendert(); };
  canvas.addEventListener("pointerup", los); canvas.addEventListener("pointercancel", los);
  canvas.addEventListener("wheel", (e) => {
    const [x, y, w, h] = ort(e), i = treffer(x, y, w, h), b = bands()[i];
    if (!b || b.t !== "pk") return;
    e.preventDefault(); vorher();
    b.q = Math.round(Math.max(EQ_Q[0], Math.min(EQ_Q[1], (b.q || 1) * Math.pow(1.1, -Math.sign(e.deltaY)))) * 100) / 100;
    alles(); geaendert();
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    if (!getM() || bands().length >= EQ_MAX) return;
    const [x, y, w, h] = ort(e);
    vorher(true);
    bands().push({ t: "pk", f: rund(xf(x, w)), g: Math.round(Math.max(EQ_G[0], Math.min(EQ_G[1], yg(y, h))) * 2) / 2, q: 1 });
    alles(); geaendert();
  });
  window.addEventListener("resize", () => zeichnen());
  return {
    zeichnen: alles,
    neu() { if (!getM() || bands().length >= EQ_MAX) return false; vorher(true); bands().push({ t: "pk", f: 1000, g: 0, q: 1 }); alles(); geaendert(); return true; },
    leeren() { if (!getM()) return; vorher(true); getM().eq = []; alles(); geaendert(); },
  };
}

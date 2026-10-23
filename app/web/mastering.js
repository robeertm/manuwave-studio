// =============================================================================
// Mastering-Kette (3.7) — EINE Rechnung für die Vorschau im Mastering-Tab UND die Wiedergabe in der Bibliothek.
// =============================================================================
//    Bis 3.6 spielte die Bibliothek immer die Rohfassung — die Regler wirkten nur in der Vorschau und im Export.
//    Jetzt rechnet diese Datei aus Original + Einstellungen die gemasterte Fassung; die Bibliothek legt sie am
// 🔑 Reihenfolge, Frequenzen und Güte = master_filters() der Brücke (ffmpeg rechnet dieselben RBJ-Biquads,
//    gemessen ≤ 0,005 dB): Schnitt → Bässe 100 Hz → Tonfarbe 300 Hz/3 kHz gegenläufig → Weich 3,5 kHz (Q 0,8)
//    → Höhen 8 kHz → Pegel → Ein-/Ausblenden (qsin) → Limiter −1,5 dB.
// 🔑 Offline gerechnet (OfflineAudioContext) und als WAV über <audio> gespielt: Safaris LIVE-Ausgabe von Web Audio

export const MASTER_DEFAULT = { bass: 0, tone: 0, treble: 0, soft: 2, fade_in: 0 };
export const MASTER_PRESETS = {
  weich: { bass: 0, tone: -1, treble: -1, soft: 3 },
  warm: { bass: 2, tone: -2.5, treble: -2, soft: 2 },
  hell: { bass: 0, tone: 1.5, treble: 2, soft: 1 },
  club: { bass: 3, tone: 0, treble: 1, soft: 1.5 },
  neutral: { bass: 0, tone: 0, treble: 0, soft: 0 },
  // 3.27: Startkurven aus der Mastering-Recherche (Tiefschnitt 4. Ordnung, kleine Bewegungen, Bass mono) —
  //       die Schnellregler stehen dabei auf 0, der Klang steckt im Equalizer. 3.28: dazu maßvolle Dynamik.
  fundament: { bass: 0, tone: 0, treble: 0, soft: 0, haerte: 4, zisch: 3, komp: 3, mono_bass: 120, breite: 100,
    eq: [{ t: "lc", f: 25 }, { t: "pk", f: 55, g: 3, q: 0.9 }, { t: "ls", f: 120, g: 2.5 }, { t: "pk", f: 300, g: -1.5, q: 1 },
      { t: "pk", f: 3200, g: -2, q: 1.2 }, { t: "hs", f: 9000, g: 2 }] },
  techno: { bass: 0, tone: 0, treble: 0, soft: 0, haerte: 3, komp: 4, mono_bass: 120, breite: 100,
    eq: [{ t: "lc", f: 28 }, { t: "pk", f: 55, g: 2, q: 1 }, { t: "pk", f: 250, g: -1.5, q: 1 }, { t: "pk", f: 3200, g: -1.5, q: 1.2 }, { t: "hs", f: 10000, g: 1.5 }] },
  trance: { bass: 0, tone: 0, treble: 0, soft: 0, haerte: 3, zisch: 2, komp: 3, mono_bass: 120, breite: 106,
    eq: [{ t: "lc", f: 25 }, { t: "pk", f: 60, g: 1.5, q: 1 }, { t: "pk", f: 350, g: -1.5, q: 0.9 }, { t: "pk", f: 2500, g: -1, q: 1.5 }, { t: "hs", f: 12000, g: 2 }] },
  deephouse: { bass: 0, tone: 0, treble: 0, soft: 0, haerte: 2, komp: 3, mono_bass: 100, breite: 100,
    eq: [{ t: "lc", f: 25 }, { t: "ls", f: 110, g: 2 }, { t: "pk", f: 400, g: -1, q: 1 }, { t: "pk", f: 3000, g: -1, q: 1 }, { t: "hs", f: 9000, g: 0.5 }] },
  vocalpop: { bass: 0, tone: 0, treble: 0, soft: 0, haerte: 3, zisch: 5, komp: 3, mono_bass: 0, breite: 100,
    eq: [{ t: "lc", f: 30 }, { t: "pk", f: 80, g: 1, q: 1 }, { t: "pk", f: 250, g: -2, q: 1.2 }, { t: "pk", f: 3000, g: 1, q: 1 }, { t: "hs", f: 10000, g: 2 }] },
};
// Grenzen wie MASTER_RANGES in der Brücke (die Regler im Tab haben dieselben)
export const MASTER_RANGES = { bass: [-12, 12], tone: [-6, 6], treble: [-12, 12], soft: [0, 8], gain: [-24, 12], fade_in: [0, 10], fade_out: [0, 15] };
export const MASTER_LIMIT_DB = -1.5, MASTER_TARGET_LUFS = -14;
// 3.27: Equalizer — bis zu 8 Bänder hinter den Schnellreglern. Typen = RBJ-Biquads, die Web Audio und ffmpeg gleich rechnen:
//   lc Tiefschnitt (highpass, Butterworth), ls Bass-Kuhschwanz (S=1), pk Glocke (Güte), hs Höhen-Kuhschwanz (S=1),
//   hc Höhenschnitt (lowpass, Butterworth). 🔑 Web Audio nimmt die Güte von Hoch-/Tiefpass in dB (20·log10 Q).
export const EQ_TYPES = { lc: "highpass", ls: "lowshelf", pk: "peaking", hs: "highshelf", hc: "lowpass" };
export const EQ_MAX = 8, EQ_F = [20, 20000], EQ_G = [-12, 12], EQ_Q = [0.3, 8];
// Hoch-/Tiefpass 4. Ordnung (24 dB/Oktave) = zwei Butterworth-Stufen; ffmpeg: zweimal highpass p=2 t=q mit diesen Q
export const EQ_BUTTER4 = [0.5411961, 1.3065630];
// 3.27: Mitte/Seite — Bass unter mono_bass Hz in Mono (Seite hochpassen, 4. Ordnung), Stereobreite = Seitenpegel in %
export const MONO_BASS = [60, 200], BREITE = [50, 150];
// Lautheitsziel: Streaming −14 (die großen Dienste), leise −16 (Dienste, die leiser normalisieren), Club −9 (keine Normalisierung)
export const ZIELE = { streaming: -14, leise: -16, club: -9 };
export function eqClean(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const b of raw.slice(0, EQ_MAX)) {
    if (!b || !EQ_TYPES[b.t] || typeof b.f !== "number" || !isFinite(b.f)) continue;
    const f = Math.round(Math.max(EQ_F[0], Math.min(EQ_F[1], b.f)));
    const g = (b.t === "lc" || b.t === "hc") ? 0 : Math.round(Math.max(EQ_G[0], Math.min(EQ_G[1], +b.g || 0)) * 10) / 10;
    const q = b.t === "pk" ? Math.round(Math.max(EQ_Q[0], Math.min(EQ_Q[1], +b.q || 1)) * 100) / 100 : undefined;
    if ((b.t === "pk" || b.t === "ls" || b.t === "hs") && g === 0) continue;   // ein Band ohne Wirkung ist keins
    out.push(q === undefined ? (g ? { t: b.t, f, g } : { t: b.t, f }) : { t: b.t, f, g, q });
  }
  return out;
}

export const dbGain = (db) => Math.pow(10, db / 20);
const Off = () => window.OfflineAudioContext || window.webkitOfflineAudioContext;

// Einstellungen in ihre Normalform: nur bekannte Regler, in ihren Grenzen, gerundet, feste Reihenfolge.
export function masterClean(m, dur = Infinity) {
  const out = {};
  if (!m || typeof m !== "object") return out;
  for (const k of ["bass", "tone", "treble", "soft", "fade_in", "fade_out", "gain"]) {
    const v = m[k];
    if (typeof v === "number" && isFinite(v)) { const [lo, hi] = MASTER_RANGES[k]; out[k] = Math.round(Math.max(lo, Math.min(hi, v)) * 100) / 100; }
  }
  const eq = eqClean(m.eq);
  if (eq.length) out.eq = eq;
  for (const k of DYN_KEYS) {                                    // 3.28: Dynamik-Stärken 0–10 in halben Schritten
    const v = m[k], r = typeof v === "number" && isFinite(v) ? Math.floor(Math.min(DYN_MAX, v) * 2 + 0.5) / 2 : 0;
    if (r > 0) out[k] = r;
  }
  if (typeof m.mono_bass === "number" && m.mono_bass >= MONO_BASS[0]) out.mono_bass = Math.round(Math.min(MONO_BASS[1], m.mono_bass));
  if (typeof m.breite === "number" && isFinite(m.breite) && Math.round(m.breite) !== 100) out.breite = Math.round(Math.max(BREITE[0], Math.min(BREITE[1], m.breite)));
  if (m.ziel && m.ziel !== "streaming" && ZIELE[m.ziel] != null) out.ziel = m.ziel;
  if (typeof m.start === "number" && m.start > 0.0005) out.start = Math.round(m.start * 1000) / 1000;
  if (typeof m.end === "number" && m.end > 0 && m.end < dur - 0.0005) out.end = Math.round(m.end * 1000) / 1000;
  return out;
}
// Woran man erkennt, ob eine gespeicherte gemasterte Fassung noch zum Track passt:
export function masterKey(master, rev, size) {
  return JSON.stringify([masterClean(master), rev || 0, size || 0]);
}

// Anfang/Ende des Ausschnitts (wie master_filters: mindestens 1 s, innerhalb des Tracks)
export function cutOf(m, dur) {
  const start = Math.max(0, Math.min((m && m.start) || 0, dur));
  const e = (m && m.end) || dur;
  return { start, end: Math.max(start + 1, Math.min(e, dur)) };
}

// Wo die Musik aufhört — gleiche Rechnung wie auto_end() in der Brücke (0,1-s-Blöcke, Median − 20 dB)
export function autoEnd(buf) {
  const sr = buf.sampleRate, blk = Math.round(sr * 0.1), n = Math.floor(buf.length / blk);
  if (n < 50) return null;
  const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  const dbs = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const d of chs) for (let k = i * blk, e = k + blk; k < e; k++) s += d[k] * d[k];
    dbs[i] = 20 * Math.log10(Math.max(Math.sqrt(s / (blk * chs.length)), 1 / 32768));
  }
  const med = [...dbs].sort((a, b) => a - b)[Math.floor(n / 2)];
  let last = -1; for (let i = n - 1; i >= 0; i--) if (dbs[i] > med - 20) { last = i; break; }
  if (last < 0) return null;
  const end = Math.min(buf.duration, (last + 1) * 0.1 + 0.3);
  return buf.duration - end < 0.5 ? null : [Math.round(end * 100) / 100, 1.0];
}
// Der Vorschlag für einen Track ohne eigene Einstellungen (= was der Mac ohne Regler exportiert).
export const PRESET_KEYS = ["bass", "tone", "treble", "soft", "fade_in", "fade_out", "eq", "mono_bass", "breite", "ziel", "haerte", "zisch", "komp"];
export function presetKlang(m) {
  const c = masterClean(m), out = {};
  for (const k of PRESET_KEYS) if (k in c) out[k] = c[k];
  return out;
}
export function masterDefault(buf, klang) {
  const k = klang && Object.keys(klang).length ? presetKlang(klang) : null;
  const m = k ? { bass: 0, tone: 0, treble: 0, soft: 0, fade_in: 0, ...k } : { ...MASTER_DEFAULT };
  const ae = buf && autoEnd(buf);
  if (ae) { m.end = ae[0]; if (!k || !("fade_out" in k)) m.fade_out = ae[1]; }
  return m;
}

// Audio dekodieren — ohne hörbaren Kontext (Safari kennt teils nur die Rückruf-Form)
export async function decodeAudio(bytes) {
  const O = Off();
  return await new Promise((res, rej) => {
    const p = new O(2, 1, 48000).decodeAudioData(bytes, res, rej);
    if (p && p.then) p.then(res, rej);
  });
}

// Die Klang-Kette als Web-Audio-Knoten (Reihenfolge = master_filters in der Brücke)
export function eqNodes(ctx, m) {
  const bq = (type, f, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; return b; };
  const n = { bass: bq("lowshelf", 100), toneLo: bq("lowshelf", 300), toneHi: bq("highshelf", 3000), soft: bq("peaking", 3500, 0.8), treble: bq("highshelf", 8000) };
  n.bass.connect(n.toneLo); n.toneLo.connect(n.toneHi); n.toneHi.connect(n.soft); n.soft.connect(n.treble);
  n.bass.gain.value = m.bass || 0; n.toneLo.gain.value = -(m.tone || 0) / 2; n.toneHi.gain.value = (m.tone || 0) / 2;
  n.soft.gain.value = -(m.soft || 0); n.treble.gain.value = m.treble || 0;
  n.input = n.bass; n.output = n.treble;
  n.all = [n.bass, n.toneLo, n.toneHi, n.soft, n.treble];      // alle Filter — die EQ-Kurve rechnet genau diese
  // 3.27: die EQ-Bänder dahinter (Reihenfolge = master_filters)
  for (const b of eqClean(m.eq)) {
    const stufen = (b.t === "lc" || b.t === "hc") ? EQ_BUTTER4 : [b.q];
    for (const q of stufen) {
      const f = ctx.createBiquadFilter(); f.type = EQ_TYPES[b.t]; f.frequency.value = b.f;
      if (b.t === "lc" || b.t === "hc") f.Q.value = 20 * Math.log10(q);          // Web Audio: Q von Hoch-/Tiefpass in dB
      else { f.gain.value = b.g; if (b.t === "pk") f.Q.value = q; }
      n.output.connect(f); n.output = f; n.all.push(f);
    }
  }
  // 3.27: Mitte/Seite — M=(L+R)/2, S=(L−R)/2, S hochpassen (Bass mono) und mit der Breite gewichten, L=M+S, R=M−S
  const mono = m.mono_bass >= MONO_BASS[0] ? m.mono_bass : 0, breite = m.breite ? m.breite / 100 : 1;
  if ((mono || breite !== 1) && ctx.destination.channelCount >= 2) {
    const sp = ctx.createChannelSplitter(2), mid = ctx.createGain(), side = ctx.createGain(), sMinus = ctx.createGain();
    const gl = ctx.createGain(), gr = ctx.createGain(), mg = ctx.createChannelMerger(2);
    const aL = ctx.createGain(), aR = ctx.createGain(); aL.gain.value = 0.5; aR.gain.value = 0.5; sMinus.gain.value = -0.5;
    const sL = ctx.createGain(); sL.gain.value = 0.5;
    n.output.connect(sp);
    sp.connect(aL, 0); sp.connect(aR, 1); aL.connect(mid); aR.connect(mid);            // M = (L+R)/2
    sp.connect(sL, 0); sp.connect(sMinus, 1); sL.connect(side); sMinus.connect(side);   // S = (L−R)/2
    let s = side;
    if (mono) for (const q of EQ_BUTTER4) { const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = mono; f.Q.value = 20 * Math.log10(q); s.connect(f); s = f; }
    const sw = ctx.createGain(), sn = ctx.createGain(); sw.gain.value = breite; sn.gain.value = -breite;
    s.connect(sw); s.connect(sn);
    mid.connect(gl); sw.connect(gl); mid.connect(gr); sn.connect(gr);                  // L = M + w·S, R = M − w·S
    gl.connect(mg, 0, 0); gr.connect(mg, 0, 1);
    n.output = mg;
  }
  return n;
}

// Lautheit nach EBU R128 (K-Bewertung, 400-ms-Blöcke, Schwellen −70 und −10) — nach dem Klang, vor Pegel und
// Limiter, über den Ausschnitt (wie measure_lufs in der Brücke)
export async function measureLufs(buf, m) {
  const sr = buf.sampleRate, { start, end } = cutOf(m, buf.duration);
  const len = Math.max(1, Math.round((end - start) * sr));
  const oc = new (Off())(buf.numberOfChannels, len, sr);
  const src = oc.createBufferSource(); src.buffer = buf;
  const eq = eqNodes(oc, m);
  const k1 = oc.createBiquadFilter(); k1.type = "highshelf"; k1.frequency.value = 1681.97; k1.gain.value = 4;
  const k2 = oc.createBiquadFilter(); k2.type = "highpass"; k2.frequency.value = 38.13; k2.Q.value = 20 * Math.log10(0.5003);   // Web Audio: Q in dB
  src.connect(eq.input); eq.output.connect(k1); k1.connect(k2); k2.connect(oc.destination);
  src.start(0, start);
  const out = await oc.startRendering();
  const blk = Math.round(sr * 0.4), hop = Math.round(sr * 0.1), zs = [];
  const chs = []; for (let c = 0; c < out.numberOfChannels; c++) chs.push(out.getChannelData(c));
  for (let i = 0; i + blk <= out.length; i += hop) {
    let z = 0; for (const d of chs) { let s = 0; for (let k = i; k < i + blk; k++) s += d[k] * d[k]; z += s / blk; }
    zs.push(z);
  }
  const L = (z) => -0.691 + 10 * Math.log10(Math.max(z, 1e-12));
  const g1 = zs.filter(z => L(z) > -70); if (!g1.length) return -70;
  const rel = L(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
  const g2 = g1.filter(z => L(z) > rel);
  return L(g2.reduce((a, b) => a + b, 0) / g2.length);
}
// Welche Messung zu welchen Einstellungen gehört (Pegel und Blenden ändern sie nicht)
export const lufsKey = (m, dur) => { const c = masterClean(m, dur), { start, end } = cutOf(c, dur);
  return JSON.stringify([c.bass || 0, c.tone || 0, c.treble || 0, c.soft || 0, c.eq || [], c.mono_bass || 0, c.breite || 100, start, end]); };
export const zielLufs = (ziel) => ZIELE[ziel] != null ? ZIELE[ziel] : MASTER_TARGET_LUFS;
export const autoGain = (lufs, ziel) => Math.max(MASTER_RANGES.gain[0], Math.min(MASTER_RANGES.gain[1], zielLufs(ziel) - lufs));

// =============================================================================
// 3.28: Dynamik — Kompressor (Zusammenhalt), dynamischer EQ gegen KI-Härte, De-Esser.
// =============================================================================
// 🔑 Alle drei sind derselbe Baustein: acompressor von ffmpeg, Zeile für Zeile nachgerechnet (Kern seit ffmpeg 5.1
//    unverändert — die Kunden haben 5.1 bis 9.x). ffmpegs adynamicequalizer/deesser rechnen je Version anders, darum
//    nicht genommen. Der dynamische EQ und der De-Esser drücken nur ein Band: out = x − Band + Kompressor(Band),
//    das Band ist ein RBJ-Bandpass (0 dB Spitze) — die Brücke baut dasselbe mit asplit/bandpass/amerge/pan.
// 🔑 Sitzt nach dem Pegel (die Schwellen stehen relativ zum Lautheitsziel, gleich für jeden Titel) und vor
//    Blenden und Limiter. Was die Dynamik an Lautheit nimmt, gleicht ein zweiter Pegel danach aus (gemessen).
export const DYN_KEYS = ["haerte", "zisch", "komp"], DYN_MAX = 10, DYN_AUSGLEICH = 6;
// Stärke 0–10 → Einstellungen. thr = Schwelle in dB über/unter dem Lautheitsziel; knee als Faktor wie ffmpeg (2,83 ≈ 9 dB)
export const DYN_STUFEN = {
  haerte: { f: 3200, q: 1.0, ratio: 3, knee: 2, att: 5, rel: 80, thr: (s) => -5 - 1.1 * s },
  zisch: { f: 7000, q: 1.4, ratio: 4, knee: 2, att: 1, rel: 40, thr: (s) => -7 - 1.0 * s },
  komp: { ratio: 2, knee: 2.82843, att: 30, rel: 250, thr: (s) => 4 - 1.2 * s },
};
export function dynStufen(m) {
  const z = zielLufs(m && m.ziel), out = [];
  for (const k of DYN_KEYS) {
    const s = m && m[k];
    if (!(s > 0)) continue;
    const d = DYN_STUFEN[k];
    out.push({ k, f: d.f, q: d.q, ratio: d.ratio, knee: d.knee, att: d.att, rel: d.rel,
      thr: Math.round(dbGain(Math.max(-59, Math.min(0, z + d.thr(s)))) * 1e6) / 1e6 });   // linear, 6 Stellen wie die Brücke
  }
  return out;
}
const hermite = (x, x0, x1, p0, p1, m0, m1) => {
  const w = x1 - x0, t = (x - x0) / w, t2 = t * t, t3 = t2 * t;
  m0 *= w; m1 *= w;
  return (2 * p0 + m0 - 2 * p1 + m1) * t3 + (-3 * p0 - 2 * m0 + 3 * p1 - m1) * t2 + m0 * t + p0;
};
// acompressor (detection=rms, link=average, makeup=1, mix=1) → Verstärkung je Sample
export function kompGain(sc, sr, p) {
  const thres = Math.log(p.thr), lks = p.thr / Math.sqrt(p.knee), lke = p.thr * Math.sqrt(p.knee);
  const ks = Math.log(lks), ke = Math.log(lke), delta = 1 / p.ratio;
  const cke = (ke - thres) / p.ratio + thres, ab = lks * lks;
  const att = Math.min(1, 1 / (p.att * sr / 4000)), rel = Math.min(1, 1 / (p.rel * sr / 4000));
  const n = sc[0].length, nc = sc.length, g = new Float64Array(n);
  let ls = 0;
  for (let i = 0; i < n; i++) {
    let a = 0; for (let c = 0; c < nc; c++) a += Math.abs(sc[c][i]);
    a /= nc; a *= a;
    ls += (a - ls) * (a > ls ? att : rel);
    if (ls > 0 && ls > ab) {
      const slope = Math.log(ls) * 0.5;
      let gain = (slope - thres) / p.ratio + thres;
      if (p.knee > 1 && slope < ke) gain = hermite(slope, ks, ke, ks, cke, 1, delta);
      g[i] = Math.exp(gain - slope);
    } else g[i] = 1;
  }
  return g;
}
export function bandpass(x, sr, f, q) {
  const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
  const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i], o = b0 * v + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = o; y[i] = o;
  }
  return y;
}
// Wendet die Dynamik auf einen AudioBuffer an (in place) → { haerte|zisch|komp: [Ø-Absenkung dB, stärkste dB] } oder null
export function dynamik(ab, m) {
  const st = dynStufen(m);
  if (!st.length) return null;
  const sr = ab.sampleRate, chs = [], res = {};
  for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
  for (const p of st) {
    const band = p.f ? chs.map(d => bandpass(d, sr, p.f, p.q)) : null;
    const g = kompGain(band || chs, sr, p);
    let sum = 0, min = 1;
    for (let i = 0; i < g.length; i++) { const v = g[i]; sum += v < 1 ? Math.log(v) : 0; if (v < min) min = v; }
    if (band) chs.forEach((d, c) => { const b = band[c]; for (let i = 0; i < d.length; i++) d[i] += b[i] * (g[i] - 1); });
    else for (const d of chs) for (let i = 0; i < d.length; i++) d[i] *= g[i];
    res[p.k] = [Math.round(20 / Math.LN10 * sum / Math.max(1, g.length) * 100) / 100, Math.round(20 * Math.log10(min) * 10) / 10];
  }
  return res;
}
// Ein-/Ausblenden wie ffmpeg afade curve=qsin (st/d auf ms gerundet wie in der Brücke, Samples gerundet wie av_rescale)
export function blenden(ab, fi, fo) {
  const sr = ab.sampleRate, n = ab.length, dur = n / sr, r3 = (x) => Math.round(x * 1000) / 1000;
  const g = (i) => {
    let v = 1;
    if (fi > 0) { const ns = Math.round(r3(Math.min(fi, dur / 2)) * sr); v *= Math.sin(Math.PI / 2 * Math.min(1, Math.max(0, i / ns))); }
    if (fo > 0) { const d = Math.min(fo, dur / 2), ns = Math.round(r3(d) * sr), st = Math.round(r3(dur - d) * sr);
      v *= Math.sin(Math.PI / 2 * Math.min(1, Math.max(0, (st + ns - i) / ns))); }
    return v;
  };
  if (!(fi > 0) && !(fo > 0)) return;
  const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
  for (let i = 0; i < n; i++) { const v = g(i); if (v !== 1) for (const d of chs) d[i] *= v; }
}

// Die gemasterte Fassung des Ausschnitts → AudioBuffer (+ .dyn: Absenkung je Dynamik-Stufe, .ausgleich: dB danach)
// 3.28: Klang und Pegel im Graphen, danach auf den Samples: Dynamik → Lautheitsausgleich → Blenden → Limiter.
//       `lufsVor` = Lautheit nach dem Pegel (gemessen + Pegel); ohne sie (Pegel von Hand) kein Ausgleich.
export async function renderMaster(buf, m, gainDb, lufsVor) {
  const sr = buf.sampleRate, { start, end } = cutOf(m, buf.duration);
  const len = Math.max(1, Math.round((end - start) * sr));
  const oc = new (Off())(buf.numberOfChannels, len, sr);
  const src = oc.createBufferSource(); src.buffer = buf;
  const n = eqNodes(oc, m);
  const gain = oc.createGain(); gain.gain.value = dbGain(gainDb);
  src.connect(n.input); n.output.connect(gain); gain.connect(oc.destination);
  src.start(0, start);
  const out = await oc.startRendering();
  const dyn = dynamik(out, m);
  let ausgleich = 0;
  if (dyn && lufsVor != null) {
    ausgleich = Math.round(Math.max(0, Math.min(DYN_AUSGLEICH, lufsVor - await measureLufs(out, {}))) * 100) / 100;
    if (ausgleich) { const k = dbGain(ausgleich); for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; } }
  }
  blenden(out, m.fade_in || 0, m.fade_out || 0);
  limit(out, MASTER_LIMIT_DB);
  out.dyn = dyn; out.ausgleich = ausgleich;
  return out;
}

// 🔴 3.7 (Prüfstand): der Kompressor von Web Audio ist KEIN Limiter — ein lauter Track mit +8 dB kam auf 0,00 dBFS
//    und wurde in der WAV abgeschnitten (Knacksen), während der Mac (alimiter) sauber bei −1,5 blieb.
//    Jetzt ein echter Spitzenbegrenzer auf den Samples, wie alimiter (attack 1 ms mit Vorausschau, release 60 ms):
//    rückwärts: die Verstärkung sinkt VOR einer Spitze in höchstens 1 ms auf das Nötige;
//    vorwärts: danach steigt sie mit 60 ms wieder an — aber nie über das, was die Spitzen erlauben.
export function limit(ab, limitDb) {
  const L = dbGain(limitDb), n = ab.length, sr = ab.sampleRate, chs = [];
  for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
  const g = new Float32Array(n);
  let over = false;
  for (let i = 0; i < n; i++) {
    let p = 0; for (const d of chs) { const v = Math.abs(d[i]); if (v > p) p = v; }
    g[i] = p > L ? L / p : 1;
    if (p > L) over = true;
  }
  if (!over) return 0;
  const step = 1 / Math.max(1, Math.round(sr * 0.001));            // 1 ms von 1 auf 0
  for (let i = n - 2; i >= 0; i--) if (g[i] > g[i + 1] + step) g[i] = g[i + 1] + step;
  const rel = 1 - Math.exp(-1 / (sr * 0.06));
  let e = g[0];
  let minG = 1;
  for (let i = 0; i < n; i++) {
    e = Math.min(g[i], e + (1 - e) * rel);
    g[i] = e;
    if (e < minG) minG = e;
  }
  for (const d of chs) for (let i = 0; i < n; i++) d[i] *= g[i];
  return 20 * Math.log10(minG);                                     // stärkste Absenkung in dB (≤ 0)
}

// 16-Bit-WAV (der Export rechnet auf dem Mac in 24 Bit)
export function wavBlob(ab) {
  const ch = ab.numberOfChannels, n = ab.length, sr = ab.sampleRate, data = n * ch * 2;
  const buf = new ArrayBuffer(44 + data), v = new DataView(buf);
  const w4 = (o, t) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  w4(0, "RIFF"); v.setUint32(4, 36 + data, true); w4(8, "WAVE"); w4(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, ch, true); v.setUint32(24, sr, true); v.setUint32(28, sr * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  w4(36, "data"); v.setUint32(40, data, true);
  const out = new Int16Array(buf, 44), chs = []; for (let c = 0; c < ch; c++) chs.push(ab.getChannelData(c));
  for (let i = 0, k = 0; i < n; i++) for (let c = 0; c < ch; c++, k++) { const x = Math.max(-1, Math.min(1, chs[c][i])); out[k] = x < 0 ? x * 32768 : x * 32767; }
  return new Blob([buf], { type: "audio/wav" });
}

// Wellenform für die Bibliothek (gleiches Format wie computePeaks in app.js: 480 Spitzen, Kanal 0)
export function peaksOf(ab, n = 480) {
  const ch = ab.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n)), peaks = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(ch.length, (i + 1) * step);
    for (let k = i * step; k < end; k += 8) { const v = Math.abs(ch[k]); if (v > m) m = v; }
    peaks.push(Math.round(m * 1000) / 1000);
  }
  return peaks;
}

// Alles zusammen: Original + Einstellungen → gemasterte Fassung zum Abspielen und Ablegen.
// `lufsCache` (Map) spart die Messung, wenn sich nur Pegel oder Blenden ändern.
export async function masterAudio(buf, master, lufsCache) {
  const m = masterClean(master, buf.duration);
  let lufs = null, gain = m.gain;
  if (gain == null) {
    const lk = lufsKey(m, buf.duration);
    lufs = lufsCache && lufsCache.has(lk) ? lufsCache.get(lk) : await measureLufs(buf, m);
    if (lufsCache) lufsCache.set(lk, lufs);
    gain = autoGain(lufs, m.ziel);
  }
  const ab = await renderMaster(buf, m, gain, lufs == null ? null : lufs + gain);
  const { start, end } = cutOf(m, buf.duration);
  return { blob: wavBlob(ab), peaks: peaksOf(ab), dur: ab.duration, gain: Math.round(gain * 100) / 100, lufs, start, end, settings: m,
    dyn: ab.dyn, ausgleich: ab.ausgleich };
}

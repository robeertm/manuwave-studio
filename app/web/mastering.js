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
};
// Grenzen wie MASTER_RANGES in der Brücke (die Regler im Tab haben dieselben)
export const MASTER_RANGES = { bass: [-12, 12], tone: [-6, 6], treble: [-12, 12], soft: [0, 8], gain: [-24, 12], fade_in: [0, 10], fade_out: [0, 15] };
export const MASTER_LIMIT_DB = -1.5, MASTER_TARGET_LUFS = -14;

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
// Der Vorschlag für einen Track ohne eigene Einstellungen (= was der Mac ohne Regler exportiert)
export function masterDefault(buf) {
  const m = { ...MASTER_DEFAULT };
  const ae = buf && autoEnd(buf);
  if (ae) { m.end = ae[0]; m.fade_out = ae[1]; }
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
  return JSON.stringify([c.bass || 0, c.tone || 0, c.treble || 0, c.soft || 0, start, end]); };
export const autoGain = (lufs) => Math.max(MASTER_RANGES.gain[0], Math.min(MASTER_RANGES.gain[1], MASTER_TARGET_LUFS - lufs));

// Die gemasterte Fassung des Ausschnitts → AudioBuffer
export async function renderMaster(buf, m, gainDb) {
  const sr = buf.sampleRate, { start, end } = cutOf(m, buf.duration);
  const len = Math.max(1, Math.round((end - start) * sr));
  const oc = new (Off())(buf.numberOfChannels, len, sr);
  const src = oc.createBufferSource(); src.buffer = buf;
  const n = eqNodes(oc, m);
  const gain = oc.createGain(); gain.gain.value = dbGain(gainDb);
  const fade = oc.createGain();
  const dur = len / sr, fi = Math.min(m.fade_in || 0, dur / 2), fo = Math.min(m.fade_out || 0, dur / 2);
  const kurve = (auf) => { const c = new Float32Array(256); for (let k = 0; k < 256; k++) { const x = k / 255; c[k] = Math.sin(Math.PI / 2 * (auf ? x : 1 - x)); } return c; };
  if (fi > 0) fade.gain.setValueCurveAtTime(kurve(true), 0, fi);
  if (fo > 0) fade.gain.setValueCurveAtTime(kurve(false), Math.max(fi, dur - fo), Math.min(fo, dur - fi));
  src.connect(n.input); n.output.connect(gain); gain.connect(fade); fade.connect(oc.destination);
  src.start(0, start);
  const out = await oc.startRendering();
  limit(out, MASTER_LIMIT_DB);
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
    gain = autoGain(lufs);
  }
  const ab = await renderMaster(buf, m, gain);
  const { start, end } = cutOf(m, buf.duration);
  return { blob: wavBlob(ab), peaks: peaksOf(ab), dur: ab.duration, gain: Math.round(gain * 100) / 100, lufs, start, end, settings: m };
}

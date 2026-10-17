// Manuwave Studio 3.15 — "Selber machen": Regler-Schema, Werks-Presets, Drum-Kits und das Demo-Projekt.
// Werte stehen in echten Einheiten (Hz, s, Halbtöne); jeder Regler kennt Bereich, Kurve und Standard.

// ---- Regler-Schema je Klangmotor ----
// [k, de, en, min, max, def, opts]   opts: { c: "exp", u: "Hz"|"s"|"st"|"ct"|"%"|"x", st: Schritt }
// Auswahl: ["sel", k, de, en, [[wert, de, en], …], def]   Schalter: ["tog", k, de, en, def]
const K = (k, de, en, min, max, def, o = {}) => ({ t: "knob", k, de, en, min, max, def, ...o });
const SEL = (k, de, en, opts, def) => ({ t: "sel", k, de, en, opts, def });
const TOG = (k, de, en, def = false) => ({ t: "tog", k, de, en, def });

const WAVES = [["saw", "Säge", "Saw"], ["square", "Rechteck/Puls", "Square/pulse"], ["tri", "Dreieck", "Triangle"], ["sine", "Sinus", "Sine"],
  ["wt", "Wavetable", "Wavetable"], ["noise", "Rauschen", "Noise"]];
const SYNC = [["off", "frei (Hz)", "free (Hz)"], ["4/1", "4 Takte", "4 bars"], ["2/1", "2 Takte", "2 bars"], ["1/1", "1 Takt", "1 bar"], ["1/2", "1/2", "1/2"],
  ["1/4", "1/4", "1/4"], ["1/4T", "1/4 Triole", "1/4 triplet"], ["1/8", "1/8", "1/8"], ["1/8T", "1/8 Triole", "1/8 triplet"], ["1/16", "1/16", "1/16"]];
const SHAPES = [["sine", "Sinus", "Sine"], ["tri", "Dreieck", "Triangle"], ["saw", "Säge", "Saw"], ["square", "Rechteck", "Square"], ["sh", "Zufall (S&H)", "Random (S&H)"]];
const DESTS = [["off", "aus", "off"], ["pitch", "Tonhöhe", "Pitch"], ["cut", "Filter", "Filter"], ["pw", "Pulsbreite", "Pulse width"], ["amp", "Lautstärke", "Volume"],
  ["pan", "Panorama", "Pan"], ["wt", "Wavetable-Position", "Wavetable position"]];
const lfo = (n, rate, dest) => ({ id: "lfo" + n, de: "LFO " + n, en: "LFO " + n, p: [
  SEL("l" + n + "shape", "Form", "Shape", SHAPES, "sine"),
  K("l" + n + "rate", "Tempo", "Rate", 0.05, 20, rate, { c: "exp", u: "Hz" }),
  SEL("l" + n + "sync", "Im Takt", "Tempo sync", SYNC, "off"),
  SEL("l" + n + "dest", "Ziel", "Destination", DESTS, dest),
  K("l" + n + "amt", "Menge", "Amount", 0, 1, 0, { u: "%" }),
] });
const ARP = { id: "arp", de: "Arpeggiator", en: "Arpeggiator", p: [
  SEL("arp", "Modus", "Mode", [["off", "aus", "off"], ["up", "aufwärts", "up"], ["down", "abwärts", "down"], ["updown", "auf & ab", "up & down"],
    ["order", "wie gespielt", "as played"], ["random", "zufällig", "random"]], "off"),
  SEL("arprate", "Noten", "Rate", [["1/4", "1/4", "1/4"], ["1/8", "1/8", "1/8"], ["1/8T", "1/8 Triole", "1/8 triplet"], ["1/16", "1/16", "1/16"],
    ["1/16T", "1/16 Triole", "1/16 triplet"], ["1/32", "1/32", "1/32"]], "1/16"),
  K("arpoct", "Oktaven", "Octaves", 1, 4, 1, { st: 1 }),
  K("arpgate", "Notenlänge", "Gate", 0.05, 1, 0.5, { u: "%" }),
  TOG("arplatch", "Halten (Latch)", "Latch"),
] };
const VOICE = (mode = "poly", voices = 8) => ({ id: "voice", de: "Spielweise", en: "Play mode", p: [
  SEL("mode", "Stimmen", "Voicing", [["poly", "mehrstimmig", "poly"], ["mono", "einstimmig", "mono"], ["legato", "legato (gleitend)", "legato"]], mode),
  K("voices", "max. Stimmen", "Max voices", 1, 16, voices, { st: 1 }),
  K("glide", "Glide", "Glide", 0, 1, 0, { c: "exp0", u: "s" }),
  K("pb", "Pitchbend", "Bend range", 1, 12, 2, { st: 1, u: "st" }),
  SEL("mw", "Modulationsrad", "Mod wheel", [["vib", "Vibrato", "Vibrato"], ["cut", "Filter auf", "Opens filter"], ["wt", "Wavetable", "Wavetable"]], "vib"),
  K("vol", "Pegel", "Level", 0, 1, 0.8, { u: "%" }),
] });

export const SCHEMA = {
  va: [
    { id: "osc1", de: "Oszillator 1", en: "Oscillator 1", p: [
      SEL("o1w", "Welle", "Wave", WAVES, "saw"), K("o1oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), K("o1semi", "Halbton", "Semitone", -12, 12, 0, { st: 1, u: "st" }),
      K("o1fine", "Fein", "Fine", -50, 50, 0, { u: "ct" }), K("o1pw", "Pulsbreite", "Pulse width", 0.03, 0.97, 0.5, { u: "%" }), K("o1lvl", "Pegel", "Level", 0, 1, 0.8, { u: "%" })] },
    { id: "osc2", de: "Oszillator 2", en: "Oscillator 2", p: [
      SEL("o2w", "Welle", "Wave", WAVES, "saw"), K("o2oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), K("o2semi", "Halbton", "Semitone", -12, 12, 0, { st: 1, u: "st" }),
      K("o2fine", "Fein", "Fine", -50, 50, 7, { u: "ct" }), K("o2pw", "Pulsbreite", "Pulse width", 0.03, 0.97, 0.5, { u: "%" }), K("o2lvl", "Pegel", "Level", 0, 1, 0, { u: "%" }),
      TOG("o2sync", "Hard Sync", "Hard sync"), K("fm", "FM 2→1", "FM 2→1", 0, 1, 0, { u: "%" })] },
    { id: "mix", de: "Mischer & Unisono", en: "Mixer & unison", p: [
      K("sub", "Sub-Oszillator", "Sub oscillator", 0, 1, 0, { u: "%" }), K("noise", "Rauschen", "Noise", 0, 1, 0, { u: "%" }),
      K("uni", "Unisono", "Unison", 1, 7, 1, { st: 1 }), K("unidet", "Verstimmung", "Detune", 0, 1, 0.2, { u: "%" }),
      K("unispread", "Stereobreite", "Stereo width", 0, 1, 0.5, { u: "%" }), K("drive", "Drive", "Drive", 0, 1, 0, { u: "%" })] },
    { id: "wt", de: "Wavetable", en: "Wavetable", p: [
      SEL("wtset", "Satz", "Set", [["analog", "Analog (Sinus → Puls)", "Analog (sine → pulse)"], ["pwm", "Pulsbreite", "Pulse width"], ["sync", "Sync", "Sync"],
        ["fold", "Wavefolder", "Wavefolder"], ["vocal", "Vokale A-E-I-O-U", "Vowels A-E-I-O-U"], ["bell", "Glas & Glocke", "Glass & bell"]], "analog"),
      K("wtpos", "Position", "Position", 0, 1, 0, { u: "%" }), K("wtenv", "Hüllkurve → Pos.", "Envelope → pos.", -1, 1, 0, { u: "%" }),
      K("wtlfo", "LFO 2 → Pos.", "LFO 2 → pos.", 0, 1, 0, { u: "%" })] },
    { id: "filter", de: "Filter", en: "Filter", p: [
      SEL("ftype", "Typ", "Type", [["lp24", "Tiefpass 24 dB (Leiter)", "Low-pass 24 dB (ladder)"], ["lp12", "Tiefpass 12 dB", "Low-pass 12 dB"],
        ["hp12", "Hochpass 12 dB", "High-pass 12 dB"], ["bp12", "Bandpass", "Band-pass"], ["notch", "Kerbe", "Notch"]], "lp24"),
      K("cut", "Cutoff", "Cutoff", 20, 20000, 2400, { c: "exp", u: "Hz" }), K("res", "Resonanz", "Resonance", 0, 1, 0.2, { u: "%" }),
      K("fenv", "Hüllkurve", "Env amount", -1, 1, 0.3, { u: "%" }), K("fkey", "Tastatur", "Key track", 0, 1, 0.3, { u: "%" }),
      K("fvel", "Anschlag", "Velocity", 0, 1, 0.3, { u: "%" }), K("accent", "Akzent (303)", "Accent (303)", 0, 1, 0, { u: "%" })] },
    { id: "fenv", de: "Filter-Hüllkurve", en: "Filter envelope", p: [
      K("fa", "Attack", "Attack", 0.001, 5, 0.005, { c: "exp", u: "s" }), K("fd", "Decay", "Decay", 0.005, 8, 0.4, { c: "exp", u: "s" }),
      K("fs", "Sustain", "Sustain", 0, 1, 0.3, { u: "%" }), K("fr", "Release", "Release", 0.005, 8, 0.4, { c: "exp", u: "s" })] },
    { id: "aenv", de: "Lautstärke-Hüllkurve", en: "Amp envelope", p: [
      K("aa", "Attack", "Attack", 0.001, 5, 0.005, { c: "exp", u: "s" }), K("ad", "Decay", "Decay", 0.005, 8, 0.3, { c: "exp", u: "s" }),
      K("as", "Sustain", "Sustain", 0, 1, 0.7, { u: "%" }), K("ar", "Release", "Release", 0.005, 8, 0.3, { c: "exp", u: "s" }),
      K("velamp", "Anschlag", "Velocity", 0, 1, 0.5, { u: "%" })] },
    lfo(1, 5, "off"), lfo(2, 0.4, "off"), VOICE(), ARP,
  ],
  fm: [
    { id: "algo", de: "Algorithmus", en: "Algorithm", p: [
      SEL("algo", "Verschaltung", "Routing", [[1, "1: 4→3→2→1", "1: 4→3→2→1"], [2, "2: (3+4)→2→1", "2: (3+4)→2→1"], [3, "3: 2→1, 4→3→1", "3: 2→1, 4→3→1"],
        [4, "4: 3→2→1, 4→1", "4: 3→2→1, 4→1"], [5, "5: zwei Paare 2→1, 4→3", "5: two pairs 2→1, 4→3"], [6, "6: 4 → 1, 2, 3", "6: 4 → 1, 2, 3"],
        [7, "7: 4→3, dazu 1 + 2", "7: 4→3, plus 1 + 2"], [8, "8: alle hörbar (Orgel)", "8: all audible (organ)"]], 1),
      K("fb", "Rückkopplung Op 4", "Feedback op 4", 0, 1, 0, { u: "%" }), K("ksc", "Tastatur-Skalierung", "Key scaling", 0, 1, 0.2, { u: "%" })] },
    ...[1, 2, 3, 4].map(n => ({ id: "op" + n, de: "Operator " + n, en: "Operator " + n, p: [
      K("op" + n + "ratio", "Verhältnis", "Ratio", 0.5, 16, 1, { st: 0.5, u: "x" }), K("op" + n + "fine", "Fein", "Fine", -100, 100, 0, { u: "ct" }),
      K("op" + n + "lvl", n === 1 ? "Pegel" : "Pegel / Index", n === 1 ? "Level" : "Level / index", 0, 1, n === 1 ? 1 : 0.4, { u: "%" }),
      K("op" + n + "att", "Attack", "Attack", 0.001, 5, 0.002, { c: "exp", u: "s" }), K("op" + n + "dec", "Decay", "Decay", 0.005, 10, 0.8, { c: "exp", u: "s" }),
      K("op" + n + "sus", "Sustain", "Sustain", 0, 1, n === 1 ? 0.7 : 0.3, { u: "%" }), K("op" + n + "rel", "Release", "Release", 0.005, 8, 0.4, { c: "exp", u: "s" }),
      K("op" + n + "vel", "Anschlag", "Velocity", 0, 1, 0.5, { u: "%" })] })),
    lfo(1, 5, "off"), VOICE(), ARP,
  ],
  ep: [
    { id: "tine", de: "Zinke & Hammer", en: "Tine & hammer", p: [
      K("tine", "Zinke", "Tine", 0, 1, 0.5, { u: "%" }), K("tinedec", "Zinke klingt", "Tine decay", 0.05, 3, 0.6, { c: "exp", u: "s" }),
      K("bell", "Glocke", "Bell", 0, 1, 0.3, { u: "%" }), K("bark", "Biss (Anschlag)", "Bark", 0, 1, 0.4, { u: "%" }),
      K("decay", "Ausklingen", "Decay", 0.3, 12, 4, { c: "exp", u: "s" }), K("rel", "Dämpfer", "Damper", 0.02, 2, 0.25, { c: "exp", u: "s" }),
      K("tone", "Ton", "Tone", 0, 1, 0.7, { u: "%" })] },
    { id: "lfo1", de: "Tremolo", en: "Tremolo", p: [
      SEL("l1dest", "Art", "Type", [["off", "aus", "off"], ["pan", "Stereo (Autopan)", "Stereo (auto-pan)"], ["amp", "Lautstärke", "Volume"]], "pan"),
      K("l1rate", "Tempo", "Rate", 0.1, 12, 4.5, { c: "exp", u: "Hz" }), SEL("l1sync", "Im Takt", "Tempo sync", SYNC, "off"),
      K("l1amt", "Tiefe", "Depth", 0, 1, 0.35, { u: "%" })] },
    VOICE("poly", 12), ARP,
  ],
  organ: [
    { id: "draw", de: "Zugriegel", en: "Drawbars", draw: true, p: [
      ["16'", "16'"], ["5⅓'", "5⅓'"], ["8'", "8'"], ["4'", "4'"], ["2⅔'", "2⅔'"], ["2'", "2'"], ["1⅗'", "1⅗'"], ["1⅓'", "1⅓'"], ["1'", "1'"]]
      .map(([de, en], i) => K("db" + (i + 1), de, en, 0, 8, i < 3 ? 8 : 0, { st: 1 })) },
    { id: "perc", de: "Perkussion & Klick", en: "Percussion & click", p: [
      TOG("perc", "Perkussion", "Percussion"), TOG("perc3", "3. statt 2. Oberton", "3rd instead of 2nd"), TOG("percfast", "schnell", "fast"),
      TOG("percsoft", "leise", "soft"), K("click", "Tastenklick", "Key click", 0, 1, 0.3, { u: "%" })] },
    { id: "rot", de: "Vibrato, Leslie, Röhre", en: "Vibrato, rotary, drive", p: [
      SEL("vib", "Vibrato/Chorus", "Vibrato/chorus", [["off", "aus", "off"], ["v1", "V1", "V1"], ["v2", "V2", "V2"], ["v3", "V3", "V3"], ["c1", "C1", "C1"], ["c2", "C2", "C2"], ["c3", "C3", "C3"]], "off"),
      SEL("leslie", "Leslie", "Rotary", [["off", "aus", "off"], ["slow", "langsam (Choral)", "slow (chorale)"], ["fast", "schnell (Tremolo)", "fast (tremolo)"]], "slow"),
      K("drive", "Röhre", "Drive", 0, 1, 0.15, { u: "%" }), K("vol", "Pegel", "Level", 0, 1, 0.8, { u: "%" })] },
    { id: "voice", de: "Spielweise", en: "Play mode", p: [K("voices", "max. Stimmen", "Max voices", 1, 16, 12, { st: 1 }), K("pb", "Pitchbend", "Bend range", 1, 12, 2, { st: 1, u: "st" })] },
  ],
  pluck: [
    { id: "string", de: "Saite", en: "String", p: [
      K("bright", "Helligkeit", "Brightness", 0, 1, 0.6, { u: "%" }), K("damp", "Dämpfung", "Damping", 0, 0.98, 0.35, { u: "%" }),
      K("decay", "Ausklingen", "Decay", 0.1, 12, 3, { c: "exp", u: "s" }), K("pos", "Anschlagpunkt", "Pluck position", 0.02, 0.5, 0.2, { u: "%" }),
      K("body", "Korpus", "Body", 0, 1, 0.3, { u: "%" }), K("velb", "Anschlag → hell", "Velocity → bright", 0, 1, 0.6, { u: "%" }),
      K("rel", "Abdämpfen", "Mute on release", 0.05, 4, 0.4, { c: "exp", u: "s" })] },
    lfo(1, 5, "off"), VOICE("poly", 12), ARP,
  ],
  drums: [
    { id: "kit", de: "Drum-Machine", en: "Drum machine", p: [K("drive", "Sättigung", "Saturation", 0, 1, 0.1, { u: "%" }), K("vol", "Pegel", "Level", 0, 1, 0.85, { u: "%" })] },
  ],
};
// Regler einer Drum-Stimme (Pad)
export const PAD_PARAMS = [
  K("lvl", "Pegel", "Level", 0, 1, 0.8, { u: "%" }), K("pan", "Panorama", "Pan", -1, 1, 0, { u: "pan" }),
  K("tune", "Stimmung", "Tune", -24, 24, 0, { u: "st" }), K("dec", "Länge", "Decay", 0.1, 4, 1, { c: "exp", u: "x" }),
  K("tone", "Ton", "Tone", 0, 1, 0.5, { u: "%" }), K("snap", "Knack / Rauschen", "Snap / noise", 0, 1, 0.5, { u: "%" }),
];
export const DRUM_MODELS = [
  ["kick808", "Kick 808", "Kick 808"], ["kick909", "Kick 909", "Kick 909"], ["kickacoustic", "Kick weich", "Kick soft"], ["snare", "Snare", "Snare"],
  ["snare909", "Snare 909", "Snare 909"], ["clap", "Clap", "Clap"], ["hatc", "Hi-Hat zu", "Closed hat"], ["hato", "Hi-Hat offen", "Open hat"],
  ["tomlo", "Tom tief", "Low tom"], ["tommid", "Tom mittel", "Mid tom"], ["tomhi", "Tom hoch", "High tom"], ["rim", "Rimshot", "Rimshot"],
  ["cowbell", "Kuhglocke", "Cowbell"], ["crash", "Crash", "Crash"], ["ride", "Ride", "Ride"], ["cymbal", "Becken", "Cymbal"],
  ["shaker", "Shaker", "Shaker"], ["tamb", "Tamburin", "Tambourine"], ["conga", "Conga", "Conga"], ["clave", "Clave", "Clave"],
  ["zap", "Zap", "Zap"], ["lofi", "Lo-Fi-Rauschen", "Lo-fi noise"],
];
// GM-Drum-Noten → Pad (für Keyboard-Spiel: C1 = Kick …)
export const GM_TO_PAD = { 36: 0, 35: 0, 38: 1, 40: 1, 39: 2, 42: 3, 44: 3, 46: 4, 41: 5, 43: 5, 45: 6, 47: 6, 48: 7, 50: 7, 37: 8, 56: 9, 49: 10, 57: 10, 51: 11, 59: 11, 70: 12, 69: 12, 63: 13, 64: 13, 75: 14, 54: 15 };
export const PAD_TO_GM = [36, 38, 39, 42, 46, 41, 45, 48, 37, 56, 49, 51, 70, 63, 75, 54];

const pad = (model, o = {}) => ({ model, lvl: 0.8, pan: 0, tune: 0, dec: 1, tone: 0.5, snap: 0.5, ...o });
export const KITS = {
  "808": { de: "808 — rund und tief", en: "808 — round and deep", kit: [
    pad("kick808", { lvl: 0.95, dec: 1.4, tone: 0.35 }), pad("snare", { tone: 0.4 }), pad("clap", { lvl: 0.7 }), pad("hatc", { lvl: 0.55, pan: 0.2 }), pad("hato", { lvl: 0.5, pan: 0.2 }),
    pad("tomlo", { pan: -0.3 }), pad("tommid"), pad("tomhi", { pan: 0.3 }), pad("rim", { lvl: 0.6 }), pad("cowbell", { lvl: 0.5 }), pad("crash", { lvl: 0.5, pan: -0.2 }),
    pad("ride", { lvl: 0.45, pan: 0.25 }), pad("shaker", { lvl: 0.45, pan: -0.25 }), pad("conga", { pan: 0.35 }), pad("clave", { lvl: 0.55 }), pad("zap", { lvl: 0.5 })] },
  "909": { de: "909 — House & Techno", en: "909 — house & techno", kit: [
    pad("kick909", { lvl: 0.95, snap: 0.6 }), pad("snare909", { snap: 0.65 }), pad("clap", { lvl: 0.75 }), pad("hatc", { lvl: 0.6, tone: 0.65, pan: 0.15 }),
    pad("hato", { lvl: 0.55, tone: 0.65, pan: 0.15 }), pad("tomlo", { pan: -0.3, dec: 0.8 }), pad("tommid", { dec: 0.8 }), pad("tomhi", { pan: 0.3, dec: 0.8 }), pad("rim", { lvl: 0.6 }),
    pad("cowbell", { lvl: 0.45 }), pad("crash", { lvl: 0.5 }), pad("ride", { lvl: 0.5, tone: 0.6, pan: 0.2 }), pad("shaker", { lvl: 0.45 }), pad("tamb", { lvl: 0.45, pan: -0.3 }),
    pad("clave", { lvl: 0.5 }), pad("zap", { lvl: 0.45 })] },
  techno: { de: "Techno — hart und trocken", en: "Techno — hard and dry", kit: [
    pad("kick909", { lvl: 1, tune: -3, dec: 1.6, tone: 0.8, snap: 0.75 }), pad("snare909", { tone: 0.7, dec: 0.7 }), pad("clap", { lvl: 0.75, dec: 1.3 }),
    pad("hatc", { lvl: 0.55, tone: 0.8, dec: 0.7 }), pad("hato", { lvl: 0.5, tone: 0.75, dec: 0.8 }), pad("tomlo", { tune: -5 }), pad("tommid", { tune: -3 }), pad("tomhi"),
    pad("rim", { lvl: 0.65, tune: 2 }), pad("cowbell", { lvl: 0.4, tune: -2 }), pad("crash", { lvl: 0.45 }), pad("ride", { lvl: 0.55, tone: 0.75 }), pad("shaker", { lvl: 0.4 }),
    pad("lofi", { lvl: 0.4 }), pad("clave", { lvl: 0.45 }), pad("zap", { lvl: 0.5, tune: -5 })] },
  lofi: { de: "Lo-Fi — weich und staubig", en: "Lo-fi — soft and dusty", kit: [
    pad("kickacoustic", { lvl: 0.9, dec: 0.8, tone: 0.2, snap: 0.2 }), pad("snare", { tone: 0.15, snap: 0.3, dec: 0.8 }), pad("clap", { lvl: 0.5, tone: 0.2 }),
    pad("hatc", { lvl: 0.4, tone: 0.2, snap: 0.8 }), pad("hato", { lvl: 0.35, tone: 0.25, snap: 0.8 }), pad("tomlo", { tone: 0.2 }), pad("tommid"), pad("tomhi"),
    pad("rim", { lvl: 0.55, tone: 0.3 }), pad("cowbell", { lvl: 0.3 }), pad("cymbal", { lvl: 0.35 }), pad("ride", { lvl: 0.35, tone: 0.3 }), pad("shaker", { lvl: 0.4, tone: 0.2 }),
    pad("conga"), pad("lofi", { lvl: 0.35 }), pad("tamb", { lvl: 0.35 })] },
};

// ---- Synthesizer-Modelle: was man im "Instrument"-Menü wählt ----
export const MODELS = [
  { id: "poly", engine: "va", de: "Analog Poly", en: "Analog Poly", hd: "Flächen, Akkorde, Brass — zwei Oszillatoren, Leiterfilter", he: "Pads, chords, brass — two oscillators, ladder filter" },
  { id: "mono", engine: "va", de: "Analog Mono", en: "Analog Mono", hd: "Bässe und Leads — ein Ton, Glide, drei Oszillatoren", he: "Basses and leads — one note, glide, three oscillators" },
  { id: "acid", engine: "va", de: "Acid-Bass", en: "Acid Bass", hd: "Quietschende Resonanz, Akzent und Slide", he: "Squelchy resonance, accent and slide" },
  { id: "super", engine: "va", de: "Supersaw", en: "Supersaw", hd: "Sieben verstimmte Sägezähne — Trance, Hymnen", he: "Seven detuned saws — trance, anthems" },
  { id: "wave", engine: "va", de: "Wavetable", en: "Wavetable", hd: "Wandernde Wellenformen — Vokale, Glas, Sync", he: "Moving waveforms — vowels, glass, sync" },
  { id: "strings", engine: "va", de: "String Machine", en: "String Machine", hd: "Streicherflächen der 70er/80er", he: "70s/80s string ensembles" },
  { id: "fm", engine: "fm", de: "FM-Synth (4 Operatoren)", en: "FM synth (4 operators)", hd: "Glocken, E-Pianos, Digitalbässe, Metall", he: "Bells, e-pianos, digital basses, metal" },
  { id: "ep", engine: "ep", de: "E-Piano", en: "Electric piano", hd: "Zinken-Piano mit Biss und Tremolo", he: "Tine piano with bark and tremolo" },
  { id: "organ", engine: "organ", de: "Orgel", en: "Organ", hd: "Neun Zugriegel, Perkussion, Leslie", he: "Nine drawbars, percussion, rotary" },
  { id: "pluck", engine: "pluck", de: "Saite / Pluck", en: "String / pluck", hd: "Gezupft: Gitarre, Harfe, Koto", he: "Plucked: guitar, harp, koto" },
  { id: "drums", engine: "drums", de: "Drum-Machine", en: "Drum machine", hd: "16 Pads, alle synthetisch — 808, 909, Techno, Lo-Fi", he: "16 pads, all synthetic — 808, 909, techno, lo-fi" },
];

// Standard-Patch eines Motors aus dem Schema
export function defaults(engine) {
  const out = { engine };
  for (const sec of SCHEMA[engine] || []) for (const p of sec.p) out[p.k] = p.def;
  if (engine === "drums") out.kit = JSON.parse(JSON.stringify(KITS["808"].kit)), out.kitName = "808";
  return out;
}

// ---- Werks-Presets ----
const P = (model, de, en, patch) => ({ model, de, en, patch });
export const PRESETS = [
  // Analog Poly
  P("poly", "Warme Fläche", "Warm pad", { o1w: "saw", o2w: "saw", o2lvl: 0.7, o2fine: 9, cut: 1400, res: 0.15, fenv: 0.2, aa: 0.6, ad: 1.2, as: 0.8, ar: 1.6, fa: 0.8, fd: 2, fs: 0.5, l1dest: "pitch", l1amt: 0.05, l1rate: 4.5, unidet: 0.3, voices: 8 }),
  P("poly", "80er-Brass", "80s brass", { o1w: "saw", o2w: "saw", o2lvl: 0.8, o2fine: 6, cut: 900, res: 0.1, fenv: 0.55, fa: 0.05, fd: 0.5, fs: 0.4, aa: 0.03, ad: 0.4, as: 0.8, ar: 0.3 }),
  P("poly", "PWM-Streicher", "PWM strings", { o1w: "square", o1pw: 0.4, o2w: "square", o2pw: 0.6, o2lvl: 0.7, o2fine: 5, l1dest: "pw", l1amt: 0.6, l1rate: 0.7, cut: 3200, res: 0.05, fenv: 0, aa: 0.4, as: 0.9, ar: 1.2 }),
  P("poly", "Glasklare Keys", "Glassy keys", { o1w: "square", o1pw: 0.25, o2w: "tri", o2oct: 1, o2lvl: 0.5, cut: 2600, res: 0.25, fenv: 0.35, fd: 0.6, fs: 0.1, aa: 0.002, ad: 0.9, as: 0.3, ar: 0.6 }),
  P("poly", "Sync-Lead", "Sync lead", { o1w: "saw", o2w: "saw", o2lvl: 0.9, o1lvl: 0.3, o2sync: true, o2semi: 7, cut: 5000, res: 0.2, fenv: 0.25, l2dest: "off", aa: 0.003, as: 0.85, ar: 0.25, mode: "legato", glide: 0.05 }),
  P("poly", "Dunkler Drone", "Dark drone", { o1w: "saw", o2w: "square", o2oct: -1, o2lvl: 0.7, cut: 420, res: 0.55, l1dest: "cut", l1amt: 0.35, l1rate: 0.12, aa: 2, as: 1, ar: 4, noise: 0.1 }),
  // Analog Mono
  P("mono", "Fetter Bass", "Fat bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "square", o2oct: -1, o2lvl: 0.6, o2fine: -6, sub: 0.6, cut: 380, res: 0.25, fenv: 0.45, fd: 0.25, fs: 0.15, aa: 0.002, ad: 0.3, as: 0.85, ar: 0.12, drive: 0.25 }),
  P("mono", "Pluck-Bass", "Plucky bass", { mode: "mono", o1w: "square", o1oct: -1, o1pw: 0.3, sub: 0.4, cut: 260, res: 0.35, fenv: 0.6, fd: 0.18, fs: 0, ad: 0.25, as: 0.3, ar: 0.1 }),
  P("mono", "Leiter-Lead", "Ladder lead", { mode: "legato", glide: 0.06, o1w: "saw", o2w: "saw", o2lvl: 0.7, o2fine: 8, cut: 2200, res: 0.35, fenv: 0.3, l1dest: "pitch", l1amt: 0.04, l1rate: 5.5, as: 0.9, ar: 0.25, drive: 0.2 }),
  P("mono", "Reese", "Reese bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "saw", o2oct: -1, o2lvl: 0.9, o2fine: 22, uni: 3, unidet: 0.25, cut: 600, res: 0.15, fenv: 0.1, drive: 0.35, as: 1, ar: 0.2 }),
  P("mono", "Sub 808", "808 sub", { mode: "mono", glide: 0.04, o1w: "sine", o1oct: -1, o1lvl: 1, cut: 3000, res: 0, fenv: 0, aa: 0.002, ad: 1.8, as: 0, ar: 0.4, drive: 0.35 }),
  // Acid
  P("acid", "Acid Classic", "Acid classic", { mode: "mono", glide: 0.06, o1w: "saw", cut: 380, res: 0.82, fenv: 0.55, fd: 0.22, fs: 0, accent: 0.7, aa: 0.002, ad: 0.3, as: 0.9, ar: 0.08, drive: 0.2 }),
  P("acid", "Acid Rechteck", "Acid square", { mode: "mono", glide: 0.06, o1w: "square", o1pw: 0.5, cut: 320, res: 0.86, fenv: 0.6, fd: 0.18, fs: 0, accent: 0.8, ad: 0.3, as: 0.9, ar: 0.08, drive: 0.3 }),
  P("acid", "Acid verzerrt", "Acid distorted", { mode: "mono", glide: 0.05, o1w: "saw", cut: 500, res: 0.88, fenv: 0.65, fd: 0.25, fs: 0.05, accent: 0.8, drive: 0.75, as: 0.9, ar: 0.06 }),
  // Supersaw
  P("super", "Trance-Hymne", "Trance anthem", { o1w: "saw", uni: 7, unidet: 0.45, unispread: 0.9, o2w: "saw", o2oct: 1, o2lvl: 0.25, cut: 7000, res: 0.1, fenv: 0.1, aa: 0.01, ad: 0.6, as: 0.85, ar: 0.6, voices: 8 }),
  P("super", "Hoover", "Hoover", { mode: "legato", glide: 0.12, o1w: "pulse", o1pw: 0.3, uni: 5, unidet: 0.7, unispread: 0.8, l1dest: "pw", l1amt: 0.5, l1rate: 2, cut: 3000, res: 0.15, drive: 0.4, as: 1, ar: 0.4 }),
  P("super", "Supersaw-Pluck", "Supersaw pluck", { o1w: "saw", uni: 7, unidet: 0.35, unispread: 0.8, cut: 900, res: 0.2, fenv: 0.6, fd: 0.3, fs: 0, aa: 0.002, ad: 0.4, as: 0, ar: 0.35 }),
  // Wavetable
  P("wave", "Sprechende Fläche", "Talking pad", { o1w: "wt", wtset: "vocal", wtpos: 0.1, wtlfo: 0.9, l2rate: 0.15, o2w: "wt", o2fine: 9, o2lvl: 0.6, cut: 6000, res: 0.1, fenv: 0, aa: 0.8, as: 0.9, ar: 1.8 }),
  P("wave", "Glasglocke", "Glass bell", { o1w: "wt", wtset: "bell", wtpos: 0.8, wtenv: -0.7, cut: 9000, res: 0.05, fenv: 0, aa: 0.002, ad: 2.5, as: 0, ar: 2.2 }),
  P("wave", "Wavefolder-Bass", "Wavefolder bass", { mode: "mono", o1w: "wt", o1oct: -1, wtset: "fold", wtpos: 0.2, wtenv: 0.6, fd: 0.3, fs: 0.1, sub: 0.5, cut: 3000, res: 0.15, fenv: 0.2, as: 0.9, ar: 0.12 }),
  P("wave", "Sync-Sweep", "Sync sweep", { o1w: "wt", wtset: "sync", wtpos: 0, wtenv: 0.8, fd: 1.2, fs: 0.2, cut: 7000, as: 0.8, ar: 0.5 }),
  // Strings
  P("strings", "Solina-Streicher", "Ensemble strings", { o1w: "saw", o2w: "saw", o2oct: 1, o2lvl: 0.5, o2fine: 4, uni: 3, unidet: 0.25, unispread: 0.9, cut: 4500, res: 0, fenv: 0, ftype: "lp12", aa: 0.35, as: 1, ar: 1.4, l1dest: "pitch", l1amt: 0.04, l1rate: 5.5 }),
  P("strings", "Dunkle Celli", "Dark cellos", { o1w: "saw", o1oct: -1, o2w: "saw", o2lvl: 0.6, o2fine: 6, uni: 2, unidet: 0.2, cut: 1300, res: 0.1, fenv: 0.15, aa: 0.5, as: 1, ar: 1.2 }),
  // FM
  P("fm", "FM-E-Piano", "FM e-piano", { algo: 5, op1ratio: 1, op2ratio: 1, op2lvl: 0.35, op2dec: 1.4, op2sus: 0.1, op3ratio: 1, op3lvl: 0.7, op4ratio: 14, op4lvl: 0.25, op4dec: 0.25, op4sus: 0, op1dec: 3, op1sus: 0.15, op3dec: 3, op3sus: 0.15, op1rel: 0.4, op3rel: 0.4 }),
  P("fm", "Röhrenglocke", "Tubular bell", { algo: 5, op1ratio: 1, op2ratio: 3.5, op2lvl: 0.45, op2dec: 4, op2sus: 0, op3ratio: 1, op3lvl: 0.6, op4ratio: 7, op4lvl: 0.3, op4dec: 2, op4sus: 0, op1dec: 6, op1sus: 0, op3dec: 5, op3sus: 0, op1rel: 2, op3rel: 2 }),
  P("fm", "FM-Bass", "FM bass", { algo: 1, mode: "mono", op1ratio: 0.5, op2ratio: 0.5, op2lvl: 0.55, op2dec: 0.35, op2sus: 0.15, op3ratio: 1, op3lvl: 0.3, op3dec: 0.2, op3sus: 0, op4ratio: 1, op4lvl: 0, op1sus: 0.9, fb: 0.2 }),
  P("fm", "Marimba", "Marimba", { algo: 5, op1ratio: 1, op2ratio: 4, op2lvl: 0.3, op2dec: 0.08, op2sus: 0, op3ratio: 1, op3lvl: 0.5, op4ratio: 10, op4lvl: 0.15, op4dec: 0.05, op4sus: 0, op1dec: 0.6, op1sus: 0, op3dec: 0.4, op3sus: 0, op1rel: 0.3, op3rel: 0.3 }),
  P("fm", "Digital-Brass", "Digital brass", { algo: 1, op1ratio: 1, op2ratio: 1, op2lvl: 0.55, op2att: 0.06, op2dec: 0.5, op2sus: 0.6, op3ratio: 1, op3lvl: 0.25, op4ratio: 1, op4lvl: 0.2, fb: 0.35, op1att: 0.03, op1sus: 0.85, op1rel: 0.3 }),
  P("fm", "Metallisch", "Metallic", { algo: 2, op1ratio: 1, op2ratio: 1.41, op2lvl: 0.6, op3ratio: 3.5, op3lvl: 0.5, op4ratio: 7.5, op4lvl: 0.5, fb: 0.5, op1dec: 2, op1sus: 0, op2dec: 1.5, op2sus: 0, op1rel: 1 }),
  // E-Piano
  P("ep", "Klassisch", "Classic", { tine: 0.5, bark: 0.35, bell: 0.3, decay: 4.5, l1dest: "pan", l1amt: 0.3, l1rate: 4.5 }),
  P("ep", "Bissig", "Barky", { tine: 0.7, bark: 0.85, bell: 0.35, decay: 3.5, tone: 0.85, l1dest: "pan", l1amt: 0.25 }),
  P("ep", "Weich & dunkel", "Soft & dark", { tine: 0.3, bark: 0.1, bell: 0.15, decay: 5, tone: 0.4, l1dest: "amp", l1amt: 0.2, l1rate: 3.5 }),
  // Orgel
  P("organ", "Jazz 888000000", "Jazz 888000000", { db1: 8, db2: 8, db3: 8, db4: 0, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, perc: true, perc3: true, percfast: true, vib: "c3", leslie: "slow", drive: 0.15 }),
  P("organ", "Rock voll", "Full rock", { db1: 8, db2: 8, db3: 8, db4: 8, db5: 8, db6: 8, db7: 8, db8: 8, db9: 8, click: 0.5, vib: "c3", leslie: "fast", drive: 0.55 }),
  P("organ", "Gospel", "Gospel", { db1: 8, db2: 8, db3: 8, db4: 6, db5: 0, db6: 0, db7: 0, db8: 4, db9: 8, perc: false, vib: "c3", leslie: "slow", drive: 0.25, click: 0.4 }),
  P("organ", "Flöte", "Flute", { db1: 0, db2: 0, db3: 8, db4: 6, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, click: 0.1, vib: "v2", leslie: "off", drive: 0 }),
  // Pluck
  P("pluck", "Akustikgitarre", "Acoustic guitar", { bright: 0.55, damp: 0.35, decay: 3.5, pos: 0.18, body: 0.45 }),
  P("pluck", "Harfe", "Harp", { bright: 0.45, damp: 0.25, decay: 6, pos: 0.35, body: 0.2, rel: 3 }),
  P("pluck", "Koto", "Koto", { bright: 0.8, damp: 0.15, decay: 2.5, pos: 0.08, body: 0.3, l1dest: "pitch", l1amt: 0.03 }),
  P("pluck", "Gedämpft (Arp)", "Muted (arp)", { bright: 0.4, damp: 0.7, decay: 0.6, pos: 0.25, body: 0.25, rel: 0.1 }),
];

// ---- Demo-Projekt: "Neon Drive", Synthwave in a-Moll, 100 BPM ----
// Akkorde je Takt: Am – F – C – G (i – VI – III – VII)
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const ROOT = [45, 41, 48, 43];
function notesPad(bars = 4) { const o = []; for (let b = 0; b < bars; b++) for (const n of CH[b % 4]) o.push({ s: b * 16, l: 16, n: n + 12, v: 0.7 }); return o; }
function notesBass(bars = 4) {
  const o = [];
  for (let b = 0; b < bars; b++) for (let k = 0; k < 8; k++) o.push({ s: b * 16 + k * 2, l: 1.6, n: ROOT[b % 4] - 12 + (k % 4 === 3 ? 12 : 0), v: k % 2 ? 0.7 : 0.9 });
  return o;
}
function notesArp(bars = 4) {
  const o = [];
  for (let b = 0; b < bars; b++) { const c = CH[b % 4]; const seq = [c[0], c[1], c[2], c[1] + 12, c[2] + 12, c[1] + 12, c[2], c[1]];
    for (let k = 0; k < 16; k++) o.push({ s: b * 16 + k, l: 0.8, n: seq[k % 8] + 12, v: k % 4 === 0 ? 0.85 : 0.6 }); }
  return o;
}
function notesLead() {
  // eine kleine Melodie über vier Takte
  const m = [[0, 4, 76], [4, 2, 74], [6, 2, 72], [8, 6, 69], [16, 4, 72], [20, 4, 74], [24, 8, 72], [32, 4, 71], [36, 2, 72], [38, 2, 74], [40, 8, 76], [48, 4, 74], [52, 4, 72], [56, 8, 71]];
  return m.map(([s, l, n]) => ({ s, l, n, v: 0.8 }));
}
function drumsBeat(bars = 4, full = true) {
  const o = [];
  for (let b = 0; b < bars; b++) {
    const B = b * 16;
    [0, 4, 8, 12].forEach(s => o.push({ s: B + s, n: 0, v: 0.95, l: 1 }));
    if (full) [4, 12].forEach(s => o.push({ s: B + s, n: 1, v: 0.85, l: 1 }));
    if (full) [4, 12].forEach(s => o.push({ s: B + s, n: 2, v: 0.55, l: 1 }));
    for (let s = 0; s < 16; s += 2) o.push({ s: B + s, n: s % 4 === 2 ? 4 : 3, v: s % 4 === 2 ? 0.5 : 0.65, l: 1 });  // zu auf dem Schlag, offen dazwischen
    if (full && b === bars - 1) [13, 14, 15].forEach((s, i) => o.push({ s: B + s, n: 7 - i, v: 0.7, l: 1 }));
  }
  if (full) o.push({ s: 0, n: 10, v: 0.6, l: 1 });
  return o;
}
export function demoProject(L) {
  const de = L === "de";
  const tr = (id, kind, model, name, patch, o = {}) => ({ id, kind, model, name, color: o.color, patch, presetName: o.preset || "", vol: o.vol ?? -6, pan: o.pan ?? 0,
    mute: false, solo: false, rev: o.rev ?? 0.15, dly: o.dly ?? 0, eq: { lo: 0, mid: 0, hi: 0 }, chorus: o.chorus ?? 0 });
  const presetPatch = (model, de0) => { const pr = PRESETS.find(p => p.model === model && p.de === de0); const m = MODELS.find(x => x.id === model);
    return Object.assign(defaults(m.engine), pr ? pr.patch : {}); };
  const drums = Object.assign(defaults("drums"), { kit: JSON.parse(JSON.stringify(KITS["808"].kit)), kitName: "808" });
  const arpPatch = presetPatch("pluck", "Gedämpft (Arp)");
  return {
    v: 1, id: "demo", name: de ? "Neon Drive (Demo)" : "Neon Drive (demo)", bpm: 100, swing: 0.5, key: "A minor", genre: "synthwave",
    tracks: [
      tr("drums", "drums", "drums", "Drums", drums, { preset: "808", color: "#ff4d94", vol: -5, rev: 0.08 }),
      tr("bass", "synth", "mono", de ? "Bass" : "Bass", presetPatch("mono", "Fetter Bass"), { preset: de ? "Fetter Bass" : "Fat bass", color: "#22e3c3", vol: -7, rev: 0 }),
      tr("pad", "synth", "poly", de ? "Fläche" : "Pad", presetPatch("poly", "Warme Fläche"), { preset: de ? "Warme Fläche" : "Warm pad", color: "#7c5cff", vol: -11, rev: 0.35, chorus: 0.4 }),
      tr("arp", "synth", "pluck", "Arp", arpPatch, { preset: de ? "Gedämpft (Arp)" : "Muted (arp)", color: "#ffb347", vol: -13, rev: 0.25, dly: 0.25, pan: 0.2 }),
      tr("lead", "synth", "super", "Lead", presetPatch("super", "Trance-Hymne"), { preset: de ? "Trance-Hymne" : "Trance anthem", color: "#5cc8ff", vol: -14, rev: 0.3, dly: 0.2 }),
    ],
    patterns: {
      A: { bars: 4, notes: { drums: drumsBeat(4, false), pad: notesPad(), arp: notesArp() } },
      B: { bars: 4, notes: { drums: drumsBeat(4, true), bass: notesBass(), pad: notesPad(), arp: notesArp(), lead: notesLead() } },
      C: { bars: 4, notes: { pad: notesPad(), lead: notesLead().map(n => ({ ...n, v: 0.6 })) } },
    },
    song: [{ p: "A", r: 1 }, { p: "B", r: 2 }, { p: "C", r: 1 }, { p: "B", r: 1 }],
    fx: { revSize: 0.6, revDecay: 2.6, dlyTime: "3/16", dlyFb: 0.35, dlyTone: 0.5 },
    master: { vol: 0 },
  };
}

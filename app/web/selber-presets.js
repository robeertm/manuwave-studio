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

// ---- 3.21: Raum für jedes Instrument (Hall bis 30 s, Einfrieren, Shimmer · Echo im Takt · Fülle & Breite) ----
const ECHO_T = [["1/16", "1/16", "1/16"], ["1/8T", "1/8 Triole", "1/8 triplet"], ["1/8", "1/8", "1/8"], ["3/16", "3/16 (punktiert)", "3/16 (dotted)"], ["1/4T", "1/4 Triole", "1/4 triplet"],
  ["1/4", "1/4", "1/4"], ["3/8", "3/8 (punktiert)", "3/8 (dotted)"], ["1/2", "1/2", "1/2"], ["3/4", "3/4", "3/4"], ["1/1", "1 Takt", "1 bar"], ["ms", "frei (ms)", "free (ms)"]];
const SPACE = [
  { id: "space", de: "Hall", en: "Reverb", p: [K("rvmix", "Hall", "Reverb", 0, 1, 0, { u: "%" }), K("rvtime", "Hallzeit", "Decay", 0.2, 30, 3, { c: "exp", u: "s" }),
    K("rvsize", "Raumgröße", "Size", 0, 1, 0.6, { u: "%" }), K("rvpre", "Vorverzögerung", "Pre-delay", 0, 0.25, 0.02, { c: "exp0", u: "s" }),
    K("rvdamp", "Hall-Höhen", "Reverb highs", 0, 1, 0.5, { u: "%" }), K("rvshim", "Shimmer (Oktave)", "Shimmer (octave)", 0, 1, 0, { u: "%" }), TOG("rvfreeze", "Einfrieren", "Freeze")] },
  { id: "echo", de: "Echo", en: "Echo", p: [K("dlmix", "Echo", "Echo", 0, 1, 0, { u: "%" }), SEL("dltime", "Echo-Zeit", "Echo time", ECHO_T, "3/16"),
    K("dlms", "Zeit frei", "Free time", 20, 2500, 350, { c: "exp", u: "ms" }), K("dlfb", "Wiederholungen", "Feedback", 0, 0.95, 0.4, { u: "%" }), K("dltone", "Echo-Ton", "Echo tone", 0, 1, 0.5, { u: "%" })] },
  { id: "fill", de: "Fülle & Breite", en: "Body & width", p: [K("fwarm", "Wärme", "Warmth", 0, 1, 0, { u: "%" }), K("fbody", "Körper", "Body", 0, 1, 0, { u: "%" }),
    K("fair", "Luft", "Air", 0, 1, 0, { u: "%" }), K("fwidth", "Breite", "Width", 0, 1, 0, { u: "%" })] },
];
const MTYPES = [["grand", "Konzertflügel", "Concert grand"], ["felt", "Filz-Klavier (soft)", "Felt piano (soft)"], ["upright", "Klavier (Upright)", "Upright piano"], ["honky", "Honky-Tonk", "Honky-tonk"],
  ["bright", "Pop-Flügel (hell)", "Pop grand (bright)"], ["dark", "Flügel dunkel", "Dark grand"], ["celesta", "Celesta", "Celesta"], ["toy", "Spielzeugklavier", "Toy piano"],
  ["marimba", "Marimba", "Marimba"], ["xylo", "Xylophon", "Xylophone"], ["vibes", "Vibraphon", "Vibraphone"], ["glock", "Glockenspiel", "Glockenspiel"], ["musicbox", "Spieluhr", "Music box"],
  ["kalimba", "Kalimba", "Kalimba"], ["tubular", "Röhrenglocken", "Tubular bells"], ["bell", "Kirchenglocke", "Church bell"], ["steel", "Steeldrum", "Steel drum"], ["bowl", "Klangschale", "Singing bowl"],
  ["glass", "Glas", "Glass"], ["gong", "Gong", "Gong"]];
const OTYPES = [["strings", "Streichorchester", "String orchestra"], ["violins", "Violinen", "Violins"], ["violas", "Bratschen", "Violas"], ["cellos", "Celli", "Cellos"], ["basses", "Kontrabässe", "Double basses"],
  ["solovln", "Solo-Violine", "Solo violin"], ["solocello", "Solo-Cello", "Solo cello"], ["pizz", "Pizzicato", "Pizzicato"], ["tremolo", "Tremolo-Streicher", "Tremolo strings"],
  ["horn", "Horn", "French horn"], ["trumpet", "Trompete", "Trumpet"], ["trombone", "Posaune", "Trombone"], ["tuba", "Tuba", "Tuba"], ["brass", "Blechbläser-Satz", "Brass section"],
  ["flute", "Flöte", "Flute"], ["panflute", "Panflöte", "Pan flute"], ["clarinet", "Klarinette", "Clarinet"], ["oboe", "Oboe", "Oboe"], ["bassoon", "Fagott", "Bassoon"], ["sax", "Saxofon", "Saxophone"],
  ["woods", "Holzbläser-Satz", "Woodwind section"]];
const SCHEMA_321 = {
  modal: [
    { id: "minst", de: "Instrument", en: "Instrument", p: [SEL("mtype", "Art", "Type", MTYPES, "grand"), K("tune", "Stimmung", "Tuning", -100, 100, 0, { u: "ct" }),
      K("stretch", "Oktavspreizung", "Octave stretch", 0, 1, 0.5, { u: "%" }), K("inh", "Saitensteifigkeit", "Inharmonicity", 0, 1, 0.5, { u: "%" }), K("uni", "Saiten-Verstimmung", "Unison width", 0, 1, 0.3, { u: "%" })] },
    { id: "hammer", de: "Hammer & Anschlag", en: "Hammer & touch", p: [K("hard", "Härte", "Hardness", 0, 1, 0.55, { u: "%" }), K("felt", "Filz", "Felt", 0, 1, 0, { u: "%" }),
      K("velb", "Anschlag → hell", "Velocity → bright", 0, 1, 0.6, { u: "%" }), K("pos", "Anschlagstelle", "Strike point", 0.05, 0.5, 0.125, { u: "%" }),
      K("noise", "Hammergeräusch", "Hammer noise", 0, 1, 0.3, { u: "%" }), K("mech", "Mechanik", "Mechanics", 0, 1, 0.2, { u: "%" })] },
    { id: "sus", de: "Ausklang & Dämpfer", en: "Sustain & damper", p: [K("decay", "Ausklang", "Sustain", 0.1, 4, 1, { c: "exp", u: "x" }), K("damper", "Dämpfer offen", "Damper open", 0, 1, 0.3, { u: "%" }),
      K("trem", "Vibraphon-Motor", "Vibes motor", 0, 1, 0.4, { u: "%" }), K("tremrate", "Motor-Tempo", "Motor rate", 1, 12, 5.5, { c: "exp", u: "Hz" }), K("width", "Stereo-Breite", "Stereo width", 0, 1, 0.5, { u: "%" })] },
    lfo(1, 5, "off"), ...SPACE, VOICE("poly", 16), ARP,
  ],
  vox: [
    { id: "choir", de: "Chor", en: "Choir", p: [SEL("lage", "Stimmlage", "Voice type", [["auto", "gemischt (nach Tonhöhe)", "mixed (by pitch)"], ["bass", "Bass", "Bass"], ["tenor", "Tenor", "Tenor"],
      ["alto", "Alt", "Alto"], ["soprano", "Sopran", "Soprano"], ["kids", "Kinderchor", "Children"]], "auto"), K("singers", "Sänger je Ton", "Singers per note", 1, 8, 4, { st: 1 }),
      K("spread", "Streuung", "Spread", 0, 1, 0.4, { u: "%" }), K("width", "Breite", "Width", 0, 1, 0.7, { u: "%" })] },
    { id: "vowel", de: "Vokal", en: "Vowel", p: [K("vowel", "Vokal (a e i o u m)", "Vowel (a e i o u m)", 0, 5, 0, { u: "vowel" }), K("vmove", "Vokal wandert", "Vowel motion", 0, 1, 0, { u: "%" }),
      K("vrate", "Wander-Tempo", "Motion rate", 0.02, 4, 0.15, { c: "exp", u: "Hz" }), K("overtone", "Obertongesang", "Overtone singing", 0, 1, 0, { u: "%" })] },
    { id: "vvoice", de: "Stimme", en: "Voice", p: [K("breath", "Atem", "Breath", 0, 1, 0.15, { u: "%" }), K("whisper", "Flüstern", "Whisper", 0, 1, 0, { u: "%" }), TOG("robot", "Roboter", "Robot"),
      K("vib", "Vibrato", "Vibrato", 0, 1, 0.35, { u: "%" }), K("vibrate", "Vibrato-Tempo", "Vibrato rate", 3, 8, 5.2, { u: "Hz" }), K("vibdel", "Vibrato-Verzögerung", "Vibrato delay", 0, 2, 0.5, { u: "s" }),
      K("att", "Einschwingen", "Attack", 0.005, 3, 0.35, { c: "exp", u: "s" }), K("rel", "Ausklingen", "Release", 0.02, 6, 0.9, { c: "exp", u: "s" })] },
    lfo(1, 5, "off"), ...SPACE, VOICE("poly", 10), ARP,
  ],
  orch: [
    { id: "oinst", de: "Instrument", en: "Instrument", p: [SEL("otype", "Instrument", "Instrument", OTYPES, "strings"), K("players", "Spieler je Ton", "Players per note", 1, 8, 6, { st: 1 }),
      K("spread", "Streuung", "Spread", 0, 1, 0.5, { u: "%" }), K("width", "Breite", "Width", 0, 1, 0.7, { u: "%" })] },
    { id: "oplay", de: "Spiel", en: "Playing", p: [K("att", "Einschwingen", "Attack", 0.002, 2, 0.2, { c: "exp", u: "s" }), K("rel", "Ausklingen", "Release", 0.02, 4, 0.5, { c: "exp", u: "s" }),
      K("expr", "Dynamik", "Expression", 0, 1, 0.6, { u: "%" }), K("bright", "Helligkeit", "Brightness", 0, 1, 0.5, { u: "%" }), K("body", "Korpus", "Body", 0, 1, 0.6, { u: "%" }),
      K("noise", "Bogen/Atem", "Bow/breath", 0, 1, 0.3, { u: "%" })] },
    { id: "ovib", de: "Vibrato", en: "Vibrato", p: [K("vib", "Vibrato", "Vibrato", 0, 1, 0.4, { u: "%" }), K("vibrate", "Tempo", "Rate", 3, 8, 5.4, { u: "Hz" }), K("vibdel", "Verzögerung", "Delay", 0, 2, 0.35, { u: "s" })] },
    ...SPACE, VOICE("poly", 10), ARP,
  ],
  wild: [
    { id: "wsrc", de: "Quelle", en: "Source", p: [SEL("wwave", "Welle", "Wave", [["saw", "Säge", "Saw"], ["square", "Rechteck", "Square"], ["tri", "Dreieck", "Triangle"], ["sine", "Sinus", "Sine"]], "saw"),
      K("tone", "Ton", "Tone", 0, 1, 0.6, { u: "%" }), K("noise", "Rauschen", "Noise", 0, 1, 0.2, { u: "%" }), K("dust", "Staub (Knistern)", "Dust (crackle)", 0, 1, 0, { u: "%" }),
      K("fmr", "FM-Verhältnis", "FM ratio", 0.25, 12, 1.5, { c: "exp", u: "x" }), K("fmi", "FM-Menge", "FM amount", 0, 1, 0, { u: "%" })] },
    { id: "wmove", de: "Fahrt", en: "Sweep", p: [K("len", "Länge", "Length", 0.05, 20, 2, { c: "exp", u: "s" }), K("span", "Tonhöhen-Fahrt", "Pitch sweep", -48, 48, 0, { st: 1, u: "st" }),
      SEL("curve", "Kurve", "Curve", [["lin", "gerade", "linear"], ["exp", "langsam, dann schnell", "slow, then fast"], ["log", "schnell, dann langsam", "fast, then slow"], ["sine", "weich", "smooth"], ["bounce", "springend", "bouncing"]], "exp"),
      K("fsweep", "Filter-Fahrt", "Filter sweep", -1, 1, 0, { u: "pm" }), K("jump", "Zufallssprünge", "Random jumps", 0, 1, 0, { u: "%" }), K("jrate", "Sprung-Tempo", "Jump rate", 0.5, 40, 8, { c: "exp", u: "Hz" }),
      K("chaos", "Chaos", "Chaos", 0, 1, 0, { u: "%" })] },
    { id: "wfilt", de: "Filter & Farbe", en: "Filter & colour", p: [SEL("fmode", "Filter", "Filter", [["lp", "Tiefpass", "Low-pass"], ["bp", "Bandpass", "Band-pass"], ["hp", "Hochpass", "High-pass"]], "lp"),
      K("cut", "Frequenz", "Frequency", 30, 18000, 3000, { c: "exp", u: "Hz" }), K("res", "Resonanz", "Resonance", 0, 0.98, 0.3, { u: "%" }), K("metal", "Metall", "Metal", 0, 0.97, 0, { u: "%" }),
      K("ring", "Ringmodulation", "Ring mod", 0, 1, 0, { u: "%" }), K("ringr", "Ring-Verhältnis", "Ring ratio", 0.1, 12, 3.1, { c: "exp", u: "x" }), K("crush", "Zerbröseln", "Crush", 0, 1, 0, { u: "%" })] },
    { id: "wpulse", de: "Hülle & Pulsieren", en: "Envelope & pulse", p: [K("att", "Einschwingen", "Attack", 0.001, 8, 0.01, { c: "exp", u: "s" }), K("sus", "Halten", "Sustain", 0, 1, 0.8, { u: "%" }),
      K("rel", "Ausklingen", "Release", 0.02, 12, 0.8, { c: "exp", u: "s" }),
      SEL("lshape2", "Puls-Form", "Pulse shape", [["sine", "Welle (Meer)", "wave (sea)"], ["square", "an/aus", "on/off"], ["heart", "Herzschlag", "heartbeat"], ["rand", "Zufall (Glitch)", "random (glitch)"]], "sine"),
      K("lrate", "Puls-Tempo", "Pulse rate", 0.02, 30, 1, { c: "exp", u: "Hz" }), K("lamt2", "Puls-Tiefe", "Pulse depth", 0, 1, 0, { u: "%" }), K("width", "Breite", "Width", 0, 1, 0.6, { u: "%" })] },
    ...SPACE, VOICE("poly", 8),
  ],
};

export const SCHEMA = {
  va: [
    { id: "osc1", de: "Oszillator 1", en: "Oscillator 1", p: [
      SEL("o1w", "Welle", "Wave", WAVES, "saw"), K("o1oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), K("o1semi", "Halbton", "Semitone", -12, 12, 0, { st: 1, u: "st" }),
      K("o1fine", "Fein", "Fine", -50, 50, 0, { u: "ct" }), K("o1pw", "Pulsbreite", "Pulse width", 0.03, 0.97, 0.5, { u: "%" }), K("o1lvl", "Pegel", "Level", 0, 1, 0.8, { u: "%" })] },
    { id: "osc2", de: "Oszillator 2", en: "Oscillator 2", p: [
      SEL("o2w", "Welle", "Wave", WAVES, "saw"), K("o2oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }), K("o2semi", "Halbton", "Semitone", -12, 12, 0, { st: 1, u: "st" }),
      K("o2fine", "Fein", "Fine", -50, 50, 7, { u: "ct" }), K("o2pw", "Pulsbreite", "Pulse width", 0.03, 0.97, 0.5, { u: "%" }), K("o2lvl", "Pegel", "Level", 0, 1, 0, { u: "%" }),
      TOG("o2sync", "Hard Sync", "Hard sync"), K("fm", "FM 2→1", "FM 2→1", 0, 1, 0, { u: "%" })] },
    { id: "osc3", de: "Oszillator 3", en: "Oscillator 3", p: [
      SEL("o3w", "Welle", "Wave", WAVES.filter(w => w[0] !== "wt"), "saw"), K("o3oct", "Oktave", "Octave", -2, 2, 0, { st: 1 }),
      K("o3semi", "Halbton", "Semitone", -12, 12, 0, { st: 1, u: "st" }), K("o3fine", "Fein", "Fine", -50, 50, -5, { u: "ct" }),
      K("o3lvl", "Pegel", "Level", 0, 1, 0, { u: "%" })] },
    { id: "mix", de: "Mischer & Unisono", en: "Mixer & unison", p: [
      K("sub", "Sub-Oszillator", "Sub oscillator", 0, 1, 0, { u: "%" }), K("noise", "Rauschen", "Noise", 0, 1, 0, { u: "%" }),
      K("uni", "Unisono", "Unison", 1, 7, 1, { st: 1 }), K("unidet", "Verstimmung", "Detune", 0, 1, 0.2, { u: "%" }),
      K("unispread", "Stereobreite", "Stereo width", 0, 1, 0.5, { u: "%" }), K("drive", "Drive", "Drive", 0, 1, 0, { u: "%" }),
      K("drift", "Analog-Drift", "Analog drift", 0, 1, 0, { u: "%" })] },
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
      K("fvel", "Anschlag", "Velocity", 0, 1, 0.3, { u: "%" }), K("accent", "Akzent (303)", "Accent (303)", 0, 1, 0, { u: "%" }),
      K("hpf", "Hochpass davor", "High-pass before", 20, 2000, 20, { c: "exp", u: "Hz" })] },
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
for (const e of ["va", "fm", "ep", "organ", "pluck"]) { const arr = SCHEMA[e], k = arr.findIndex(x => x.id === "voice"); arr.splice(k < 0 ? arr.length : k, 0, ...SPACE); }
Object.assign(SCHEMA, SCHEMA_321);
// einem anderen, der aus stand, z. B. alles von Oszillator 2 bei Pegel 0.) null = wirkt. Sonst { de, en } = warum,
// optional fix = was man dazuschalten muss (nur wenn eindeutig) und soft = wirkt, braucht aber etwas von außen (Rad, Anschlag).
export function knobIdle(eng, k, p) {
  const v = (x, d) => (p[x] !== undefined ? p[x] : d), on = (x) => Number(v(x, 0)) > 0;
  const R = (de, en, fix, soft, opener) => ({ de, en, fix, soft: !!soft, opener: !!opener });
  let m;
  // das Ziel ist der Einschalter des LFO: bleibt hell (opener), ein gewähltes Ziel bringt die Menge gleich mit
  if ((m = /^l([12])dest$/.exec(k)) && !on("l" + m[1] + "amt")) return R(`wirkt, sobald die Menge von LFO ${m[1]} über 0 ist`, `works once the amount of LFO ${m[1]} is above 0`, { ["l" + m[1] + "amt"]: 0.3 }, false, true);
  if ((m = /^l([12])(rate|shape|sync|amt)$/.exec(k))) {
    const n = m[1], dest = v("l" + n + "dest", "off"), wtUse = n === "2" && eng === "va" && on("wtlfo") && (v("o1w", "saw") === "wt" || v("o2w", "saw") === "wt");
    if (dest === "off" && !wtUse) return R(`wirkt, sobald LFO ${n} ein Ziel hat (Ziel: aus)`, `works once LFO ${n} has a destination (destination: off)`);
    if (m[2] !== "amt" && !on("l" + n + "amt") && !wtUse) return R(`wirkt, sobald die Menge von LFO ${n} über 0 ist`, `works once the amount of LFO ${n} is above 0`, { ["l" + n + "amt"]: 0.3 });
    if (m[2] === "rate" && v("l" + n + "sync", "off") !== "off") return R("läuft im Takt — „Im Takt“ auf frei stellen", "runs in tempo — set “Tempo sync” to free");
    return null;
  }
  if (k === "glide" && v("mode", "poly") === "poly") return R("wirkt nur einstimmig (Stimmen: einstimmig oder legato)", "works only in mono or legato voicing");
  if (k === "voices" && v("mode", "poly") !== "poly") return R("nur bei mehrstimmig", "only in poly voicing");
  if (k === "pb") return R("Bereich fürs Pitchbend-Rad am MIDI-Keyboard", "range of the pitch-bend wheel on a MIDI keyboard", null, true);
  if (k === "mw") return R("wirkt mit dem Modulationsrad am MIDI-Keyboard", "works with the mod wheel on a MIDI keyboard", null, true);
  if (/^arp(rate|oct|gate|latch)$/.test(k) && v("arp", "off") === "off") return R("wirkt, sobald der Arpeggiator läuft (Modus: aus)", "works once the arpeggiator runs (mode: off)");
  if (eng === "va") {
    if (k === "o1pw" && v("o1w", "saw") !== "square") return R("wirkt bei Welle Rechteck/Puls", "works with the square/pulse wave", { o1w: "square" });
    const o2 = on("o2lvl") || on("fm");
    if (k === "o2pw" && (!o2 || v("o2w", "saw") !== "square")) return R("wirkt bei Oszillator 2 mit Pegel und Welle Rechteck/Puls", "works with oscillator 2 at a level and the square/pulse wave", { ...(o2 ? {} : { o2lvl: 0.5 }), o2w: "square" });
    if (/^o2(w|oct|semi|fine|sync)$/.test(k) && !o2) return R("wirkt, sobald Oszillator 2 einen Pegel hat", "works once oscillator 2 has a level", { o2lvl: 0.5 });
    if (/^o3(w|oct|semi|fine)$/.test(k) && !on("o3lvl")) return R("wirkt, sobald Oszillator 3 einen Pegel hat", "works once oscillator 3 has a level", { o3lvl: 0.5 });
    if ((k === "unidet" || k === "unispread") && Number(v("uni", 1)) <= 1) return R("wirkt ab 2 Unisono-Stimmen", "works from 2 unison voices", { uni: 3 });
    if (/^wt(set|pos|env|lfo)$/.test(k) && v("o1w", "saw") !== "wt" && !(v("o2w", "saw") === "wt" && o2)) return R("wirkt bei Welle Wavetable", "works with the wavetable wave", { o1w: "wt" });
    if (/^f[adsr]$/.test(k) && !on("fenv") && Number(v("fenv", 0)) === 0) return R("wirkt, sobald die Filter-Hüllkurve eine Menge hat", "works once the filter envelope has an amount", { fenv: 0.4 });
    if (k === "accent") return R("wirkt bei betonten Noten (Anschlag über 94 %, z. B. Acid-Bass)", "works on accented notes (velocity above 94 %, e.g. acid bass)", null, true);
  }
  if (eng === "fm" && (m = /^op([234])(ratio|fine|att|dec|sus|rel|vel)$/.exec(k)) && !on("op" + m[1] + "lvl")) return R(`wirkt, sobald Operator ${m[1]} einen Pegel hat`, `works once operator ${m[1]} has a level`, { ["op" + m[1] + "lvl"]: 0.4 });
  if (eng === "organ" && /^perc(3|fast|soft)$/.test(k) && !v("perc", false)) return R("wirkt, sobald Perkussion an ist", "works once percussion is on", { perc: true });
  // 3.21 Raum je Instrument
  if (k === "rvfreeze" && !on("rvmix")) return R("hält den Hall fest — wirkt, sobald „Hall“ über 0 ist", "holds the reverb — works once “Reverb” is above 0", { rvmix: 0.5 });
  if (/^rv(time|size|pre|damp|shim)$/.test(k) && !on("rvmix")) return R("wirkt, sobald „Hall“ über 0 ist", "works once “Reverb” is above 0", { rvmix: 0.35 });
  if (/^rv(time|damp)$/.test(k) && v("rvfreeze", false)) return R("Hall ist eingefroren — er klingt endlos und unverändert", "the reverb is frozen — it rings endlessly and unchanged");
  if (k === "dlms" && (!on("dlmix") || v("dltime", "3/16") !== "ms")) return R("wirkt bei Echo-Zeit „frei (ms)“", "works with echo time “free (ms)”", { ...(on("dlmix") ? {} : { dlmix: 0.3 }), dltime: "ms" });
  if (/^dl(time|fb|tone)$/.test(k) && !on("dlmix")) return R("wirkt, sobald „Echo“ über 0 ist", "works once “Echo” is above 0", { dlmix: 0.3 });
  if (eng === "modal") {
    const t = v("mtype", "grand"), piano = ["grand", "felt", "upright", "honky", "bright", "dark"].includes(t);
    if ((k === "trem" || k === "tremrate") && t !== "vibes") return R("nur beim Vibraphon (Art: Vibraphon)", "only for the vibraphone (type: vibraphone)");
    if (k === "tremrate" && !on("trem")) return R("wirkt, sobald der Motor läuft", "works once the motor runs", { trem: 0.4 });
    if (/^(stretch|pos|mech)$/.test(k) && !piano) return R("nur bei den Klavieren", "only for the pianos");
    if (k === "uni" && !piano && t !== "bowl") return R("nur bei Klavieren und der Klangschale (Schwebung)", "only for pianos and the singing bowl (beating)");
  }
  if (eng === "vox" && k === "vrate" && !on("vmove")) return R("wirkt, sobald der Vokal wandert", "works once the vowel moves", { vmove: 0.4 });
  if (eng === "wild") {
    if (k === "fmr" && !on("fmi")) return R("wirkt, sobald die FM-Menge über 0 ist", "works once the FM amount is above 0", { fmi: 0.4 });
    if (k === "curve" && !Number(v("span", 0)) && !Number(v("fsweep", 0))) return R("wirkt, sobald Tonhöhe oder Filter fahren", "works once pitch or filter sweep", { span: 12 });
    if (k === "jrate" && !on("jump")) return R("wirkt, sobald es Zufallssprünge gibt", "works once there are random jumps", { jump: 0.5 });
    if (k === "ringr" && !on("ring")) return R("wirkt, sobald die Ringmodulation über 0 ist", "works once ring modulation is above 0", { ring: 0.5 });
    if ((k === "lshape2" || k === "lrate") && !on("lamt2")) return R("wirkt, sobald die Puls-Tiefe über 0 ist", "works once the pulse depth is above 0", { lamt2: 0.5 });
  }
  return null;
}

// extrem (0,9). Gedreht wird in der Reglerstellung (0…1), nicht in Einheiten: so verhalten sich Hz, Sekunden und % gleich.
// Was die Tonhöhe verschiebt (Halbtöne, Träger-Verhältnis) oder die Spielweise ändert, bleibt; danach wird geprüft, dass der
// Klang hörbar bleibt (Pegel, Filter nicht zu, Saite klingt aus). opts.short: Bass/Arp/Lead — Einschwingen bleibt kurz.
const MUT_SKIP = /^(vol|voices|pb|glide|mode|mw|arp|arprate|arpoct|arpgate|arplatch|o[123]semi|o1oct|op1ratio|op1fine|l[12]sync|kit|kitName|engine|rv\w+|dl\w+|fwarm|fbody|fair|fwidth|tune|singers|players)$/;   // 3.21: Raum gehört zum Klang, bleibt
const posOf = (q, v) => q.c === "exp" ? Math.log(v / q.min) / Math.log(q.max / q.min) : q.c === "exp0" ? Math.sqrt(Math.max(0, v / q.max)) : (v - q.min) / (q.max - q.min);
const valOf = (q, x) => { x = Math.min(1, Math.max(0, x)); let v = q.c === "exp" ? q.min * Math.pow(q.max / q.min, x) : q.c === "exp0" ? x * x * q.max : q.min + x * (q.max - q.min); if (q.st) v = Math.round(v / q.st) * q.st; return Math.min(q.max, Math.max(q.min, v)); };
export function mutatePatch(engine, patch, amt, rand = Math.random, opts = {}) {
  const out = JSON.parse(JSON.stringify(patch)), changed = [];
  const gauss = () => (rand() + rand() + rand() - 1.5) * 1.15;          // ungefähr normalverteilt, Breite ~1
  for (const sec of SCHEMA[engine] || []) for (const q of sec.p) {
    if (MUT_SKIP.test(q.k)) continue;
    if (/^o[23]oct$|^op[234]ratio$|^algo$|^(mtype|otype|lage)$/.test(q.k) && amt < 0.75) continue;
    const cur = out[q.k] !== undefined ? out[q.k] : q.def;
    if (q.t === "knob") {
      if (rand() > 0.35 + amt * 0.5) continue;
      const nv = valOf(q, posOf(q, cur) + gauss() * (0.04 + amt * 0.3));
      if (nv !== cur) { out[q.k] = Math.round(nv * 10000) / 10000; changed.push(q.k); }
    } else if (q.t === "sel" && amt >= 0.5 && rand() < amt * 0.3) {
      let opts2 = q.opts.map(o => o[0]);
      if (q.k === "o1w") opts2 = opts2.filter(x => x !== "noise");
      if (q.k === "ftype") opts2 = ["lp24", "lp12"];          // Bandpass mit hohem Cutoff klang dünn und 20–30 dB leiser (Prüfstand)
      if (/^l[12]dest$/.test(q.k) && opts.short) opts2 = opts2.filter(x => x !== "amp");
      const nv = opts2[Math.floor(rand() * opts2.length) % opts2.length];
      if (nv !== cur) { out[q.k] = nv; changed.push(q.k); if (/^l[12]dest$/.test(q.k) && nv !== "off" && !(Number(out[q.k[0] + q.k[1] + "amt"]) > 0)) out[q.k[0] + q.k[1] + "amt"] = 0.25; }
    }
  }
  // hörbar halten
  const lim = (k, lo, hi) => { if (out[k] === undefined) return; out[k] = Math.min(hi, Math.max(lo, out[k])); };
  if (engine === "va") {
    if (!(out.o1lvl >= 0.4) && !(out.o2lvl >= 0.4)) out.o1lvl = 0.6;
    if (out.ftype !== "hp12") lim("cut", 160, 20000); else lim("cut", 20, 2000);
    // eine negative Filter-Hüllkurve schließt den Filter beim Anschlag — mit tiefem Cutoff wurde es still (Prüfstand, −20 dB)
    const fe0 = Number(patch.fenv) || 0;
    if (out.fenv < 0 && fe0 >= 0) out.fenv = Math.max(out.fenv, -0.25);
    if (out.fenv < 0 && out.ftype !== "hp12") out.cut = Math.min(20000, Math.max(out.cut, 260 / Math.pow(2, out.fenv * 7 * 0.6)));
    if (out.hpf !== undefined) out.hpf = Math.min(out.hpf, Math.max(Number(patch.hpf) || 20, 200));
    lim("res", 0, 0.85); lim("noise", 0, 0.5);
    if (opts.short) { lim("aa", 0.001, 0.04); lim("ar", 0.005, 0.8); lim("fa", 0.001, 0.12); }
    else lim("aa", 0.001, 1.2);
  }
  if (engine === "fm") {
    out.op1lvl = Math.max(0.6, Number(out.op1lvl) || 0.6); lim("fb", 0, 0.8);
    for (const n of [1, 2, 3, 4]) { if (opts.short) lim("op" + n + "att", 0.001, 0.03); else lim("op" + n + "att", 0.001, 1); }
  }
  if (engine === "ep") { lim("decay", 0.8, 12); lim("rel", 0.05, 2); }
  if (engine === "pluck") { lim("decay", 0.4, 12); lim("damp", 0, 0.85); lim("bright", 0.15, 1); }
  if (engine === "organ") { if (Math.max(Number(out.db1) || 0, Number(out.db2) || 0, Number(out.db3) || 0) < 4) out.db3 = 6; }
  // 3.21
  if (engine === "modal") { lim("decay", 0.3, 4); lim("hard", 0.1, 1); lim("damper", Math.min(0.3, Number(patch.damper) || 0.3), 1); }
  if (engine === "vox") { lim("whisper", 0, 0.85); lim("overtone", 0, 0.9); if (opts.short) lim("att", 0.005, 0.06); }
  if (engine === "orch") { lim("bright", 0.15, 1); lim("expr", 0, 0.9); if (opts.short) lim("att", 0.002, 0.06); }
  if (engine === "wild") {
    const sum = (Number(out.tone) || 0) + (Number(out.noise) || 0) + (Number(out.dust) || 0) * 0.6, sum0 = (Number(patch.tone) || 0) + (Number(patch.noise) || 0) + (Number(patch.dust) || 0) * 0.6;
    if (sum < Math.min(0.5, sum0 * 0.7)) { const k2 = Number(patch.noise) > Number(patch.tone) ? "noise" : "tone"; out[k2] = Math.max(Number(out[k2]) || 0, Number(patch[k2]) || 0.5); }
    lim("res", 0, 0.85); lim("metal", 0, 0.9); lim("fmi", 0, 0.7); lim("crush", 0, 0.7); lim("lamt2", 0, 0.85);
    if (out.fmode === "lp") lim("cut", 200, 18000); else if (out.fmode === "hp") lim("cut", 30, 5000);
    if (Number(patch.sus) > 0.5) lim("sus", 0.5, 1);
  }
  return { patch: out, changed };
}

// 3.18.1: Mausrad, Trackpad und Magic-Mouse-Fläche an den Reglern (Loop-Maschine und Selber machen).
// Vorher drehte JEDES Rad-Ereignis 3 % — ein Trackpad schickt bei einer kleinen Wischbewegung 30–60 winzige Ereignisse, der
// Regler stand sofort am Anschlag; und wer die Seite scrollte, verdrehte jeden Regler, über den der Zeiger fuhr.
// Jetzt: Weg nach gescrollter Strecke (ganzer Bereich ≈ 1500 px, mit Shift 7500 px), je Ereignis höchstens 2,5 % (eine
// Mausrad-Raste wie bisher); gestufte Regler mit wenigen Stufen (Oktave, Welle …) eine Stufe je Raste oder je ~120 px.
// Eine Scroll-Geste, die auf der Seite beginnt, scrollt die Seite weiter — auch wenn der Zeiger dabei über Regler fährt.
const WHEEL = { t: 0, knob: null };
if (typeof document !== "undefined") document.addEventListener("wheel", (e) => {
  const now = performance.now(), k = e.target && e.target.closest ? e.target.closest(".sb-kface") : null;
  if (now - WHEEL.t > 350) WHEEL.knob = k;              // Pause → neue Geste: wo beginnt sie?
  else if (WHEEL.knob && k) WHEEL.knob = k;             // Geste läuft an Reglern: der unter dem Zeiger dreht
  WHEEL.t = now;
}, { capture: true, passive: true });
export const WHEEL_PX = 1500;
export function knobWheel(face, p, get, set, toPos, fromPos) {
  let acc = 0, wp = null, last = 0;
  const steps = p.st ? Math.round((p.max - p.min) / p.st) : 0, coarse = steps > 0 && steps <= 24;
  face.addEventListener("wheel", (e) => {
    let d = e.deltaY;
    if (!d && e.shiftKey) d = e.deltaX;                 // macOS: Shift macht aus dem Rad eine waagrechte Bewegung
    if (!d || Math.abs(e.deltaX) > Math.abs(e.deltaY) * 2 && !e.shiftKey) return;     // waagrecht wischen: nicht drehen
    if (WHEEL.knob !== face) return;                   // die Geste begann auf der Seite: weiter scrollen lassen
    e.preventDefault();
    if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
    const now = performance.now(); if (now - last > 350) acc = 0; last = now;     // neue Geste: Rest der alten vergessen
    const v = get();
    if (coarse) {                                       // wenige Stufen: eine je Raste (großer Ausschlag) oder je ~120 px
      if (Math.sign(d) !== Math.sign(acc)) acc = 0;
      acc += d;
      if (Math.abs(d) < 40 && Math.abs(acc) < 120) return;
      acc = 0; const nv = Math.min(p.max, Math.max(p.min, v - Math.sign(d) * p.st)); if (nv !== v) set(nv); return;
    }
    const cap = e.shiftKey ? 0.005 : 0.025, dp = Math.max(-cap, Math.min(cap, -d / (e.shiftKey ? WHEEL_PX * 5 : WHEEL_PX)));
    // die Stellung zwischen den Ereignissen fein mitführen (sonst rundet ein Stufenregler kleine Schritte zurück)
    if (wp == null || Math.abs(fromPos(p, wp) - v) > (p.st || Math.abs(p.max - p.min) * 1e-3)) wp = toPos(p, v);
    wp = Math.min(1, Math.max(0, wp + dp));
    const nv = fromPos(p, wp); if (nv !== v) set(nv);
  }, { passive: false });
}

// 3.19: Ton am Leben halten. Safari setzt den AudioContext bei jedem Bestätigungsfenster (confirm) aus und nimmt ihn nicht
// anderen Unterbrechungen. Soll etwas klingen (wanted), wird sofort fortgesetzt; verlangt der Browser dafür eine Geste,
// beim nächsten Klick oder Tastendruck.
export function keepAudioAlive(ctx, wanted) {
  let armed = false;
  const go = () => {
    armed = false; document.removeEventListener("pointerdown", go, true); document.removeEventListener("keydown", go, true);
    if (ctx.state !== "running" && ctx.state !== "closed" && wanted()) ctx.resume().catch(() => {});
  };
  const heal = () => {
    if (ctx.state === "running" || ctx.state === "closed" || !wanted()) return;
    ctx.resume().catch(() => {});
    if (!armed) { armed = true; document.addEventListener("pointerdown", go, true); document.addEventListener("keydown", go, true); }
  };
  ctx.addEventListener("statechange", () => setTimeout(heal, 30));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) heal(); });
  window.addEventListener("focus", heal);
  return heal;
}

// 3.17.2: Oberfläche — Regler, die gerade nicht wirken, abdunkeln und sagen warum (beide Ansichten: Loop-Maschine, Selber machen).
// root: Behälter mit Elementen [data-pk]; idleOf(pk) → knobIdle-Ergebnis; en: englische Oberfläche
export function markIdle(root, idleOf, en) {
  if (!root) return;
  for (const el of root.querySelectorAll("[data-pk]")) {
    const r = idleOf(el.dataset.pk);
    el.classList.toggle("idle", !!(r && !r.soft && !r.opener));
    if (el.dataset.tip === undefined) el.dataset.tip = el.getAttribute("title") || "";
    const tip = el.dataset.tip;
    el.setAttribute("title", r ? (en ? r.en : r.de) + (r.fix ? (en ? " — turning it switches that on" : " — Drehen schaltet das dazu") : "") + (tip ? "\n" + tip : "") : tip);
  }
}
// einen Regler/Schalter/eine Auswahl sichtbar auf einen Wert stellen (ohne Rückmeldung an den Klang — das macht der Aufrufer)
export function showValue(el, v) {
  if (!el) return;
  if (el.setValue) { el.setValue(v); return; }
  const sel = el.tagName === "SELECT" ? el : el.querySelector && el.querySelector("select");
  if (sel) { sel.value = String(v); return; }
  if (el.classList && el.classList.contains("sb-tog")) { el.classList.toggle("on", !!v); el.setAttribute("aria-pressed", String(!!v)); }
}
export function fixText(fix, specOf, en) {
  return Object.entries(fix).map(([k, v]) => {
    const q = specOf(k); const lab = q ? (en ? q.en : q.de) : k;
    let t = String(v);
    if (typeof v === "boolean") t = v ? (en ? "on" : "an") : (en ? "off" : "aus");
    else if (q && q.opts) { const o = q.opts.find(x => String(x[0]) === String(v)); if (o) t = en ? o[2] : o[1]; }
    else if (q && q.u === "%") t = Math.round(v * 100) + " %";
    return `${lab} → ${t}`;
  }).join(", ");
}

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
  "808": { de: "TR-808 — rund und tief", en: "TR-808 — round and deep", kit: [
    pad("kick808", { lvl: 0.95, dec: 1.4, tone: 0.35 }), pad("snare", { tone: 0.4 }), pad("clap", { lvl: 0.7 }), pad("hatc", { lvl: 0.55, pan: 0.2 }), pad("hato", { lvl: 0.5, pan: 0.2 }),
    pad("tomlo", { pan: -0.3 }), pad("tommid"), pad("tomhi", { pan: 0.3 }), pad("rim", { lvl: 0.6 }), pad("cowbell", { lvl: 0.5 }), pad("crash", { lvl: 0.5, pan: -0.2 }),
    pad("ride", { lvl: 0.45, pan: 0.25 }), pad("shaker", { lvl: 0.45, pan: -0.25 }), pad("conga", { pan: 0.35 }), pad("clave", { lvl: 0.55 }), pad("zap", { lvl: 0.5 })] },
  "909": { de: "TR-909 — House & Techno", en: "TR-909 — house & techno", kit: [
    pad("kick909", { lvl: 0.95, snap: 0.6 }), pad("snare909", { snap: 0.65 }), pad("clap", { lvl: 0.75 }), pad("hatc", { lvl: 0.6, tone: 0.65, pan: 0.15 }),
    pad("hato", { lvl: 0.55, tone: 0.65, pan: 0.15 }), pad("tomlo", { pan: -0.3, dec: 0.8 }), pad("tommid", { dec: 0.8 }), pad("tomhi", { pan: 0.3, dec: 0.8 }), pad("rim", { lvl: 0.6 }),
    pad("cowbell", { lvl: 0.45 }), pad("crash", { lvl: 0.5 }), pad("ride", { lvl: 0.5, tone: 0.6, pan: 0.2 }), pad("shaker", { lvl: 0.45 }), pad("tamb", { lvl: 0.45, pan: -0.3 }),
    pad("clave", { lvl: 0.5 }), pad("zap", { lvl: 0.45 })] },
  techno: { de: "Techno — hart und trocken", en: "Techno — hard and dry", kit: [
    pad("kick909", { lvl: 1, tune: -3, dec: 1.6, tone: 0.8, snap: 0.75 }), pad("snare909", { tone: 0.7, dec: 0.7 }), pad("clap", { lvl: 0.75, dec: 1.3 }),
    pad("hatc", { lvl: 0.55, tone: 0.8, dec: 0.7 }), pad("hato", { lvl: 0.5, tone: 0.75, dec: 0.8 }), pad("tomlo", { tune: -5 }), pad("tommid", { tune: -3 }), pad("tomhi"),
    pad("rim", { lvl: 0.65, tune: 2 }), pad("cowbell", { lvl: 0.4, tune: -2 }), pad("crash", { lvl: 0.45 }), pad("ride", { lvl: 0.55, tone: 0.75 }), pad("shaker", { lvl: 0.4 }),
    pad("lofi", { lvl: 0.4 }), pad("clave", { lvl: 0.45 }), pad("zap", { lvl: 0.5, tune: -5 })] },
  // 3.16: weitere Klassiker — Nachbauten mit den eigenen Klangmodellen
  "606": { de: "TR-606 — leicht und trocken", en: "TR-606 — light and dry", kit: [
    pad("kick808", { lvl: 0.9, tune: 4, dec: 0.6, tone: 0.55, snap: 0.6 }), pad("snare", { tone: 0.65, snap: 0.75, dec: 0.6 }), pad("clap", { lvl: 0.6, dec: 0.8 }),
    pad("hatc", { lvl: 0.55, tone: 0.8, dec: 0.6, pan: 0.15 }), pad("hato", { lvl: 0.5, tone: 0.8, dec: 0.7, pan: 0.15 }), pad("tomlo", { tune: 3, dec: 0.6, pan: -0.3 }),
    pad("tommid", { tune: 3, dec: 0.6 }), pad("tomhi", { tune: 3, dec: 0.6, pan: 0.3 }), pad("rim", { lvl: 0.55 }), pad("cowbell", { lvl: 0.4 }), pad("cymbal", { lvl: 0.45, tone: 0.7 }),
    pad("ride", { lvl: 0.4, tone: 0.7 }), pad("shaker", { lvl: 0.4 }), pad("clave", { lvl: 0.5 }), pad("tamb", { lvl: 0.4 }), pad("zap", { lvl: 0.45, tune: 5 })] },
  cr78: { de: "CR-78 — Vintage-Rhythmusbox", en: "CR-78 — vintage rhythm box", kit: [
    pad("kickacoustic", { lvl: 0.85, dec: 0.6, tone: 0.3, snap: 0.15 }), pad("snare", { tone: 0.7, snap: 0.3, dec: 0.5 }), pad("rim", { lvl: 0.6, tone: 0.6 }),
    pad("hatc", { lvl: 0.5, tone: 0.9, dec: 0.4, snap: 0.3 }), pad("hato", { lvl: 0.4, tone: 0.9, dec: 0.5, snap: 0.3 }), pad("conga", { tune: -3, pan: -0.3 }),
    pad("conga", { tune: 4, pan: 0.3 }), pad("conga", { tune: 9, dec: 0.7, pan: 0.4 }), pad("clave", { lvl: 0.55 }), pad("cowbell", { lvl: 0.45, tune: 2 }),
    pad("cymbal", { lvl: 0.4, tone: 0.6, dec: 0.7 }), pad("tamb", { lvl: 0.45, pan: -0.2 }), pad("shaker", { lvl: 0.45, pan: 0.2 }), pad("tomlo", { tune: -2, tone: 0.3 }),
    pad("tomhi", { tone: 0.3 }), pad("lofi", { lvl: 0.3 })] },
  "80s": { de: "80er — TR-707 & LinnDrum-Stil", en: "80s — TR-707 & LinnDrum style", kit: [
    pad("kick909", { lvl: 0.95, tone: 0.4, snap: 0.4, dec: 0.9 }), pad("snare909", { tone: 0.5, snap: 0.55, dec: 1.1 }), pad("clap", { lvl: 0.75, dec: 1.1 }),
    pad("hatc", { lvl: 0.55, tone: 0.55, pan: 0.15 }), pad("hato", { lvl: 0.5, tone: 0.55, dec: 1.1, pan: 0.15 }), pad("tomlo", { dec: 1.3, tone: 0.45, pan: -0.35 }),
    pad("tommid", { dec: 1.3, tone: 0.45 }), pad("tomhi", { dec: 1.3, tone: 0.45, pan: 0.35 }), pad("rim", { lvl: 0.6 }), pad("cowbell", { lvl: 0.5 }), pad("crash", { lvl: 0.55 }),
    pad("ride", { lvl: 0.45, pan: 0.2 }), pad("tamb", { lvl: 0.5, pan: -0.25 }), pad("shaker", { lvl: 0.4 }), pad("conga", { pan: 0.3 }), pad("clave", { lvl: 0.5 })] },
  trap: { de: "Trap — langes 808 und schnelle Hats", en: "Trap — long 808 and fast hats", kit: [
    pad("kick808", { lvl: 1, dec: 3.2, tone: 0.2, snap: 0.55 }), pad("snare909", { tone: 0.75, snap: 0.8, dec: 0.8 }), pad("clap", { lvl: 0.8, dec: 1.2 }),
    pad("hatc", { lvl: 0.45, tone: 0.85, dec: 0.5, pan: 0.15 }), pad("hato", { lvl: 0.4, tone: 0.8, dec: 0.9, pan: 0.15 }), pad("tomlo", { tune: -4, dec: 1.5 }), pad("tommid", { tune: -2, dec: 1.4 }),
    pad("tomhi", { dec: 1.3 }), pad("rim", { lvl: 0.6, tune: 3 }), pad("cowbell", { lvl: 0.4 }), pad("crash", { lvl: 0.45 }), pad("ride", { lvl: 0.4 }), pad("shaker", { lvl: 0.35 }),
    pad("zap", { lvl: 0.45, tune: -7 }), pad("clave", { lvl: 0.45 }), pad("lofi", { lvl: 0.3 })] },
  lofi: { de: "Lo-Fi — weich und staubig", en: "Lo-fi — soft and dusty", kit: [
    pad("kickacoustic", { lvl: 0.9, dec: 0.8, tone: 0.2, snap: 0.2 }), pad("snare", { tone: 0.15, snap: 0.3, dec: 0.8 }), pad("clap", { lvl: 0.5, tone: 0.2 }),
    pad("hatc", { lvl: 0.4, tone: 0.2, snap: 0.8 }), pad("hato", { lvl: 0.35, tone: 0.25, snap: 0.8 }), pad("tomlo", { tone: 0.2 }), pad("tommid"), pad("tomhi"),
    pad("rim", { lvl: 0.55, tone: 0.3 }), pad("cowbell", { lvl: 0.3 }), pad("cymbal", { lvl: 0.35 }), pad("ride", { lvl: 0.35, tone: 0.3 }), pad("shaker", { lvl: 0.4, tone: 0.2 }),
    pad("conga"), pad("lofi", { lvl: 0.35 }), pad("tamb", { lvl: 0.35 })] },
};

// ---- Synthesizer-Modelle: was man im "Instrument"-Menü wählt ----
// g: Gruppe im Menü — "base" Grundmodelle, "classic" Nachbauten berühmter Synthesizer (3.16), "drums"
// Die Namen der Klassiker nennen nur das Vorbild; es sind eigene Nachbauten, keine Samples und kein Bezug zu den Herstellern.
export const MODEL_GROUPS = [["base", "Grundmodelle", "Basic models"], ["classic", "Klassiker (Nachbau)", "Classics (recreations)"], ["acoustic", "Akustisch (Klangmodell)", "Acoustic (modelled)"], ["fx", "Effekte", "Effects"], ["drums", "Drums", "Drums"]];
export const MODELS = [
  { id: "poly", g: "base", engine: "va", de: "Analog Poly", en: "Analog Poly", hd: "Flächen, Akkorde, Brass — zwei Oszillatoren, Leiterfilter", he: "Pads, chords, brass — two oscillators, ladder filter" },
  { id: "mono", g: "base", engine: "va", de: "Analog Mono", en: "Analog Mono", hd: "Bässe und Leads — ein Ton, Glide, drei Oszillatoren", he: "Basses and leads — one note, glide, three oscillators" },
  { id: "super", g: "base", engine: "va", de: "Supersaw", en: "Supersaw", hd: "Sieben verstimmte Sägezähne wie beim JP-8000 — Trance, Hymnen", he: "Seven detuned saws like the JP-8000 — trance, anthems" },
  { id: "wave", g: "base", engine: "va", de: "Wavetable", en: "Wavetable", hd: "Wandernde Wellenformen — Vokale, Glas, Sync", he: "Moving waveforms — vowels, glass, sync" },
  { id: "strings", g: "base", engine: "va", de: "String Machine", en: "String Machine", hd: "Streicherflächen der 70er/80er (Solina, Polymoog)", he: "70s/80s string ensembles (Solina, Polymoog)" },
  { id: "fm", g: "base", engine: "fm", de: "FM-Synth (4 Operatoren)", en: "FM synth (4 operators)", hd: "Glocken, E-Pianos, Digitalbässe, Metall", he: "Bells, e-pianos, digital basses, metal" },
  { id: "ep", g: "base", engine: "ep", de: "E-Piano", en: "Electric piano", hd: "Zinken-Piano mit Biss und Tremolo", he: "Tine piano with bark and tremolo" },
  { id: "organ", g: "base", engine: "organ", de: "Orgel", en: "Organ", hd: "Neun Zugriegel, Perkussion, Leslie", he: "Nine drawbars, percussion, rotary" },
  { id: "pluck", g: "base", engine: "pluck", de: "Saite / Pluck", en: "String / pluck", hd: "Gezupft: Gitarre, Harfe, Koto", he: "Plucked: guitar, harp, koto" },
  // Klassiker — eigene Nachbauten im Stil der Vorbilder
  { id: "acid", g: "classic", engine: "va", de: "TB-303 · Acid-Bass", en: "TB-303 · acid bass", hd: "Säge oder Rechteck, quietschendes 24-dB-Filter, Akzent ab starkem Anschlag. Slide: Note bis in die nächste ziehen — dann gleitet der Ton ohne neuen Anschlag.", he: "Saw or square, squelchy 24 dB filter, accent on hard hits. Slide: drag a note into the next one — it glides without retriggering." },
  { id: "minimoog", g: "classic", engine: "va", de: "Minimoog · Bass & Lead", en: "Minimoog · bass & lead", hd: "Drei Oszillatoren, Leiterfilter mit Drive, einstimmig — der Bass- und Lead-Klassiker", he: "Three oscillators, ladder filter with drive, mono — the bass and lead classic" },
  { id: "juno", g: "classic", engine: "va", de: "Juno-60 · Chorus-Poly", en: "Juno-60 · chorus poly", hd: "Säge + Puls + Sub aus einem Oszillator, Hochpass, PWM — und der typische Chorus", he: "Saw + pulse + sub from one oscillator, high-pass, PWM — and that chorus" },
  { id: "jupiter", g: "classic", engine: "va", de: "Jupiter-8 · Brass & Flächen", en: "Jupiter-8 · brass & pads", hd: "Zwei Oszillatoren, Sync und Kreuzmodulation, breite Polyklänge", he: "Two oscillators, sync and cross-mod, wide poly sounds" },
  { id: "prophet", g: "classic", engine: "va", de: "Prophet-5 · warme Poly-Klänge", en: "Prophet-5 · warm poly sounds", hd: "Weiche Flächen, Keys, Poly-Mod-Glocken", he: "Soft pads, keys, poly-mod bells" },
  { id: "obx", g: "classic", engine: "va", de: "OB-Xa · Rock-Brass", en: "OB-Xa · rock brass", hd: "Helles 12-dB-Filter, große Sägezahn-Akkorde (Jump)", he: "Bright 12 dB filter, big saw chords (Jump)" },
  { id: "sh101", g: "classic", engine: "va", de: "SH-101 · Mono-Bass & Bleeps", en: "SH-101 · mono bass & bleeps", hd: "Ein Oszillator mit Säge, Puls und Sub — Bässe, Blubbern, Arp-Leads", he: "One oscillator with saw, pulse and sub — basses, blips, arp leads" },
  { id: "ms20", g: "classic", engine: "va", de: "MS-20 · schreiende Filter", en: "MS-20 · screaming filters", hd: "Hochpass und Tiefpass hintereinander, viel Resonanz und Dreck", he: "High-pass into low-pass, lots of resonance and grit" },
  { id: "odyssey", g: "classic", engine: "va", de: "ARP Odyssey · Leads", en: "ARP Odyssey · leads", hd: "Bissige Sync-Leads, Bässe, Ringmodulator-Klänge", he: "Biting sync leads, basses, ring-mod tones" },
  { id: "cs80", g: "classic", engine: "va", de: "CS-80 · Blade-Runner-Brass", en: "CS-80 · Blade Runner brass", hd: "Langsam öffnendes Filter, Vibrato am Modrad, viel Anschlagdynamik", he: "Slowly opening filter, vibrato on the mod wheel, lots of velocity" },
  { id: "taurus", g: "classic", engine: "va", de: "Taurus · Bass-Pedal", en: "Taurus · bass pedals", hd: "Drei Oszillatoren tief gestimmt — Fundament für Rock und Prog", he: "Three oscillators tuned low — the foundation for rock and prog" },
  { id: "ppg", g: "classic", engine: "va", de: "PPG Wave · Wavetable", en: "PPG Wave · wavetable", hd: "Digitale Wellen, die wandern — glasig, vokal, kühl", he: "Digital waves that move — glassy, vocal, cool" },
  { id: "dx7", g: "classic", engine: "fm", de: "DX7 · FM-Klassiker", en: "DX7 · FM classics", hd: "E-Piano, Bass, Glocken, Orgel aus vier Operatoren", he: "E-piano, bass, bells, organ from four operators" },
  { id: "m1", g: "classic", engine: "fm", de: "M1 · House-Orgel", en: "M1 · house organ", hd: "Die perkussive House-Orgel der 90er und ihre Verwandten", he: "The percussive 90s house organ and its relatives" },
  { id: "rhodes", g: "classic", engine: "ep", de: "Rhodes · E-Piano", en: "Rhodes · electric piano", hd: "Zinken-Piano: Mark I, Suitcase mit Stereo-Tremolo, Dyno", he: "Tine piano: Mark I, suitcase with stereo tremolo, Dyno" },
  { id: "wurli", g: "classic", engine: "ep", de: "Wurlitzer · E-Piano", en: "Wurlitzer · electric piano", hd: "Zungen-Piano: näselnd, bissig, mit Tremolo", he: "Reed piano: nasal, barky, with tremolo" },
  { id: "b3", g: "classic", engine: "organ", de: "B3 · Tonrad-Orgel", en: "B3 · tonewheel organ", hd: "Klassische Zugriegel-Registrierungen mit Leslie", he: "Classic drawbar registrations with rotary" },
  { id: "clav", g: "classic", engine: "pluck", de: "Clavinet · Funk-Keys", en: "Clavinet · funk keys", hd: "Hell angeschlagene, schnell gedämpfte Saiten", he: "Brightly struck, quickly damped strings" },
  { id: "drums", g: "drums", engine: "drums", de: "Drum-Machine", en: "Drum machine", hd: "16 Pads, alle synthetisch — TR-808, TR-909, 606, CR-78, 80er, Trap, Techno, Lo-Fi", he: "16 pads, all synthetic — TR-808, TR-909, 606, CR-78, 80s, trap, techno, lo-fi" },
  // 3.21: Klangmodelle ohne Samples — gerechnet wie die Synthesizer
  { id: "piano", g: "acoustic", engine: "modal", de: "Klavier & Flügel", en: "Piano & grand", hd: "Flügel, Filz-Softpiano, Upright, Honky-Tonk — Hammer, Saiten, Dämpfer, Hall bis 30 s", he: "Grand, felt soft piano, upright, honky-tonk — hammer, strings, damper, reverb up to 30 s" },
  { id: "mallet", g: "acoustic", engine: "modal", de: "Mallets & Glocken", en: "Mallets & bells", hd: "Marimba, Vibraphon, Glockenspiel, Kalimba, Röhren- und Kirchenglocken, Klangschale, Gong", he: "Marimba, vibraphone, glockenspiel, kalimba, tubular and church bells, singing bowl, gong" },
  { id: "choir", g: "acoustic", engine: "vox", de: "Chor & Stimmen", en: "Choir & voices", hd: "Chöre (a e i o u, Summen), Solostimmen, Flüstern, Obertongesang, Roboter", he: "Choirs (a e i o u, humming), solo voices, whisper, overtone singing, robot" },
  { id: "orch", g: "acoustic", engine: "orch", de: "Orchester", en: "Orchestra", hd: "Streicher, Blech, Holz — Sektionen und Solo, Vibrato, Bogen und Atem", he: "Strings, brass, woodwinds — sections and solo, vibrato, bow and breath" },
  { id: "wild", g: "fx", engine: "wild", de: "Wild & Effekte", en: "Wild & effects", hd: "Riser, Einschläge, Laser, Wind, Regen, Meer, Gewitter, Alien, Glitch, Drohnen", he: "Risers, impacts, lasers, wind, rain, sea, thunder, aliens, glitch, drones" },
];

// Standard-Patch eines Motors aus dem Schema
export function defaults(engine) {
  const out = { engine };
  for (const sec of SCHEMA[engine] || []) for (const p of sec.p) out[p.k] = p.def;
  if (engine === "drums") out.kit = JSON.parse(JSON.stringify(KITS["808"].kit)), out.kitName = "808";
  return out;
}

// ---- Werks-Presets ----
// o.ch: Chorus der Spur (gehört zum Klang des Vorbilds, z. B. Juno) — wird beim Wählen des Presets gesetzt
const P = (model, de, en, patch, o = {}) => ({ model, de, en, patch, ...o });
export const PRESETS = [
  // Analog Poly
  P("poly", "Warme Fläche", "Warm pad", { o1w: "saw", o2w: "saw", o2lvl: 0.7, o2fine: 9, cut: 1400, res: 0.15, fenv: 0.2, aa: 0.6, ad: 1.2, as: 0.8, ar: 1.6, fa: 0.8, fd: 2, fs: 0.5, l1dest: "pitch", l1amt: 0.05, l1rate: 4.5, unidet: 0.3, voices: 8 }),
  P("poly", "80er-Brass", "80s brass", { o1w: "saw", o2w: "saw", o2lvl: 0.8, o2fine: 6, cut: 900, res: 0.1, fenv: 0.55, fa: 0.05, fd: 0.5, fs: 0.4, aa: 0.03, ad: 0.4, as: 0.8, ar: 0.3 }),
  P("poly", "PWM-Streicher", "PWM strings", { vol: 0.6, o1w: "square", o1pw: 0.4, o2w: "square", o2pw: 0.6, o2lvl: 0.7, o2fine: 5, l1dest: "pw", l1amt: 0.6, l1rate: 0.7, cut: 3200, res: 0.05, fenv: 0, aa: 0.4, as: 0.9, ar: 1.2 }),
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
  P("acid", "303 Klassisch (Säge)", "303 classic (saw)", { mode: "legato", glide: 0.06, fkey: 0.1, o1w: "saw", cut: 380, res: 0.82, fenv: 0.55, fd: 0.22, fs: 0, accent: 0.7, aa: 0.002, ad: 0.3, as: 0.9, ar: 0.08, drive: 0.2 }),
  P("acid", "303 Rechteck", "303 square", { mode: "legato", glide: 0.06, fkey: 0.1, o1w: "square", o1pw: 0.5, cut: 320, res: 0.86, fenv: 0.6, fd: 0.18, fs: 0, accent: 0.8, ad: 0.3, as: 0.9, ar: 0.08, drive: 0.3 }),
  P("acid", "303 verzerrt", "303 distorted", { mode: "legato", glide: 0.05, fkey: 0.1, o1w: "saw", cut: 500, res: 0.88, fenv: 0.65, fd: 0.25, fs: 0.05, accent: 0.8, drive: 0.75, as: 0.9, ar: 0.06 }),
  P("acid", "303 Squelch (hohe Resonanz)", "303 squelch (high resonance)", { mode: "legato", glide: 0.06, fkey: 0.1, o1w: "saw", cut: 240, res: 0.93, fenv: 0.72, fd: 0.32, fs: 0, accent: 0.85, aa: 0.002, ad: 0.3, as: 0.9, ar: 0.06, drive: 0.3 }),
  P("acid", "303 tief & rund", "303 deep & round", { mode: "legato", glide: 0.07, fkey: 0.1, o1w: "square", cut: 210, res: 0.6, fenv: 0.38, fd: 0.5, fs: 0.05, accent: 0.5, aa: 0.002, ad: 0.4, as: 0.9, ar: 0.08, drive: 0.15 }),
  P("acid", "303 kurz & knackig", "303 short & snappy", { mode: "legato", glide: 0.05, fkey: 0.1, o1w: "saw", cut: 330, res: 0.8, fenv: 0.6, fd: 0.1, fs: 0, accent: 0.8, aa: 0.002, ad: 0.16, as: 0.25, ar: 0.04, drive: 0.25 }),
  P("acid", "303 hypnotisch (lang)", "303 hypnotic (long)", { mode: "legato", glide: 0.08, fkey: 0.1, o1w: "saw", cut: 280, res: 0.87, fenv: 0.5, fd: 0.9, fs: 0.08, accent: 0.6, aa: 0.002, ad: 0.5, as: 0.9, ar: 0.08, drive: 0.2, l1dest: "cut", l1sync: "4/1", l1shape: "tri", l1amt: 0.12 }),
  // ===== Klassiker (3.16) — eigene Nachbauten, die Namen nennen das Vorbild =====
  // Minimoog: drei Oszillatoren, Leiterfilter, Drive
  P("minimoog", "Moog-Bass klassisch", "Classic Moog bass", { mode: "mono", o1w: "saw", o1oct: -1, o1lvl: 0.8, o2w: "saw", o2oct: -1, o2fine: -6, o2lvl: 0.75, o3w: "square", o3oct: -2, o3fine: 0, o3lvl: 0.45,
    cut: 300, res: 0.22, fenv: 0.45, fkey: 0.4, fd: 0.35, fs: 0.2, aa: 0.002, ad: 0.5, as: 0.85, ar: 0.08, drive: 0.35 }),
  P("minimoog", "Funk-Bass gezupft", "Plucked funk bass", { vol: 1.0, mode: "mono", o1w: "saw", o1oct: -1, o2w: "square", o2oct: -1, o2fine: 4, o2lvl: 0.6, cut: 190, res: 0.35, fenv: 0.7, fkey: 0.4, fd: 0.17, fs: 0, ad: 0.32, as: 0.35, ar: 0.06, drive: 0.3 }),
  P("minimoog", "Gleitender Lead (Lucky Man)", "Gliding lead (Lucky Man)", { mode: "legato", glide: 0.22, o1w: "square", o1pw: 0.5, o2w: "saw", o2fine: 6, o2lvl: 0.75, o3w: "saw", o3oct: -1, o3lvl: 0.35,
    cut: 1700, res: 0.3, fenv: 0.2, fkey: 0.5, fd: 0.6, fs: 0.6, as: 0.95, ar: 0.3, l1dest: "pitch", l1rate: 5.2, l1amt: 0.025, drive: 0.3 }),
  P("minimoog", "Singender Lead", "Singing lead", { mode: "legato", glide: 0.07, o1w: "saw", o2w: "saw", o2fine: 8, o2lvl: 0.8, o3w: "saw", o3oct: 1, o3fine: -4, o3lvl: 0.3,
    cut: 2400, res: 0.45, fenv: 0.3, fkey: 0.5, fd: 0.5, fs: 0.5, as: 0.9, ar: 0.25, drive: 0.4 }),
  P("minimoog", "Quinten-Lead", "Fifths lead", { mode: "legato", glide: 0.05, o1w: "saw", o2w: "saw", o2semi: 7, o2fine: 3, o2lvl: 0.6, o3w: "saw", o3oct: -1, o3lvl: 0.45, cut: 2000, res: 0.3, fenv: 0.3, fd: 0.4, fs: 0.5, as: 0.9, ar: 0.25, drive: 0.3 }),
  P("minimoog", "Sub-Bass rund", "Round sub bass", { mode: "mono", o1w: "tri", o1oct: -1, o1lvl: 0.9, o3w: "sine", o3oct: -2, o3fine: 0, o3lvl: 0.6, cut: 700, res: 0.1, fenv: 0.1, ad: 0.6, as: 0.9, ar: 0.1, drive: 0.2 }),
  // Juno-60: Säge + Puls + Sub aus einem Oszillator, Hochpass, Chorus
  P("juno", "Juno-Fläche (Chorus II)", "Juno pad (chorus II)", { o1w: "saw", o1lvl: 0.65, o2w: "square", o2fine: 0, o2pw: 0.5, o2lvl: 0.45, sub: 0.3, l1dest: "pw", l1rate: 0.6, l1amt: 0.5, hpf: 120,
    cut: 1800, res: 0.15, fenv: 0.15, fa: 0.5, fd: 1.5, fs: 0.6, aa: 0.5, ad: 1, as: 0.85, ar: 1.5, voices: 6 }, { ch: 0.65 }),
  P("juno", "Juno-Bass (Sub)", "Juno bass (sub)", { mode: "mono", o1w: "square", o1oct: -1, o1pw: 0.5, o1lvl: 0.7, sub: 0.7, cut: 360, res: 0.2, fenv: 0.4, fd: 0.25, fs: 0.1, ad: 0.3, as: 0.7, ar: 0.06 }, { ch: 0.15 }),
  P("juno", "Juno-Brass", "Juno brass", { o1w: "saw", o1lvl: 0.8, sub: 0.2, cut: 700, res: 0.12, fenv: 0.55, fa: 0.08, fd: 0.6, fs: 0.4, aa: 0.04, ad: 0.5, as: 0.85, ar: 0.4, voices: 6 }, { ch: 0.45 }),
  P("juno", "Juno-Streicher", "Juno strings", { o1w: "saw", o1lvl: 0.8, hpf: 300, cut: 3500, res: 0.05, fenv: 0, aa: 0.45, as: 1, ar: 1.2, voices: 6 }, { ch: 0.8 }),
  P("juno", "Juno-Glocken-Arp", "Juno bell arp", { o1w: "square", o1pw: 0.25, o1lvl: 0.8, cut: 2200, res: 0.3, fenv: 0.4, fd: 0.2, fs: 0, aa: 0.002, ad: 0.35, as: 0, ar: 0.3, arp: "up", arprate: "1/16", arpoct: 2, arpgate: 0.6, voices: 6 }, { ch: 0.5 }),
  P("juno", "Hoover (Alpha Juno)", "Hoover (Alpha Juno)", { mode: "legato", glide: 0.15, o1w: "square", o1pw: 0.3, uni: 4, unidet: 0.6, unispread: 0.8, l1dest: "pw", l1rate: 2, l1amt: 0.5, cut: 3000, res: 0.15, fenv: 0.1, drive: 0.35, as: 1, ar: 0.4 }, { ch: 0.5 }),
  // Jupiter-8
  P("jupiter", "Jupiter-Brass", "Jupiter brass", { vol: 0.7, o1w: "saw", o2w: "saw", o2fine: 8, o2lvl: 0.85, cut: 800, res: 0.1, fenv: 0.6, fa: 0.1, fd: 0.7, fs: 0.45, aa: 0.06, ad: 0.5, as: 0.85, ar: 0.4, voices: 8 }, { ch: 0.25 }),
  P("jupiter", "Jupiter-Fläche", "Jupiter pad", { o1w: "saw", o2w: "square", o2pw: 0.45, o2fine: 6, o2lvl: 0.7, cut: 1500, res: 0.2, fenv: 0.15, l1dest: "cut", l1rate: 0.2, l1amt: 0.1, aa: 1.2, ad: 1.5, as: 0.9, ar: 2.5, voices: 8 }, { ch: 0.4 }),
  P("jupiter", "Sync-Lead", "Sync lead", { mode: "legato", glide: 0.04, o1w: "saw", o1lvl: 0.3, o2w: "saw", o2sync: true, o2semi: 9, o2lvl: 0.9, cut: 4500, res: 0.2, fenv: 0.25, as: 0.9, ar: 0.25, l1dest: "pitch", l1rate: 5.5, l1amt: 0.02 }),
  P("jupiter", "Unisono-Bass", "Unison bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "saw", o2oct: -1, o2fine: 10, o2lvl: 0.8, uni: 4, unidet: 0.2, unispread: 0.4, cut: 450, res: 0.25, fenv: 0.5, fd: 0.3, fs: 0.2, ad: 0.4, as: 0.85, ar: 0.1 }),
  P("jupiter", "Kreuzmodulierte Glocke", "Cross-mod bell", { o1w: "tri", o2w: "square", o2oct: 1, o2semi: 7, o2lvl: 0.2, fm: 0.55, cut: 6000, res: 0.1, fenv: 0, aa: 0.002, ad: 1.6, as: 0, ar: 1.2, voices: 8 }, { ch: 0.3 }),
  // Prophet-5
  P("prophet", "Prophet-Fläche warm", "Warm Prophet pad", { o1w: "saw", o2w: "square", o2pw: 0.45, o2fine: 6, o2lvl: 0.7, cut: 1200, res: 0.2, fenv: 0.25, fa: 0.9, fd: 2, fs: 0.5, aa: 0.7, as: 0.9, ar: 2, l1dest: "pitch", l1rate: 4, l1amt: 0.015, voices: 5 }),
  P("prophet", "Prophet-Keys", "Prophet keys", { o1w: "saw", o2w: "saw", o2fine: 5, o2lvl: 0.7, cut: 1600, res: 0.2, fenv: 0.35, fd: 0.7, fs: 0.2, aa: 0.003, ad: 1.2, as: 0.4, ar: 0.5, voices: 5 }),
  P("prophet", "Poly-Mod-Glocke", "Poly-mod bell", { o1w: "square", o1pw: 0.5, o2w: "tri", o2oct: 1, o2semi: 7, o2lvl: 0.1, fm: 0.5, cut: 4000, res: 0.15, fenv: 0.2, fd: 0.8, fs: 0, aa: 0.002, ad: 2, as: 0, ar: 1.5, voices: 5 }),
  P("prophet", "Prophet-Brass", "Prophet brass", { vol: 0.7, o1w: "saw", o2w: "square", o2pw: 0.35, o2fine: 7, o2lvl: 0.8, cut: 750, res: 0.15, fenv: 0.55, fa: 0.06, fd: 0.6, fs: 0.5, aa: 0.04, ad: 0.4, as: 0.85, ar: 0.35, voices: 5 }),
  P("prophet", "Sync-Kreischer", "Sync screamer", { mode: "legato", glide: 0.05, o1w: "saw", o1lvl: 0.25, o2w: "saw", o2sync: true, o2oct: 1, o2semi: 5, o2lvl: 0.85, cut: 4000, res: 0.3, fenv: 0.2, as: 0.9, ar: 0.3 }),
  // OB-Xa
  P("obx", "Jump-Brass", "Jump brass", { vol: 0.6, o1w: "saw", o2w: "saw", o2fine: 10, o2lvl: 0.9, ftype: "lp12", cut: 2600, res: 0.1, fenv: 0.25, fa: 0.01, fd: 0.4, fs: 0.7, aa: 0.01, ad: 0.3, as: 0.9, ar: 0.35, voices: 8 }, { ch: 0.2 }),
  P("obx", "OB-Fläche", "OB pad", { vol: 0.55, o1w: "saw", o2w: "saw", o2fine: 9, o2lvl: 0.85, ftype: "lp12", uni: 2, unidet: 0.2, unispread: 0.8, cut: 1600, res: 0.15, fenv: 0.15, aa: 0.8, as: 0.9, ar: 2, voices: 8 }),
  P("obx", "OB-Bass", "OB bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "saw", o2oct: -1, o2fine: 8, o2lvl: 0.8, ftype: "lp12", cut: 500, res: 0.3, fenv: 0.5, fd: 0.25, fs: 0.2, ad: 0.35, as: 0.8, ar: 0.08 }),
  P("obx", "OB-Streicher", "OB strings", { vol: 0.6, o1w: "saw", o2w: "square", o2pw: 0.4, o2fine: 6, o2lvl: 0.6, ftype: "lp12", cut: 3200, res: 0.05, fenv: 0, l1dest: "pw", l1rate: 0.8, l1amt: 0.4, aa: 0.5, as: 1, ar: 1.4, voices: 8 }, { ch: 0.35 }),
  // SH-101
  P("sh101", "101-Bass", "101 bass", { mode: "mono", o1w: "saw", o1oct: -1, o1lvl: 0.6, o2w: "square", o2oct: -1, o2fine: 0, o2lvl: 0.5, sub: 0.7, cut: 350, res: 0.3, fenv: 0.5, fkey: 0.5, fd: 0.22, fs: 0.1, ad: 0.25, as: 0.7, ar: 0.05 }),
  P("sh101", "101-Blubb", "101 bubble", { mode: "legato", glide: 0.05, o1w: "square", o1oct: -1, o1pw: 0.5, sub: 0.4, cut: 260, res: 0.65, fenv: 0.55, fd: 0.16, fs: 0, ad: 0.2, as: 0.6, ar: 0.05 }),
  P("sh101", "101-Lead (PWM)", "101 lead (PWM)", { mode: "legato", glide: 0.04, o1w: "square", o1pw: 0.3, l1dest: "pw", l1rate: 3, l1amt: 0.4, cut: 2500, res: 0.25, fenv: 0.2, as: 0.9, ar: 0.2 }),
  P("sh101", "101-Blip", "101 blip", { mode: "mono", o1w: "square", o1pw: 0.5, cut: 900, res: 0.75, fenv: 0.6, fd: 0.07, fs: 0, ad: 0.12, as: 0, ar: 0.05, arp: "up", arprate: "1/16", arpoct: 2 }),
  // MS-20
  P("ms20", "MS-20-Schrei", "MS-20 scream", { mode: "mono", o1w: "saw", o2w: "square", o2oct: -1, o2lvl: 0.5, ftype: "lp12", hpf: 300, cut: 1200, res: 0.85, fenv: 0.4, fd: 0.4, fs: 0.3, drive: 0.6, as: 0.9, ar: 0.2 }),
  P("ms20", "MS-20-Bass dreckig", "Dirty MS-20 bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "square", o2oct: -1, o2lvl: 0.6, ftype: "lp12", cut: 400, res: 0.6, fenv: 0.5, fd: 0.25, fs: 0.15, drive: 0.8, ad: 0.35, as: 0.8, ar: 0.08 }),
  P("ms20", "MS-20-Lead", "MS-20 lead", { mode: "legato", glide: 0.07, o1w: "saw", ftype: "lp12", hpf: 200, cut: 1800, res: 0.7, fenv: 0.25, drive: 0.5, l1dest: "pitch", l1rate: 5, l1amt: 0.02, as: 0.9, ar: 0.25 }),
  // ARP Odyssey
  P("odyssey", "Odyssey-Sync-Lead", "Odyssey sync lead", { mode: "legato", glide: 0.05, o1w: "square", o1pw: 0.35, o1lvl: 0.4, o2w: "saw", o2sync: true, o2semi: 7, o2lvl: 0.8, cut: 3000, res: 0.35, fenv: 0.3, as: 0.9, ar: 0.25, l1dest: "pitch", l1rate: 5.5, l1amt: 0.025 }),
  P("odyssey", "Odyssey-Bass", "Odyssey bass", { mode: "mono", o1w: "square", o1oct: -1, o2w: "saw", o2oct: -1, o2fine: 5, o2lvl: 0.7, cut: 500, res: 0.5, fenv: 0.5, fd: 0.2, fs: 0.1, ad: 0.3, as: 0.8, ar: 0.08 }),
  P("odyssey", "Ringmodulator", "Ring modulator", { o1w: "sine", o2w: "sine", o2semi: 7, o2fine: 30, o2lvl: 0.25, fm: 0.8, cut: 5000, res: 0.1, fenv: 0, aa: 0.005, ad: 1.2, as: 0.3, ar: 0.8 }),
  // CS-80
  P("cs80", "Blade-Runner-Brass", "Blade Runner brass", { vol: 0.6, o1w: "saw", o2w: "square", o2pw: 0.4, o2fine: 9, o2lvl: 0.7, uni: 2, unidet: 0.15, unispread: 0.7, hpf: 60, cut: 700, res: 0.3, fenv: 0.55, fvel: 0.7, fa: 0.4, fd: 1.5, fs: 0.55,
    aa: 0.15, ad: 1, as: 0.9, ar: 2.5, velamp: 0.8, l1dest: "pitch", l1rate: 5, l1amt: 0.015, voices: 8 }, { ch: 0.3 }),
  P("cs80", "CS-80-Fläche", "CS-80 pad", { vol: 0.7, o1w: "saw", o2w: "saw", o2fine: 10, o2lvl: 0.8, uni: 2, unidet: 0.2, unispread: 0.8, cut: 1500, res: 0.2, fenv: 0.2, fa: 1.2, fd: 2, fs: 0.6, aa: 1.5, as: 0.9, ar: 3, voices: 8 }, { ch: 0.35 }),
  P("cs80", "Vangelis-Lead", "Vangelis lead", { mode: "legato", glide: 0.12, o1w: "saw", o2w: "saw", o2fine: 7, o2lvl: 0.7, cut: 2000, res: 0.35, fenv: 0.2, fvel: 0.8, velamp: 0.9, l1dest: "pitch", l1rate: 5, l1amt: 0.04, as: 0.9, ar: 0.6 }),
  // Taurus
  P("taurus", "Taurus-Bass", "Taurus bass", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "saw", o2oct: -1, o2fine: 9, o2lvl: 0.75, o3w: "sine", o3oct: -2, o3fine: 0, o3lvl: 0.55, sub: 0.3,
    cut: 450, res: 0.25, fenv: 0.3, fd: 0.8, fs: 0.5, aa: 0.01, ad: 1, as: 0.9, ar: 0.6, drive: 0.3 }),
  P("taurus", "Taurus-Drone", "Taurus drone", { mode: "mono", o1w: "saw", o1oct: -1, o2w: "saw", o2oct: -1, o2fine: 12, o2lvl: 0.8, o3w: "tri", o3oct: -2, o3fine: 0, o3lvl: 0.6, cut: 320, res: 0.3, fenv: 0.1, l1dest: "cut", l1rate: 0.15, l1amt: 0.15, aa: 0.3, as: 1, ar: 2 }),
  // PPG Wave
  P("ppg", "PPG-Fläche", "PPG pad", { o1w: "wt", wtset: "sync", wtpos: 0.3, wtlfo: 0.4, l2rate: 0.2, o2w: "wt", o2fine: 8, o2lvl: 0.5, cut: 5000, res: 0.1, fenv: 0, aa: 0.6, as: 0.9, ar: 1.8, voices: 8 }),
  P("ppg", "PPG-Glocke", "PPG bell", { o1w: "wt", wtset: "bell", wtpos: 0.9, wtenv: -0.6, cut: 8000, res: 0.05, fenv: 0, fd: 1.5, fs: 0, aa: 0.002, ad: 2, as: 0, ar: 1.6 }),
  P("ppg", "PPG-Stimme", "PPG voice", { o1w: "wt", wtset: "vocal", wtpos: 0, wtenv: 0.5, fd: 1.5, fs: 0.3, o2w: "wt", o2fine: -7, o2lvl: 0.6, cut: 6000, res: 0.1, fenv: 0, aa: 0.2, as: 0.85, ar: 1.2 }),
  P("ppg", "PPG-Bass", "PPG bass", { mode: "mono", o1w: "wt", o1oct: -1, wtset: "fold", wtpos: 0.35, wtenv: 0.4, fd: 0.25, fs: 0.2, sub: 0.4, cut: 2500, res: 0.15, fenv: 0.15, ad: 0.4, as: 0.85, ar: 0.1 }),
  // DX7
  P("dx7", "DX-E-Piano (hell)", "DX e-piano (bright)", { algo: 5, op1ratio: 1, op2ratio: 1, op2lvl: 0.45, op2dec: 1.2, op2sus: 0.1, op3ratio: 1, op3lvl: 0.75, op4ratio: 14, op4lvl: 0.35, op4dec: 0.22, op4sus: 0,
    op1dec: 3, op1sus: 0.12, op3dec: 2.5, op3sus: 0.1, op1rel: 0.45, op3rel: 0.45, op2vel: 0.8, op4vel: 0.9 }),
  P("dx7", "Slap-Bass (Lately)", "Slap bass (Lately)", { algo: 5, op1ratio: 0.5, op1sus: 0.6, op1dec: 1.2, op2ratio: 0.5, op2lvl: 0.6, op2dec: 0.3, op2sus: 0.1, op3ratio: 0.5, op3lvl: 0.45, op3dec: 0.5, op3sus: 0.2, op4ratio: 1.5, op4lvl: 0.45, op4dec: 0.12, op4sus: 0, op1rel: 0.12, op3rel: 0.12, fb: 0.25 }),
  P("dx7", "Kristall-Glocken", "Crystal bells", { algo: 6, op4ratio: 3.5, op4lvl: 0.4, op4dec: 3, op4sus: 0, op1ratio: 1, op2ratio: 2, op2lvl: 0.5, op3ratio: 4, op3lvl: 0.35, op1dec: 4, op1sus: 0, op2dec: 3, op2sus: 0, op3dec: 2, op3sus: 0, op1rel: 1.5, op2rel: 1.5, op3rel: 1.2 }),
  P("dx7", "FM-Orgel (alle hörbar)", "FM organ (all audible)", { algo: 8, op1ratio: 0.5, op1lvl: 0.6, op2ratio: 1, op2lvl: 0.8, op3ratio: 2, op3lvl: 0.45, op4ratio: 3, op4lvl: 0.3, op1sus: 1, op2sus: 1, op3sus: 1, op4sus: 1, op1att: 0.005, op2att: 0.005, op3att: 0.005, op4att: 0.005, op1rel: 0.08, op2rel: 0.08, op3rel: 0.08, op4rel: 0.08 }),
  P("dx7", "Harmonika", "Harmonica", { algo: 1, op1ratio: 1, op2ratio: 1, op2lvl: 0.5, op2att: 0.06, op2sus: 0.7, op3ratio: 2, op3lvl: 0.3, op3sus: 0.6, op4ratio: 1, op4lvl: 0.15, fb: 0.4, op1att: 0.04, op1sus: 0.9, op1rel: 0.15, l1dest: "pitch", l1rate: 5.5, l1amt: 0.02 }),
  // M1
  P("m1", "House-Orgel", "House organ", { algo: 8, op1ratio: 1, op1lvl: 0.75, op1dec: 0.35, op1sus: 0.5, op2ratio: 2, op2lvl: 0.6, op2dec: 0.25, op2sus: 0.3, op3ratio: 3, op3lvl: 0.45, op3dec: 0.15, op3sus: 0.12, op4ratio: 4, op4lvl: 0.35, op4dec: 0.08, op4sus: 0,
    op1rel: 0.12, op2rel: 0.1, op3rel: 0.08, op4rel: 0.05, op1att: 0.001, op2att: 0.001, op3att: 0.001, op4att: 0.001 }),
  P("m1", "House-Orgel (kurz)", "House organ (short)", { algo: 8, op1ratio: 1, op1lvl: 0.8, op1dec: 0.2, op1sus: 0.15, op2ratio: 2, op2lvl: 0.6, op2dec: 0.15, op2sus: 0.05, op3ratio: 3, op3lvl: 0.45, op3dec: 0.1, op3sus: 0, op4ratio: 4, op4lvl: 0.35, op4dec: 0.06, op4sus: 0,
    op1rel: 0.08, op2rel: 0.06, op3rel: 0.05, op4rel: 0.04, op1att: 0.001, op2att: 0.001, op3att: 0.001, op4att: 0.001 }),
  P("m1", "Glocken-Fläche", "Bell pad", { algo: 7, op4ratio: 7, op4lvl: 0.3, op4dec: 2, op4sus: 0, op3ratio: 1, op3lvl: 0.5, op3dec: 3, op3sus: 0.2, op1ratio: 1, op1lvl: 0.6, op1att: 0.6, op1sus: 0.9, op2ratio: 2, op2lvl: 0.4, op2att: 0.8, op2sus: 0.8, op1rel: 1.5, op2rel: 1.5, op3rel: 1.5 }),
  // Rhodes
  P("rhodes", "Mark I", "Mark I", { tine: 0.45, bark: 0.35, bell: 0.25, decay: 5, tone: 0.6, l1dest: "off" }),
  P("rhodes", "Suitcase (Stereo-Tremolo)", "Suitcase (stereo tremolo)", { tine: 0.5, bark: 0.4, bell: 0.3, decay: 4.5, tone: 0.65, l1dest: "pan", l1amt: 0.6, l1rate: 5 }),
  P("rhodes", "Dyno (glockig)", "Dyno (bell-like)", { tine: 0.7, bark: 0.5, bell: 0.6, decay: 4, tone: 0.85, l1dest: "pan", l1amt: 0.25, l1rate: 4 }),
  P("rhodes", "Ballade (weich)", "Ballad (soft)", { tine: 0.3, bark: 0.1, bell: 0.15, decay: 6, tone: 0.45, l1dest: "pan", l1amt: 0.2, l1rate: 3.5 }),
  // Wurlitzer
  P("wurli", "200A", "200A", { vol: 1.0, tine: 0.55, tinedec: 0.4, bark: 0.9, bell: 0.1, decay: 2.5, tone: 0.8, rel: 0.15, l1dest: "amp", l1amt: 0.35, l1rate: 5.5 }),
  P("wurli", "Trocken", "Dry", { vol: 1.0, tine: 0.5, tinedec: 0.4, bark: 0.75, bell: 0.1, decay: 2.5, tone: 0.75, rel: 0.15, l1dest: "off" }),
  P("wurli", "Soul (viel Biss)", "Soul (lots of bark)", { vol: 1.0, tine: 0.6, tinedec: 0.35, bark: 1, bell: 0.05, decay: 2, tone: 0.9, rel: 0.12, l1dest: "amp", l1amt: 0.5, l1rate: 6 }),
  // B3
  P("b3", "Jazz 888000000 (Perk. 3.)", "Jazz 888000000 (perc. 3rd)", { db1: 8, db2: 8, db3: 8, db4: 0, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, perc: true, perc3: true, percfast: true, vib: "c3", leslie: "slow", drive: 0.15 }),
  P("b3", "Blues 888800000", "Blues 888800000", { db1: 8, db2: 8, db3: 8, db4: 8, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, perc: true, perc3: false, percfast: true, vib: "c3", leslie: "slow", drive: 0.35, click: 0.4 }),
  P("b3", "Rock 888888888 (Leslie schnell)", "Rock 888888888 (fast rotary)", { db1: 8, db2: 8, db3: 8, db4: 8, db5: 8, db6: 8, db7: 8, db8: 8, db9: 8, click: 0.5, vib: "c3", leslie: "fast", drive: 0.6 }),
  P("b3", "Ballade 008600000", "Ballad 008600000", { db1: 0, db2: 0, db3: 8, db4: 6, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, click: 0.15, vib: "v2", leslie: "slow", drive: 0 }),
  // Clavinet
  P("clav", "Clavinet D6", "Clavinet D6", { vol: 0.7, bright: 0.9, damp: 0.2, decay: 1.2, pos: 0.06, body: 0.1, rel: 0.08, velb: 0.8 }),
  P("clav", "Funk gedämpft", "Funk muted", { vol: 0.55, bright: 0.8, damp: 0.55, decay: 0.5, pos: 0.05, body: 0.08, rel: 0.05, velb: 0.9 }),
  // Supersaw
  P("super", "Trance-Hymne", "Trance anthem", { o1w: "saw", uni: 7, unidet: 0.45, unispread: 0.9, o2w: "saw", o2oct: 1, o2lvl: 0.25, cut: 7000, res: 0.1, fenv: 0.1, aa: 0.01, ad: 0.6, as: 0.85, ar: 0.6, voices: 8 }),
  P("super", "Hoover", "Hoover", { mode: "legato", glide: 0.12, o1w: "square", o1pw: 0.3, uni: 5, unidet: 0.7, unispread: 0.8, l1dest: "pw", l1amt: 0.5, l1rate: 2, cut: 3000, res: 0.15, drive: 0.4, as: 1, ar: 0.4 }),
  P("super", "Supersaw-Pluck", "Supersaw pluck", { o1w: "saw", uni: 7, unidet: 0.35, unispread: 0.8, cut: 900, res: 0.2, fenv: 0.6, fd: 0.3, fs: 0, aa: 0.002, ad: 0.4, as: 0, ar: 0.35 }),
  // Wavetable
  P("wave", "Sprechende Fläche", "Talking pad", { o1w: "wt", wtset: "vocal", wtpos: 0.1, wtlfo: 0.9, l2rate: 0.15, o2w: "wt", o2fine: 9, o2lvl: 0.6, cut: 6000, res: 0.1, fenv: 0, aa: 0.8, as: 0.9, ar: 1.8 }),
  P("wave", "Glasglocke", "Glass bell", { o1w: "wt", wtset: "bell", wtpos: 0.8, wtenv: -0.7, cut: 9000, res: 0.05, fenv: 0, aa: 0.002, ad: 2.5, as: 0, ar: 2.2 }),
  P("wave", "Wavefolder-Bass", "Wavefolder bass", { mode: "mono", o1w: "wt", o1oct: -1, wtset: "fold", wtpos: 0.2, wtenv: 0.6, fd: 0.3, fs: 0.1, sub: 0.5, cut: 3000, res: 0.15, fenv: 0.2, as: 0.9, ar: 0.12 }),
  P("wave", "Sync-Sweep", "Sync sweep", { o1w: "wt", wtset: "sync", wtpos: 0, wtenv: 0.8, fd: 1.2, fs: 0.2, cut: 7000, as: 0.8, ar: 0.5 }),
  // Strings
  P("strings", "Solina-Streicher", "Ensemble strings", { vol: 0.65, o1w: "saw", o2w: "saw", o2oct: 1, o2lvl: 0.5, o2fine: 4, uni: 3, unidet: 0.25, unispread: 0.9, cut: 4500, res: 0, fenv: 0, ftype: "lp12", aa: 0.35, as: 1, ar: 1.4, l1dest: "pitch", l1amt: 0.04, l1rate: 5.5 }),
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
  P("pluck", "Koto", "Koto", { vol: 0.65, bright: 0.8, damp: 0.15, decay: 2.5, pos: 0.08, body: 0.3, l1dest: "pitch", l1amt: 0.03 }),
  P("pluck", "Gedämpft (Arp)", "Muted (arp)", { bright: 0.4, damp: 0.7, decay: 0.6, pos: 0.25, body: 0.25, rel: 0.1 }),
  // ===== 3.21 Klavier & Flügel (Klangmodell) =====
  P("piano", "Konzertflügel", "Concert grand", { mtype: "grand", hard: 0.6, rvmix: 0.18, rvtime: 2.4, rvsize: 0.7 }, { cat: "keys", tags: ["hell", "klassisch"] }),
  P("piano", "Flügel weich (Ballade)", "Soft grand (ballad)", { mtype: "grand", hard: 0.38, velb: 0.7, rvmix: 0.25, rvtime: 3, fbody: 0.3 }, { cat: "keys", tags: ["weich", "warm"] }),
  P("piano", "Filz-Klavier (Soft Piano)", "Felt piano (soft piano)", { mtype: "felt", hard: 0.25, felt: 0.85, noise: 0.45, mech: 0.45, damper: 0.45, rvmix: 0.3, rvtime: 4, fwarm: 0.3, fbody: 0.35 }, { cat: "keys", tags: ["weich", "warm", "intim"] }),
  P("piano", "Filz mit langem Hall", "Felt with long reverb", { mtype: "felt", hard: 0.22, felt: 0.9, noise: 0.4, mech: 0.4, damper: 0.6, rvmix: 0.55, rvtime: 11, rvsize: 0.95, rvpre: 0.04, rvdamp: 0.35, fbody: 0.3 }, { cat: "keys", tags: ["weich", "lang", "hall"] }),
  P("piano", "Filz-Echo-Traum", "Felt echo dream", { mtype: "felt", hard: 0.2, felt: 0.9, damper: 0.55, dlmix: 0.38, dltime: "1/4", dlfb: 0.55, dltone: 0.35, rvmix: 0.4, rvtime: 7, fwarm: 0.25 }, { cat: "keys", tags: ["weich", "echo", "lang"] }),
  P("piano", "Nachtklavier (Shimmer)", "Night piano (shimmer)", { mtype: "felt", hard: 0.28, felt: 0.75, damper: 0.7, rvmix: 0.6, rvtime: 14, rvsize: 1, rvshim: 0.45, rvdamp: 0.55, fwidth: 0.4 }, { cat: "keys", tags: ["weich", "lang", "hall", "schwebend"] }),
  P("piano", "Klavier in der Kathedrale", "Piano in the cathedral", { mtype: "grand", hard: 0.45, rvmix: 0.7, rvtime: 18, rvsize: 1, rvpre: 0.08, rvdamp: 0.4 }, { cat: "keys", tags: ["lang", "hall"] }),
  P("piano", "Unendliches Klavier", "Endless piano", { mtype: "felt", hard: 0.3, felt: 0.7, damper: 1, decay: 3, rvmix: 0.65, rvtime: 30, rvsize: 1, rvshim: 0.25, fwidth: 0.5 }, { cat: "keys", tags: ["lang", "hall", "schwebend"] }),
  P("piano", "Lo-Fi-Kassettenklavier", "Lo-fi cassette piano", { mtype: "felt", hard: 0.35, felt: 0.6, tune: -18, uni: 0.6, noise: 0.5, mech: 0.6, fwarm: 0.7, fair: 0, rvmix: 0.2, rvtime: 1.6, l1dest: "pitch", l1rate: 0.6, l1amt: 0.03 }, { cat: "keys", tags: ["warm", "lofi", "weich"] }),
  P("piano", "Upright warm", "Warm upright", { mtype: "upright", hard: 0.45, uni: 0.45, fbody: 0.4, rvmix: 0.15, rvtime: 1.4 }, { cat: "keys", tags: ["warm"] }),
  P("piano", "Upright in der Bar", "Bar upright", { mtype: "upright", hard: 0.6, uni: 0.7, noise: 0.4, mech: 0.35, rvmix: 0.12, rvtime: 1 }, { cat: "keys", tags: ["hell"] }),
  P("piano", "Honky-Tonk-Saloon", "Honky-tonk saloon", { mtype: "honky", hard: 0.7, uni: 0.7, rvmix: 0.1, rvtime: 0.9 }, { cat: "keys", tags: ["hell", "retro"] }),
  P("piano", "Pop-Flügel hell", "Bright pop grand", { mtype: "bright", hard: 0.85, velb: 0.8, fair: 0.4, rvmix: 0.15, rvtime: 1.8 }, { cat: "keys", tags: ["hell"] }),
  P("piano", "Dunkler Flügel", "Dark grand", { mtype: "dark", hard: 0.4, fbody: 0.4, rvmix: 0.22, rvtime: 3.2 }, { cat: "keys", tags: ["dunkel", "warm"] }),
  P("piano", "Ambient-Klavier mit Echo", "Ambient piano with echo", { mtype: "grand", hard: 0.35, felt: 0.4, damper: 0.6, dlmix: 0.32, dltime: "3/8", dlfb: 0.6, dltone: 0.4, rvmix: 0.45, rvtime: 9, rvshim: 0.15, fwidth: 0.5 }, { cat: "keys", tags: ["echo", "hall", "lang"] }),
  P("piano", "Celesta", "Celesta", { mtype: "celesta", hard: 0.6, rvmix: 0.25, rvtime: 2.5 }, { cat: "mallet", tags: ["hell", "klassisch"] }),
  P("piano", "Celesta im Märchenwald", "Fairy-tale celesta", { mtype: "celesta", hard: 0.5, rvmix: 0.5, rvtime: 8, rvshim: 0.3, dlmix: 0.2, dltime: "1/8T" }, { cat: "mallet", tags: ["hell", "lang", "schwebend"] }),
  P("piano", "Spielzeugklavier", "Toy piano", { mtype: "toy", hard: 0.9, rvmix: 0.15, rvtime: 1.2 }, { cat: "keys", tags: ["hell", "kurz"] }),
  // ===== Mallets & Glocken =====
  P("mallet", "Marimba", "Marimba", { mtype: "marimba", hard: 0.5, rvmix: 0.15, rvtime: 1.5 }, { cat: "mallet", tags: ["warm", "kurz"] }),
  P("mallet", "Marimba weich (Filzschlägel)", "Soft marimba (felt mallets)", { mtype: "marimba", hard: 0.2, noise: 0.15, rvmix: 0.25, rvtime: 2.4, fbody: 0.3 }, { cat: "mallet", tags: ["weich", "warm"] }),
  P("mallet", "Xylophon", "Xylophone", { mtype: "xylo", hard: 0.8, rvmix: 0.15, rvtime: 1.2 }, { cat: "mallet", tags: ["hell", "kurz"] }),
  P("mallet", "Vibraphon (Motor)", "Vibraphone (motor)", { mtype: "vibes", hard: 0.4, trem: 0.5, tremrate: 5.5, damper: 0.4, rvmix: 0.2, rvtime: 2.2 }, { cat: "mallet", tags: ["weich", "jazz"] }),
  P("mallet", "Vibraphon ohne Motor", "Vibraphone (no motor)", { mtype: "vibes", hard: 0.45, trem: 0, damper: 0.5, rvmix: 0.25, rvtime: 3 }, { cat: "mallet", tags: ["weich"] }),
  P("mallet", "Glockenspiel", "Glockenspiel", { mtype: "glock", hard: 0.8, rvmix: 0.2, rvtime: 2 }, { cat: "mallet", tags: ["hell"] }),
  P("mallet", "Spieluhr", "Music box", { mtype: "musicbox", hard: 0.9, damper: 0.7, rvmix: 0.2, rvtime: 1.8 }, { cat: "mallet", tags: ["hell", "kurz"] }),
  P("mallet", "Spieluhr im Traum", "Dreamy music box", { mtype: "musicbox", hard: 0.8, damper: 0.8, rvmix: 0.55, rvtime: 9, rvshim: 0.35, dlmix: 0.25, dltime: "1/4" }, { cat: "mallet", tags: ["lang", "schwebend"] }),
  P("mallet", "Kalimba", "Kalimba", { mtype: "kalimba", hard: 0.55, rvmix: 0.15, rvtime: 1.4, fbody: 0.3 }, { cat: "world", tags: ["warm", "kurz"] }),
  P("mallet", "Kalimba mit Echo", "Kalimba with echo", { mtype: "kalimba", hard: 0.5, dlmix: 0.35, dltime: "3/16", dlfb: 0.5, rvmix: 0.3, rvtime: 3 }, { cat: "world", tags: ["echo"] }),
  P("mallet", "Röhrenglocken", "Tubular bells", { mtype: "tubular", hard: 0.7, damper: 0.8, rvmix: 0.3, rvtime: 5 }, { cat: "mallet", tags: ["lang", "klassisch"] }),
  P("mallet", "Kirchenglocke", "Church bell", { mtype: "bell", hard: 0.8, damper: 1, rvmix: 0.45, rvtime: 8, rvsize: 1 }, { cat: "mallet", tags: ["lang", "dunkel"] }),
  P("mallet", "Steeldrum", "Steel drum", { mtype: "steel", hard: 0.5, rvmix: 0.15, rvtime: 1.4 }, { cat: "world", tags: ["hell", "kurz"] }),
  P("mallet", "Klangschale", "Singing bowl", { mtype: "bowl", hard: 0.3, damper: 1, rvmix: 0.35, rvtime: 6 }, { cat: "world", tags: ["lang", "schwebend"] }),
  P("mallet", "Klangschalen-Tempel", "Singing bowl temple", { mtype: "bowl", hard: 0.25, damper: 1, decay: 2, rvmix: 0.65, rvtime: 20, rvsize: 1, rvshim: 0.2 }, { cat: "texture", tags: ["lang", "hall", "schwebend"] }),
  P("mallet", "Glasharfe", "Glass harp", { mtype: "glass", hard: 0.4, damper: 0.8, rvmix: 0.4, rvtime: 5, fwidth: 0.4 }, { cat: "mallet", tags: ["hell", "schwebend"] }),
  P("mallet", "Gong", "Gong", { mtype: "gong", hard: 0.5, damper: 1, rvmix: 0.35, rvtime: 7 }, { cat: "world", tags: ["dunkel", "lang"] }),
  P("mallet", "Glocken-Kaskade", "Bell cascade", { mtype: "glock", hard: 0.7, dlmix: 0.45, dltime: "1/8T", dlfb: 0.7, dltone: 0.7, rvmix: 0.35, rvtime: 5, fwidth: 0.5 }, { cat: "mallet", tags: ["echo", "hell"] }),
  // ===== Chöre & Stimmen =====
  P("choir", "Chor „Aah“ gemischt", "Choir “aah” mixed", { lage: "auto", vowel: 0, singers: 5, rvmix: 0.35, rvtime: 4 }, { cat: "voice", tags: ["klassisch", "weich"] }),
  P("choir", "Chor „Ooh“ weich", "Soft choir “ooh”", { lage: "auto", vowel: 3.3, singers: 6, breath: 0.25, att: 0.6, rvmix: 0.4, rvtime: 5 }, { cat: "voice", tags: ["weich", "warm"] }),
  P("choir", "Summen „Mmm“", "Humming “mmm”", { lage: "auto", vowel: 5, singers: 5, breath: 0.1, att: 0.5, rvmix: 0.3, rvtime: 3 }, { cat: "voice", tags: ["weich", "warm", "intim"] }),
  P("choir", "Knabenchor", "Boys' choir", { lage: "kids", vowel: 3.4, singers: 6, vib: 0.2, rvmix: 0.5, rvtime: 6 }, { cat: "voice", tags: ["hell", "klassisch"] }),
  P("choir", "Männerchor tief", "Low male choir", { lage: "bass", vowel: 3, singers: 6, vib: 0.25, rvmix: 0.4, rvtime: 5 }, { cat: "voice", tags: ["dunkel"] }),
  P("choir", "Frauenchor", "Women's choir", { lage: "soprano", vowel: 0.2, singers: 6, rvmix: 0.4, rvtime: 4.5 }, { cat: "voice", tags: ["hell"] }),
  P("choir", "Kammerchor", "Chamber choir", { lage: "auto", vowel: 0.4, singers: 3, spread: 0.3, rvmix: 0.3, rvtime: 2.6 }, { cat: "voice", tags: ["klassisch", "intim"] }),
  P("choir", "Großer Chor im Dom", "Grand choir in the cathedral", { vol: 0.65, lage: "auto", vowel: 0, singers: 8, spread: 0.55, att: 0.5, rvmix: 0.65, rvtime: 12, rvsize: 1, rvpre: 0.06, fwidth: 0.4 }, { cat: "voice", tags: ["lang", "hall", "klassisch"] }),
  P("choir", "Gregorianik", "Gregorian chant", { lage: "tenor", vowel: 3, singers: 5, vib: 0.1, spread: 0.2, rvmix: 0.7, rvtime: 14, rvsize: 1 }, { cat: "voice", tags: ["dunkel", "lang", "hall"] }),
  P("choir", "Engelschor", "Angel choir", { lage: "kids", vowel: 0.3, singers: 6, att: 0.9, rvmix: 0.6, rvtime: 12, rvshim: 0.45, fwidth: 0.5 }, { cat: "voice", tags: ["hell", "schwebend", "lang"] }),
  P("choir", "Vokal-Fläche wandernd", "Moving vowel pad", { lage: "auto", vowel: 1, vmove: 0.6, vrate: 0.12, singers: 6, att: 1.2, rel: 2.5, rvmix: 0.5, rvtime: 8 }, { cat: "pad", tags: ["schwebend", "lang"] }),
  P("choir", "Solo-Stimme „Aah“", "Solo voice “aah”", { lage: "alto", vowel: 0, singers: 1, vib: 0.55, vibdel: 0.3, att: 0.12, rvmix: 0.3, rvtime: 3, mode: "legato", glide: 0.08 }, { cat: "voice", tags: ["intim"] }),
  P("choir", "Solo-Sopran", "Solo soprano", { lage: "soprano", vowel: 0.1, singers: 1, vib: 0.7, att: 0.15, rvmix: 0.4, rvtime: 4, mode: "legato", glide: 0.06 }, { cat: "voice", tags: ["hell", "klassisch"] }),
  P("choir", "Pop-Vocal-Stack", "Pop vocal stack", { lage: "alto", vowel: 0.6, singers: 3, spread: 0.25, att: 0.04, rel: 0.4, vib: 0.2, rvmix: 0.2, rvtime: 1.8, dlmix: 0.15, dltime: "1/8" }, { cat: "voice", tags: ["hell", "kurz"] }),
  P("choir", "Flüsterchor", "Whisper choir", { lage: "auto", whisper: 0.85, breath: 0.4, singers: 6, att: 0.4, rvmix: 0.5, rvtime: 6 }, { cat: "voice", tags: ["dunkel", "wild"] }),
  P("choir", "Obertonsänger", "Overtone singer", { lage: "bass", vowel: 3.5, singers: 1, overtone: 0.85, vib: 0.05, vrate: 0.08, rvmix: 0.45, rvtime: 6 }, { cat: "voice", tags: ["wild", "welt"] }),
  P("choir", "Roboterstimme", "Robot voice", { lage: "tenor", robot: true, singers: 1, vowel: 0.5, vmove: 0.4, vrate: 2, breath: 0, rvmix: 0.1, rvtime: 1 }, { cat: "voice", tags: ["wild", "retro"] }),
  P("choir", "Mönche im Nebel", "Monks in the mist", { lage: "bass", vowel: 3.2, singers: 7, breath: 0.3, att: 1.2, rel: 3, rvmix: 0.7, rvtime: 16, rvsize: 1, rvdamp: 0.25 }, { cat: "voice", tags: ["dunkel", "lang", "hall"] }),
  P("choir", "Geisterchor", "Ghost choir", { lage: "auto", whisper: 0.45, vmove: 0.5, vrate: 0.2, singers: 6, att: 1.5, rel: 4, rvmix: 0.65, rvtime: 18, rvshim: 0.35, fwidth: 0.6 }, { cat: "texture", tags: ["wild", "dunkel", "lang"] }),
  // ===== Orchester =====
  P("orch", "Streichorchester", "String orchestra", { otype: "strings", players: 8, att: 0.3, rel: 0.7, rvmix: 0.35, rvtime: 3.5 }, { cat: "strings", tags: ["klassisch", "warm"] }),
  P("orch", "Streicher weich (langsam)", "Soft strings (slow)", { otype: "strings", players: 8, att: 0.9, rel: 1.4, bright: 0.35, rvmix: 0.4, rvtime: 4.5 }, { cat: "strings", tags: ["weich", "lang"] }),
  P("orch", "Filmstreicher", "Film strings", { otype: "strings", players: 8, att: 0.45, rel: 1.2, expr: 0.8, rvmix: 0.55, rvtime: 7, rvsize: 1, fwidth: 0.4, fbody: 0.3 }, { cat: "strings", tags: ["lang", "hall"] }),
  P("orch", "Violinen", "Violins", { otype: "violins", players: 6, att: 0.18, rvmix: 0.3, rvtime: 3 }, { cat: "strings", tags: ["hell", "klassisch"] }),
  P("orch", "Bratschen", "Violas", { otype: "violas", players: 5, att: 0.2, rvmix: 0.3, rvtime: 3 }, { cat: "strings", tags: ["warm"] }),
  P("orch", "Celli", "Cellos", { otype: "cellos", players: 5, att: 0.22, rvmix: 0.3, rvtime: 3 }, { cat: "strings", tags: ["warm", "dunkel"] }),
  P("orch", "Kontrabässe", "Double basses", { otype: "basses", players: 4, att: 0.25, rvmix: 0.25, rvtime: 2.6 }, { cat: "strings", tags: ["dunkel"] }),
  P("orch", "Solo-Violine", "Solo violin", { otype: "solovln", players: 1, att: 0.09, vib: 0.8, rvmix: 0.3, rvtime: 2.6, mode: "legato", glide: 0.05 }, { cat: "strings", tags: ["hell", "intim"] }),
  P("orch", "Solo-Cello", "Solo cello", { otype: "solocello", players: 1, att: 0.1, vib: 0.75, rvmix: 0.3, rvtime: 2.8, mode: "legato", glide: 0.06 }, { cat: "strings", tags: ["warm", "intim"] }),
  P("orch", "Pizzicato", "Pizzicato", { otype: "pizz", players: 4, att: 0.002, rel: 0.25, vib: 0, rvmix: 0.25, rvtime: 2 }, { cat: "strings", tags: ["kurz"] }),
  P("orch", "Tremolo-Streicher", "Tremolo strings", { otype: "tremolo", players: 6, att: 0.1, rvmix: 0.35, rvtime: 3.5 }, { cat: "strings", tags: ["spannung"] }),
  P("orch", "Horn", "French horn", { otype: "horn", players: 1, att: 0.06, rvmix: 0.3, rvtime: 3 }, { cat: "brass", tags: ["warm", "klassisch"] }),
  P("orch", "Hörner im Saal", "Horns in the hall", { otype: "horn", players: 4, spread: 0.4, att: 0.09, rvmix: 0.5, rvtime: 5, rvsize: 0.9 }, { cat: "brass", tags: ["warm", "hall"] }),
  P("orch", "Trompete", "Trumpet", { otype: "trumpet", players: 1, att: 0.035, rvmix: 0.2, rvtime: 2, mode: "legato", glide: 0.03 }, { cat: "brass", tags: ["hell"] }),
  P("orch", "Posaune", "Trombone", { otype: "trombone", players: 1, att: 0.05, rvmix: 0.2, rvtime: 2.2 }, { cat: "brass", tags: ["warm"] }),
  P("orch", "Tuba", "Tuba", { otype: "tuba", players: 1, att: 0.07, rvmix: 0.2, rvtime: 2 }, { cat: "brass", tags: ["dunkel"] }),
  P("orch", "Blechbläser-Satz", "Brass section", { otype: "brass", players: 4, att: 0.06, rvmix: 0.3, rvtime: 2.8 }, { cat: "brass", tags: ["hell"] }),
  P("orch", "Fanfare", "Fanfare", { otype: "brass", players: 5, att: 0.03, expr: 0.9, bright: 0.8, rvmix: 0.4, rvtime: 3.5 }, { cat: "brass", tags: ["hell", "spannung"] }),
  P("orch", "Flöte", "Flute", { otype: "flute", players: 1, att: 0.06, vib: 0.5, rvmix: 0.3, rvtime: 2.6, mode: "legato", glide: 0.04 }, { cat: "winds", tags: ["weich", "klassisch"] }),
  P("orch", "Panflöte", "Pan flute", { otype: "panflute", players: 1, att: 0.04, rvmix: 0.35, rvtime: 3.5 }, { cat: "winds", tags: ["weich", "welt"] }),
  P("orch", "Klarinette", "Clarinet", { otype: "clarinet", players: 1, att: 0.045, rvmix: 0.25, rvtime: 2.2, mode: "legato", glide: 0.03 }, { cat: "winds", tags: ["warm"] }),
  P("orch", "Oboe", "Oboe", { otype: "oboe", players: 1, att: 0.04, vib: 0.4, rvmix: 0.25, rvtime: 2.4, mode: "legato", glide: 0.03 }, { cat: "winds", tags: ["hell", "klassisch"] }),
  P("orch", "Fagott", "Bassoon", { otype: "bassoon", players: 1, att: 0.05, rvmix: 0.25, rvtime: 2.2 }, { cat: "winds", tags: ["dunkel"] }),
  P("orch", "Saxofon", "Saxophone", { otype: "sax", players: 1, att: 0.04, vib: 0.5, rvmix: 0.2, rvtime: 1.8, mode: "legato", glide: 0.04 }, { cat: "winds", tags: ["warm", "jazz"] }),
  P("orch", "Holzbläser-Satz", "Woodwind section", { otype: "woods", players: 3, att: 0.08, rvmix: 0.3, rvtime: 2.8 }, { cat: "winds", tags: ["klassisch"] }),
  // ===== Wild & Effekte =====
  P("wild", "Riser (Rauschen)", "Riser (noise)", { tone: 0, noise: 0.9, fmode: "bp", cut: 300, fsweep: 1, res: 0.5, len: 8, curve: "exp", sus: 1, rel: 0.4, rvmix: 0.35, rvtime: 3 }, { cat: "fx", tags: ["übergang", "spannung"] }),
  P("wild", "Riser mit Ton", "Tonal riser", { wwave: "saw", tone: 0.7, noise: 0.4, span: 24, curve: "exp", len: 8, cut: 600, fsweep: 0.8, res: 0.4, sus: 1, rel: 0.3, rvmix: 0.3, rvtime: 3, fwidth: 0.5 }, { cat: "fx", tags: ["übergang", "spannung"] }),
  P("wild", "Absturz (Downlifter)", "Downlifter", { wwave: "saw", tone: 0.6, noise: 0.6, span: -36, curve: "log", len: 3, cut: 8000, fsweep: -0.8, res: 0.3, sus: 0, rel: 0.5, rvmix: 0.4, rvtime: 4 }, { cat: "fx", tags: ["übergang"] }),
  P("wild", "Einschlag (Boom)", "Impact (boom)", { vol: 0.6, wwave: "sine", tone: 1, noise: 0.6, span: -24, curve: "log", len: 1.2, cut: 900, fsweep: -0.6, sus: 0, rel: 1.5, att: 0.001, rvmix: 0.5, rvtime: 6, fbody: 0.6, fwarm: 0.5 }, { cat: "fx", tags: ["übergang", "dunkel"] }),
  P("wild", "Laser", "Laser", { wwave: "square", tone: 0.8, noise: 0, span: -40, curve: "log", len: 0.35, cut: 6000, res: 0.6, sus: 0, rel: 0.1, att: 0.001, dlmix: 0.3, dltime: "1/16", dlfb: 0.5 }, { cat: "fx", tags: ["kurz", "retro"] }),
  P("wild", "Zap-Schuss", "Zap shot", { wwave: "saw", tone: 0.8, span: 30, curve: "exp", len: 0.15, fmi: 0.5, fmr: 3.3, sus: 0, rel: 0.08, att: 0.001, cut: 9000 }, { cat: "fx", tags: ["kurz"] }),
  P("wild", "Wind", "Wind", { tone: 0, noise: 1, fmode: "bp", cut: 700, res: 0.6, chaos: 0.6, lshape2: "sine", lrate: 0.15, lamt2: 0.6, att: 1.5, sus: 1, rel: 3, rvmix: 0.3, rvtime: 4, width: 1 }, { cat: "fx", tags: ["natur", "lang"] }),
  P("wild", "Sturm", "Storm", { tone: 0, noise: 1, fmode: "bp", cut: 450, res: 0.75, chaos: 1, lrate: 0.35, lamt2: 0.8, dust: 0.15, att: 1, sus: 1, rel: 3, rvmix: 0.4, rvtime: 5, width: 1 }, { cat: "fx", tags: ["natur", "wild"] }),
  P("wild", "Regen", "Rain", { tone: 0, noise: 0.25, dust: 0.9, fmode: "hp", cut: 900, res: 0.2, metal: 0.25, att: 0.8, sus: 1, rel: 2, rvmix: 0.35, rvtime: 3, width: 1 }, { cat: "fx", tags: ["natur"] }),
  P("wild", "Meeresrauschen", "Ocean waves", { tone: 0, noise: 1, fmode: "lp", cut: 1400, res: 0.1, lshape2: "sine", lrate: 0.09, lamt2: 0.85, chaos: 0.3, att: 2, sus: 1, rel: 4, rvmix: 0.35, rvtime: 5, width: 1 }, { cat: "fx", tags: ["natur", "lang", "weich"] }),
  P("wild", "Gewitter", "Thunderstorm", { wwave: "sine", tone: 0.3, noise: 1, fmode: "lp", cut: 220, res: 0.3, span: -12, curve: "log", len: 4, dust: 0.2, chaos: 0.8, att: 0.05, sus: 0.3, rel: 5, rvmix: 0.6, rvtime: 9, fbody: 0.7 }, { cat: "fx", tags: ["natur", "dunkel", "wild"] }),
  P("wild", "Knisterndes Feuer", "Crackling fire", { tone: 0, noise: 0.35, dust: 0.75, fmode: "lp", cut: 2600, res: 0.2, chaos: 0.4, lshape2: "rand", lrate: 3, lamt2: 0.3, att: 0.5, sus: 1, rel: 1.5, rvmix: 0.15, rvtime: 1.5, width: 0.8 }, { cat: "fx", tags: ["natur", "warm"] }),
  P("wild", "Alien-Geplapper", "Alien chatter", { vol: 0.6, wwave: "square", tone: 0.8, noise: 0.05, jump: 0.7, jrate: 11, fmi: 0.4, fmr: 2.7, fmode: "bp", cut: 1500, res: 0.55, chaos: 0.5, sus: 1, rel: 0.3, dlmix: 0.25, dltime: "1/8T", dlfb: 0.4 }, { cat: "fx", tags: ["wild", "retro"] }),
  P("wild", "Roboter-Sprache", "Robot speech", { wwave: "saw", tone: 0.9, jump: 0.35, jrate: 7, ring: 0.7, ringr: 2.2, crush: 0.45, fmode: "bp", cut: 1200, res: 0.6, sus: 1, rel: 0.2 }, { cat: "fx", tags: ["wild", "retro"] }),
  P("wild", "Sonar-Ping", "Sonar ping", { wwave: "sine", tone: 1, noise: 0, len: 0.9, sus: 0, rel: 0.8, att: 0.001, dlmix: 0.5, dltime: "1/2", dlfb: 0.6, dltone: 0.3, rvmix: 0.5, rvtime: 7 }, { cat: "fx", tags: ["lang", "echo"] }),
  P("wild", "Glitch-Stotterer", "Glitch stutter", { wwave: "square", tone: 0.7, noise: 0.4, crush: 0.6, jump: 0.5, jrate: 16, lshape2: "rand", lrate: 14, lamt2: 1, sus: 1, rel: 0.1, fmode: "bp", cut: 2500, res: 0.4 }, { cat: "fx", tags: ["wild", "kurz"] }),
  P("wild", "Metall-Drohne", "Metal drone", { wwave: "saw", tone: 0.5, noise: 0.3, metal: 0.9, fmode: "bp", cut: 1800, res: 0.5, chaos: 0.3, att: 2, sus: 1, rel: 4, rvmix: 0.5, rvtime: 10, width: 0.8 }, { cat: "texture", tags: ["dunkel", "wild", "lang"] }),
  P("wild", "Abgrund (dunkle Drohne)", "Abyss (dark drone)", { wwave: "saw", tone: 0.8, noise: 0.2, fmode: "lp", cut: 260, res: 0.6, chaos: 0.25, fmi: 0.15, fmr: 0.5, att: 3, sus: 1, rel: 6, rvmix: 0.6, rvtime: 16, fwarm: 0.6, fbody: 0.5 }, { cat: "texture", tags: ["dunkel", "lang"] }),
  P("wild", "Herzschlag", "Heartbeat", { wwave: "sine", tone: 1, noise: 0.05, fmode: "lp", cut: 180, res: 0.2, lshape2: "heart", lrate: 1.1, lamt2: 1, sus: 1, rel: 0.4, fbody: 0.7, fwarm: 0.5 }, { cat: "fx", tags: ["dunkel", "spannung"] }),
  P("wild", "Radio-Rauschen", "Radio static", { wwave: "sine", tone: 0.4, noise: 0.7, dust: 0.5, fmode: "bp", cut: 1800, res: 0.5, jump: 0.6, jrate: 3, crush: 0.4, sus: 1, rel: 0.3 }, { cat: "fx", tags: ["retro", "wild"] }),
  P("wild", "Raumschiff-Antrieb", "Spaceship engine", { wwave: "saw", tone: 0.7, noise: 0.5, fmode: "lp", cut: 500, res: 0.7, lshape2: "sine", lrate: 6, lamt2: 0.3, ring: 0.3, ringr: 0.5, att: 1, sus: 1, rel: 2, rvmix: 0.3, rvtime: 4, fbody: 0.5 }, { cat: "fx", tags: ["dunkel", "wild"] }),
  P("wild", "Weltraum-Textur", "Space texture", { wwave: "sine", tone: 0.5, noise: 0.35, fmi: 0.35, fmr: 1.41, chaos: 0.5, fmode: "bp", cut: 1200, res: 0.6, att: 3, sus: 1, rel: 6, rvmix: 0.7, rvtime: 20, rvshim: 0.4, width: 1 }, { cat: "texture", tags: ["lang", "schwebend", "wild"] }),
  P("wild", "Zeitmaschine", "Time machine", { wwave: "saw", tone: 0.7, noise: 0.3, span: 36, curve: "bounce", len: 6, fmi: 0.6, fmr: 2.5, chaos: 0.6, cut: 2400, fsweep: 0.6, res: 0.5, sus: 1, rel: 2, dlmix: 0.35, dltime: "1/8", dlfb: 0.7, rvmix: 0.4, rvtime: 8 }, { cat: "fx", tags: ["wild", "übergang"] }),
  P("wild", "Unterwasser", "Underwater", { wwave: "sine", tone: 0.5, noise: 0.6, dust: 0.3, fmode: "lp", cut: 350, res: 0.5, chaos: 0.5, lrate: 0.3, lamt2: 0.4, att: 1.5, sus: 1, rel: 3, rvmix: 0.5, rvtime: 6, fbody: 0.5 }, { cat: "fx", tags: ["natur", "dunkel"] }),
  P("wild", "Insektenschwarm", "Insect swarm", { wwave: "saw", tone: 0.6, noise: 0.2, jump: 0.15, jrate: 30, fmi: 0.2, fmr: 1.02, fmode: "bp", cut: 3000, res: 0.5, lshape2: "rand", lrate: 25, lamt2: 0.4, att: 1, sus: 1, rel: 1, width: 1 }, { cat: "fx", tags: ["natur", "wild"] }),
  P("wild", "Glasscherben", "Shattering glass", { tone: 0, noise: 0.3, dust: 1, fmode: "hp", cut: 3000, metal: 0.85, len: 1, sus: 0, rel: 1.2, att: 0.001, rvmix: 0.4, rvtime: 3, width: 1 }, { cat: "fx", tags: ["kurz", "wild"] }),
  // ===== Gitarren, Harfe & Zupfinstrumente (Saite) =====
  P("pluck", "Nylon-Gitarre", "Nylon guitar", { bright: 0.35, damp: 0.45, decay: 3, pos: 0.18, body: 0.6, velb: 0.5, rvmix: 0.15, rvtime: 1.6 }, { cat: "guitar", tags: ["warm", "weich"] }),
  P("pluck", "Stahlsaiten-Gitarre", "Steel-string guitar", { bright: 0.65, damp: 0.25, decay: 4, pos: 0.14, body: 0.5, velb: 0.6, rvmix: 0.15, rvtime: 1.8 }, { cat: "guitar", tags: ["hell"] }),
  P("pluck", "Harfe im Hall", "Harp in the hall", { bright: 0.45, damp: 0.3, decay: 7, pos: 0.3, body: 0.35, rel: 3, rvmix: 0.55, rvtime: 9, rvshim: 0.2 }, { cat: "guitar", tags: ["lang", "hall"] }),
  P("pluck", "Koto mit Hall", "Koto with reverb", { vol: 0.65, bright: 0.75, damp: 0.2, decay: 3.5, pos: 0.08, body: 0.3, velb: 0.7, rvmix: 0.2, rvtime: 2.2, l1dest: "pitch", l1rate: 5, l1amt: 0.02 }, { cat: "world", tags: ["hell", "welt"] }),
  P("pluck", "Cembalo", "Harpsichord", { vol: 0.65, bright: 0.9, damp: 0.1, decay: 2.2, pos: 0.07, body: 0.2, velb: 0.2, rel: 0.25, rvmix: 0.2, rvtime: 2 }, { cat: "keys", tags: ["hell", "klassisch", "retro"] }),
  P("pluck", "Banjo", "Banjo", { vol: 0.7, bright: 0.85, damp: 0.15, decay: 1.4, pos: 0.1, body: 0.15, velb: 0.6 }, { cat: "guitar", tags: ["hell", "kurz"] }),
  P("pluck", "Ukulele", "Ukulele", { bright: 0.5, damp: 0.4, decay: 1.6, pos: 0.2, body: 0.65, velb: 0.5, rvmix: 0.12, rvtime: 1.2 }, { cat: "guitar", tags: ["warm", "kurz"] }),
  P("pluck", "Hackbrett", "Hammered dulcimer", { bright: 0.8, damp: 0.15, decay: 4.5, pos: 0.12, body: 0.3, velb: 0.7, rvmix: 0.25, rvtime: 2.6, fwidth: 0.3 }, { cat: "world", tags: ["hell", "welt"] }),
  P("pluck", "Akustik-Gitarre mit Echo", "Acoustic guitar with echo", { bright: 0.55, damp: 0.3, decay: 3.5, pos: 0.16, body: 0.5, dlmix: 0.3, dltime: "3/16", dlfb: 0.45, rvmix: 0.25, rvtime: 2.6 }, { cat: "guitar", tags: ["echo"] }),
  // ===== Orgeln mit Raum =====
  P("organ", "Kirchenorgel (Plenum)", "Church organ (full)", { vol: 0.65, db1: 8, db2: 6, db3: 8, db4: 8, db5: 6, db6: 7, db7: 4, db8: 4, db9: 5, leslie: "off", drive: 0, click: 0.05, rvmix: 0.6, rvtime: 9, rvsize: 1, rvpre: 0.05 }, { cat: "organ", tags: ["klassisch", "hall", "lang"] }),
  P("organ", "Flöte 8' im Kirchenschiff", "Flute 8' in the nave", { db1: 0, db2: 0, db3: 8, db4: 3, db5: 0, db6: 0, db7: 0, db8: 0, db9: 0, leslie: "off", drive: 0, click: 0, rvmix: 0.55, rvtime: 8, rvsize: 1 }, { cat: "organ", tags: ["weich", "hall"] }),
  // ===== Flächen & Texturen (Analog mit Raum) =====
  P("poly", "Eisige Shimmer-Fläche", "Icy shimmer pad", { o1w: "saw", o2w: "saw", o2lvl: 0.7, o2fine: 8, cut: 2400, res: 0.15, aa: 1.2, ad: 2, as: 0.8, ar: 3, unidet: 0.35, rvmix: 0.6, rvtime: 14, rvshim: 0.5, fwidth: 0.6 }, { cat: "pad", tags: ["hell", "schwebend", "lang"] }),
  P("poly", "Endlose Fläche (eingefroren)", "Endless pad (frozen)", { o1w: "saw", o2w: "square", o2lvl: 0.5, o2fine: 6, cut: 1500, res: 0.2, aa: 1.5, as: 0.9, ar: 4, rvmix: 0.7, rvtime: 30, rvsize: 1, fwidth: 0.5 }, { cat: "texture", tags: ["lang", "schwebend"] }),
  P("poly", "Wolkenfläche", "Cloud pad", { o1w: "tri", o2w: "saw", o2lvl: 0.4, o2fine: 12, cut: 1100, res: 0.1, aa: 2, ad: 2, as: 0.85, ar: 5, l1dest: "cut", l1rate: 0.1, l1amt: 0.25, rvmix: 0.55, rvtime: 10, dlmix: 0.2, dltime: "3/8", fwidth: 0.5, fwarm: 0.3 }, { cat: "pad", tags: ["weich", "lang"] }),
  P("strings", "Mellotron-Streicher", "Mellotron strings", { o1w: "saw", o2w: "saw", o2lvl: 0.5, o2fine: 5, uni: 3, unidet: 0.2, ftype: "lp12", cut: 2200, aa: 0.18, ar: 0.6, l1dest: "pitch", l1rate: 0.5, l1amt: 0.025, fwarm: 0.55, rvmix: 0.25, rvtime: 2.4 }, { cat: "retro", tags: ["retro", "warm"] }),
  P("wave", "Wandernde Wavetable-Welt", "Drifting wavetable world", { o1w: "wt", wtset: "vocal", wtpos: 0.3, wtlfo: 0.7, l2rate: 0.08, o2w: "wt", o2fine: 7, o2lvl: 0.5, cut: 5000, res: 0.1, fenv: 0, aa: 1.5, as: 0.9, ar: 4, rvmix: 0.55, rvtime: 12, rvshim: 0.25, dlmix: 0.25, dltime: "1/4", fwidth: 0.6 }, { cat: "texture", tags: ["lang", "schwebend"] }),
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

// =====================================================================================================
// Gemessen: Die Hall-Impulsantwort trug +24 dB Energie gegenüber dem trockenen Signal — schon ein Send von 15 % machte den Hall
// 5,5 dB LAUTER als das Instrument, die Stereo-Seite war so laut wie die Mitte (auch im Bass). Das klang dünn und hohl.
// Jetzt: Impulsantwort auf eine feste Energie (+3 dB → Send 15 % ≈ 15 dB unter trocken), Hall ohne Tiefen, Bass mono.
// =====================================================================================================
export const IR_ENERGY = 2;   // +3 dB
export function normIR(buf, target = IR_ENERGY) {
  let e = 0; for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) e += d[i] * d[i]; }
  e /= buf.numberOfChannels; if (!(e > 0)) return buf;
  const k = Math.sqrt(target / e); for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return buf;
}
// Hall-Rückweg ohne Tiefen: Hochpass, damit Bass und Grundtöne trocken und in der Mitte bleiben
export function reverbReturn(c, freq = 180) { const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = freq; f.Q.value = 0.6; return f; }
export function monoBass(c, freq = 120) {
  const inp = c.createGain(), sp = c.createChannelSplitter(2), mid = c.createGain(), side = c.createGain(), inv = c.createGain(), sInv = c.createGain();
  const h1 = c.createBiquadFilter(), h2 = c.createBiquadFilter(), mg = c.createChannelMerger(2), out = c.createGain();
  inp.channelCount = 2; inp.channelCountMode = "explicit"; inp.channelInterpretation = "speakers";
  mid.gain.value = 0.5; side.gain.value = 0.5; inv.gain.value = -1; sInv.gain.value = -1;
  for (const h of [h1, h2]) { h.type = "highpass"; h.frequency.value = freq; h.Q.value = Math.SQRT1_2; }
  inp.connect(sp); sp.connect(mid, 0); sp.connect(mid, 1); sp.connect(side, 0); sp.connect(inv, 1); inv.connect(side);
  side.connect(h1); h1.connect(h2); h2.connect(sInv);
  mid.connect(mg, 0, 0); h2.connect(mg, 0, 0); mid.connect(mg, 0, 1); sInv.connect(mg, 0, 1); mg.connect(out);
  return { inp, out, h1, h2 };
}
// Fülle: sanfte Sättigung (Obertöne machen den Bass auch auf kleinen Lautsprechern hörbar), Wärme um 180 Hz, ein leiser
export function fullness(c) {
  const inp = c.createGain(), sat = c.createWaveShaper(), pre = c.createGain(), post = c.createGain(), warm = c.createBiquadFilter(), comp = c.createDynamicsCompressor(), mk = c.createGain(), out = c.createGain();
  sat.oversample = "4x"; warm.type = "peaking"; warm.frequency.value = 180; warm.Q.value = 0.7;
  comp.knee.value = 12; comp.attack.value = 0.02; comp.release.value = 0.25;
  inp.connect(pre); pre.connect(sat); sat.connect(post); post.connect(warm); warm.connect(comp); comp.connect(mk); mk.connect(out);
  let last = -1;
  const set = (v, now) => {
    v = Math.max(0, Math.min(1, +v || 0)); const t = now ?? c.currentTime;
    if (Math.abs(v - last) > 1e-4) {
      // weiche Kennlinie mit etwas Asymmetrie (gerade Obertöne = warm), Antrieb mit der Fülle
      const n = 2048, cv = new Float32Array(n), d = 1 + v * 2.2, a = v * 0.12;
      for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, y = Math.tanh(d * (x + a * x * x)) / Math.tanh(d); cv[i] = y; }
      sat.curve = v > 0 ? cv : null; last = v;
    }
    pre.gain.setTargetAtTime(v > 0 ? 0.5 : 1, t, 0.02); post.gain.setTargetAtTime(v > 0 ? 2 : 1, t, 0.02);
    warm.gain.setTargetAtTime(v * 7, t, 0.05);
    comp.threshold.setTargetAtTime(v > 0 ? -8 - v * 12 : 0, t, 0.05); comp.ratio.setTargetAtTime(1 + v * 1.8, t, 0.05);
    mk.gain.setTargetAtTime(Math.pow(10, (v * 2) / 20), t, 0.05);   // +1 dB bei 50 %: der erzeugte Track bleibt unter −1 dBTP
  };
  set(0.5, 0);
  return { inp, out, set, comp };
}

// =====================================================================================================
// 3.21 Klangwahl: Kategorien und Schlagworte. Die neuen Klänge tragen sie selbst (cat, tags),
// die älteren werden nach Modell und Namen eingeordnet.
// =====================================================================================================
export const CATS = [["keys", "🎹", "Klavier & Keys", "Piano & keys"], ["organ", "⛪", "Orgeln", "Organs"], ["mallet", "🔔", "Glocken & Mallets", "Bells & mallets"],
  ["strings", "🎻", "Streicher", "Strings"], ["brass", "🎺", "Blechbläser", "Brass"], ["winds", "🪈", "Holz & Flöten", "Woodwinds & flutes"],
  ["guitar", "🎸", "Gitarren & Zupfinstrumente", "Guitars & plucked"], ["voice", "🗣", "Chöre & Stimmen", "Choirs & voices"], ["world", "🌍", "Welt", "World"],
  ["pad", "☁️", "Flächen", "Pads"], ["texture", "🌌", "Texturen & Klangwelten", "Textures & soundscapes"], ["bass", "🔊", "Bässe", "Basses"],
  ["lead", "⚡", "Leads", "Leads"], ["poly", "🎛", "Synth-Akkorde & Stabs", "Synth chords & stabs"], ["pluck", "💧", "Plucks & Arps", "Plucks & arps"],
  ["retro", "📼", "Retro & String Machines", "Retro & string machines"], ["fx", "💥", "Effekte & Übergänge", "Effects & transitions"]];
export const TAG_NAMES = { weich: ["weich", "soft"], warm: ["warm", "warm"], hell: ["hell", "bright"], dunkel: ["dunkel", "dark"], lang: ["lang", "long"], kurz: ["kurz", "short"],
  hall: ["viel Hall", "big reverb"], echo: ["Echo", "echo"], schwebend: ["schwebend", "floating"], intim: ["intim", "intimate"], klassisch: ["klassisch", "classical"],
  retro: ["retro", "retro"], lofi: ["Lo-Fi", "lo-fi"], jazz: ["Jazz", "jazz"], welt: ["Welt", "world"], natur: ["Natur", "nature"], wild: ["wild", "wild"], spannung: ["Spannung", "tension"], übergang: ["Übergang", "transition"] };
export function catOf(pr) {
  if (pr.cat) return pr.cat;
  const n = pr.de, m = pr.model;
  if (["ep", "rhodes", "wurli", "clav"].includes(m)) return "keys";
  if (["organ", "b3"].includes(m)) return "organ";
  if (m === "pluck") return /gitarre|harfe/i.test(n) ? "guitar" : /Koto/.test(n) ? "world" : "pluck";
  if (m === "strings") return "retro";
  if (/Bass|Sub|Reese|303|Acid|Drone-Bass|Taurus|Wobble/i.test(n) || ["acid", "taurus"].includes(m)) return "bass";
  if (/Glock|Glocke|Bell|Marimba|Celesta|Vibra/i.test(n)) return "mallet";
  if (/Brass|Bläser|Horn|Fanfare/i.test(n)) return "brass";
  if (/Streicher|Strings|Celli|Cello|Geige/i.test(n)) return "strings";
  if (/Orgel/i.test(n)) return "organ";
  if (/Piano|E-Piano|EP |Keys|Klavier/i.test(n)) return "keys";
  if (/Lead|Solo|Sync|Singend|Stimme/i.test(n)) return "lead";
  if (/Arp|Pluck|Gezupft|Tropfen/i.test(n)) return "pluck";
  if (/Fläche|Pad|Drone|Wolke|Chor|Choir|Teppich|Atmo/i.test(n)) return "pad";
  return "poly";
}
export function tagsOf(pr) {
  if (pr.tags) return pr.tags;
  const n = pr.de, t = [];
  if (/warm|weich|rund|sanft|Ballade/i.test(n)) t.push("warm");
  if (/hell|glas|klar|Glocke|bright/i.test(n)) t.push("hell");
  if (/dunkel|tief|Drone|dark/i.test(n)) t.push("dunkel");
  if (/80er|70er|Juno|Prophet|Jupiter|OB-X|Moog|CS-80|PPG|DX7|M1|Vintage|Retro|Solina/i.test(n + " " + pr.model)) t.push("retro");
  if (/Fläche|Pad|Drone/i.test(n)) t.push("lang");
  if (/Stab|kurz|Pluck|gedämpft|Arp/i.test(n)) t.push("kurz");
  return t;
}

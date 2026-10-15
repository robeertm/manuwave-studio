// NeonForge 3.8 — Richtungen und der Würfel.
//
// Richtungen, füge sie hinzu, will alles abdecken können". Jetzt ~90 Richtungen in Gruppen.
// 🔑 Die 16 alten Namen bleiben WORTGLEICH — gespeicherte Eingaben (nf_form) wählen per Text.
//
// Jede Richtung bringt mit, was der Würfel zum Schreiben braucht:
//   bpm   — üblicher Tempobereich (der Würfel nennt eine Zahl daraus, das Feld BPM bleibt frei)
//   fam   — Bauform: club (Build/Drop), song (Strophe/Refrain), flow (lange Bögen) → Gerüst + Bogen-Text

const G = (n, bpm, kit, extra = {}) => ({ n, bpm, kit, ...extra });

export const GENRE_GROUPS = [
  { id: "techno", name: "Techno", fam: "club", moods: ["driving", "dark", "emotional", "dreamy"], genres: [
    G("Techno", [126, 132], ["einer stampfenden, trockenen Kick", "einem rollenden Bass", "metallischen Percussion-Loops", "einer hypnotischen Synth-Sequenz", "sich langsam öffnenden Hi-Hats"]),
    G("Melodic Techno", [120, 126], ["einem melancholischen Synth-Lead in Moll", "einem pulsierenden Arpeggio", "weiten, schwebenden Pads", "einem tiefen, rollenden Bass", "einer sauberen, tiefen Kick"]),
    G("Peak-Time Techno", [128, 134], ["einer harten, druckvollen Kick", "einem treibenden Rumble-Bass", "scharfen Stabs", "sich steigernden Snare-Rolls", "einem sich in den Raum schraubenden Lead"]),
    G("Hard Techno", [145, 155], ["einer verzerrten, harten Kick", "einem bodenerschütternden Rumble", "industriellen Schlägen", "rasenden Hi-Hats", "kreischenden Synth-Stabs"], { rough: true, moods: ["dark", "driving"] }),
    G("Minimal Techno", [124, 128], ["einer reduzierten, knackigen Kick", "winzigen Klick-Percussions", "einem trockenen, federnden Bass", "einzelnen, gezupften Tönen", "viel Stille zwischen den Schlägen"]),
    G("Dub Techno", [118, 124], ["hallenden Akkord-Stabs", "einem tiefen, weichen Sub-Bass", "rauschenden Delays", "einer gedämpften Kick", "im Nebel verschwindenden Echos"], { moods: ["dreamy", "driving"] }),
    G("Acid Techno", [130, 138], ["einer quietschenden 303-Acid-Linie", "einer harten Kick", "Cowbell-Akzenten", "einem sich langsam öffnenden Filter", "klatschenden Claps"], { rough: true }),
    G("Industrial Techno", [132, 142], ["rauen, metallischen Schlägen", "verzerrten Bass-Impulsen", "Maschinengeräuschen", "einer brutalen Kick", "dunklen, schleifenden Flächen"], { rough: true, moods: ["dark"] }),
    G("Detroit Techno", [125, 130], ["warmen, analogen Streicher-Flächen", "einer funkigen Drum-Machine", "einem seelenvollen Synth-Motiv", "einem gleitenden Bass", "jazzigen Akkorden"]),
  ] },
  { id: "house", name: "House", fam: "club", moods: ["warm", "euphoric", "driving", "emotional", "dreamy"], genres: [
    G("Melodic House", [118, 124], ["einem warmen, singenden Synth-Lead", "einem gezupften Arpeggio", "einem weichen, runden Bass", "luftigen Pads", "einer federnden Kick"]),
    G("Deep House", [118, 124], ["warmen Rhodes-Akkorden", "einem tiefen, runden Bass", "weichen Shaker-Grooves", "einer gedämpften Kick", "jazzigen Orgel-Tupfern"]),
    G("Progressive House", [122, 128], ["sich langsam aufbauenden Synth-Schichten", "einem pulsierenden Bass", "einem gezupften Leitmotiv", "großen, weiten Pads", "einer gleichmäßigen Kick"]),
    G("Tech House", [124, 128], ["einem groovenden, knurrenden Bass", "knackigen Percussions", "einer trockenen Kick", "kurzen Vocal-Schnipseln", "funkigen Hi-Hats"]),
    G("Afro House", [118, 124], ["afrikanischen Trommeln", "einem warmen Marimba-Motiv", "einer tiefen, weichen Kick", "Shakern und Congas", "einem erdigen Bass"]),
    G("Organic House", [110, 120], ["einer Kalimba", "Handtrommeln", "einer orientalischen Flöte", "einem warmen, tiefen Bass", "Naturgeräuschen im Hintergrund"]),
    G("Disco House", [120, 126], ["gefilterten Disco-Samples", "einer funkigen Gitarre", "einem hüpfenden Bass", "Streicher-Akzenten", "einer satten Kick"]),
    G("Acid House", [120, 126], ["einer blubbernden 303-Linie", "einer klassischen Drum-Machine", "einem Piano-Stab", "klatschenden Claps", "einem warmen Bass"]),
    G("Afro Tech", [122, 126], ["afrikanischen Percussions", "einem dunklen, rollenden Bass", "einem hypnotischen Synth-Motiv", "einer trockenen Kick", "rufenden Stimmfetzen"]),
    G("Big Room House", [126, 130], ["einem riesigen Synth-Drop", "einer mächtigen Kick", "aufsteigenden Snare-Rolls", "einem schrillen Lead", "einem breiten Bass"], { moods: ["euphoric"] }),
    G("Electro House", [126, 130], ["einem fetten, wobbelnden Bass", "einer harten Kick", "schneidenden Synth-Stabs", "aufsteigenden Effekten", "einem kantigen Lead"], { rough: true }),
    G("Future House", [124, 128], ["einem metallisch federnden Bass", "einem glitzernden Pluck", "einer knackigen Kick", "geschnittenen Vocal-Fetzen", "hellen Pads"]),
  ] },
  { id: "trance", name: "Trance", fam: "club", moods: ["euphoric", "emotional", "dreamy", "driving"], genres: [
    G("Trance", [136, 140], ["einem schimmernden Supersaw-Lead", "einem rollenden Off-Beat-Bass", "einem gezupften Arpeggio", "großen, hellen Pads", "einer klaren Kick"]),
    G("Uplifting Trance", [136, 140], ["einem euphorischen Supersaw-Lead", "Klavier-Akkorden im Breakdown", "anschwellenden Streichern", "einem rollenden Bass", "einer riesigen Snare-Steigerung"], { moods: ["euphoric", "emotional"] }),
    G("Progressive Trance", [130, 136], ["einem langsam atmenden Arpeggio", "tiefen, weichen Pads", "einem pulsierenden Bass", "einem zurückhaltenden Lead", "einer gleichmäßigen Kick"]),
    G("Psytrance", [140, 146], ["einem galoppierenden Bass", "psychedelischen Acid-Linien", "zwitschernden Effekten", "einer harten, kurzen Kick", "sich drehenden Synth-Spiralen"], { rough: true }),
    G("Goa Trance", [140, 148], ["orientalischen Melodien", "einem galoppierenden Bass", "glitzernden Arpeggios", "einer klaren Kick", "fließenden Acid-Linien"]),
    G("Tech Trance", [136, 142], ["einem harten Off-Beat-Bass", "metallischen Stabs", "einem schneidenden Lead", "treibenden Percussions", "einer druckvollen Kick"]),
    G("Vocal Trance", [136, 140], ["einem schwebenden Supersaw-Lead", "Klavier im Breakdown", "großen Pads", "einem rollenden Bass", "einer klaren Kick"]),
    G("Hard Trance", [145, 150], ["einem harten, schnellen Bass", "kreischenden Leads", "einer harten Kick", "Hoover-Klängen", "rasenden Arpeggios"], { rough: true }),
  ] },
  { id: "bass", name: "Bass & Breaks", fam: "club", moods: ["driving", "dark", "euphoric", "emotional"], genres: [
    G("Drum & Bass", [172, 176], ["einem rollenden Breakbeat", "einem tiefen Reese-Bass", "scharfen Snares", "atmosphärischen Pads", "schnellen Hi-Hats"]),
    G("Liquid Drum & Bass", [172, 176], ["einem weichen, rollenden Breakbeat", "warmen Rhodes-Akkorden", "einem runden Sub-Bass", "schwebenden Streichern", "sanften Klavier-Tupfern"], { moods: ["emotional", "dreamy"] }),
    G("Neurofunk", [172, 176], ["einem knurrenden, verzerrten Reese-Bass", "präzisen, harten Breaks", "metallischen Effekten", "dunklen Flächen", "scharfen Snares"], { rough: true, moods: ["dark", "driving"] }),
    G("Jungle", [160, 170], ["zerhackten Amen-Breaks", "einem tiefen Dub-Bass", "Reggae-Stimmfetzen", "hallenden Stabs", "dunklen Pads"], { rough: true }),
    G("Dubstep", [138, 142], ["einem wobbelnden, verzerrten Bass", "einem halbierten, schweren Beat", "einer peitschenden Snare", "dunklen Pads", "metallischen Effekten"], { rough: true }),
    G("Melodic Dubstep", [140, 150], ["einem emotionalen Supersaw-Lead", "einem schweren, weichen Bass", "Klavier im Intro", "großen Pads", "einer peitschenden Snare"]),
    G("Future Bass", [140, 160], ["schimmernden Supersaw-Akkorden", "einem wackelnden Bass", "geschnittenen Vocal-Fetzen", "verspielten Plucks", "einer knackigen Snare"]),
    G("Breakbeat", [126, 136], ["einem funkigen Breakbeat", "einem fetten Bass", "scratchenden Effekten", "einem Synth-Riff", "Stimmfetzen"]),
    G("UK Garage", [130, 134], ["einem stolpernden 2-Step-Beat", "einem tiefen, wackelnden Bass", "geschnittenen Soul-Vocals", "Orgel-Akkorden", "glitzernden Hi-Hats"]),
    G("Hardstyle", [150, 155], ["einer verzerrten, pfeifenden Kick", "einem riesigen Lead", "epischen Streichern", "harten Snare-Rolls", "einem gewaltigen Breakdown"], { rough: true, moods: ["euphoric", "dark"] }),
    G("Hardcore / Gabber", [170, 190], ["einer brachial verzerrten Kick", "rasenden Synth-Stabs", "schreienden Hoovers", "harten Breaks", "einem dröhnenden Bass"], { rough: true, moods: ["dark", "driving"] }),
  ] },
  { id: "synth", name: "Synth & Retro", fam: "club", moods: ["driving", "emotional", "dark", "dreamy"], genres: [
    G("Synthwave", [90, 118], ["einem glitzernden 80er-Synth-Lead", "einer gated Snare mit viel Hall", "einem pulsierenden Achtel-Bass", "warmen Analog-Pads", "einem funkelnden Arpeggio"], { fam: "song" }),
    G("Darksynth", [100, 120], ["einem aggressiven Analog-Bass", "dunklen, verzerrten Synths", "einer harten Drum-Machine", "unheimlichen Flächen", "einem kalten Arpeggio"], { rough: true, moods: ["dark", "driving"] }),
    G("Retrowave / Outrun", [100, 118], ["einem strahlenden Synth-Lead", "einer gated Snare", "einem treibenden Achtel-Bass", "einer E-Gitarre im Solo", "warmen Pads"], { fam: "song" }),
    G("Italo Disco", [115, 125], ["einem hüpfenden Oktav-Bass", "einer Vocoder-Stimme", "glitzernden Synth-Akkorden", "einer klassischen Drum-Machine", "einem naiven, eingängigen Lead"], { fam: "song" }),
    G("Nu-Disco", [115, 124], ["einer funkigen Gitarre", "einem hüpfenden Bass", "Streicher-Stabs", "glitzernden Synths", "einer federnden Kick"]),
    G("Electro", [120, 130], ["einem 808-Beat", "einem Roboter-Vocoder", "kalten Synth-Sequenzen", "einem tiefen, knackenden Bass", "Laser-Effekten"]),
    G("EBM", [120, 130], ["einem harten Sequenzer-Bass", "einer marschierenden Drum-Machine", "kalten Synths", "metallischen Schlägen", "einem düsteren Motiv"], { rough: true }),
    G("Chiptune", [120, 160], ["8-Bit-Rechteck-Melodien", "einem flinken Arpeggio", "Rauschen-Percussion", "einem hüpfenden Dreieck-Bass", "Videospiel-Effekten"], { fam: "song" }),
    G("Vaporwave", [70, 95], ["verlangsamten 80er-Samples", "weichem Saxophon", "verwaschenen Pads", "einem trägen Bass", "verhalltem Klavier"], { fam: "flow", moods: ["dreamy"] }),
  ] },
  { id: "chill", name: "Chill & Ambient", fam: "flow", moods: ["dreamy", "warm", "emotional"], genres: [
    G("Ambient / Downtempo", [80, 105], ["weiten, schwebenden Flächen", "einem langsamen, weichen Beat", "einem warmen Bass", "fernem Klavier", "Naturgeräuschen"]),
    G("Ambient", [60, 80], ["endlosen, atmenden Flächen", "fernem Glockenklang", "leisem Rauschen", "einem tiefen Drone", "sanften Tonwolken"], { moods: ["dreamy", "emotional"] }),
    G("Chillout / Lounge", [90, 110], ["einem entspannten Beat", "warmen Rhodes-Akkorden", "einem runden Bass", "einer gezupften Gitarre", "luftigen Pads"], { fam: "song" }),
    G("Lo-Fi Hip-Hop", [70, 90], ["einem schläfrigen, schiefen Beat", "verstaubten Jazz-Akkorden", "Vinylknistern", "einem weichen Bass", "einer gedämpften Gitarre"], { fam: "song", moods: ["dreamy", "warm"] }),
    G("Trip-Hop", [75, 95], ["einem schweren, langsamen Breakbeat", "dunklen Streichern", "einem tiefen Bass", "Vinylknistern", "einer verhallten Gitarre"], { fam: "song" }),
    G("Chillwave", [90, 110], ["verwaschenen Synths", "einem lässigen Beat", "hallenden Gitarren", "warmen Pads", "einem weichen Bass"], { fam: "song" }),
    G("Dark Ambient", [60, 75], ["tiefen, grollenden Drones", "metallischem Nachhall", "fernen Stimmen im Raum", "dunklem Rauschen", "langsam anschwellenden Flächen"], { moods: ["dark"] }),
    G("Meditation / Klangschalen", [55, 70], ["Klangschalen", "einem warmen Drone", "sanften Glocken", "weichem Wasserplätschern", "einer gehauchten Flöte"], { moods: ["dreamy"] }),
  ] },
  { id: "pop", name: "Pop & Urban", fam: "song", moods: ["euphoric", "warm", "emotional", "driving"], genres: [
    G("Pop", [100, 124], ["einer eingängigen Synth-Hook", "einem knackigen Beat", "warmen Akkorden", "einem federnden Bass", "Händeklatschen"], { fam: "club" }),
    G("Dance-Pop", [118, 128], ["einem pumpenden Four-on-the-Floor-Beat", "einer strahlenden Synth-Hook", "einem hüpfenden Bass", "glitzernden Plucks", "großen Akkorden im Refrain"]),
    G("Electropop", [105, 125], ["schimmernden Synths", "einem trockenen Beat", "einem federnden Synth-Bass", "geschnittenen Vocal-Fetzen", "einer verspielten Hook"]),
    G("Indie Pop", [100, 125], ["einer hellen, klingelnden Gitarre", "einem lockeren Live-Schlagzeug", "einem warmen Bass", "verträumten Synths", "Händeklatschen"]),
    G("Synth-Pop", [110, 125], ["kühlen Analog-Synths", "einer Drum-Machine", "einem treibenden Synth-Bass", "einer melancholischen Hook", "glitzernden Arpeggios"]),
    G("K-Pop", [100, 130], ["einem knallenden, wechselnden Beat", "einer glitzernden Synth-Hook", "einem tiefen 808-Bass", "Streicher-Akzenten", "plötzlichen Breaks"]),
    G("R&B", [65, 95], ["einem weichen, schleppenden Beat", "warmen Rhodes-Akkorden", "einem tiefen 808-Bass", "seidigen Pads", "feinen Hi-Hat-Rolls"]),
    G("Hip-Hop", [85, 98], ["einem harten Boom-Bap-Beat", "einem gesampelten Soul-Loop", "einem tiefen Bass", "Scratches", "einem Klavier-Motiv"]),
    G("Deutschrap", [85, 145], ["einem harten Beat", "einem dunklen Klavier-Loop", "einem dröhnenden 808-Bass", "schnellen Hi-Hats", "düsteren Streichern"]),
    G("Trap", [130, 150], ["einem dröhnenden 808-Bass", "rasenden Hi-Hat-Rolls", "dunklen Glocken-Melodien", "einer knallenden Snare", "unheimlichen Pads"]),
    G("Drill", [140, 145], ["einem gleitenden 808-Bass", "stolpernden Hi-Hats", "düsteren Streichern", "einer verschobenen Snare", "einem kalten Klavier"], { rough: true, moods: ["dark", "driving"] }),
    G("Phonk", [130, 145], ["einer Cowbell-Melodie", "einem verzerrten 808-Bass", "Memphis-Stimmfetzen", "harten Hi-Hats", "dunklen Effekten"], { rough: true, moods: ["dark", "driving"] }),
    G("Afrobeats", [100, 112], ["federnden afrikanischen Percussions", "einem warmen, tanzenden Bass", "einer hellen Gitarren-Figur", "Log-Drum-Schlägen", "weichen Synth-Akkorden"]),
    G("Amapiano", [110, 115], ["tiefen Log-Drums", "jazzigen Klavier-Akkorden", "Shakern", "einem weichen Bass", "luftigen Pads"], { fam: "club" }),
    G("Reggaeton", [88, 98], ["dem typischen Dembow-Rhythmus", "einem tiefen Bass", "einer Latin-Gitarre", "knackigen Percussions", "einer eingängigen Synth-Hook"]),
    G("Dancehall", [90, 105], ["einem federnden Riddim", "einem tiefen Bass", "Off-Beat-Akkorden", "knackigen Percussions", "Air-Horn-Effekten"]),
    G("Schlager", [110, 130], ["einem fröhlichen Discofox-Beat", "glitzernden Synth-Streichern", "einem hüpfenden Bass", "einem eingängigen Akkordeon", "großen Refrain-Akkorden"], { moods: ["euphoric", "warm"] }),
  ] },
  { id: "rock", name: "Rock & Metal", fam: "song", moods: ["driving", "euphoric", "dark", "emotional"], genres: [
    G("Rock", [110, 140], ["kraftvollen E-Gitarren-Riffs", "einem treibenden Live-Schlagzeug", "einem satten E-Bass", "einem Gitarren-Solo", "Hammond-Orgel"], { rough: true }),
    G("Indie Rock", [110, 140], ["schrammelnden Gitarren", "einem trockenen Schlagzeug", "einem melodischen Bass", "hallenden Lead-Gitarren", "einem schiefen Synth"]),
    G("Alternative Rock", [100, 140], ["verzerrten Gitarren-Wänden", "einem wuchtigen Schlagzeug", "einem knurrenden Bass", "leisen Strophen-Gitarren", "explodierenden Refrains"], { rough: true }),
    G("Punk Rock", [160, 200], ["rasenden Power-Chords", "einem hämmernden Schlagzeug", "einem schnellen Bass", "Gang-Rufen", "rohen Gitarren"], { rough: true, moods: ["driving", "euphoric"] }),
    G("Post-Rock", [80, 120], ["flirrenden Tremolo-Gitarren", "einem anschwellenden Schlagzeug", "Hall-Wänden", "Glockenspiel", "einem tiefen Bass"], { fam: "flow" }),
    G("Shoegaze", [90, 120], ["Wänden aus verzerrten, verhallten Gitarren", "einem dumpfen Schlagzeug", "einem warmen Bass", "verwaschenen Flächen", "schwebenden Akkorden"], { rough: true }),
    G("Hard Rock", [110, 140], ["dreckigen Gitarren-Riffs", "einem stampfenden Schlagzeug", "einem rollenden Bass", "einem heulenden Gitarren-Solo", "Hammond-Orgel"], { rough: true }),
    G("Metal", [100, 180], ["tief gestimmten, verzerrten Gitarren", "Doublebass-Schlagzeug", "einem schweren Bass", "einem virtuosen Gitarren-Solo", "Palm-Mute-Riffs"], { rough: true, moods: ["dark", "driving", "euphoric"] }),
    G("Metalcore", [120, 180], ["tief gestimmten Breakdown-Riffs", "einem präzisen Schlagzeug", "melodischen Lead-Gitarren", "einem dröhnenden Bass", "atmosphärischen Synths"], { rough: true, moods: ["dark", "driving", "emotional"] }),
    G("Symphonic Metal", [100, 160], ["verzerrten Gitarren", "einem Orchester", "einem Chor", "Doublebass-Schlagzeug", "epischen Streichern"], { rough: true }),
    G("Grunge", [90, 130], ["schlammigen, verzerrten Gitarren", "einem schweren Schlagzeug", "einem dumpfen Bass", "leisen, brüchigen Strophen", "lauten Refrains"], { rough: true }),
  ] },
  { id: "jazz", name: "Jazz, Soul & Funk", fam: "song", moods: ["warm", "emotional", "dreamy"], genres: [
    G("Jazz", [90, 180], ["einem Kontrabass", "einem Besen-Schlagzeug", "einem Jazz-Klavier", "einem Tenorsaxophon", "einer gedämpften Trompete"]),
    G("Nu Jazz", [110, 125], ["einem Live-Kontrabass", "elektronischen Beats", "Rhodes-Akkorden", "einer Trompete mit Hall", "verspielten Percussions"]),
    G("Smooth Jazz", [85, 105], ["einem weichen Saxophon", "Rhodes-Akkorden", "einem samtigen Bass", "einem sanften Schlagzeug", "einer warmen Gitarre"]),
    G("Swing / Big Band", [140, 200], ["einer Bläsersektion", "einem swingenden Schlagzeug", "einem laufenden Kontrabass", "einem Jazz-Klavier", "einem Klarinetten-Solo"]),
    G("Soul", [70, 110], ["einer Hammond-Orgel", "warmen Bläsern", "einem tiefen, singenden Bass", "einem lockeren Schlagzeug", "einer Rhythmusgitarre"]),
    G("Neo-Soul", [70, 95], ["warmen Rhodes-Akkorden", "einem schleppenden Beat", "einem samtigen Bass", "einer jazzigen Gitarre", "feinen Bläsern"]),
    G("Funk", [95, 115], ["einer zackigen Funk-Gitarre", "einem slappenden Bass", "knackigen Bläsern", "einem tighten Schlagzeug", "einem Clavinet"]),
    G("Disco", [115, 125], ["einer funkigen Gitarre", "einem hüpfenden Oktav-Bass", "großen Streichern", "Bläsern", "einem Four-on-the-Floor-Schlagzeug"], { fam: "club" }),
    G("Blues", [60, 110], ["einer klagenden E-Gitarre", "einer Mundharmonika", "einem schleppenden Shuffle", "einem Klavier", "einem laufenden Bass"], { moods: ["emotional", "warm"] }),
    G("Gospel", [70, 120], ["einem Chor", "einer Hammond-Orgel", "einem Klavier", "Händeklatschen", "einem warmen Bass"], { moods: ["euphoric", "emotional"] }),
  ] },
  { id: "welt", name: "Akustik & Welt", fam: "song", moods: ["warm", "euphoric", "emotional", "dreamy"], genres: [
    G("Singer-Songwriter", [70, 110], ["einer Akustikgitarre", "einem Klavier", "leisen Streichern", "einem sanften Schlagzeug", "einem warmen Bass"]),
    G("Folk", [80, 120], ["einer Akustikgitarre", "einer Geige", "einem Banjo", "einer Mandoline", "einer Fußtrommel"]),
    G("Country", [90, 130], ["einer Steel-Gitarre", "einer Akustikgitarre", "einer Fiddle", "einem lockeren Schlagzeug", "einem laufenden Bass"]),
    G("Celtic", [90, 130], ["einer Tin Whistle", "einer Fiddle", "einer Harfe", "einer Bodhrán", "einem Dudelsack in der Ferne"]),
    G("Latin", [95, 125], ["Congas und Timbales", "einer Nylongitarre", "Bläsern", "einem Klavier-Montuno", "einem tanzenden Bass"]),
    G("Salsa", [160, 200], ["einem Klavier-Montuno", "Congas und Timbales", "einer Bläsersektion", "einem synkopierten Bass", "Clave-Schlägen"]),
    G("Bossa Nova", [110, 140], ["einer Nylongitarre", "weichen Besen", "einem samtigen Bass", "einer Flöte", "leisen Rhodes-Akkorden"], { moods: ["warm", "dreamy"] }),
    G("Flamenco", [100, 180], ["einer Flamenco-Gitarre", "Händeklatschen (Palmas)", "einem Cajón", "Kastagnetten", "einem leidenschaftlichen Rhythmus"]),
    G("Reggae", [70, 90], ["Off-Beat-Gitarren", "einem tiefen, warmen Bass", "einem One-Drop-Schlagzeug", "einer Orgel", "hallenden Effekten"], { moods: ["warm"] }),
    G("Balkan Beats", [120, 140], ["einer Blaskapelle", "einem Akkordeon", "einer Klarinette", "elektronischen Beats", "einem hüpfenden Bass"]),
    G("Orientalisch", [90, 120], ["einer Oud", "einer Darbuka", "einer Ney-Flöte", "Streichern in orientalischen Skalen", "einem tiefen Bass"]),
    G("Asiatisch", [70, 110], ["einer Guzheng", "einer Bambusflöte", "Taiko-Trommeln", "einer Erhu", "sanften Pads"]),
  ] },
  { id: "film", name: "Film & Klassik", fam: "flow", moods: ["euphoric", "dark", "emotional", "dreamy"], genres: [
    G("Filmmusik / Epic", [80, 120], ["einem großen Orchester", "mächtigen Trommeln", "einem Chor", "anschwellenden Streichern", "strahlenden Hörnern"]),
    G("Orchester / Klassik", [60, 120], ["einem Streichorchester", "Holzbläsern", "einer Harfe", "Hörnern", "Pauken"]),
    G("Neoklassik / Piano", [60, 90], ["einem einzelnen Flügel", "leisen Streichern", "einem Cello", "sanften Pads", "dem Knarzen der Hämmer"]),
    G("Kammermusik", [60, 110], ["einem Streichquartett", "einem Klavier", "einer Klarinette", "einem Cello", "einer Bratsche"]),
    G("Chormusik", [60, 90], ["einem großen Chor", "einer Orgel", "Glocken", "leisen Streichern", "langem Kirchenhall"]),
    G("Videospiel-Soundtrack", [90, 150], ["einem Orchester", "verspielten Synths", "einem heroischen Thema", "treibenden Percussions", "glitzernden Arpeggios"]),
    G("Trailer / Hybrid", [90, 130], ["riesigen Trommelschlägen", "dröhnenden Bläsern", "pulsierenden Synth-Ostinati", "Streicher-Stakkati", "tiefen Braams"], { moods: ["dark", "euphoric"] }),
  ] },
];

export const GENRES = GENRE_GROUPS.flatMap(g => g.genres.map(x => x.n));
const BY_NAME = Object.fromEntries(GENRE_GROUPS.flatMap(g => g.genres.map(x => [x.n, { ...x, fam: x.fam || g.fam, moods: x.moods || g.moods, group: g.id }])));
export const genreInfo = (n) => BY_NAME[n] || null;

// dann Songs, sonst lange Bögen. Ohne Wahl: wie bis 3.7 (club).
export function familyOf(genres) {
  const f = (genres || []).map(n => (BY_NAME[n] || {}).fam).filter(Boolean);
  if (!f.length || f.includes("club")) return "club";
  return f.includes("song") ? "song" : "flow";
}
export const roughOf = (genres) => (genres || []).some(n => (BY_NAME[n] || {}).rough);
export function tempoOf(genres) {
  const r = (genres || []).map(n => (BY_NAME[n] || {}).bpm).filter(Boolean);
  return r.length ? r[0] : null;
}

// =============================================================================
// Der Würfel — schreibt eine ausführliche Idee aus Zufallsbausteinen
// =============================================================================
// Jetzt: Bild, Anfang, Kern, Bogen, Gefühl, Klang, ein Detail und (bei Gesang) die Geschichte des
// Textes. Alles zufällig, aber passend zur gewählten Richtung (ihre Klänge, ihr Tempo, ihre Bauform).

// Szenen nach Gefühl sortiert — so landet Metal nicht bei Glühwürmchen am See.
const SCENES = {
  dark: [
    "eine verlassene Raumstation, in der nur noch die Notbeleuchtung atmet",
    "ein Leuchtturm im Sturm, dessen Strahl immer wieder durch die Gischt schneidet",
    "ein leerer Bahnhof um drei Uhr nachts, eine einzelne Lampe flackert",
    "eine verlassene Fabrikhalle, Licht fällt in Bahnen durch zerbrochene Fenster",
    "eine Verfolgungsjagd durch enge Gassen einer Stadt aus Glas und Stahl",
    "ein Gewitter über dem Meer, Blitze zeichnen kurz die Horizontlinie",
    "eine Kathedrale bei Nacht, Kerzen, Hall, der Atem wird sichtbar",
    "ein Labyrinth aus Beton unter einer Stadt, die nie schläft",
    "ein Sturm, der über eine verlassene Stadt zieht und Fensterläden schlagen lässt",
    "ein Bunker tief im Fels, Maschinen laufen seit Jahrzehnten weiter",
  ],
  euphoric: [
    "ein Club nach Mitternacht, Nebel, Stroboskop, hunderte Hände in der Luft",
    "ein Festival im Morgengrauen, die letzten Tänzer, Tau auf dem Gras",
    "ein Flug über einer geschlossenen Wolkendecke, darüber nur Licht",
    "ein Raumschiff, das in den Hyperraum springt und die Sterne zu Linien zieht",
    "ein Sprung ins kalte Meer, der Moment unter Wasser, dann die Sonne",
    "ein Gipfel über einem Nebelmeer, nur die höchsten Spitzen ragen heraus",
    "ein Wiedersehen am Flughafen nach langer Zeit",
    "ein Rennen gegen den Sonnenuntergang über eine Salzwüste",
    "ein Stadion, in dem zehntausend Menschen gleichzeitig die Arme heben",
    "der erste warme Frühlingstag, alle Fenster der Stadt stehen offen",
  ],
  emotional: [
    "der letzte Zug nach Hause, das Abteil leer, draußen ziehen dunkle Felder vorbei",
    "eine Erinnerung an einen Sommer, der nie ganz vorbei ist",
    "eine Strandbar am letzten Urlaubstag, die Sonne versinkt im Meer",
    "ein verregneter Abend in einer fremden Großstadt, Neonschilder spiegeln sich auf dem nassen Asphalt",
    "eine Bergstraße im Herbst, rotes Laub wirbelt hinter dem Wagen auf",
    "ein Ballsaal, in dem die Uhr gerade Mitternacht schlägt",
    "ein Brief, der nie abgeschickt wurde, und die Wohnung, in der er liegt",
    "ein Bahnsteig, auf dem jemand winkt, bis der Zug verschwunden ist",
  ],
  dreamy: [
    "ein Wald im ersten Schnee, so still, dass man den eigenen Herzschlag hört",
    "ein Polarlicht über einer verschneiten Ebene, grün und lautlos",
    "eine Tiefsee-Forschungsstation, Licht dringt in Strahlen durch das dunkle Wasser",
    "ein Spätsommerabend am See, Glühwürmchen und das letzte Licht auf dem Wasser",
    "ein Regenwald nach dem Wolkenbruch, alles tropft, Vögel kehren zurück",
    "ein Hafen im Morgennebel, Möwen, das Tuten eines fernen Schiffes",
    "ein schwereloser Moment zwischen Schlafen und Wachen",
    "eine Bibliothek, in der nachts die Bücher zu flüstern beginnen",
  ],
  driving: [
    "eine nächtliche Fahrt über eine leere Küstenstraße, die Lichter der Stadt werden im Rückspiegel immer kleiner",
    "eine endlose Autobahn bei Nacht, Rücklichter als rote Perlenkette",
    "eine Fahrt durch einen Tunnel aus Licht, der nie zu enden scheint",
    "eine Großstadt aus der Vogelperspektive, Millionen Lichter wie ein Schaltkreis",
    "eine Wüstenstraße bei Sonnenaufgang, die Hitze flirrt schon über dem Horizont",
    "ein Zug, der mit voller Geschwindigkeit durch die Nacht schneidet",
    "ein Lauf durch die Stadt bei Sonnenaufgang, der Atem geht im Takt",
    "ein Motorrad auf einer Passstraße, Kurve um Kurve",
  ],
  warm: [
    "ein Markt bei Sonnenuntergang, Gewürzduft, Stimmen, Lichterketten zwischen den Ständen",
    "eine Dachterrasse über der schlafenden Stadt, warme Luft, ferne Sirenen",
    "ein Zeltlager in der Steppe, Feuer, Sterne, der Wind trägt ferne Trommeln heran",
    "ein Rooftop-Pool in Tokio bei Nacht, Wolkenkratzer spiegeln sich im Wasser",
    "der Morgen nach einer langen Nacht: erste Sonne über den Dächern, die Straßen noch leer",
    "eine alte Spielhalle kurz vor Ladenschluss, die Automaten blinken noch für niemanden",
    "ein Sonntagmorgen mit offenem Fenster und Kaffeeduft",
    "ein Hinterhof-Konzert im Sommer, Lichterketten und Gelächter",
  ],
};

const MOODS = {
  dark: ["düster", "bedrohlich", "rau", "unheimlich", "kalt", "angespannt"],
  euphoric: ["euphorisch", "strahlend", "triumphal", "befreiend", "hoffnungsvoll", "überschwänglich"],
  emotional: ["melancholisch", "sehnsüchtig", "zärtlich", "wehmütig", "bittersüß", "verletzlich"],
  dreamy: ["verträumt", "schwebend", "nebelhaft", "zeitlos", "friedlich", "entrückt"],
  driving: ["hypnotisch", "treibend", "fokussiert", "rastlos", "unaufhaltsam", "pulsierend"],
  warm: ["warm", "gelassen", "verspielt", "sonnig", "zufrieden", "lässig"],
};
const MOOD_SELECT = {
  "hypnotic, driving": ["driving"], "dark, industrial": ["dark"], "euphoric, uplifting": ["euphoric"],
  "melodic, emotional": ["emotional"], "dreamy, atmospheric": ["dreamy"], "hard, peak-time, energetic": ["driving", "dark"],
  "warm, relaxed, groovy": ["warm"],
};
const ENDINGS = {
  dark: ["im Dunkeln, nur ein Ton bleibt übrig", "abrupt, wie ein Stromausfall", "mit einem letzten Schlag, der lange nachhallt", "unaufgelöst und kalt"],
  euphoric: ["in voller Helligkeit", "mit Gänsehaut", "erschöpft und glücklich", "mit einem Gefühl von Aufbruch"],
  emotional: ["offen, wie eine Frage", "versöhnlich", "mit einem leisen Lächeln", "mit einem letzten Nachhall, der lange stehen bleibt"],
  dreamy: ["wie ein Traum, an den man sich nur halb erinnert", "ruhig, als wäre ein Sturm vorbeigezogen", "in einem langen, weichen Ausklang", "schwebend, ohne Schluss"],
  driving: ["mit voller Geschwindigkeit, dann plötzliche Stille", "mit einem Gefühl von Ankunft", "erschöpft und glücklich", "mit einem letzten Aufbäumen"],
  warm: ["mit einem leisen Lächeln", "gelassen und zufrieden", "wie ein Abend, der nicht enden soll", "versöhnlich"],
};

const OPENERS = [
  (k) => `Es beginnt ganz leise mit ${k}, gefiltert, als käme es aus einem Nebenraum`,
  (k) => `Am Anfang steht nur Rauschen wie von fernem Regen, dann tastet sich das Stück mit ${k} heran`,
  (k) => `Ein einzelner Ton öffnet das Stück, bevor es sich mit ${k} langsam füllt`,
  (k) => `Das Intro atmet langsam: zuerst nur Raum und Hall, dann ein erster Puls mit ${k}`,
  (k) => `Ohne Vorwarnung geht es los, direkt mit ${k}, trocken und nah`,
  (k) => `Nach einem kurzen, verhallten Motiv beginnt das Stück mit ${k}`,
];

const HOOKS = [
  "schält sich eine Melodie heraus, die man nach dem zweiten Durchgang mitsummt",
  "wächst ein Motiv, das sich wie ein Gedanke immer wieder neu formt",
  "entsteht eine Hook aus wenigen Tönen, schlicht und unvergesslich",
  "zieht eine Melodie ihre Kreise, die zwischen Moll und Hoffnung schwankt",
  "fragt ein Motiv und eine zweite Stimme antwortet",
  "steigt eine Melodie Ton für Ton auf, als würde sie eine Treppe ins Licht nehmen",
];

const ARCS = {
  club: [
    (k) => `Nach sechzehn Takten setzt die Kick ein, tief und sauber; im Breakdown bleibt nichts als ein Klangraum mit ${k}, die Spannung baut sich mit einem langen Riser auf — und dann kehrt alles in voller Breite zurück`,
    (k) => `Der Track wächst Schicht für Schicht, jede Phase bringt ein neues Element; der Breakdown gehört ${k}, danach ein Drop, der mehr Raum als Druck hat`,
    (k) => `Zwei Drops mit verschiedenem Charakter: der erste zurückhaltend und hypnotisch, der zweite offen und groß — dazwischen ein Moment der Stille mit ${k}`,
    (k) => `Der Groove bleibt fast unverändert, aber Filter und Hall verwandeln ihn ständig; in der Mitte verändert ein Einschub mit ${k} die Farbe des ganzen Stücks`,
  ],
  song: [
    (k) => `Die Strophe bleibt sparsam und nah, der Refrain öffnet sich weit; vor dem letzten Refrain nimmt eine Bridge mit ${k} alles kurz zurück`,
    (k) => `Ein klarer Songaufbau: ruhige Strophe, wachsender Übergang, ein Refrain, der sitzt; in der Mitte ein instrumentaler Teil mit ${k}`,
    (k) => `Jeder Refrain bekommt eine Schicht mehr, bis zum Schluss alles zusammenkommt; ein kurzer Bruch mit ${k} sorgt für Gänsehaut`,
    (k) => `Das Stück beginnt intim und wird mit jeder Wiederholung größer; ein Solo mit ${k} trägt es in den letzten Teil`,
  ],
  flow: [
    (k) => `Das Stück wächst in langen Bögen, ohne Eile, bis zu einem Höhepunkt mit ${k}, der danach leise wieder zerfällt`,
    (k) => `Keine Strophen, keine Drops: ein Thema wandert durch verschiedene Klangfarben, getragen von ${k}, und kehrt am Ende verwandelt zurück`,
    (k) => `Es entfaltet sich wie eine Landschaft, durch die man langsam fährt; erst spät öffnet sich der Blick, und das Stück wird von ${k} getragen`,
    (k) => `Drei Teile — Ankommen, Aufbruch, Heimkehr — fließend verbunden, im Zentrum ein Abschnitt mit ${k}`,
  ],
};

const SOUND = {
  club: ["druckvolle, saubere Kick", "tiefer, klarer Bass", "breites Stereobild", "klare, seidige Höhen", "viel Raum und Hall", "warmer, analoger Charakter", "präzise Percussion", "polierte Produktion"],
  song: ["warmer, natürlicher Mix", "Stimme und Melodie im Vordergrund", "lebendige Dynamik", "klare Höhen", "satter Bass", "Wärme wie auf Band", "nahe, intime Aufnahme", "großer, offener Refrain-Klang"],
  flow: ["weiter, tiefer Raum", "natürliche Dynamik", "sanfte, klare Höhen", "warme Tiefen", "langer, weicher Hall", "viel Luft zwischen den Klängen", "organischer Charakter", "filmische Breite"],
  rough: ["rauer, druckvoller Mix", "verzerrte, aber klare Gitarren- und Bassflächen", "kantige Energie", "harte, punchige Drums"],
};

const DETAILS = [
  "ein kaum hörbares Vinylknistern unter dem Intro",
  "ein Glockenspiel-Ton, der nur ein einziges Mal erklingt, ganz am Ende",
  "Feldaufnahmen von Wellen tief im Hintergrund",
  "ein Klavierakkord, der rückwärts abgespielt in den Refrain führt",
  "ein Herzschlag-Puls, der im Breakdown die Kick ersetzt",
  "ein Motiv aus dem Intro, das im Finale in doppelter Geschwindigkeit wiederkehrt",
  "ferne Stimmen einer Menschenmenge, wie durch eine Wand",
  "ein einzelner Streicherton, der minutenlang liegt und sich kaum merklich verändert",
  "eine Pause von einem ganzen Takt kurz vor dem Höhepunkt",
  "Regen, der im Outro stärker wird, bis die Musik darin verschwindet",
  "ein Funkgeräusch, als würde ein Signal aus großer Ferne empfangen",
  "eine Melodie, die im Bass beginnt und am Ende ganz oben ankommt",
];

const THEMES = [
  "einem Versprechen, das man sich in einer Sommernacht gegeben hat",
  "dem Mut, alles hinter sich zu lassen und neu anzufangen",
  "zwei Menschen, die sich in einer überfüllten Stadt immer wieder verpassen",
  "dem Gefühl, endlich irgendwo anzukommen",
  "einer Liebe, die über große Entfernung hält",
  "dem Tanzen, bis die Sorgen leiser werden",
  "dem Wiederaufstehen nach einem Fall",
  "Erinnerungen an eine Zeit, die nicht wiederkommt, und Dankbarkeit dafür",
  "einer Nacht, in der alles möglich scheint",
  "dem Licht am Ende eines langen Winters",
  "Freundschaft, die alles übersteht",
  "einer Fahrt ins Ungewisse mit offenem Fenster",
  "dem Moment, bevor man sich verliebt",
  "der Sehnsucht nach dem Meer",
  "einem Abschied ohne Groll",
];
const VOICES = {
  female: ["eine warme, klare Frauenstimme, nah am Mikrofon", "eine gehauchte, intime Frauenstimme", "eine kraftvolle, soulige Frauenstimme", "eine helle, schwebende Frauenstimme mit viel Hall"],
  male: ["eine warme, raue Männerstimme", "eine sanfte, intime Männerstimme", "eine kraftvolle, soulige Männerstimme", "eine tiefe, ruhige Männerstimme"],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
function pickN(a, n) {
  const b = [...a]; const out = [];
  while (b.length && out.length < n) out.push(b.splice(Math.floor(Math.random() * b.length), 1)[0]);
  return out;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// genres: die gewählten (oder vom Würfel gezogenen) Richtungen. o: vocals, mood (Wert des Stimmung-Felds).
export function composeIdea(genres, o = {}) {
  const infos = genres.map(n => BY_NAME[n]).filter(Boolean);
  const fam = familyOf(genres);
  const kitAll = [...new Set(infos.flatMap(i => i.kit))];
  const kit = pickN(kitAll.length ? kitAll : ["warmen Pads", "einem tiefen Bass", "einem klaren Beat", "einer Melodie"], 4);
  while (kit.length < 4) kit.push(kit[0]);
  const [lo, hi] = tempoOf(genres) || [100, 128];
  const bpm = lo + Math.floor(Math.random() * (hi - lo + 1));
  const fit = [...new Set(infos.flatMap(i => i.moods || []))];
  const feel = pick(MOOD_SELECT[o.mood] || (fit.length ? fit : Object.keys(MOODS)));
  const moods = pickN(MOODS[feel], 2);
  const label = genres.length > 1 ? `${genres.slice(0, -1).join(", ")} trifft ${genres[genres.length - 1]}` : (genres[0] || "Ein Track");

  const parts = [];
  parts.push(`${label}, um ${bpm} BPM — ${pick(SCENES[feel])}.`);
  parts.push(`${pick(OPENERS)(kit[0])}.`);
  parts.push(`Getragen von ${kit[1]} und ${kit[2]} ${pick(HOOKS)}.`);
  parts.push(`${pick(ARCS[fam])(kit[3])}.`);
  parts.push(`Gefühl: ${moods.join(" und ")} — am Ende ${pick(ENDINGS[feel])}.`);
  const sound = pickN(SOUND[fam], 3);
  if (roughOf(genres)) sound[0] = pick(SOUND.rough);
  parts.push(`Klang: ${sound.join(", ")}.`);
  if (o.vocals === "female" || o.vocals === "male") {
    parts.push(`Gesang: ${pick(VOICES[o.vocals])}; der Text erzählt ${("von " + pick(THEMES)).replace(/^von dem /, "vom ")}, in Bildern statt Floskeln.`);
  } else if (o.vocals === "chops") {
    parts.push("Dazu kurze, gehauchte Vocal-Fetzen, die wie ein Echo der Melodie antworten.");
  }
  if (Math.random() < 0.7) parts.push(`Ein Detail: ${pick(DETAILS)}.`);
  return { text: parts.map(cap).join(" "), bpm };
}

// Zieht eine Richtung, wenn keine gewählt ist — gleich wahrscheinlich über alle Gruppen,
// damit die vielen Clubrichtungen den Rest nicht verdrängen.
export function randomGenre() { return pick(pick(GENRE_GROUPS).genres).n; }

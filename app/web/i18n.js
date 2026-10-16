// Manuwave Studio 3.12 — English interface.
//
// The app is written in German. This file translates what the page SHOWS, at runtime: text nodes,
// title/placeholder/aria-label/alt, the window title and confirm/alert/prompt. The code keeps working
// with its German strings — nothing that is stored, sent to the bridge or compared changes.
//   exact   — whole text matches a dictionary entry (whitespace-insensitive)
//   pattern — German texts with {0}, {1} … become anchored patterns; the parts are translated again
//   pieces  — failing both: emoji prefix, " — ", ": " and line breaks are split and translated one by one
// Language: localStorage "mws_lang" (button in the top bar), otherwise the browser language.
// Elements with translate="no" (and pre/code/textarea) are left alone — titles, lyrics, commands.
(function () {
  "use strict";
  var KEY = "mws_lang";
  var lang = "";
  try { lang = localStorage.getItem(KEY) || ""; } catch (e) { /* private window */ }
  if (lang !== "de" && lang !== "en") lang = /^de\b/i.test(navigator.language || "") ? "de" : "en";
  window.MWS_LANG = lang;
  window.mwsSetLang = function (l) { try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ } location.reload(); };
  window.mwsT = function (s) { return s; };

  function langButton() {
    var b = document.getElementById("langBtn");
    if (!b) return;
    b.textContent = lang === "en" ? "Deutsch" : "English";
    b.title = "Sprache / Language";
    b.onclick = function () { window.mwsSetLang(lang === "en" ? "de" : "en"); };
  }
  document.addEventListener("DOMContentLoaded", langButton);
  if (lang !== "en") return;

  var DICT = {
" · über 4 Min.: Hauptteil + {0} angebaute Abschnitte": " · over 4 min: main part + {0} extended sections",
"(Brücke ab 3.6 nötig).": "(needs bridge 3.6 or newer).",
"(XL: beste Qualität, etwa 2–3× langsamer als Standard)": "(XL: best quality, about 2–3× slower than standard)",
"(alte Fassung ersetzt)": "(old version replaced)",
"(endgültig — Papierkorb nicht erreichbar).": "(permanently — trash not reachable).",
") und das unhörbare Wasserzeichen hinein.": ") and the inaudible watermark.",
", Sprachmodell {0}, Modus {1}.": ", language model {0}, mode {1}.",
".m4a — verlustfrei mit Cover in Musik, Finder, iPhone": ".m4a — lossless with cover in Music, Finder, iPhone",
".tta — verlustfrei · nicht auf Apple-Geräten": ".tta — lossless · not on Apple devices",
".wv — verlustfrei, klein · nicht auf Apple-Geräten": ".wv — lossless, small · not on Apple devices",
"16 Bit — CD": "16 bit — CD",
"24 Bit — Studio": "24 bit — studio",
"320 kbit/s — läuft überall, Cover überall sichtbar": "320 kbit/s — plays everywhere, cover shown everywhere",
"44,1 kHz — CD und Vertrieb": "44.1 kHz — CD and distribution",
"48 kHz — wie gerechnet (Original)": "48 kHz — as rendered (original)",
"Abbrechen": "Cancel",
"Abholen fehlgeschlagen — im Mac-Archiv nicht gefunden. Bitte neu erzeugen.": "Fetching failed — not found in the archive on your computer. Please generate it again.",
"Abholen unterbrochen ({0}) — wird nachgeladen …": "Fetching interrupted ({0}) — retrying …",
"Abruf abgebrochen:": "Request cancelled:",
"Abspielen / Pause": "Play / pause",
"Abspielen / Pause — das Cover entsteht gerade": "Play / pause — the cover is being painted",
"Abtastrate": "Sample rate",
"Abwählen": "Deselect",
"Akustik & Welt": "Acoustic & World",
"Alle": "All",
"Alle ausgewählten exportieren — MP3 oder verlustfrei, als eine ZIP-Datei": "Export all selected — MP3 or lossless, as one ZIP file",
"Alle sichtbaren Tracks auswählen": "Select all visible tracks",
"Als MP3 oder verlustfrei (FLAC, ALAC, WAV, AIFF …) — mit Cover, Tags und Wasserzeichen": "As MP3 or lossless (FLAC, ALAC, WAV, AIFF …) — with cover, tags and watermark",
"Alten Key aus diesem Browser entfernen": "Remove the old key from this browser",
"Anfang": "Start",
"Apple-Geräte spielen dieses Format nicht ab. Cover und Tags stehen trotzdem drin — für VLC, foobar2000 und andere.": "Apple devices don't play this format. Cover and tags are still inside — for VLC, foobar2000 and others.",
"Asiatisch": "East Asian",
"Auch auf deinem Mac: Audio, Cover und Original wandern in den Papierkorb (dort bis zum Leeren zurückholbar).": "On your computer too: audio, cover and original go to the trash (recoverable until you empty it).",
"Auf Fahrstuhlmusik veröffentlichen — öffentlich und kostenlos zum Anhören (gemasterte Fassung)": "Publish on Fahrstuhlmusik — public and free to listen (mastered version)",
"Auf dem Mac löschen (Papierkorb)": "Delete on your computer (trash)",
"Auf dem Mac speichern": "Save on computer",
"Auf dem Mac: ffmpeg {0} · audiowmark {1} · Wasserzeichen-Schlüssel {2} · Bildmodell {3}": "On your computer: ffmpeg {0} · audiowmark {1} · watermark key {2} · image model {3}",
"Aufgabe für den Brief fehlt": "Task for the brief is missing",
"Auftrag unbekannt (Server neu gestartet?).": "Job unknown (server restarted?).",
"Auftrag verloren (Server neu gestartet) — bitte neu erzeugen.": "Job lost (server restarted) — please generate again.",
"Auftrag verloren (Server neu gestartet).": "Job lost (server restarted).",
"Auftrag verloren (Server neu gestartet?) — bitte noch einmal.": "Job lost (server restarted?) — please try again.",
"Auftrag war verloren": "job was lost",
"Ausblenden": "Fade out",
"Auswahl": "Selection",
"Auswahl aufheben": "Clear selection",
"Auswählen": "Select",
"Auswählen (Umschalt = Bereich)": "Select (Shift = range)",
"Beim Ändern dieselben Zufallswerte (Seeds) nehmen — der Track behält seinen Charakter": "Use the same random values (seeds) when changing — the track keeps its character",
"Bereiche": "Sections",
"Beschreibe deinen Track — Stimmung, Klang, Gefühl, gern auf Deutsch": "Describe your track — mood, sound, feeling, in your own words",
"Bibliothek nicht verfügbar (privates Fenster?).": "Library not available (private window?).",
"Bibliothek wird einmalig umgestellt ({0} {1}) …": "Converting the library once ({0} {1}) …",
"Bibliothek: Lesen abgebrochen": "Library: reading cancelled",
"Bibliothek: Schreiben abgebrochen": "Library: writing cancelled",
"Bibliothek: Umzug von": "Library: moving from",
"Bild-Server startet nicht (Port {0} belegt?)": "Image server does not start (port {0} in use?)",
"Bittiefe (verlustfrei)": "Bit depth (lossless)",
"Bricht die Musik am Ende hart ab, blendet dein Mac die letzten Sekunden weich aus und kürzt die Stille danach": "If the music stops abruptly, your computer fades out the last seconds and trims the silence after it",
"Brief": "Brief",
"Bässe": "Bass",
"Charakter behalten": "Keep character",
"Chormusik": "Choral",
"Code eingeben (z. B. KRB-DMQ).": "Enter the code (e.g. KRB-DMQ).",
"Code unbekannt": "Code unknown",
"Code unbekannt oder abgelaufen.": "Code unknown or expired.",
"Copyright aus ⚙️": "copyright from ⚙️",
"Copyright-Text": "Copyright text",
"Cover": "Cover",
"Cover groß ansehen — und bei Bedarf ein neues malen lassen": "View the cover large — and paint a new one if you like",
"Cover ist kein JPEG": "Cover is not a JPEG",
"Cover wird gemalt ({0}){1} …": "Painting the cover ({0}){1} …",
"Cover: Motiv wird beschrieben …": "Cover: describing the motif …",
"Dafür muss dein Mac verbunden sein (Brücke 3.2).": "Your computer needs to be connected for this (bridge 3.2).",
"Das Bildmodell hat kein Bild geliefert": "The image model returned no image",
"Das Cover steckt in der Datei — aber Musik, QuickTime, Finder und iPhone zeigen bei FLAC grundsätzlich kein Cover, Apple liest dort nur Textkommentare. VLC, foobar2000, Plex, Navidrome und Android-Player zeigen es.": "The cover is inside the file — but Music, QuickTime, Finder and iPhone never show covers for FLAC; Apple only reads text comments there. VLC, foobar2000, Plex, Navidrome and Android players show it.",
"Das Sprachmodell hat keine Audio-Codes geliefert.": "The language model returned no audio codes.",
"Das Sprachmodell hat keinen lesbaren Brief geliefert": "The language model returned no readable brief",
"Das letzte Cover ist nicht gelungen.": "The last cover didn't work out.",
"Das richtet die Brücke als Dienst ein (startet mit dem Mac) und öffnet Manuwave Studio gekoppelt. Der Mac verbindet sich nur": "This sets up the bridge as a service (starts with the computer) and opens Manuwave Studio paired. The computer only connects",
"Datei fehlt oder ist größer als 60 MB.": "File missing or larger than 60 MB.",
"Datei fehlt oder ist größer als {0} MB.": "File missing or larger than {0} MB.",
"Datei größer als 60 MB.": "File larger than 60 MB.",
"Datei wählen …": "Choose file …",
"Datei zu groß ({0} MB) — 16 Bit oder ein komprimiertes Format wählen": "File too large ({0} MB) — choose 16 bit or a compressed format",
"Dateien als ZIP": "files as ZIP",
"Dauert etwa 1–3 Minuten — du kannst das Fenster schließen, das Cover kommt in die Bibliothek.": "Takes about 1–3 minutes — you can close this window, the cover will appear in the library.",
"Dein Mac ist gerade nicht verbunden — die Angaben liegen auf ihm.": "Your computer is not connected right now — the details are stored on it.",
"Dein Mac ist in diesem Browser noch nicht gekoppelt.": "Your computer is not paired with this browser yet.",
"Dein Mac rechnet beim Export genau diese Kette — dazu einen Limiter (−1,5 dB), damit auch ein MP3 nicht übersteuert. Ältere Tracks mit abgeschnittenen Spitzen repariert er von selbst, vor dem Wasserzeichen.": "On export your computer renders exactly this chain — plus a limiter (−1.5 dB) so even an MP3 doesn't clip. Older tracks with clipped peaks are repaired automatically, before the watermark.",
"Dein Mac schreibt Cover, Tags (": "Your computer embeds cover, tags (",
"Dein Mac schreibt den Brief …": "Your computer is writing the brief …",
"Dein Mac sucht das Wasserzeichen in „{0}“ …": "Your computer is looking for the watermark in “{0}” …",
"Deine Musik-KI — alles läuft lokal auf deinem Mac": "Your music AI — everything runs locally on your computer",
"Den Vorschlag wiederherstellen (weich, Ende gekürzt, Lautheit automatisch)": "Restore the suggestion (soft, ending trimmed, automatic loudness)",
"Den alten Claude-API-Key aus diesem Browser entfernen?\nManuwave Studio braucht ihn nicht mehr.": "Remove the old Claude API key from this browser?\nManuwave Studio no longer needs it.",
"Der Brief des Sprachmodells ist unvollständig": "The language model's brief is incomplete",
"Der Mac antwortet nicht.": "Your computer is not responding.",
"Der Mac hat den Auftrag zwei Stunden nicht abgeholt.": "Your computer did not pick up the job for two hours.",
"Der Mac hat sich nicht mehr gemeldet.": "Your computer stopped responding.",
"Der Mac ist bei diesem Auftrag zweimal ausgestiegen.": "Your computer dropped out of this job twice.",
"Der Ordner verschwindet, seine Tracks bleiben (unter „Unsortiert“)": "The folder disappears, its tracks stay (under “Unsorted”)",
"Der Track liegt nur hier im Browser.": "This track only exists here in the browser.",
"Der mitgeschickte Track ist keine WAV-Datei": "The uploaded track is not a WAV file",
"Derselbe Brief, neue Zufallswerte": "Same brief, new random values",
"Deutsch": "German",
"Die Bibliothek liegt in diesem Browser. Jede Datei liegt zusätzlich auf deinem Mac unter": "The library lives in this browser. Every file is also stored on your computer under",
"Die Brücke auf deinem Mac ist älter als 3.2 — einmal neu einrichten (unten).": "The bridge on your computer is older than 3.2 — set it up again once (below).",
"Die Brücke auf deinem Mac ist älter als {0} — einmal neu einrichten (⚙️ › Mac einrichten).": "The bridge on your computer is older than {0} — set it up again once (⚙️ › set up computer).",
"Die Musik-KI (ACE-Step 1.5), das Sprachmodell für Brief und Liedtext und das Bildmodell fürs Cover bringt der": "The music AI (ACE-Step 1.5), the language model for briefs and lyrics and the image model for covers are installed by the",
"Die Stilbeschreibung (Tags) ist leer.": "The style description (tags) is empty.",
"Die gewählten Tracks sind nicht mehr in der Bibliothek.": "The selected tracks are no longer in the library.",
"Diesen Track zum aktuellen machen — ändern oder neue Versionen, mit seinem Charakter": "Make this the current track — change it or make new versions with its character",
"Dieser Ordner ist leer. Tracks auswählen und „📁 In Ordner …“ — oder eine Zeile hierher ziehen.": "This folder is empty. Select tracks and use “📁 Move to folder …” — or drag a row here.",
"Drop härter und breiter": "Harder, wider drop",
"Dunkler und hypnotischer": "Darker and more hypnotic",
"Ein Hörurteil-Modell bewertet jede fertige Fassung auf deinem Mac. Fällt sie durch, rechnet der Mac eine neue und behält die bessere — das kostet dann die Rechenzeit einer weiteren Fassung. Verworfene liegen im Ordner renders/_verworfen.": "A listening-judgement model rates every finished take on your computer. If it falls short, your computer renders a new one and keeps the better — that costs the time of one more take. Discarded takes are kept in renders/_verworfen.",
"Ein Rechteinhaber muss drinstehen.": "A rights holder is required.",
"Einblenden": "Fade in",
"Einen Song hochladen — die Musik-KI hört ihn an, dein Track baut darauf auf": "Upload a song — the music AI listens to it and your track builds on it",
"Einstellungen": "Settings",
"Einstellungen › Mac": "Settings › Computer",
"Einzeln holen oder auf dem Mac löschen": "Fetch individually or delete on your computer",
"Ende": "End",
"Ende geglättet": "ending smoothed",
"Englisch": "English",
"Entwurf — ungeführt, schneller": "Draft — unguided, faster",
"Er schreibt und rechnet die Musik.": "It writes and renders the music.",
"Erst den Mac koppeln — er schreibt und rechnet.": "Pair your computer first — it writes and renders.",
"Erst müssen die Angaben vom Mac gelesen sein.": "The details have to be read from your computer first.",
"Euphorischer, großer Breakdown": "More euphoric, big breakdown",
"Export braucht deinen Mac (Brücke ab 3.2) — er schreibt Cover, Tags und Wasserzeichen hinein.": "Export needs your computer (bridge 3.2 or newer) — it embeds cover, tags and watermark.",
"Exportieren": "Export",
"Fahrstuhlmusik nicht erreichbar ({0}) — ist Tailscale auf dem Mac an?": "Fahrstuhlmusik not reachable ({0}) — is Tailscale running on your computer?",
"Fahrstuhlmusik wandelt um …": "Fahrstuhlmusik is converting …",
"Favorit": "Favourite",
"Favorit bleibt": "favourite stays",
"Favoriten": "Favourites",
"Favoriten bleiben": "favourites stay",
"Fehler auf dem Mac": "Error on your computer",
"Fehler {0}": "Error {0}",
"Feinheiten — Stimmung, Tempo, Tonart, Klangqualität, Referenz-Track": "Details — mood, tempo, key, sound quality, reference track",
"Film & Klassik": "Film & Classical",
"Filmmusik / Epic": "Film score / Epic",
"Findet, wo die Musik aufhört, und schneidet den Klangrest dahinter ab": "Finds where the music ends and trims the residual sound after it",
"Französisch": "French",
"Für ein neues Cover muss dein Mac verbunden sein (Brücke 3.2).": "Your computer must be connected for a new cover (bridge 3.2).",
"Für ein neues Cover muss dein Mac verbunden sein.": "Your computer must be connected for a new cover.",
"Ganzer Track": "Whole track",
"Gefällt es nicht? Ein neues Motiv kommt in etwa 1–3 Minuten.": "Don't like it? A new motif takes about 1–3 minutes.",
"Gekoppelt, aber der Mac meldet sich gerade nicht — Aufträge warten auf ihn.": "Paired, but your computer is not responding right now — jobs wait for it.",
"Gelöscht — auf dem Mac noch nicht ({0}). Wird nachgeholt.": "Deleted — not yet on your computer ({0}). Will be done later.",
"Gelöscht. Auf dem Mac {0} gelöscht, sobald er verbunden ist": "Deleted. On your computer {0} deleted as soon as it is connected",
"Gemastert — ▶︎ spielt deine Einstellungen. Hier ändern": "Mastered — ▶︎ plays your settings. Change here",
"Gemasterte Fassung für die Seite …": "Mastered version for the site …",
"Gesang": "Vocals",
"Gesang mit Text braucht das Sprachmodell auf dem Mac — {0}.": "Vocals with lyrics need the language model on your computer — {0}.",
"Gesang ♀": "Vocals ♀",
"Gesang ♂": "Vocals ♂",
"Gewählt:": "Selected:",
"Gilt für jeden Track, den dieser Mac erzeugt: steht in den Tags jeder Datei, und das unhörbare Wasserzeichen trägt die Kennung. Die Angaben liegen auf dem Mac, nicht im Browser.": "Applies to every track this computer creates: it's in the tags of every file, and the inaudible watermark carries the ID. The details are stored on the computer, not in the browser.",
"Gruppen": "Groups",
"Hinter dem Ende ist nichts abzuschneiden.": "Nothing to trim after the end.",
"Höhen": "Treble",
"Hören geht — für den Export mit Mastering braucht dein Mac die Brücke 3.4.": "Listening works — exporting with mastering needs bridge 3.4 on your computer.",
"In Ordner verschieben": "Move to folder",
"In die Bibliothek holen": "Add to the library",
"Installer von Manuwave Studio": "Manuwave Studio installer",
"Instrumental": "Instrumental",
"Irgendeine Audiodatei (auch eine MP3 aus dem Netz): stammt sie von diesem Mac, und welcher Track ist es?": "Any audio file (even an MP3 from the web): does it come from this computer, and which track is it?",
"Italienisch": "Italian",
"Jazz, Soul & Funk": "Jazz, Soul & Funk",
"Jede Änderung wird sofort gespeichert und gilt für jeden Export dieses Tracks.": "Every change is saved immediately and applies to every export of this track.",
"Jeder kann ihn dort kostenlos anhören. Hochgeladen wird die gemasterte Fassung mit Cover, Liedtext und deiner Notiz, gekennzeichnet als KI-erzeugt. Zurückziehen geht jederzeit.": "Anyone can listen to it there for free. The mastered version is uploaded with cover, lyrics and your note, labelled as AI-generated. You can withdraw it at any time.",
"Jetzt läuft": "Now playing",
"KI-Cover für jeden Track": "AI cover for every track",
"Kammermusik": "Chamber music",
"Kein Audio (mehr) vorhanden.": "No audio (any more).",
"Kein Bildmodell installiert (macOS: tools/ollama-bild mit x/flux2-klein:4b, Windows/Linux: tools/sd + models/sd) — den Installer erneut ausführen": "No image model installed (macOS: tools/ollama-bild with x/flux2-klein:4b, Windows/Linux: tools/sd + models/sd) — run the installer again",
"Kein Cover (noch nicht).": "No cover (yet).",
"Kein Sprachmodell auf dem Mac erreichbar (Ollama)": "No language model reachable on your computer (Ollama)",
"Kein gültiger Kopplungsschlüssel — Mac-Brücke in den Einstellungen koppeln.": "No valid pairing key — pair the bridge in the settings.",
"Kein unmarkiertes Original für {0}": "No unmarked original for {0}",
"Keine Fahrstuhlmusik-Seite eingetragen (bridge.json → web_admin)": "No Fahrstuhlmusik site configured (bridge.json → web_admin)",
"Keine Richtung gewählt — 🎲 zieht dann selbst eine.": "No style selected — 🎲 picks one for you.",
"Klang & Stil — Tags für die Musik-KI (englisch, kommagetrennt)": "Sound & style — tags for the music AI (English, comma-separated)",
"Klangmodell": "Sound model",
"Klangprüfung": "Quality check",
"Klangprüfung {0} — unter {1}, neue Fassung ({2}/{3}) …": "Quality {0} — below {1}, rendering a new take ({2}/{3}) …",
"Klangprüfung …": "Quality check …",
"Klangqualität": "Sound quality",
"Klar": "Clear",
"Klicken = an diese Stelle springen": "Click = jump to this position",
"Klicken = schließen": "Click = close",
"Klicken = springen": "Click = jump",
"Klicken zum Umbenennen": "Click to rename",
"Koppeln": "Pair",
"Kopplung lösen": "Unpair",
"Kopplung mit dem Mac in DIESEM Browser lösen?": "Unpair your computer in THIS browser?",
"Kopplungscode, z. B. KRB-DMQ": "Pairing code, e.g. KRB-DMQ",
"Künstlername": "Artist name",
"Künstlername als Schriftzug aufs Cover": "Artist name as lettering on the cover",
"Langer Titel: Teil {0}/{1}, Versuch {2} …": "Long track: part {0}/{1}, attempt {2} …",
"Lautheit": "Loudness",
"Lautheit nicht messbar": "Loudness could not be measured",
"Lautheit wird gemessen …": "Measuring loudness …",
"Letzte Änderung zurücknehmen": "Undo the last change",
"Liedtext wird an die Musik angelegt …": "Aligning the lyrics to the music …",
"Liste ▴": "List ▴",
"Liste ▾": "List ▾",
"Länge": "Length",
"Löschen — auch auf dem Mac (Papierkorb)": "Delete — on your computer too (trash)",
"Mac": "Computer",
"Mac einrichten (einmalig)": "Set up computer (once)",
"Mac koppeln": "Pair computer",
"Mac nicht erreichbar — deine Änderungen sind gemerkt und werden gespeichert, sobald er da ist.": "Computer not reachable — your changes are kept and saved as soon as it's back.",
"Mac war kurz weg — läuft neu an …": "Computer was briefly away — restarting …",
"Mac übernimmt …": "Your computer is taking over …",
"Manuwave Studio — Musik-KI": "Manuwave Studio — music AI",
"Mastern — Klang, Lautheit, Anfang/Ende einstellen; gilt dann hier und im Export": "Master — set sound, loudness, start/end; applies here and in every export",
"Maximal": "Maximum",
"Maximal — 80 Schritte, langsamer": "Maximum — 80 steps, slower",
"Meditation / Klangschalen": "Meditation / Singing bowls",
"Mehr Groove, weniger Druck": "More groove, less pressure",
"Mehr Melodie, eine Hook zum Mitsummen": "More melody, a hook to hum along",
"Modellserver ist nicht hochgekommen — Log in ~/NeonForge/": "The model server did not start — see the log in ~/NeonForge/",
"Musik-KI auf dem Mac wird gestartet …": "Starting the music AI …",
"Musik-KI nicht installiert (ace-server fehlt in {0}) — erst den Installer von Manuwave Studio ausführen.": "Music AI not installed (ace-server missing in {0}) — run the Manuwave Studio installer first.",
"NEU": "NEW",
"Nachladen vom Mac gescheitert ({0}) — neuer Versuch in einer Minute": "Fetching from your computer failed ({0}) — retrying in a minute",
"Name des neuen Ordners:": "Name of the new folder:",
"Neoklassik / Piano": "Neoclassical / Piano",
"Neu starten (gleiche Einstellungen)": "Restart (same settings)",
"Neuen Ordner anlegen": "Create a new folder",
"Neuer Name für den Ordner:": "New name for the folder:",
"Neuer Titel:": "New title:",
"Neuer Track": "New track",
"Neustart nicht möglich: {0}": "Restart not possible: {0}",
"Nicht nachladen (bleibt auf dem Mac)": "Don't fetch (stays on your computer)",
"Nichts zu löschen": "Nothing to delete",
"Noch kein Cover.": "No cover yet.",
"Noch kein Track in der Bibliothek — erzeuge im Studio deinen ersten.": "No track in the library yet — generate your first one in the studio.",
"Noch keine Favoriten.": "No favourites yet.",
"Noch keine Tracks — erzeuge oben deinen ersten.": "No tracks yet — generate your first one above.",
"Noch nicht gekoppelt. Auf dem Mac einmal die Brücke einrichten (siehe unten), dann den angezeigten": "Not paired yet. Set up the bridge on your computer once (see below), then enter the code shown",
"Notiz nicht übersetzt: {0}": "Note not translated: {0}",
"Notiz wird übersetzt …": "Translating the note …",
"Ohne Titel": "Untitled",
"Orchester / Klassik": "Orchestral / Classical",
"Ordner": "Folder",
"Ordner auflösen": "Dissolve folder",
"Ordner „{0}“ auflösen?\nDie Tracks darin bleiben erhalten und stehen dann unter „Unsortiert“.": "Dissolve folder “{0}”?\nIts tracks are kept and move to “Unsorted”.",
"Orientalisch": "Middle Eastern",
"Pakete": "packages",
"Pause / weiter": "Pause / continue",
"Rechteinhaber (Copyright)": "Rights holder (copyright)",
"Referenz-Track": "Reference track",
"Referenz:": "Reference:",
"Richtung": "Style",
"Schließen": "Close",
"Schreib Zeilen unter die Marker, oder erzeuge den Track oben neu mit „Gesang ♀/♂“ — dann schreibt dein Mac den Text.": "Write lines under the markers, or generate the track again above with “Vocals ♀/♂” — then your computer writes the lyrics.",
"Schriftzug: kein JPEG": "Lettering: not a JPEG",
"Server startet neu — dein Mac arbeitet weiter …": "Server is restarting — your computer keeps working …",
"Server startet neu — dein Mac rechnet weiter …": "Server is restarting — your computer keeps rendering …",
"Server war neu gestartet — dein Mac rechnet weiter …": "Server was restarted — your computer keeps rendering …",
"So entsteht er: ① dein Mac schreibt den Produktions-Brief (lokales Sprachmodell) · ② die Musik-KI": "How it's made: ① your computer writes the production brief (local language model) · ② the music AI",
"Songstruktur & Text —": "Song structure & lyrics —",
"Spanisch": "Spanish",
"Sprache": "Language",
"Sprache / Language": "Language / Sprache",
"Sprache des Textes": "Lyrics language",
"Sprachmodell": "Language model",
"Sprachmodell:": "Language model:",
"Standard für verlustfrei, Archiv und Vertrieb · Apple zeigt kein Cover": "Standard for lossless, archive and distribution · Apple shows no cover",
"Standard — schneller": "Standard — faster",
"Starte Ollama auf dem Mac oder wähle Instrumental bzw. Vocal-Chops.": "Start Ollama on your computer or choose Instrumental or Vocal chops.",
"Stimmung": "Mood",
"Stopp": "Stop",
"Studio — geführt, 50 Schritte": "Studio — guided, 50 steps",
"Synth & Retro": "Synth & Retro",
"Takt": "Time signature",
"Titel": "Title",
"Titel aufs Cover": "Title on the cover",
"Tonart": "Key",
"Tonart auto": "key auto",
"Tonfarbe": "Tone",
"Track": "track",
"Track bekommt": "track gets",
"Track klingt": "track sounds",
"Track liegt": "track is",
"Track wartet": "track waits",
"Track zum Mastern": "Track to master",
"Track-Angaben fehlen": "Track details missing",
"Tracks": "tracks",
"Tracks bekommen": "tracks get",
"Tracks klingen": "tracks sound",
"Tracks liegen": "tracks are",
"Tracks warten": "tracks wait",
"Unbekannte Auftragsart.": "Unknown job type.",
"Unhörbares Wasserzeichen": "Inaudible watermark",
"Unsortiert": "Unsorted",
"Unter „✎ Brief von Hand bearbeiten“ kannst du selbst ändern.": "You can change it yourself under “✎ Edit brief by hand”.",
"Verbunden": "Connected",
"Vergleich": "Compare",
"Verlustbehaftet": "Lossy",
"Verlustfrei": "Lossless",
"Verlustfrei mit Cover auf Apple: ALAC nehmen": "Lossless with cover on Apple: use ALAC",
"Version": "version",
"Versionen": "versions",
"Veröffentlichen braucht die Brücke 3.10 auf deinem Mac (⚙️ › Mac einrichten).": "Publishing needs bridge 3.10 on your computer (⚙️ › set up computer).",
"Veröffentlichungspaket wird geschnürt …": "Building the release package …",
"Videospiel-Soundtrack": "Video game soundtrack",
"Vocal-Chops": "Vocal chops",
"Voreinstellungen": "Presets",
"Vorschau: Künstler „{0}“ · {1}": "Preview: artist “{0}” · {1}",
"Vorschlag": "Suggestion",
"Vorschlag (weich, Ende gekürzt, Lautheit automatisch) — sobald du etwas änderst, gilt es auch in der Bibliothek": "Suggestion (soft, ending trimmed, automatic loudness) — as soon as you change something, it applies in the library too",
"Vorschlag wiederhergestellt": "Suggestion restored",
"Was soll anders werden?": "What should change?",
"Wasserzeichen fehlt — Veröffentlichen abgebrochen": "Watermark missing — publishing cancelled",
"Wasserzeichen hat das Format verändert ({0} → {1})": "Watermarking changed the format ({0} → {1})",
"Wasserzeichen nach dem Aufbereiten nicht lesbar — alte Datei bleibt": "Watermark not readable after processing — the old file stays",
"Wasserzeichen wird gesucht …": "Looking for the watermark …",
"Weich": "Soft",
"Wellenform: Griffe ziehen = Anfang/Ende schneiden, Klick = springen": "Waveform: drag the handles = trim start/end, click = jump",
"Wärmer und organischer, weniger digital": "Warmer and more organic, less digital",
"XL — größtes Modell, beste Qualität": "XL — largest model, best quality",
"Zu groß für eine ZIP ({0}) — bitte weniger auswählen.": "Too large for one ZIP ({0}) — please select fewer.",
"Zufälliger Track nach deiner Auswahl: schreibt eine ausführliche Idee und erzeugt sofort": "Random track from your selection: writes a detailed idea and generates right away",
"Zum Track in der Bibliothek springen": "Jump to the track in the library",
"alle auswählen": "select all",
"audiowmark fehlt auf dem Mac — Wasserzeichen nicht möglich": "audiowmark is missing — no watermark possible",
"aus": "off",
"aus einer früheren Fassung. Manuwave Studio benutzt ihn nicht mehr — alles läuft lokal.": "from an earlier version. Manuwave Studio no longer uses it — everything runs locally.",
"aus — jede Fassung behalten": "off — keep every take",
"automatisch": "automatic",
"automatisch, z. B. A minor": "automatic, e.g. A minor",
"dem Mac": "your computer",
"der Mac braucht zu lange": "your computer takes too long",
"der Mac holt den Auftrag nicht ab": "your computer doesn't pick up the job",
"der Mac meldet sich gerade nicht": "your computer is not responding right now",
"der Mac meldet sich gerade nicht.": "your computer is not responding right now.",
"düster / industriell": "dark / industrial",
"entsteht beim ersten Track": "created with the first track",
"erzeugt die Datei": "is creating the file",
"es läuft gerade keins (Ollama).": "none is running right now (Ollama).",
"euphorisch / uplifting": "euphoric / uplifting",
"ffmpeg fehlt auf dem Mac — Export nicht möglich (brew install ffmpeg)": "ffmpeg is missing — export not possible",
"ffmpeg fehlt — Cover lässt sich nicht umwandeln": "ffmpeg is missing — the cover can't be converted",
"hart / peak-time": "hard / peak-time",
"heller": "brighter",
"hier eingeben.": "here.",
"hypnotisch / treibend": "hypnotic / driving",
"kein Copyright-Text": "no copyright text",
"kein Cover": "no cover",
"kein Sprachmodell": "no language model",
"kein Sprachmodell auf dem Mac": "no language model on your computer",
"kein {0}-Teil in der Antwort": "no {0} part in the response",
"keine WAV-Datei": "not a WAV file",
"koppele …": "pairing …",
"leer = Rechteinhaber": "empty = rights holder",
"leer = jeder Track eine Single": "empty = every track a single",
"lese vom Mac …": "reading from your computer …",
"liegt fertig auf deinem Mac — wird nachgeladen, sobald er sich meldet": "is ready on your computer — will be fetched as soon as it responds",
"lädt …": "loading …",
"melodisch / emotional": "melodic / emotional",
"mit eigenen Einstellungen,": "with your own settings,",
"mit {0} — {1}, {2} GB.": "with {0} — {1}, {2} GB.",
"mit. Wer die App auf einem anderen Rechner betreibt als die KI, koppelt den Rechner mit der KI so (im Terminal):": ". If the app runs on a different computer than the AI, pair the computer running the AI like this (in a terminal):",
"nach außen": "outwards",
"nach dem Nachrüsten weiter unvollständig": "still incomplete after finishing",
"nicht im Mac-Archiv gefunden": "not found in the archive on your computer",
"nimmt die Härte bei 3,5 kHz": "takes the edge off around 3.5 kHz",
"optional": "optional",
"rechnet auf deinem Mac, etwa in Echtzeit. Nichts davon verlässt dein Netz.": "renders on your computer, roughly in real time. Nothing leaves your network.",
"schnürt das Paket": "is building the package",
"schwache Fassung 1× neu würfeln": "re-roll a weak take once",
"schwache Fassung bis zu 2× neu würfeln": "re-roll a weak take up to 2×",
"sd-server lieferte kein Bild ({0})": "sd-server returned no image ({0})",
"sd-server startet nicht — siehe {0}": "sd-server does not start — see {0}",
"speichere auf dem Mac …": "saving on your computer …",
"speichert …": "saving …",
"ungeführt": "unguided",
"unkomprimiert — DAWs, Vertrieb": "uncompressed — DAWs, distribution",
"unkomprimiert, mit Cover": "uncompressed, with cover",
"verschoben —": "moved —",
"verträumt / atmosphärisch": "dreamy / atmospheric",
"warm / entspannt": "warm / relaxed",
"warm ↔ hell": "warm ↔ bright",
"wartet auf den Mac …": "waiting for your computer …",
"wartet — der Mac meldet sich gerade nicht": "waiting — your computer is not responding right now",
"weich ausblenden, wenn es abbricht": "fade out softly if it stops abruptly",
"werden sie": "they will be",
"wie bisher": "as before",
"wird er": "it will be",
"wird gemalt …": "being painted …",
"wärmer": "warmer",
"z. B. „Bassline rollender, Breakdown mit Piano, 4 BPM schneller“": "e.g. “rolling bassline, piano in the breakdown, 4 BPM faster”",
"z. B. „Melodischer Trance für einen Sonnenaufgang, warme Pads, eine Hook zum Mitsummen, Gänsehaut im Breakdown“": "e.g. “Melodic trance for a sunrise, warm pads, a hook to hum along, goosebumps in the breakdown”",
"{0} Tracks": "{0} tracks",
"{0} Tracks — kommen als eine ZIP-Datei": "{0} tracks — delivered as one ZIP file",
"{0} auf deinem Mac löschen?\nAudio, Cover und Original wandern in den Papierkorb (dort bis zum Leeren zurückholbar).": "Delete {0} on your computer?\nAudio, cover and original go to the trash (recoverable until you empty it).",
"{0} ausgewählt": "{0} selected",
"{0} löschen?": "Delete {0}?",
"{0} · Brief: {1} · Musik: ACE-Step 1.5 ({2})": "{0} · brief: {1} · music: ACE-Step 1.5 ({2})",
"{0}„{1}“ — dein Mac {2} …": "{0}“{1}” — your computer {2} …",
"{0}„{1}“ — wartet auf das Cover, das gerade entsteht …": "{0}“{1}” — waiting for the cover being painted …",
"{0}✓ Brief steht — {1} {2} auf dem Weg zum Mac.": "{0}✓ Brief ready — {1} {2} on the way to your computer.",
"{jahr}, {inhaber} und {kuenstler} werden eingesetzt": "{jahr}, {inhaber} and {kuenstler} are filled in",
"© Urheber & Rechte": "© Author & rights",
"· Brief: Sprachmodell auf deinem Mac · Musik: ACE-Step 1.5 · Cover: Bildmodell auf deinem Mac": "· brief: language model on your computer · music: ACE-Step 1.5 · cover: image model on your computer",
"· Tempo-Schätzung {0} BPM · {1}": "· tempo estimate {0} BPM · {1}",
"· gerade dran": "· in progress",
"· gesetzt": "· set",
"Ändern & erzeugen": "Change & generate",
"Ändern braucht das Sprachmodell auf dem Mac —": "Changing needs the language model on your computer —",
"Öffentlich auf Fahrstuhlmusik: {0} — klicken für Link, neu veröffentlichen oder zurückziehen": "Public on Fahrstuhlmusik: {0} — click for link, republish or withdraw",
"Übergabe an Manuwave Studio dreimal zu langsam ({0}) — der Track liegt auf dem Mac im Archiv; in der Bibliothek über „📥 Vom Mac holen“ holen": "Handover to Manuwave Studio too slow three times ({0}) — the track is in the archive on your computer; fetch it in the library with “📥 Fetch from computer”",
"Übernommen — „Charakter behalten“ ist an: Ändern behält den Seed dieses Tracks.": "Taken over — “Keep character” is on: changes keep this track's seed.",
"Übertrage an Fahrstuhlmusik …": "Uploading to Fahrstuhlmusik …",
"über 4 Min.: Hauptteil + {0} angebaute Abschnitte": "over 4 min: main part + {0} extended sections",
"— Manuwave Studio baut den Brief dann aus deinen Angaben, die Musik-KI schreibt den Text": "— Manuwave Studio then builds the brief from your input, the music AI writes the lyrics",
"— Vorschlag: weich, Ende gekürzt, −14 LUFS (anpassen mit 🎚)": "— suggestion: soft, ending trimmed, −14 LUFS (adjust with 🎚)",
"— als ZIP: Musik, Cover 3000 × 3000, Metadaten mit KI-Angaben, Liedtext, Herkunftsnachweis (PDF), Lizenzvorlage für Firmen (Word)": "— as ZIP: music, 3000 × 3000 cover, metadata with AI credits, lyrics, proof of origin (PDF), licence template for businesses (Word)",
"— braucht die Brücke 3.4 auf deinem Mac": "— needs bridge 3.4 on your computer",
"— braucht die Brücke 3.9 auf deinem Mac (⚙️ › Mac einrichten)": "— needs bridge 3.9 on your computer (⚙️ › set up computer)",
"— dann steht er als dein Beitrag im Nachweis und nicht als KI-Text in den Metadaten": "— then it's listed as your contribution in the proof, not as AI text in the metadata",
"— deine Einstellungen aus 🎚": "— your settings from 🎚",
"— er öffnet keinen Port. Neuer Code für ein weiteres Gerät:": "— it opens no port. New code for another device:",
"— es spielt das Original.": "— the original is playing.",
"— frei —": "— free —",
"— liegt im Papierkorb, bis du ihn leerst.": "— in the trash until you empty it.",
"— mit Cover, Tags und Wasserzeichen.": "— with cover, tags and watermark.",
"— so klingt der Track jetzt auch in der Bibliothek und im Export": "— this is how the track now sounds in the library and in exports",
"— {0}{1} mit Vorschlag": "— {0}{1} with suggestion",
"„KI-erzeugt“ in den Tags": "“AI-generated” in the tags",
"„{0}{1}“ auf Fahrstuhlmusik veröffentlichen?": "Publish “{0}{1}” on Fahrstuhlmusik?",
"„{0}“ von Fahrstuhlmusik nehmen?": "Remove “{0}” from Fahrstuhlmusik?",
"↗︎ Auf Fahrstuhlmusik ansehen": "↗︎ View on Fahrstuhlmusik",
"↶ Rückgängig": "↶ Undo",
"↻ neu gestartet · {0}": "↻ restarted · {0}",
"↻ neu gestartet — gleiche Einstellungen, gleicher Seed": "↻ restarted — same settings, same seed",
"↻ „{0}“ wurde unterbrochen ({1}) und läuft neu.": "↻ “{0}” was interrupted ({1}) and is running again.",
"⏱ ≈ {0} Min. Rechenzeit auf deinem Mac für {1} {2}": "⏱ ≈ {0} min rendering time on your computer for {1} {2}",
"⏳ Mastering wird gerechnet …": "⏳ Rendering the master …",
"⏸ Anhalten": "⏸ Pause",
"⏸ Pause": "⏸ Pause",
"▶︎ Abspielen": "▶︎ Play",
"▶︎ Weiter": "▶︎ Continue",
"★ Favorit": "★ Favourite",
"★ Favorit — geschützt. Erst den Stern entfernen, dann löschen.": "★ Favourite — protected. Remove the star first, then delete.",
"★ Favoriten": "★ Favourites",
"★ Favoriten sind geschützt — erst den Stern entfernen, dann löschen.": "★ Favourites are protected — remove the star first, then delete.",
"★ {0} löschen geht nicht — erst den Stern entfernen.": "★ {0} can't be deleted — remove the star first.",
"★ {0} {1} (geschützt).": "★ {0} {1} (protected).",
"⚙️ Dein Mac": "⚙️ Your computer",
"⚠️ Im Stil steht Gesang, aber die Struktur hat keine Textzeilen — so wird es fast ein Instrumental.": "⚠️ The style asks for vocals, but the structure has no lyric lines — it will be almost instrumental.",
"⚪ Mac schläft": "⚪ Computer asleep",
"✂︎ Ende automatisch": "✂︎ Auto end",
"✂︎ Ende bei {0} — dahinter nur noch Klangrest": "✂︎ End at {0} — only residual sound after that",
"✅ Trägt dein Wasserzeichen{0}{1}{2}": "✅ Carries your watermark{0}{1}{2}",
"✍️ Brief von deinem Mac · {0}{1}": "✍️ Brief from your computer · {0}{1}",
"✍️ Brief: {0}": "✍️ Brief: {0}",
"✍️ Dein Mac schreibt den Brief ({0}) …": "✍️ Your computer is writing the brief ({0}) …",
"✍️ Dein Mac schreibt den Brief ({0}) … {1} s": "✍️ Your computer is writing the brief ({0}) … {1} s",
"✍️ Dein Mac schreibt den Brief um ({0}) …": "✍️ Your computer is rewriting the brief ({0}) …",
"✍️ Den Liedtext habe ich selbst geschrieben": "✍️ I wrote the lyrics myself",
"✎ Brief von Hand bearbeiten": "✎ Edit brief by hand",
"✎ Umbenennen": "✎ Rename",
"✎ von Hand bearbeitet": "✎ edited by hand",
"✏️ Deine Änderungen von vorhin sind wieder da — noch nicht gerechnet.": "✏️ Your earlier changes are back — not rendered yet.",
"✓ Gelöscht.": "✓ Deleted.",
"✓ Gespeichert — gilt für neue Tracks und jeden Export.": "✓ Saved — applies to new tracks and every export.",
"✓ Geändert — {0} {1} auf dem Weg.": "✓ Changed — {0} {1} on the way.",
"✓ Neues Cover für „{0}“": "✓ New cover for “{0}”",
"✓ deine Einstellungen — so klingt der Track auch in der Bibliothek und im Export": "✓ your settings — this is how the track sounds in the library and in exports",
"✓ gekoppelt": "✓ paired",
"✓ gespeichert": "✓ saved",
"✓ neues Cover": "✓ new cover",
"✓ {0} neue {1} auf dem Weg.": "✓ {0} new {1} on the way.",
"✓ {0} {1} auf dem Weg.": "✓ {0} {1} on the way.",
"✓ {0} {1} in der neuen Fassung": "✓ {0} {1} in the new version",
"✓ {0} {1} vom Mac geholt": "✓ {0} {1} fetched from your computer",
"✓ „{0}“ ist nicht mehr öffentlich.": "✓ “{0}” is no longer public.",
"✓ „{0}“ ist online{1}: {2}": "✓ “{0}” is online{1}: {2}",
"✕ Zurückziehen": "✕ Withdraw",
"✗ Analyse:": "✗ Analysis:",
"✗ Analyse: der Mac hat nicht geantwortet.": "✗ Analysis: your computer did not respond.",
"✗ Audio im Browser nicht lesbar — Seite neu laden oder „📥 Vom Mac holen“.": "✗ Audio not readable in the browser — reload the page or “📥 Fetch from computer”.",
"✗ Cover:": "✗ Cover:",
"✗ Kein Wasserzeichen dieses Macs in „{0}“.": "✗ No watermark from this computer in “{0}”.",
"✗ Mastering nicht berechenbar": "✗ Mastering could not be rendered",
"✗ Mastering nicht berechenbar:": "✗ Mastering could not be rendered:",
"✗ Speichern fehlgeschlagen — der Stand liegt im Browser und wird beim nächsten Start nachgeholt": "✗ Saving failed — the state is kept in the browser and saved on next start",
"✗ Track nicht lesbar:": "✗ Track not readable:",
"✗ fehlt (~/NeonForge/tools/ollama-bild)": "✗ missing (~/NeonForge/tools/ollama-bild)",
"✗ „{0}“: {1}": "✗ “{0}”: {1}",
"✨ Bessere Fassung holen": "✨ Get the better version",
"✨ Veredeln: {0} {1} offen — Cover, Tags, Wasserzeichen{2} …": "✨ Finishing: {0} {1} open — cover, tags, watermark{2} …",
"✨ wird veredelt …": "✨ being finished …",
"✨ {0} {1} Cover, Tags und Wasserzeichen, sobald dein Mac verbunden ist.": "✨ {0} {1} cover, tags and watermark as soon as your computer is connected.",
"✨ {0} {1} auf Cover, Tags und Wasserzeichen — angehalten.": "✨ {0} {1} for cover, tags and watermark — paused.",
"✨ {0} {1} auf deinem Mac jetzt besser (abgeschnittene Spitzen repariert, leises Wasserzeichen, 24 Bit) — hier liegt noch die alte Kopie. Exporte kommen schon von der neuen.": "✨ {0} {1} better on your computer now (clipped peaks repaired, quiet watermark, 24 bit) — this is still the old copy. Exports already use the new one.",
"✨ {0}/{1} · „{2}{3}“ — neue Fassung kommt vom Mac …": "✨ {0}/{1} · “{2}{3}” — new version coming from your computer …",
"✨ Ändern — sag deinem Produzenten, was anders soll": "✨ Change — tell your producer what should be different",
"⟳ Neu veröffentlichen (aktuelles Mastering)": "⟳ Republish (current mastering)",
"⟳ Online aktualisieren": "⟳ Update online",
"⤴︎ Weiterarbeiten": "⤴︎ Continue working",
"⬇︎ Cover speichern": "⬇︎ Save cover",
"⬇︎ Export": "⬇︎ Export",
"⬇︎ Exportieren": "⬇︎ Export",
"＋ Neuer Ordner …": "＋ New folder …",
"＋ Ordner": "＋ Folder",
"🌐 1 veröffentlichter Track klingt auf Fahrstuhlmusik anders als dein Mastering.": "🌐 1 published track sounds different on Fahrstuhlmusik than your mastering.",
"🌐 online": "🌐 online",
"🌐 {0} veröffentlichte Tracks klingen auf Fahrstuhlmusik anders als dein Mastering.": "🌐 {0} published tracks sound different on Fahrstuhlmusik than your mastering.",
"🌐 „{0}“ wird veröffentlicht …": "🌐 Publishing “{0}” …",
"🌐 „{0}“ wird zurückgezogen …": "🌐 Withdrawing “{0}” …",
"🎚 Gemastert": "🎚 Mastered",
"🎚 Mastering wird gerechnet …": "🎚 Rendering the master …",
"🎚 Mit diesen Angaben erzeugen": "🎚 Generate with these details",
"🎚 gemastert": "🎚 mastered",
"🎚 wird gemastert …": "🎚 being mastered …",
"🎧 Bibliothek": "🎧 Library",
"🎧 Hochladen …": "🎧 Upload …",
"🎧 {0} — wird hochgeladen …": "🎧 {0} — uploading …",
"🎨 Cover entsteht …": "🎨 Cover being painted …",
"🎨 Cover malen": "🎨 Paint cover",
"🎨 Das Cover entsteht gerade …": "🎨 The cover is being painted …",
"🎨 Neues Cover für „{0}“ wird gemalt …": "🎨 Painting a new cover for “{0}” …",
"🎨 Neues Cover malen": "🎨 Paint new cover",
"🎲 Neue Versionen vom selben Brief": "🎲 New versions of the same brief",
"🎲 Würfeln & erzeugen": "🎲 Roll & generate",
"🎵 Musik:": "🎵 Music:",
"🎼 Neuer Track": "🎼 New track",
"🎼 Studio": "🎼 Studio",
"📁 In Ordner …": "📁 Move to folder …",
"📋 Brief aus deinen Angaben (ohne Sprachmodell){0}": "📋 Brief from your input (without language model){0}",
"📥 Vom Mac holen": "📥 Fetch from computer",
"📥 wird vom Mac nachgeladen …": "📥 being fetched from your computer …",
"📥 {0} {1} nur auf deinem Mac:": "📥 {0} {1} only on your computer:",
"📥 {0}/{1} · „{2}“ wird geholt (mit Cover, Tags, Wasserzeichen) …": "📥 {0}/{1} · fetching “{2}” (with cover, tags, watermark) …",
"📦 Paket schnüren": "📦 Build package",
"📦 Veröffentlichungspaket": "📦 Release package",
"🔌 Mac koppeln": "🔌 Pair computer",
"🔌 Mac …": "🔌 Computer …",
"🔎 Klang {0}": "🔎 Sound {0}",
"🔎 Klang {0} · beste von {1}": "🔎 Sound {0} · best of {1}",
"🔏 Wasserzeichen": "🔏 Watermark",
"🔏 Wasserzeichen prüfen": "🔏 Check watermark",
"🔥 Track erzeugen": "🔥 Generate track",
"🗑 Löschen": "🗑 Delete",
"🗑 {0} {1} auch auf dem Mac gelöscht": "🗑 {0} {1} deleted on your computer too",
"🟡 Gekoppelt, aber der Mac meldet sich gerade nicht (schläft? Dienst aus?). Aufträge warten, bis er wieder da ist.": "🟡 Paired, but your computer is not responding (asleep? service off?). Jobs wait until it's back.",
"🟢 {0} bereit": "🟢 {0} ready",
"🧹 In diesem Browser liegt noch ein": "🧹 This browser still holds a"
};

  var norm = function (s) { return s.replace(/\s+/g, " ").trim(); };
  var LETTER = /[A-Za-zÄÖÜäöüß]/;
  var EXACT = new Map();
  var TPL = [];
  Object.keys(DICT).forEach(function (de) {
    var k = norm(de), en = DICT[de];
    if (!/\{\d+\}/.test(k)) { EXACT.set(k, en); return; }
    var lit = k.replace(/\{\d+\}/g, "");
    if ((lit.match(/[A-Za-zÄÖÜäöüß]/g) || []).length < 3) return;      // "{0} {1}" would match everything
    var order = [];
    var src = k.split(/(\{\d+\})/).map(function (p) {
      var m = /^\{(\d+)\}$/.exec(p);
      if (m) { order.push(+m[1]); return "([\\s\\S]*?)"; }
      return p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }).join("");
    TPL.push({ re: new RegExp("^" + src + "$"), en: en, order: order, len: lit.length });
  });
  TPL.sort(function (a, b) { return b.len - a.len; });

  var cache = new Map();
  function core(k, depth) {
    var hit = EXACT.get(k);
    if (hit !== undefined) return hit;
    if (depth > 2) return null;
    for (var i = 0; i < TPL.length; i++) {
      var t = TPL[i], m = t.re.exec(k);
      if (!m) continue;
      var v = [];
      t.order.forEach(function (n, j) { v[n] = m[j + 1]; });
      return t.en.replace(/\{(\d+)\}/g, function (_, n) { return part(v[n] || "", depth + 1); });
    }
    return null;
  }
  function part(s, depth) {
    if (!LETTER.test(s)) return s;
    var r = core(norm(s), depth);
    if (r === null) r = pieces(norm(s), depth + 1);
    return r === null ? s : r;
  }
  // Zusammengesetzte Meldungen: "✗ " + Text, "A · B", "Titel: Meldung", "A — B", "Versionen (XL: …)".
  // Jede Trennstelle wird probiert; gewählt wird die Zerlegung, die am meisten übersetzt.
  var SEPS = [" · ", "\n", ": ", " — ", " ("];
  function pieces(k, depth) {
    depth = depth || 0;
    if (depth > 3) return null;
    var m = /^([^A-Za-zÄÖÜäöüß„“"(]+)([\s\S]+)$/.exec(k);
    if (m) { var r0 = core(m[2], depth) || pieces(m[2], depth + 1); if (r0 !== null) return m[1] + r0; }
    var best = null, bestScore = 0;
    SEPS.forEach(function (sep) {
      var i = k.indexOf(sep);
      if (i <= 0) return;
      var bits = sep === " (" ? [k.slice(0, i), "(" + k.slice(i + 2)] : k.split(sep);
      var score = 0;
      var out = bits.map(function (b) {
        if (!LETTER.test(b)) return b;
        var whole = core(norm(b), depth);
        if (whole !== null) { score += b.length; return whole; }
        var inner = b, pre = "", post = "";
        var pm = /^(\()([\s\S]*?)(\)?)$/.exec(b);
        if (sep === " (" && pm) { pre = pm[1]; inner = pm[2]; post = pm[3]; }
        var r = core(norm(inner), depth) ;
        if (r === null) r = pieces(norm(inner), depth + 1);
        if (r === null) return b;
        score += inner.length;
        return pre + r + post;
      });
      if (score > bestScore) { bestScore = score; best = out.join(sep === " (" ? " " : sep); }
    });
    return best;
  }
  function tr(s) {
    if (!s || !LETTER.test(s)) return s;
    if (cache.has(s)) return cache.get(s);
    var k = norm(s);
    var r = core(k, 0);
    if (r === null) r = pieces(k, 0);
    var out = s;
    if (r !== null) {
      if (/^[A-ZÄÖÜ]/.test(k) && /^[a-z]/.test(r)) r = r[0].toUpperCase() + r.slice(1);
      var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
      out = lead + r + trail;
    }
    out = out.replace(/„([^„“\n]*)“/g, "“$1”");      // deutsche Anführungszeichen → englische
    if (cache.size > 5000) cache.clear();
    cache.set(s, out);
    return out;
  }
  window.mwsT = tr;

  var ATTRS = ["title", "placeholder", "aria-label", "alt"];
  var SKIP = '[translate="no"], script, style, textarea, pre, code';
  function skipped(el) { return !el || (el.closest && el.closest(SKIP)); }
  function doText(n) {
    if (skipped(n.parentElement)) return;
    var t = tr(n.data);
    if (t !== n.data) n.data = t;
  }
  function doEl(e) {
    // Attribute (title, placeholder …) sind immer Oberfläche — auch an Inhalten mit translate="no"
    if (!e || (e.closest && e.closest('script, style'))) return;
    for (var i = 0; i < ATTRS.length; i++) {
      var v = e.getAttribute(ATTRS[i]);
      if (v) { var t = tr(v); if (t !== v) e.setAttribute(ATTRS[i], t); }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1) return;
    doEl(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    var n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) doText(n); else doEl(n); }
  }
  var mo = new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === "characterData") doText(m.target);
      else if (m.type === "attributes") doEl(m.target);
      else m.addedNodes.forEach(walk);
    });
  });
  document.documentElement.lang = "en";
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.addEventListener("DOMContentLoaded", function () {
    document.documentElement.lang = "en";
    walk(document.body);
    document.title = tr(document.title);
  });

  // Dialogs: the message, never the prefilled value of prompt() (that is the user's own text)
  function trMsg(s) {
    s = String(s == null ? "" : s);
    var whole = tr(s);
    if (whole !== s) return whole;
    return s.split(/(\n+)/).map(function (x) { return /\n/.test(x) ? x : tr(x); }).join("");
  }
  ["alert", "confirm", "prompt"].forEach(function (f) {
    var orig = window[f];
    if (typeof orig !== "function") return;
    window[f] = function (msg) {
      var rest = Array.prototype.slice.call(arguments, 1);
      return orig.apply(window, [trMsg(msg)].concat(rest));
    };
  });
})();

// Manuwave Studio 3.21 — Klangwahl: alle Klänge nach Kategorien, Suche, Schlagworte,
// Favoriten, zuletzt benutzt. Ein Klick wählt sofort (man hört ihn im laufenden Loop oder auf der Tastatur), die Pfeiltasten
const LS_FAV = "mws_kw_fav", LS_RECENT = "mws_kw_recent", LS_CAT = "mws_kw_cat";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* privates Fenster */ } };
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v; else if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

// items: [{ key, name, sub, cat, tags: [] }] · cats: [[id, icon, de, en]] · tagNames: { id: [de, en] }
export function openSoundBrowser({ en = false, title, items, cats, tagNames = {}, current, onPick, onPreview, onClose }) {
  const T = (de, e2) => (en ? e2 : de);
  document.querySelectorAll(".kw-wrap").forEach(x => x.remove());
  const fav = new Set(lsGet(LS_FAV, [])), recent = lsGet(LS_RECENT, []);
  const curItem = items.find(i => i.key === current);
  let cat = curItem ? curItem.cat : lsGet(LS_CAT, "all"), q = "", tag = null, sel = current;
  if (!cats.some(c => c[0] === cat) && !["all", "fav", "recent"].includes(cat)) cat = "all";
  const prevFocus = document.activeElement;

  const search = el("input", { type: "search", class: "kw-q", placeholder: T("Suchen … (z. B. Klavier, Chor, Hall, dunkel)", "Search … (e.g. piano, choir, reverb, dark)"), "aria-label": T("Klang suchen", "Search sounds") });
  const nav = el("nav", { class: "kw-nav", "aria-label": T("Kategorien", "Categories") });
  const chips = el("div", { class: "kw-chips", role: "group", "aria-label": T("Schlagworte", "Tags") });
  const grid = el("div", { class: "kw-grid", role: "listbox", "aria-label": T("Klänge", "Sounds") });
  const info = el("span", { class: "kw-info" });
  const close = (ok) => { wrap.remove(); document.removeEventListener("keydown", keys, true); if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* weg */ } if (onClose) onClose(ok); };
  const dlg = el("div", { class: "kw", role: "dialog", "aria-modal": "true", "aria-label": title || T("Klang wählen", "Choose a sound") },
    el("header", { class: "kw-head" },
      el("b", { class: "kw-title", text: title || T("Klang wählen", "Choose a sound") }), search,
      onPreview ? el("button", { type: "button", class: "ghost btn-s kw-play", text: T("▶︎ Anhören", "▶︎ Listen"), title: T("Den gewählten Klang kurz spielen", "Play the chosen sound briefly"), onclick: () => onPreview(sel) }) : null,
      el("button", { type: "button", class: "primary btn-s kw-ok", text: T("✓ Fertig", "✓ Done"), onclick: () => close(true) }),
      el("button", { type: "button", class: "ghost btn-s kw-x", text: "✕", title: T("Schließen (Esc)", "Close (Esc)"), "aria-label": T("Schließen", "Close"), onclick: () => close(false) })),
    el("div", { class: "kw-body" }, nav, el("div", { class: "kw-main" }, chips, grid, el("footer", { class: "kw-foot" }, info,
      el("span", { class: "kw-hint", text: T("Klick = wählen und hören · ↑↓←→ blättern · Enter/Doppelklick = fertig · ★ = Favorit · Computer- und MIDI-Tastatur spielen weiter", "Click = choose and hear · ↑↓←→ browse · Enter/double-click = done · ★ = favourite · computer and MIDI keyboard keep playing") })))));
  const wrap = el("div", { class: "kw-wrap", onclick: (e) => { if (e.target === wrap) close(false); } }, dlg);
  document.body.append(wrap);

  const matches = (it) => {
    if (cat === "fav" && !fav.has(it.key)) return false;
    if (cat === "recent" && !recent.includes(it.key)) return false;
    if (cat !== "all" && cat !== "fav" && cat !== "recent" && it.cat !== cat) return false;
    if (tag && !(it.tags || []).includes(tag)) return false;
    if (q) { const hay = norm([it.name, it.alt, it.sub, it.cat, ...(it.tags || []).map(t => (tagNames[t] || [t, t]).join(" ")), (cats.find(c => c[0] === it.cat) || []).slice(2).join(" ")].join(" ")); if (!norm(q).split(/\s+/).every(w => hay.includes(w))) return false; }
    return true;
  };
  function renderNav() {
    nav.innerHTML = "";
    const cnt = (f) => items.filter(f).length;
    const row = (id, icon, label, n) => el("button", { type: "button", class: "kw-cat" + (cat === id ? " on" : ""), "aria-pressed": String(cat === id), "data-cat": id, onclick: () => { cat = id; lsSet(LS_CAT, id); tag = null; render(); } },
      el("span", { class: "kw-ci", text: icon }), el("span", { class: "kw-cl", text: label }), el("span", { class: "kw-cn", text: String(n) }));
    nav.append(row("all", "🎼", T("Alle", "All"), items.length), row("fav", "★", T("Favoriten", "Favourites"), cnt(i => fav.has(i.key))), row("recent", "🕘", T("Zuletzt", "Recent"), cnt(i => recent.includes(i.key))));
    for (const [id, icon, de, e2] of cats) { const n = cnt(i => i.cat === id); if (n) nav.append(row(id, icon, en ? e2 : de, n)); }
  }
  function renderChips(list) {
    chips.innerHTML = "";
    const used = new Map(); for (const it of list) for (const t of it.tags || []) used.set(t, (used.get(t) || 0) + 1);
    const order = Object.keys(tagNames).filter(t => used.has(t));
    for (const t of order) chips.append(el("button", { type: "button", class: "kw-chip" + (tag === t ? " on" : ""), "aria-pressed": String(tag === t), "data-tag": t, text: (en ? tagNames[t][1] : tagNames[t][0]) + " " + used.get(t), onclick: () => { tag = tag === t ? null : t; render(); } }));
  }
  function render() {
    renderNav();
    const base = items.filter(it => { const t = tag; tag = null; const ok = matches(it); tag = t; return ok; });
    renderChips(base);
    let list = base.filter(matches);
    if (cat === "recent") list.sort((a, b) => recent.indexOf(a.key) - recent.indexOf(b.key));
    grid.innerHTML = "";
    if (!list.length) grid.append(el("p", { class: "kw-none", text: T("Nichts gefunden — andere Kategorie oder weniger Suchwörter.", "Nothing found — another category or fewer search words.") }));
    for (const it of list) {
      const star = el("span", { class: "kw-star" + (fav.has(it.key) ? " on" : ""), role: "button", tabindex: "-1", title: T("Favorit", "Favourite"), text: fav.has(it.key) ? "★" : "☆",
        onclick: (e) => { e.stopPropagation(); if (fav.has(it.key)) fav.delete(it.key); else fav.add(it.key); lsSet(LS_FAV, [...fav]); render(); } });
      const tile = el("button", { type: "button", class: "kw-tile" + (it.key === sel ? " on" : ""), role: "option", "aria-selected": String(it.key === sel), "data-key": it.key, title: it.desc || it.name,
        onclick: () => pick(it.key), ondblclick: () => { pick(it.key); close(true); } },
        el("span", { class: "kw-tn", text: it.name }), el("span", { class: "kw-ts", text: it.sub || "" }), star);
      grid.append(tile);
    }
    info.textContent = T(`${list.length} Klänge`, `${list.length} sounds`);
  }
  function pick(key) {
    sel = key;
    const r = recent.filter(k => k !== key); r.unshift(key); recent.length = 0; recent.push(...r.slice(0, 16)); lsSet(LS_RECENT, recent);
    grid.querySelectorAll(".kw-tile").forEach(t => { const on = t.dataset.key === key; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); });
    if (onPick) onPick(key);
  }
  function keys(e) {
    if (!document.body.contains(wrap)) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); return; }
    if (e.target === search) { if (e.key === "ArrowDown") { e.preventDefault(); const f = grid.querySelector(".kw-tile"); if (f) f.focus(); } return; }
    if (e.key === "/" ) { e.preventDefault(); search.focus(); return; }
    const tiles = [...grid.querySelectorAll(".kw-tile")]; if (!tiles.length) return;
    const i = Math.max(0, tiles.indexOf(document.activeElement));
    const cols = Math.max(1, Math.round(grid.clientWidth / (tiles[0].offsetWidth + 8)));
    const mv = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (mv != null && tiles.includes(document.activeElement)) { e.preventDefault(); e.stopPropagation(); const n = tiles[Math.min(tiles.length - 1, Math.max(0, i + mv))]; n.focus(); n.scrollIntoView({ block: "nearest" }); pick(n.dataset.key); return; }
    if (e.key === "Enter" && tiles.includes(document.activeElement)) { e.preventDefault(); e.stopPropagation(); pick(document.activeElement.dataset.key); close(true); }
  }
  search.addEventListener("input", () => { q = search.value.trim(); if (q && cat !== "all") cat = "all"; render(); });
  document.addEventListener("keydown", keys, true);
  render();
  const on = grid.querySelector(".kw-tile.on") || grid.querySelector(".kw-tile");
  if (on) { on.scrollIntoView({ block: "center" }); on.focus({ preventScroll: true }); }
  return { close: () => close(false), el: wrap };
}

// Manuwave Studio 3.22 — Auswahlfeld: macht aus einer langen Ausklappliste einen Knopf, der eine Übersicht öffnet —
// Gruppen als Überschriften, darunter Kacheln in Spalten (nicht mehr alles untereinander), Suchfeld ab 10 Einträgen,
// Pfeiltasten, Enter, Esc. Die echte <select> bleibt unsichtbar im Dokument und ist die einzige Wahrheit:
// Wert, change-Ereignis, .value = … von außen und neu gefüllte Optionen laufen wie vorher (Code und Prüfstände unverändert).
// Angaben an den Optionen: data-desc (zweite Zeile, wird mitdurchsucht), data-icon; an <optgroup>: data-icon.
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const SEARCH_FROM = 10;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") e.textContent = v; else if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}

let openPop = null;
export function closePick() { if (openPop) openPop(false); }

// sel: die <select> · en: Englisch · title: Überschrift der Übersicht · wide: Kacheln mit Beschreibung (breiter)
// Gibt einen Rahmen zurück, der Knopf und unsichtbare <select> enthält — ihn statt der <select> einhängen
// (hängt die <select> schon im Dokument, tritt der Rahmen an ihre Stelle).
export function pickBox(sel, { en = false, title, wide = false, search } = {}) {
  const T = (de, e2) => (en ? e2 : de);
  const btn = el("button", { type: "button", class: "aw-btn", "aria-haspopup": "listbox", "aria-expanded": "false",
    "aria-label": sel.getAttribute("aria-label"), title: sel.getAttribute("title"), id: sel.id ? sel.id + "Pick" : null },
    el("span", { class: "aw-bi" }), el("span", { class: "aw-bt", translate: "no" }), el("span", { class: "aw-bc", "aria-hidden": "true", text: "▾" }));
  const box0 = sel.className; sel.classList.add("aw-native"); sel.setAttribute("tabindex", "-1"); sel.setAttribute("aria-hidden", "true");
  const at = sel.parentNode, next = sel.nextSibling;
  const box = el("span", { class: ("aw " + box0).trim() }, sel, btn);
  if (at) at.insertBefore(box, next);
  const opts = () => [...sel.options];
  const iconOf = (o) => (o && (o.dataset.icon || (o.parentElement && o.parentElement.tagName === "OPTGROUP" && o.parentElement.dataset.icon))) || "";
  function refresh() {
    const o = sel.selectedOptions[0] || sel.options[0];
    btn.querySelector(".aw-bi").textContent = iconOf(o);
    btn.querySelector(".aw-bt").textContent = o ? o.textContent : "—";
    btn.disabled = sel.disabled;
    btn.classList.toggle("hidden", sel.classList.contains("hidden") || sel.hidden);
  }
  // .value/.selectedIndex von außen: Knopf mitziehen (die Eigenschaften lösen kein Ereignis aus)
  const P = HTMLSelectElement.prototype;
  for (const k of ["value", "selectedIndex"]) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    Object.defineProperty(sel, k, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); refresh(); } });
  }
  sel.addEventListener("change", refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
  btn.addEventListener("click", () => (btn.getAttribute("aria-expanded") === "true" ? closePick() : open()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } });
  refresh();

  function open() {
    closePick();
    const all = opts().filter(o => !(o.value === "" && o.hasAttribute("data-ph")));
    if (!all.length) return;
    const groups = []; const gOf = new Map();
    for (const o of all) {
      const g = o.parentElement && o.parentElement.tagName === "OPTGROUP" ? o.parentElement : null;
      if (!gOf.has(g)) { const x = { g, items: [] }; gOf.set(g, x); groups.push(x); }
      gOf.get(g).items.push(o);
    }
    const desc = all.some(o => o.dataset.desc), withSearch = search != null ? search : all.length >= SEARCH_FROM;
    const q = withSearch ? el("input", { type: "search", class: "aw-q", placeholder: T("Suchen …", "Search …"), "aria-label": T("Suchen", "Search") }) : null;
    const list = el("div", { class: "aw-list", role: "listbox", "aria-label": title || sel.getAttribute("aria-label") || "" });
    const none = el("p", { class: "aw-none hidden", text: T("Nichts gefunden.", "Nothing found.") });
    const pop = el("div", { class: "aw-pop" + (desc || wide ? " wide" : "") + (all.length <= 8 && !desc ? " small" : "") },
      title || q ? el("div", { class: "aw-head" }, title ? el("b", { class: "aw-title", text: title }) : null, q) : null, list, none);
    const tiles = [];
    for (const { g, items } of groups) {
      const sec = el("section", { class: "aw-g" });
      if (g) sec.append(el("div", { class: "aw-gh" }, el("span", { text: (g.dataset.icon ? g.dataset.icon + " " : "") + g.label }), el("span", { class: "aw-gn", text: String(items.length) })));
      const grid = el("div", { class: "aw-gi" });
      for (const o of items) {
        const on = o.selected && o.value !== "";
        const t = el("button", { type: "button", class: "aw-o" + (on ? " on" : ""), role: "option", "aria-selected": String(on), disabled: o.disabled || null, "data-v": o.value,
          title: o.dataset.desc || o.textContent, onclick: () => pick(o.value) },
          el("span", { class: "aw-on", translate: "no", text: (o.dataset.icon ? o.dataset.icon + " " : "") + o.textContent }),
          o.dataset.desc ? el("span", { class: "aw-od", translate: "no", text: o.dataset.desc }) : null);
        t._hay = norm([o.textContent, o.dataset.desc, g && g.label].join(" "));
        grid.append(t); tiles.push(t);
      }
      sec.append(grid); list.append(sec);
    }
    document.body.append(pop);
    place();
    const vis = () => tiles.filter(t => !t.closest(".aw-g").classList.contains("hidden") && !t.classList.contains("hidden") && !t.disabled);
    function filter() {
      const words = norm(q.value.trim()).split(/\s+/).filter(Boolean);
      for (const t of tiles) t.classList.toggle("hidden", !words.every(w => t._hay.includes(w)));
      for (const s of list.children) { const n = s.querySelectorAll(".aw-o:not(.hidden)").length, c = s.querySelector(".aw-gn"); s.classList.toggle("hidden", !n); if (c) c.textContent = String(n); }
      none.classList.toggle("hidden", tiles.some(t => !t.classList.contains("hidden")));
    }
    function pick(v) {
      close(true);
      if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); }
      // die Wahl baut den Bereich oft neu (Instrument → neuer Editor): dann den neuen Knopf fokussieren
      if (!btn.isConnected && btn.id) { const n = document.getElementById(btn.id); if (n) try { n.focus({ preventScroll: true }); } catch (e) { /* weg */ } }
    }
    // Pfeiltasten nach Lage auf dem Bildschirm: ↑↓ in die nächste Zeile (auch über Gruppen hinweg), ←→ der Reihe nach
    function step(cur, dir) {
      const v = vis(), i = v.indexOf(cur);
      if (dir === "ArrowRight") return v[Math.min(v.length - 1, i + 1)];
      if (dir === "ArrowLeft") return v[Math.max(0, i - 1)];
      const r = cur.getBoundingClientRect(), down = dir === "ArrowDown";
      const rows = v.map(t => [t, t.getBoundingClientRect()]).filter(([, b]) => (down ? b.top > r.top + 2 : b.top < r.top - 2));
      if (!rows.length) return cur;
      const y = down ? Math.min(...rows.map(([, b]) => b.top)) : Math.max(...rows.map(([, b]) => b.top));
      return rows.filter(([, b]) => Math.abs(b.top - y) < 2).sort((a, b) => Math.abs(a[1].left - r.left) - Math.abs(b[1].left - r.left))[0][0];
    }
    // am Fenster vor allen anderen: Tasten in der Übersicht gehören ihr (Leertaste startet nicht die Wiedergabe, Buchstaben spielen kein Klavier)
    function keys(e) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); return; }
      if (e.key === "Tab") { close(false); return; }
      if (!pop.contains(e.target)) return;
      e.stopPropagation();
      if (q && e.target === q) {
        if (e.key === "ArrowDown") { e.preventDefault(); const f = vis()[0]; if (f) f.focus(); }
        else if (e.key === "Enter") { e.preventDefault(); const f = vis()[0]; if (f) pick(f.dataset.v); }
        return;
      }
      if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const v = vis(); const n = v.includes(e.target) ? step(e.target, e.key) : v[0];
        if (n) { n.focus(); n.scrollIntoView({ block: "nearest" }); }
        return;
      }
      if (q && e.key.length === 1 && e.key !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) q.focus();
    }
    function place() {
      const r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight, m = 8;
      if (vw <= 560) { pop.classList.add("sheet"); return; }
      pop.classList.remove("sheet");
      if (r.bottom < 0 || r.top > vh) { close(false); return; }
      const w = Math.min(vw - 2 * m, Math.max(r.width, pop.classList.contains("small") ? 300 : pop.classList.contains("wide") ? 760 : 620));
      pop.style.width = w + "px";
      pop.style.left = Math.max(m, Math.min(r.left, vw - w - m)) + "px";
      const below = vh - r.bottom - m, above = r.top - m, need = Math.min(pop.scrollHeight, 520);
      if (below >= need || below >= above) { pop.style.top = r.bottom + 4 + "px"; pop.style.maxHeight = Math.max(200, below - 4) + "px"; }
      else { pop.style.maxHeight = Math.max(200, above - 4) + "px"; pop.style.top = Math.max(m, r.top - 4 - Math.min(pop.scrollHeight, above - 4)) + "px"; }
    }
    const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(false); };
    // Seite scrollt oder Fenster ändert sich: mitwandern statt zu schließen (Handy scrollt beim Antippen oft noch nach)
    let raf = 0; const away = (e) => { if (e && e.target && e.target !== document && pop.contains(e.target)) return; cancelAnimationFrame(raf); raf = requestAnimationFrame(place); };
    function close(picked) {
      pop.remove(); openPop = null; cancelAnimationFrame(raf); btn.setAttribute("aria-expanded", "false");
      window.removeEventListener("keydown", keys, true); document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", away); document.removeEventListener("scroll", away, true);
      if (picked || document.activeElement === document.body || pop.contains(document.activeElement)) try { btn.focus({ preventScroll: true }); } catch (e) { /* weg */ }
    }
    openPop = close;
    btn.setAttribute("aria-expanded", "true");
    window.addEventListener("keydown", keys, true); document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", away); document.addEventListener("scroll", away, true);
    if (q) q.addEventListener("input", filter);
    const cur = tiles.find(t => t.classList.contains("on"));
    if (cur) cur.scrollIntoView({ block: "nearest" });
    (q || cur || vis()[0] || btn).focus({ preventScroll: true });
  }
  return box;
}

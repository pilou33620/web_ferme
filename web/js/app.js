// Interface du jeu : interroge le serveur Python, affiche l'état, envoie les actions.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (v) => `${nf0.format(v)} €`;
const pct = (v) => `${Math.round(v)} %`;
const qf = (v) => (v > 0 && v < 10 ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(v) : nf0.format(v));

let S = null;                 // dernier état reçu
let view = "accueil";
let zone = null;              // zone sélectionnée sur la carte
let cat = "vaches";           // catégorie d'animaux affichée
let lastJournalKey = null;
let busy = false;

const WEATHER_ICON = { soleil: "sun", nuageux: "cloud", pluie: "rain", orage: "storm", canicule: "heat" };
const WEATHER_CLS = { soleil: "", nuageux: "cloud", pluie: "rain", orage: "rain", canicule: "" };
const FIELD_STATE = {
  vide: ["En friche", "grey"], seme: ["Semé", "info"], pousse: ["En pousse", ""],
  mur: ["Prête à récolter", "warn"], fletri: ["Flétri", "bad"],
};
const PRODUCT_ICON = { tomates: "🍅", legumes: "🥕", mais: "🌽", lait: "🥛", oeufs: "🥚", laine: "🧶", fumier: "💩", foin: "🌾" };

// ---------------------------------------------------------------- helpers
function setHTML(el, html) {
  if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; hydrateIcons(el); }
}
function ring(value, color = "#2F7A4B", size = 92, stroke = 9) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<svg viewBox="0 0 ${size} ${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#EFEAE0" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${(c * Math.max(0, Math.min(100, value))) / 100} ${c}" style="transition:stroke-dasharray .6s"/></svg>
    <div class="ring-val">${Math.round(value)}%</div>`;
}
const healthColor = (v) => (v >= 75 ? "#2F7A4B" : v >= 45 ? "#E9A93A" : "#D6544B");
const barCls = (v) => (v >= 60 ? "" : v >= 30 ? "amber" : "red");

function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.classList.add("out"), 3400);
  setTimeout(() => t.remove(), 3800);
  const all = $$("#toasts .toast");
  if (all.length > 4) all[0].remove();
}

// ---------------------------------------------------------------- réseau
async function poll() {
  try {
    const r = await fetch("/api/etat");
    render(await r.json());
  } catch (e) { /* serveur arrêté : on réessaie */ }
  setTimeout(poll, 500);
}

async function act(action) {
  if (busy) return;
  busy = true;
  try {
    const r = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
    const res = await r.json();
    if (res.etat) render(res.etat);
    if (action.type !== "vitesse") toast(res.message, res.ok ? "ok" : "err");
  } catch (e) {
    toast("Le serveur ne répond pas.", "err");
  } finally { busy = false; }
}

// délégation des clics sur [data-act]
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-act]");
  if (b) {
    const a = JSON.parse(b.dataset.act);
    if (a.type === "goto") return go(a.view);
    if (a.type === "zone") return selectZone(a.zone);
    if (a.type === "cat") { cat = a.cat; return render(S); }
    return act(a);
  }
});
const A = (o) => `data-act='${JSON.stringify(o)}'`;

// ---------------------------------------------------------------- navigation
function go(v) {
  view = v;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
  if (S) render(S);
}
$$(".nav-item").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
$$("#speed button").forEach((b) => b.addEventListener("click", () => act({ type: "vitesse", valeur: +b.dataset.speed })));

function selectZone(id) {
  zone = id;
  if (view !== "ferme") go("ferme");
  FarmMap.focus(id);
  $("#map-back").classList.toggle("show", !!id);
  const zp = $("#zone-panel");
  zp.classList.remove("enter"); void zp.offsetWidth; zp.classList.add("enter");
  if (S) render(S);
}
$("#map-back").addEventListener("click", (e) => { e.stopPropagation(); selectZone(null); });

// ---------------------------------------------------------------- rendu global
function render(s) {
  if (!s) return;
  S = s;
  const d = s.derive;
  renderSidebar(s, d);
  FarmMap.update(s);
  ART.updateHero($("#hero-art"), d.heure_dec, s.meteo.type);
  $(".hero").classList.toggle("night", ART.nightAmount(d.heure_dec) > .5);
  if (view === "accueil") renderHome(s, d);
  if (view === "ferme") renderFarm(s, d);
  if (view === "elevage") renderLivestock(s, d);
  if (view === "marche") renderMarket(s, d);
  notifyJournal(s);
  renderModal(s);
}

function renderSidebar(s, d) {
  $("#clk-day").textContent = `Jour ${d.jour}`;
  $("#clk-time").textContent = d.heure;
  $("#clk-bar").style.left = `${(d.heure_dec / 24) * 100}%`;
  $$("#speed button").forEach((b) => b.classList.toggle("on", +b.dataset.speed === s.vitesse));
  const m = $("#money");
  m.textContent = eur(s.argent);
  m.classList.toggle("neg", s.argent < 0);
  $("#goal-bar").style.width = `${Math.max(0, Math.min(100, (s.argent / d.objectif_argent) * 100))}%`;
  $("#goal-label").textContent = s.jours_dans_le_rouge
    ? `⚠ Dans le rouge depuis ${s.jours_dans_le_rouge} jour(s)`
    : `Objectif ${nf0.format(d.objectif_argent)} €`;
  const alerts = d.malades + d.repas.filter((r) => r.statut === "maintenant").length;
  $("#badge-elevage").textContent = alerts || "";
}

// ---------------------------------------------------------------- accueil
function renderHome(s, d) {
  const h = d.heure_dec;
  $("#greet").textContent = h < 5 || h >= 21 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir";
  setHTML($("#hero-weather"), `${icon(WEATHER_ICON[s.meteo.type])} ${s.meteo.nom} · ${Math.round(d.temperature)} °C`);
  setHTML($("#ring-farm"), ring(d.sante_ferme, healthColor(d.sante_ferme)));
  $("#farm-health-label").textContent = d.sante_ferme >= 80 ? "En bonne santé" : d.sante_ferme >= 55 ? "À surveiller" : "En difficulté";
  $("#farm-health-sub").textContent = `Animaux ${d.sante_animaux} % · Cultures ${Math.round(2 * d.sante_ferme - d.sante_animaux)} %`;

  const fc = s.previsions.map((p, i) => `<div class="fc">${["Demain", "J+2", "J+3"][i]}${icon(WEATHER_ICON[p.type])}${p.temp}°</div>`).join("");
  setHTML($("#weather-card"), `<div class="weather-now"><div class="weather-ico ${WEATHER_CLS[s.meteo.type]}">${icon(WEATHER_ICON[s.meteo.type])}</div>
    <div><div class="temp-big">${Math.round(d.temperature)}°C</div><div class="muted small">${s.meteo.nom} · Humidité du sol ${d.humidite_moy} %</div></div></div>
    <div class="forecast">${fc}</div>`);

  const stats = [
    ["sprout", "g", d.n_cultures, "Cultures actives"],
    ["cow", "r", d.n_animaux, "Animaux"],
    ["drop", "b", `${d.humidite_moy}%`, "Humidité du sol"],
    ["wheat", "a", `${nf0.format(s.stats.recolte_kg)} kg`, "Récolté au total"],
  ];
  setHTML($("#stats-grid"), stats.map(([ic, c, v, l]) => `<div class="stat"><div class="stat-ico ${c}">${icon(ic)}</div><div class="stat-val">${v}</div><div class="stat-lbl">${l}</div></div>`).join(""));

  setHTML($("#objectives"), s.ref.objectifs.map((o) => {
    const done = s.objectifs.includes(o.id);
    return `<li class="${done ? "done" : ""}"><span class="check">${done ? icon("check") : ""}</span><span class="t">${o.titre}</span></li>`;
  }).join(""));
  setHTML($("#journal"), s.journal.slice(0, 25).map((j) => `<li class="${j.type}"><span class="when">J${j.jour} ${j.heure}</span><span class="msg">${j.msg}</span></li>`).join(""));
}

// ---------------------------------------------------------------- ferme
const PILLS = [[null, "map", "Vue d'ensemble"], ["maison", "house", "Maison"], ["tomates", "tomato", "Champ de tomates"],
  ["legumes", "carrot", "Potager"], ["mais", "corn", "Champ de maïs"], ["enclos", "fence", "Enclos"], ["reservoir", "tank", "Réservoir"]];

function renderFarm(s, d) {
  setHTML($("#zone-pills"), PILLS.map(([id, ic, l]) => `<button class="pill ${zone === id ? "active" : ""}" ${A({ type: "zone", zone: id })}>${icon(ic)}${l}</button>`).join(""));
  $("#map-hint").style.display = zone ? "none" : "flex";
  $("#map-hint-sub").textContent = `${Object.keys(FarmMap.ZONES).length} zones · ${d.n_cultures} cultures · ${d.n_animaux} animaux`;
  let html;
  if (!zone) html = overviewPanel(s, d);
  else if (zone === "maison") html = housePanel(s, d);
  else if (zone === "enclos") html = penPanel(s, d);
  else if (zone === "reservoir") html = tankPanel(s, d);
  else html = fieldPanel(s, d, zone);
  setHTML($("#zone-panel"), html);
}

function meter(label, value, cls = "", right) {
  return `<div class="meter"><div class="meter-row">${label}<span>${right ?? pct(value)}</span></div><div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>`;
}

function overviewPanel(s, d) {
  const rows = ["tomates", "legumes", "mais"].map((k) => {
    const f = s.champs[k], [st, c] = FIELD_STATE[f.etat];
    return `<li style="cursor:pointer" ${A({ type: "zone", zone: k })}><b>${s.ref.cultures[k].nom}</b><span class="pill-tag ${c}">${st}</span></li>`;
  }).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("map")}</div><div><div class="zone-name">Vue d'ensemble</div><div class="muted small">Ferme du Val Vert · 12,5 ha</div></div></div>
    <div class="kv"><div><b>${d.n_cultures}</b><span>Cultures</span></div><div><b>${d.n_animaux}</b><span>Animaux</span></div><div><b>${pct(s.reservoir.niveau / s.reservoir.capacite * 100)}</b><span>Eau</span></div></div>
    <ul class="mini-list">${rows}</ul></div>
    <div class="zone-card">${meter("Santé de la ferme", d.sante_ferme, barCls(d.sante_ferme))}${meter("Humidité moyenne du sol", d.humidite_moy, "blue")}${meter("Nourriture des animaux", d.nourriture, barCls(d.nourriture))}</div>`;
}

function fieldPanel(s, d, k) {
  const f = s.champs[k], ref = s.ref.cultures[k], [st, c] = FIELD_STATE[f.etat];
  const tracteur = s.ameliorations.includes("tracteur") ? 1.2 : 1;
  const est = Math.round(ref.rendement * (0.3 + 0.7 * f.sante / 100) * tracteur);
  const daysLeft = f.etat === "pousse" || f.etat === "seme" ? ((100 - f.croissance) / 100) * ref.jours : 0;
  const engrais = f.engrais_jusqua > s.minute;
  const icons = { tomates: "tomato", legumes: "carrot", mais: "corn" };
  const actions = [];
  if (f.etat === "mur") actions.push(`<button class="btn green" ${A({ type: "recolter", champ: k })}>${icon("wheat")}Récolter ~${est} kg</button>`);
  if (f.etat === "vide" || f.etat === "fletri") actions.push(`<button class="btn" ${A({ type: "semer", champ: k })}>${icon("sprout")}Semer (${ref.graines} €)</button>`);
  if (f.etat !== "vide") actions.push(`<button class="btn ${f.etat === "mur" ? "ghost" : ""}" ${A({ type: "arroser", champ: k })}>${icon("drop")}Arroser · 600 L</button>`);
  if (f.etat === "seme" || f.etat === "pousse") actions.push(`<button class="btn ghost" ${A({ type: "fertiliser", champ: k })} ${s.stock.fumier < 50 ? "disabled" : ""}>${icon("poop")}Fumier · 50 kg</button>`);
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon(icons[k])}</div><div><div class="zone-name">${ref.nom}</div><div class="muted small">Culture : ${ref.culture}</div></div><span class="pill-tag ${c}">${st}</span></div>
    <div class="kv"><div><b>${pct(f.croissance)}</b><span>Croissance</span></div><div><b>${pct(f.sante)}</b><span>Santé</span></div><div><b>${f.etat === "vide" ? "—" : est + " kg"}</b><span>Récolte est.</span></div></div>
    ${meter("Croissance", f.croissance, "", daysLeft ? `encore ~${nf0.format(Math.ceil(daysLeft * 24))} h` : pct(f.croissance))}
    ${meter("Humidité du sol", f.humidite, f.humidite < 20 ? "red" : "blue")}
    ${meter("Santé des plants", f.sante, barCls(f.sante))}
    <div class="actions">${actions.join("")}</div></div>
    <div class="zone-card"><ul class="mini-list">
      <li>Arrosage intelligent <span>${s.ameliorations.includes("arrosage") ? "Actif" : "Non installé"}</span></li>
      <li>Engrais <span>${engrais ? "Actif (×1,5)" : "—"}</span></li>
      <li>Fumier en stock <span>${nf0.format(s.stock.fumier)} kg</span></li>
      <li>Eau disponible <span>${nf0.format(s.reservoir.niveau)} L</span></li>
      <li>Prix du marché <span>${nf2.format(s.prix[ref.produit])} €/kg</span></li></ul></div>`;
}

function housePanel(s, d) {
  const charges = 35 + 1.5 * d.n_animaux + 12 * s.ameliorations.length;
  const ups = s.ameliorations.map((u) => `<li>${s.ref.ameliorations[u].nom}<span>✓</span></li>`).join("") || `<li>Aucune pour l'instant<span>—</span></li>`;
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("house")}</div><div><div class="zone-name">Maison</div><div class="muted small">Le bureau de la ferme</div></div></div>
    <div class="kv"><div><b>${eur(s.argent)}</b><span>Trésorerie</span></div><div><b>${eur(charges)}</b><span>Charges / jour</span></div><div><b>J${d.jour}</b><span>Saison</span></div></div>
    ${meter("Objectif", (s.argent / d.objectif_argent) * 100, "", `${eur(s.argent)} / ${nf0.format(d.objectif_argent)} €`)}
    <div class="actions"><button class="btn" ${A({ type: "goto", view: "marche" })}>${icon("store")}Aller au marché</button></div></div>
    <div class="zone-card"><div class="card-head"><h3>Améliorations</h3></div><ul class="mini-list">${ups}</ul></div>`;
}

function penPanel(s, d) {
  const next = d.repas.find((r) => r.statut === "maintenant") || d.repas.find((r) => r.statut === "a_venir");
  const cats = Object.entries(s.animaux).map(([k, g]) => `<li>${s.ref.animaux[k].nom}<span>${g.liste.length}</span></li>`).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("cow")}</div><div><div class="zone-name">Enclos des animaux</div><div class="muted small">${d.n_animaux} animaux</div></div>
    ${d.malades ? `<span class="pill-tag bad">${d.malades} malade(s)</span>` : `<span class="pill-tag">En forme</span>`}</div>
    <div class="kv"><div><b>${pct(d.sante_animaux)}</b><span>Santé</span></div><div><b>${pct(d.nourriture)}</b><span>Nourris</span></div><div><b>${pct(d.production)}</b><span>Production</span></div></div>
    ${meter("Satiété", d.nourriture, barCls(d.nourriture))}
    <div class="muted small" style="margin-top:8px">${next ? `Prochain repas : <b>${next.heure}</b> — ${next.menu}${next.statut === "maintenant" ? " (maintenant !)" : ""}` : "Tous les repas du jour sont passés."}</div>
    <div class="actions"><button class="btn green" ${A({ type: "nourrir" })}>${icon("bowl")}Nourrir · ${d.ration} kg</button><button class="btn ghost" ${A({ type: "goto", view: "elevage" })}>Voir l'élevage</button></div></div>
    <div class="zone-card"><ul class="mini-list">${cats}<li>Foin en stock<span>${nf0.format(s.stock.foin)} kg</span></li></ul></div>`;
}

function tankPanel(s, d) {
  const r = s.reservoir, frac = (r.niveau / r.capacite) * 100;
  const smart = s.ameliorations.includes("arrosage");
  const stock = ["foin", "mais", "tomates", "legumes", "lait", "oeufs", "laine", "fumier"].map((k) =>
    `<li>${PRODUCT_ICON[k]} ${k === "foin" ? "Foin" : s.ref.produits[k].nom}<span>${qf(s.stock[k])} ${k === "foin" ? "kg" : s.ref.produits[k].unite}</span></li>`).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico" style="background:var(--blue-soft);color:var(--blue)">${icon("tank")}</div><div><div class="zone-name">Réservoir d'eau</div><div class="muted small">Pompe ${s.ameliorations.includes("reservoir") ? "1 440" : "720"} L/jour + pluie</div></div>
    <span class="pill-tag ${frac < 20 ? "bad" : "info"}">${frac < 20 ? "Bas" : "OK"}</span></div>
    <div class="kv"><div><b>${pct(frac)}</b><span>Niveau</span></div><div><b>${nf0.format(r.niveau)} L</b><span>Disponible</span></div><div><b>${nf0.format(r.capacite)} L</b><span>Capacité</span></div></div>
    ${meter("Niveau d'eau", frac, "blue")}
    <div class="actions">${smart ? `<button class="btn green" disabled>${icon("check")}Arrosage intelligent actif</button>`
      : `<button class="btn green" ${A({ type: "ameliorer", amelioration: "arrosage" })}>${icon("sparkle")}Arrosage intelligent · 1 200 €</button>`}</div></div>
    <div class="zone-card"><div class="card-head"><h3>Stockage</h3><button class="btn ghost sm" ${A({ type: "goto", view: "marche" })}>Vendre</button></div><ul class="mini-list">${stock}</ul></div>`;
}

// ---------------------------------------------------------------- élevage
function renderLivestock(s, d) {
  const allOk = d.malades === 0;
  setHTML($("#live-summary"), `<div class="live-top"><div><div class="card-kicker">Total du troupeau</div><div class="live-count">${d.n_animaux}</div><div class="muted small">animaux</div></div>
    <span class="pill-tag ${allOk ? "" : "bad"}">${allOk ? "Tous en bonne santé" : `${d.malades} animal(aux) malade(s)`}</span></div>
    <div class="live-rings">
      <div><div class="ring-wrap sm">${ring(d.sante_animaux, "#2F7A4B", 76, 8)}</div><div class="lbl">Santé</div><div class="sub">moyenne</div></div>
      <div><div class="ring-wrap sm">${ring(d.nourriture, "#E9A93A", 76, 8)}</div><div class="lbl">Nourriture</div><div class="sub">satiété</div></div>
      <div><div class="ring-wrap sm">${ring(d.production, "#3C8CD6", 76, 8)}</div><div class="lbl">Production</div><div class="sub">rendement</div></div>
    </div>
    ${d.malades ? `<div class="actions"><button class="btn" ${A({ type: "soigner" })}>${icon("vet")}Appeler le vétérinaire · ${d.malades * s.ref.prix_veto} €</button></div>` : ""}`);

  const lbl = { fait: "Fait", maintenant: "Maintenant", manque: "Manqué", a_venir: "À venir" };
  const auto = s.ameliorations.includes("distributeur");
  setHTML($("#feeding"), `<div class="feed-head"><div class="feed-ico">${icon("wheat")}</div><div><h3>Repas du jour</h3><div class="muted small">${auto ? "Distributeur automatique actif" : "Nourrissez le troupeau à chaque repas"}</div></div></div>
    <div class="timeline">${d.repas.map((r) => `<div class="tl ${r.statut}"><div class="tl-dot">${r.statut === "fait" ? icon("check") : r.statut === "manque" ? icon("x") : icon("clock") || ""}</div>
      <div class="tl-time">${r.heure}</div><div class="tl-menu">${r.menu}</div><div class="tl-state">${lbl[r.statut]}</div></div>`).join("")}</div>
    <div class="feed-foot"><div class="muted small">Ration : <b>${d.ration} kg</b> · Stock : <b>${nf0.format(s.stock.foin)} kg</b> de foin + ${nf0.format(s.stock.mais)} kg de maïs</div>
    <button class="btn green" ${A({ type: "nourrir" })}>${icon("bowl")}Nourrir</button></div>`);

  const prodLbl = { lait: "L de lait / j", oeufs: "œufs / j", laine: "kg de laine / j", fumier: "kg de fumier / j" };
  setHTML($("#cats"), Object.entries(s.animaux).map(([k, g]) => {
    const ref = s.ref.animaux[k];
    const p = s.stats.hier[ref.produit] ?? s.stats.production_jour[ref.produit] ?? 0;
    return `<button class="cat ${cat === k ? "active" : ""}" ${A({ type: "cat", cat: k })}><div class="cat-art">${ART.side[k]}</div>
      <div class="cat-n">${g.liste.length}</div><div class="cat-name">${ref.nom}</div><div class="cat-prod">${qf(p)} ${prodLbl[ref.produit]}</div></button>`;
  }).join(""));

  const g = s.animaux[cat], ref = s.ref.animaux[cat];
  const rows = g.liste.map((a) => `<div class="arow"><div class="arow-ico">${ART.side[cat]}</div>
      <div><div class="arow-name">${a.nom}</div><div class="arow-sub">${ref.unite[0].toUpperCase() + ref.unite.slice(1)} · n°${a.id.slice(2)}</div></div>
      <div class="bar ${barCls(a.sante)}"><i style="width:${a.sante}%"></i></div>
      <span class="pill-tag ${a.sante >= 70 ? "" : a.sante >= 50 ? "warn" : "bad"}">${a.sante >= 70 ? "En forme" : a.sante >= 50 ? "Fatigué" : "Malade"}</span></div>`).join("");
  setHTML($("#animal-list"), `<div class="card-head"><h3>Vos ${ref.nom.toLowerCase()}</h3>
    <button class="btn sm" ${A({ type: "acheter", article: cat, quantite: 1 })}>${icon("plus")}Acheter · ${nf0.format(ref.prix)} €</button></div>
    <div class="animal-rows">${rows || `<div class="muted">Aucun animal dans cette catégorie.</div>`}</div>`);
}

// ---------------------------------------------------------------- marché
function renderMarket(s, d) {
  const rows = Object.entries(s.ref.produits).map(([k, p]) => {
    const price = s.prix[k], prev = s.prix_hier[k], diff = ((price - prev) / prev) * 100;
    const tr = Math.abs(diff) < 0.5 ? "" : `<span class="trend ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(0)}%</span>`;
    const qty = k === "oeufs" ? Math.floor(s.stock[k]) : s.stock[k];
    return `<tr><td><div class="prod-cell"><span class="prod-dot">${PRODUCT_ICON[k]}</span>${p.nom}</div></td>
      <td>${qf(qty)} ${p.unite}</td><td>${nf2.format(price)} €/${p.unite}${tr}</td><td><b>${eur(qty * price)}</b></td>
      <td><button class="btn sm ${qty >= 1 ? "" : "ghost"}" ${qty >= 1 ? "" : "disabled"} ${A({ type: "vendre", produit: k })}>Vendre</button></td></tr>`;
  }).join("");
  setHTML($("#sell-table"), `<tr><th>Produit</th><th>Stock</th><th>Prix du jour</th><th>Valeur</th><th></th></tr>${rows}`);

  const fp = s.ref.prix_foin;
  let buy = `<div class="buy-row"><span class="prod-dot">🌾</span><div class="grow"><b>Foin</b><span class="muted small">${nf2.format(fp)} €/kg · stock ${nf0.format(s.stock.foin)} kg</span></div>
    <button class="btn ghost sm" ${A({ type: "acheter", article: "foin", quantite: 200 })}>200 kg · ${eur(200 * fp)}</button>
    <button class="btn sm" ${A({ type: "acheter", article: "foin", quantite: 1000 })}>1 t · ${eur(1000 * fp)}</button></div>`;
  buy += Object.entries(s.ref.animaux).map(([k, a]) => `<div class="buy-row"><span class="prod-dot">${ART.side[k]}</span><div class="grow"><b>${a.nom}</b><span class="muted small">${s.animaux[k].liste.length} à la ferme · ${a.ration} kg / repas</span></div>
    <button class="btn sm" ${A({ type: "acheter", article: k, quantite: 1 })}>+1 · ${eur(a.prix)}</button></div>`).join("");
  setHTML($("#buy-list"), buy);

  const upIcons = { arrosage: "drop", distributeur: "bowl", reservoir: "tank", cloture: "fence", tracteur: "tractor" };
  setHTML($("#upgrades"), Object.entries(s.ref.ameliorations).map(([k, u]) => {
    const owned = s.ameliorations.includes(k);
    return `<div class="upg ${owned ? "owned" : ""}"><div class="zone-ico">${icon(upIcons[k])}</div><h4>${u.nom}</h4><p>${u.desc}</p>
      ${owned ? `<span class="pill-tag">${icon("check")} Installé</span>` : `<button class="btn" ${A({ type: "ameliorer", amelioration: k })} ${s.argent < u.prix ? "disabled" : ""}>Acheter · ${eur(u.prix)}</button>`}</div>`;
  }).join(""));
}
$("#sell-all").addEventListener("click", async () => {
  for (const k of ["tomates", "legumes", "lait", "oeufs", "laine"]) {
    if (S && S.stock[k] >= 1) { await act({ type: "vendre", produit: k }); }
  }
});

// ---------------------------------------------------------------- journal → toasts
function notifyJournal(s) {
  const top = s.journal[0];
  const key = top ? `${top.jour}|${top.heure}|${top.msg}` : null;
  if (lastJournalKey === null) { lastJournalKey = key; return; }
  if (key === lastJournalKey) return;
  for (const j of s.journal) {
    if (`${j.jour}|${j.heure}|${j.msg}` === lastJournalKey) break;
    if (j.type === "alerte") toast(j.msg, "err");
    else if (j.type === "succes" && !j.msg.startsWith("Vente") && !j.msg.startsWith("Récolte")) toast(j.msg, "ok");
  }
  lastJournalKey = key;
}

function renderModal(s) {
  const m = $("#modal");
  if (s.statut === "en_cours") { m.hidden = true; m.__html = ""; return; }
  const win = s.statut === "gagne";
  setHTML(m, `<div class="modal-card"><div class="modal-emoji">${win ? "🏆" : "🥀"}</div>
    <h2>${win ? "Victoire !" : "Faillite…"}</h2>
    <p>${win ? `En ${s.derive.jour} jours, la Ferme du Val Vert a dépassé ${nf0.format(s.derive.objectif_argent)} € de trésorerie.` : "Trois jours de suite dans le rouge : la banque a saisi la ferme."}</p>
    <button class="btn" ${A({ type: "nouvelle_partie" })}>Nouvelle partie</button></div>`);
  m.hidden = false;
}

// ---------------------------------------------------------------- démarrage
ICONS.clock = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
hydrateIcons();
$("#hero-art").innerHTML = ART.hero();
$("#avatar").innerHTML = ART.avatar;
FarmMap.init($("#map"), selectZone);
poll();

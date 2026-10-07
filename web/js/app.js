// Interface du jeu : interroge le serveur Python, affiche l'état, envoie les actions.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
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
  vide: ["Libre", "grey"], seme: ["Semé", "info"], pousse: ["En pousse", ""],
  mur: ["Prête à récolter", "warn"], fletri: ["Flétri", "bad"],
};
const PRODUCT_ICON = { foin: "🌾", foin_bio: "🌿" };
const emoji = (s, k) => (s.ref.cultures[k] ? s.ref.cultures[k].emoji : s.ref.emoji[k] || PRODUCT_ICON[k]);

// qualité (0-100) en étoiles, et part bio d'un produit
const stars = (q) => "★★★★★".slice(0, Math.max(1, Math.round(q / 20))).padEnd(5, "☆");
const qCls = (q) => (q >= 70 ? "" : q >= 50 ? "info" : q >= 30 ? "warn" : "bad");
function qualityTag(q, label) {
  return `<span class="pill-tag q ${qCls(q)}" title="Qualité ${Math.round(q)}/100">${stars(q)}${label ? ` ${label}` : ""}</span>`;
}
function bioTag(b) {
  if (b >= 0.95) return `<span class="pill-tag bio" title="Produit sans engrais chimique, animaux nourris bio">🌿 Bio</span>`;
  if (b > 0.05) return `<span class="pill-tag bio part" title="Une partie du stock seulement est bio">🌿 ${Math.round(b * 100)} % bio</span>`;
  return "";
}
const unitOf = (s, k) => s.ref.produits[k].unite;

// ---------------------------------------------------------------- helpers
// Met à jour le contenu sur place (seuls les nœuds qui changent sont touchés) : pas de clignotement,
// pas d'animation rejouée et pas de clic perdu quand l'état est rafraîchi.
function setHTML(el, html) {
  if (!el || el.__html === html) return;
  el.__html = html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  morph(el, tpl.content);
  hydrateIcons(el);
}
function morph(from, to) {
  const a = [...from.childNodes], b = [...to.childNodes];
  b.forEach((n, i) => {
    const o = a[i];
    if (!o) from.appendChild(n);
    else if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName) from.replaceChild(n, o);
    else if (o.nodeType !== 1) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; }
    else {
      for (const { name } of [...o.attributes]) if (!n.hasAttribute(name)) o.removeAttribute(name);
      for (const { name, value } of [...n.attributes]) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
      morph(o, n);
    }
  });
  for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
}
function enterAnim(panel) {
  panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter");
  clearTimeout(panel.__enter);
  panel.__enter = setTimeout(() => panel.classList.remove("enter"), 400);
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
    if (res.ok && action.type === "nouvelle_partie") resetUI();
    if (res.ok && action.type === "arroser") WeatherScene.splash();
    if (res.ok && action.type === "diviser") bedSel[action.champ] = 0;
    if (res.ok && action.type === "semer" && res.etat) {   // passe à la planche libre suivante
      const beds = res.etat.champs[action.champ].planches, nxt = beds.findIndex((b) => b.etat === "vide");
      if (nxt >= 0) bedSel[action.champ] = nxt;
    }
    if (res.ok && action.type === "acheter_parcelle") {
      const keys = Object.keys(res.etat.champs).sort();
      selectZone(keys[keys.length - 1]);
    }
    if (action.type !== "vitesse" && action.type !== "menu") toast(res.message, res.ok ? "ok" : "err");
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
    if (a.type === "stall") return selectStall(a.stall);
    if (a.type === "confirmer") { confirmNew = a.oui; return render(S); }
    if (a.type === "meteo_mode") { wxMode = a.mode; return render(S); }
    if (a.type === "bed") { bedSel[a.champ] = a.i; return render(S); }
    return act(a);
  }
});
const A = (o) => `data-act='${JSON.stringify(o)}'`;

// ---------------------------------------------------------------- navigation
function go(v) {
  view = v;
  $$(".nav-item").forEach((n) => n.classList.toggle("active", n.dataset.view === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.id === `view-${v}`));
  WeatherScene.setActive(v === "meteo");
  if (S) render(S);
}
$$(".nav-item").forEach((n) => n.addEventListener("click", () => go(n.dataset.view)));
$$("#speed button").forEach((b) => b.addEventListener("click", () => act({ type: "vitesse", valeur: +b.dataset.speed })));

function selectZone(id) {
  zone = id;
  if (view !== "ferme") go("ferme");
  FarmMap.focus(id);
  $("#map-back").classList.toggle("show", !!id);
  enterAnim($("#zone-panel"));
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
  MarketMap.update(s, myGoods(s));
  notifySales(s);
  ART.updateHero($("#hero-art"), d.heure_dec, s.meteo.type, s.eoliennes);
  WeatherScene.update(s);
  $(".hero").classList.toggle("night", ART.nightAmount(d.heure_dec) > .5);
  if (view === "accueil") renderHome(s, d);
  if (view === "ferme") renderFarm(s, d);
  if (view === "meteo") renderWeather(s, d);
  if (view === "elevage") renderLivestock(s, d);
  if (view === "marche") renderMarket(s, d);
  notifyJournal(s);
  renderModal(s);
  renderTitle(s, d);
}

// ---------------------------------------------------------------- menu principal
let confirmNew = false;
function openMenu() { confirmNew = false; act({ type: "menu", ouvert: true }); }
$("#open-menu").addEventListener("click", openMenu);
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape" || !S) return;
  if (!S.menu) openMenu();
  else if (S.statut === "en_cours" && !confirmNew) act({ type: "menu", ouvert: false });
  else { confirmNew = false; render(S); }
});

// une nouvelle partie repart de l'accueil, sans rien garder de l'ancienne à l'écran
function resetUI() {
  zone = null; stall = "mon_etal"; cat = "vaches"; confirmNew = false;
  lastJournalKey = null; lastSaleKey = null;
  FarmMap.focus(null);
  $("#map-back").classList.remove("show");
  MarketMap.select("mon_etal");
  go("accueil");
}

function renderTitle(s, d) {
  const t = $("#title");
  document.body.classList.toggle("in-menu", !!s.menu);
  if (!s.menu) { t.hidden = true; return; }
  t.hidden = false;
  ART.updateHero($("#title-art"), d.heure_dec, s.meteo.type, s.eoliennes, "t-");
  const over = s.statut !== "en_cours";
  const fresh = !over && s.minute <= 305;           // partie toute neuve, jamais lancée
  let save = "";
  if (!fresh) {
    const tag = over ? `<span class="pill-tag ${s.statut === "gagne" ? "" : "bad"}">${s.statut === "gagne" ? "🏆 Victoire" : "Faillite"}</span>`
      : `<span class="pill-tag grey">${icon("pause")}En pause</span>`;
    save = `<div class="save"><div class="save-head"><b>${over ? "Partie terminée" : "Partie en cours"}</b>${tag}</div>
      <div class="save-grid">
        <div><b>${d.jour_semaine} · J${d.jour}</b><span>${d.heure}</span></div>
        <div><b>${eur(s.argent)}</b><span>Trésorerie</span></div>
        <div><b>${s.objectifs.length}/${s.ref.objectifs.length}</b><span>Objectifs</span></div>
        <div><b>${Math.round(s.reputation)}</b><span>Réputation</span></div>
      </div>
      ${meter("Objectif", (s.argent / d.objectif_argent) * 100, "", `${eur(s.argent)} / ${nf0.format(d.objectif_argent)} €`)}</div>`;
  }
  let buttons;
  if (confirmNew) {
    buttons = `<div class="confirm"><b>Recommencer de zéro ?</b>
        <span class="muted small">Votre ferme actuelle (jour ${d.jour}, ${eur(s.argent)}) sera effacée.</span>
        <div class="title-btns row"><button class="btn red" ${A({ type: "nouvelle_partie" })}>${icon("restart")}Oui, recommencer</button>
        <button class="btn ghost" ${A({ type: "confirmer", oui: false })}>Annuler</button></div></div>`;
  } else if (over) {
    buttons = `<div class="title-btns"><button class="btn big" ${A({ type: "nouvelle_partie" })}>${icon("restart")}Nouvelle partie</button></div>`;
  } else if (fresh) {
    buttons = `<div class="title-btns"><button class="btn big" ${A({ type: "menu", ouvert: false })}>${icon("play")}Commencer la partie</button></div>`;
  } else {
    buttons = `<div class="title-btns"><button class="btn big" ${A({ type: "menu", ouvert: false })}>${icon("play")}Reprendre la partie</button>
      <button class="btn ghost big" ${A({ type: "confirmer", oui: true })}>${icon("restart")}Nouvelle partie</button></div>`;
  }
  const tips = fresh ? `<ul class="title-tips"><li>🌱 Choisissez quoi semer sur vos trois parcelles</li><li>🐄 Nourrissez les bêtes à 6 h, 12 h et 18 h</li>
      <li>🧺 Vendez au marché le mardi, le jeudi et le samedi</li><li>🎯 Atteignez ${nf0.format(d.objectif_argent)} € sans faire faillite</li></ul>` : "";
  const maj = s.maj ? `<div class="maj">${icon("sparkle")}<div><b>Mise à jour installée</b><span>${s.maj}</span></div></div>` : "";
  setHTML($("#title-card"), `<div class="title-logo">${icon("leaf")}</div>
    <h1>La Ferme du Val Vert</h1><p class="title-sub">Cultivez, élevez, vendez au marché.</p>
    ${maj}${save}${buttons}${tips}
    <div class="title-foot muted small">${over || fresh ? "" : "Échap : revenir au jeu · "}La partie est sauvegardée automatiquement.${s.version ? `<br>Version ${s.version}` : ""}
      <br>${s.reseau ? `Sur les autres appareils du réseau : <b>${s.reseau}</b>` : "Accès depuis le réseau désactivé (option --local)"}</div>`);
}

function renderSidebar(s, d) {
  $("#clk-day").textContent = `${d.jour_semaine} · Jour ${d.jour}`;
  const mb = $("#badge-marche");
  mb.textContent = d.marche_ouvert ? "Ouvert" : "";
  mb.classList.toggle("ok", d.marche_ouvert);
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
  const wxAlert = d.semaine.slice(0, 2).some((w) => w.type === "orage" || w.type === "canicule");
  $("#badge-meteo").textContent = wxAlert ? "!" : "";
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

  const fc = s.previsions.slice(0, 3).map((p, i) => `<div class="fc">${["Demain", "J+2", "J+3"][i]}${icon(WEATHER_ICON[p.type])}${p.temp}°</div>`).join("");
  setHTML($("#weather-card"), `<div class="weather-now"><div class="weather-ico ${WEATHER_CLS[s.meteo.type]}">${icon(WEATHER_ICON[s.meteo.type])}</div>
    <div><div class="temp-big">${Math.round(d.temperature)}°C</div><div class="muted small">${s.meteo.nom} · Humidité du sol ${d.humidite_moy} %</div></div></div>
    <div class="forecast">${fc}</div>`);

  const stats = [
    ["sprout", "g", d.n_cultures, "Cultures actives"],
    ["cow", "r", d.n_animaux, "Animaux"],
    ["store", "b", `${Math.round(s.reputation)}/100`, `Réputation · ${d.prochain_marche}`],
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
const fieldIcon = (f) => (f.serre ? "greenhouse" : "sprout");

function renderFarm(s, d) {
  const pills = [[null, "map", "Vue d'ensemble"], ["maison", "house", "Maison"],
    ...FarmMap.FIELDS.map((k) => [k, fieldIcon(s.champs[k]), d.noms_champs[k]]),
    ["enclos", "fence", "Enclos"], ["reservoir", "tank", "Réservoir"]];
  if (d.terrain_a_vendre) pills.push(["a_vendre", "plus", "Agrandir"]);
  setHTML($("#zone-pills"), pills.map(([id, ic, l]) => `<button class="pill ${id === "a_vendre" ? "sale" : ""} ${zone === id ? "active" : ""}" ${A({ type: "zone", zone: id })}>${icon(ic)}${l}</button>`).join(""));
  $("#map-hint").style.display = zone ? "none" : "flex";
  $("#farm-area").textContent = farmArea(s);
  $("#map-hint-sub").textContent = `${Object.keys(FarmMap.ZONES).length} zones · ${d.n_cultures} cultures · ${d.n_animaux} animaux`;
  let html;
  if (zone && !FarmMap.ZONES[zone]) zone = null;    // terrain acheté entre-temps
  if (!zone) html = overviewPanel(s, d);
  else if (zone === "a_vendre") html = salePanel(s, d);
  else if (zone === "maison") html = housePanel(s, d);
  else if (zone === "enclos") html = penPanel(s, d);
  else if (zone === "reservoir") html = tankPanel(s, d);
  else html = fieldPanel(s, d, zone);
  setHTML($("#zone-panel"), html);
}

function meter(label, value, cls = "", right) {
  return `<div class="meter"><div class="meter-row">${label}<span>${right ?? pct(value)}</span></div><div class="bar ${cls}"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div></div>`;
}

const farmArea = (s) => `${nf1.format(12.5 + Object.keys(s.champs).length - 3)} ha`;

// état le plus parlant d'une parcelle à plusieurs planches (à récolter > flétri > en pousse > semé > libre)
const STATE_RANK = ["mur", "fletri", "pousse", "seme", "vide"];
const fieldState = (f) => STATE_RANK.find((e) => f.planches.some((b) => b.etat === e)) || "vide";
const bedFree = (b) => b.etat === "vide" || b.etat === "fletri";
const bedToPrep = (b) => b.etat === "fletri" || (b.etat === "vide" && !b.sol_pret);
// état affiché d'une planche : une planche libre non labourée est « à préparer »
const bedState = (b) => (b.etat === "vide" && !b.sol_pret ? ["À préparer", "warn"] : FIELD_STATE[b.etat]);
// petits signaux sur une planche : herbes, nuisibles
const bedFlags = (b) => `${b.nuisible ? "🐛" : ""}${b.herbes >= 30 ? "🌿" : ""}`;
const cropsLabel = (s, f) => {
  const names = f.planches.filter((b) => b.culture && b.etat !== "vide").map((b) => `${emoji(s, b.culture)} ${s.ref.cultures[b.culture].nom}`);
  return [...new Set(names)].join(" + ");
};
let bedSel = {};              // planche affichée pour chaque parcelle

function overviewPanel(s, d) {
  const rows = FarmMap.FIELDS.map((k) => {
    const f = s.champs[k], fs = fieldState(f);
    const [st, c] = fs === "vide" && f.planches.some(bedToPrep) ? ["À préparer", "warn"] : FIELD_STATE[fs];
    const flags = f.planches.map(bedFlags).join("");
    const crop = cropsLabel(s, f);
    return `<li style="cursor:pointer" ${A({ type: "zone", zone: k })}><b>${d.noms_champs[k]}<span class="muted">${crop ? ` · ${crop}` : ""}</span>${d.association[k] ? ` <span class="pill-tag assoc" title="Association de cultures">🤝</span>` : ""}${flags ? ` <span title="Nuisibles / mauvaises herbes">${[...new Set(flags)].join("")}</span>` : ""}</b><span class="pill-tag ${c}">${st}</span></li>`;
  }).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("map")}</div><div><div class="zone-name">Vue d'ensemble</div><div class="muted small">Ferme du Val Vert · ${farmArea(s)}</div></div></div>
    <div class="kv"><div><b>${d.n_cultures}</b><span>Cultures</span></div><div><b>${d.n_animaux}</b><span>Animaux</span></div><div><b>${pct(s.reservoir.niveau / s.reservoir.capacite * 100)}</b><span>Eau</span></div></div>
    ${careSummary(d)}
    <ul class="mini-list">${rows}</ul>
    ${d.terrain_a_vendre ? `<div class="actions"><button class="btn ghost" ${A({ type: "zone", zone: "a_vendre" })}>${icon("plus")}Agrandir · ${d.terrain_a_vendre.nom} · ${eur(d.terrain_a_vendre.prix)}</button></div>` : ""}</div>
    ${techCard(s, d, true)}
    <div class="zone-card">${meter("Santé de la ferme", d.sante_ferme, barCls(d.sante_ferme))}${meter("Humidité moyenne du sol", d.humidite_moy, "blue")}${meter("Nourriture des animaux", d.nourriture, barCls(d.nourriture))}</div>`;
}

function careSummary(d) {
  const c = d.soins_cultures, out = [];
  if (c.nuisibles) out.push(`<span class="pill-tag bad">🐛 ${c.nuisibles} planche(s) attaquée(s)</span>`);
  if (c.herbes) out.push(`<span class="pill-tag warn">🌿 ${c.herbes} à désherber</span>`);
  if (c.a_preparer) out.push(`<span class="pill-tag warn">🪨 ${c.a_preparer} à préparer</span>`);
  return out.length ? `<div class="tags" style="margin-bottom:10px">${out.join("")}</div>` : "";
}

function fieldPanel(s, d, k) {
  const f = s.champs[k], beds = f.planches, n = beds.length;
  const i = Math.min(bedSel[k] || 0, n - 1);
  const b = beds[i], [st, c] = bedState(b);
  const ref = b.culture ? s.ref.cultures[b.culture] : null;
  const free = bedFree(b), allFree = beds.every(bedFree), planted = beds.some((x) => x.etat !== "vide");
  const speed = (f.serre ? s.ref.serre_boost : 1) * (s.technologies.includes("desherbeur") ? s.ref.desherbeur : 1);
  const est = d.recolte_est[k][i], q = d.qualite_champs[k][i];
  const daysLeft = ref && (b.etat === "pousse" || b.etat === "seme") ? ((100 - b.croissance) / 100) * ref.jours / speed : 0;
  const engrais = b.engrais_jusqua > s.minute;
  const growing = b.etat === "seme" || b.etat === "pousse";
  const mixed = d.association[k];
  const bedLbl = (j) => (n > 1 ? `Planche ${j + 1}` : "Culture");

  // ---- la parcelle : sol, arrosage, découpage en planches
  const crops = cropsLabel(s, f);
  let html = `<div class="zone-card"><div class="zone-top"><div class="zone-ico ${f.serre ? "glass" : ""}">${icon(fieldIcon(f))}</div>
    <div><div class="zone-name">${d.noms_champs[k]}</div><div class="muted small">${crops || "Libre — choisissez quoi semer"}</div></div>
    ${mixed ? `<span class="pill-tag assoc" title="Plusieurs cultures sur la même parcelle">🤝 +${Math.round((s.ref.association - 1) * 100)} %</span>` : ""}</div>`;
  html += meter("Humidité du sol", f.humidite, f.humidite < 20 ? "red" : "blue");
  if (d.pluie && planted) {
    html += f.serre ? `<div class="note warn">${icon("rain")}Il pleut, mais pas sous la serre : arrosez-la vous-même.</div>`
      : `<div class="note info">${icon("rain")}Il pleut : la pluie arrose cette parcelle toute seule.</div>`;
  }
  html += `<div class="beds-head"><b>Planches</b><div class="seg">${[1, 2, 3].slice(0, s.ref.max_planches).map((m) =>
    `<button class="${m === n ? "on" : ""}" ${A({ type: "diviser", champ: k, planches: m })} ${allFree && m !== n ? "" : "disabled"} title="${allFree ? `Découper en ${m} planche${m > 1 ? "s" : ""}` : "Récoltez tout pour redécouper"}">${m}</button>`).join("")}</div></div>`;
  html += `<div class="beds" style="grid-template-columns:repeat(${n},1fr)">${beds.map((x, j) => {
    const r = x.culture ? s.ref.cultures[x.culture] : null, [bst, bc] = bedState(x);
    return `<button class="bed ${j === i ? "on" : ""} ${x.etat}" ${A({ type: "bed", champ: k, i: j })}>
      <span class="bed-emo">${r && x.etat !== "vide" ? r.emoji : bedToPrep(x) ? "🪨" : "🟫"}${bedFlags(x) ? `<i class="bed-flags">${bedFlags(x)}</i>` : ""}</span><b>${n > 1 ? `Planche ${j + 1}` : r && x.etat !== "vide" ? r.nom : bedToPrep(x) ? "En friche" : "Libre"}</b>
      <small class="pill-tag ${bc}">${x.etat === "pousse" || x.etat === "seme" ? pct(x.croissance) : bst}</small></button>`;
  }).join("")}</div>`;
  if (n > 1 && !allFree) html += `<div class="muted small" style="margin-top:8px">Pour redécouper la parcelle, récoltez d'abord toutes les planches.</div>`;
  if (n === 1 && allFree) html += `<div class="muted small" style="margin-top:8px">Astuce : découpez la parcelle en 2 ou 3 planches pour y mettre plusieurs cultures. Deux cultures différentes s'entraident : <b>+${Math.round((s.ref.association - 1) * 100)} % de récolte</b>.</div>`;
  if (planted) html += `<div class="actions"><button class="btn ghost" ${A({ type: "arroser", champ: k })}>${icon("drop")}Arroser la parcelle · 600 L</button></div>`;
  html += `</div>`;

  // ---- la planche sélectionnée
  const sub = ref && b.etat !== "fletri" && b.etat !== "vide" ? `${ref.emoji} ${ref.nom}` : b.etat === "fletri" ? `${ref.nom} flétries — ressemez` : "Libre — choisissez quoi semer";
  html += `<div class="zone-card"><div class="card-head"><h3>${bedLbl(i)} <span class="muted small" style="font-weight:600">${sub}</span></h3><span class="pill-tag ${c}">${st}</span></div>`;
  if (ref && !free) {
    html += `<div class="kv"><div><b>${pct(b.croissance)}</b><span>Croissance</span></div><div><b>${pct(b.sante)}</b><span>Santé</span></div><div><b>${est} kg</b><span>Récolte est.</span></div></div>
      ${meter("Croissance", b.croissance, "", daysLeft ? `encore ~${nf0.format(Math.ceil(daysLeft * 24))} h` : pct(b.croissance))}
      ${meter("Santé des plants", b.sante, barCls(b.sante))}
      ${meter(`Qualité de la récolte ${b.chimique ? "" : bioTag(1)}`, q, barCls(q), `${stars(q)} ${q}/100`)}`;
    if (b.etat === "mur") html += `<div class="actions"><button class="btn green" ${A({ type: "recolter", champ: k, planche: i })}>${icon("wheat")}Récolter ~${est} kg</button></div>`;
  } else if (free) {
    html += `<div class="muted small">${n > 1 ? `Cette planche occupe 1/${n} de la parcelle.` : "Toute la parcelle est disponible."}</div>`;
  }
  html += `</div>`;
  if (ref && !free) html += careCard(s, k, i, b);
  if (bedToPrep(b)) html += prepCard(s, k, i, b, beds);
  if (growing) {
    html += `<div class="zone-card"><div class="card-head"><h3>${icon("sprout")} Engrais · ${bedLbl(i).toLowerCase()}</h3>${engrais ? `<span class="pill-tag">Actif · ×${nf1.format(b.boost)}</span>` : ""}</div>
      <div class="ferti">
        <button class="ferti-opt bio" ${A({ type: "fertiliser", champ: k, planche: i, engrais: "fumier" })} ${s.stock.fumier < 50 ? "disabled" : ""}>
          <b>${icon("poop")}Fumier · bio</b><small>50 kg (stock ${nf0.format(s.stock.fumier)} kg) · pousse ×1,5 · qualité en hausse</small></button>
        <button class="ferti-opt chem" ${A({ type: "fertiliser", champ: k, planche: i, engrais: "chimique" })} ${s.argent < s.ref.prix_chimique ? "disabled" : ""}>
          <b>${icon("sparkle")}Engrais chimique · ${s.ref.prix_chimique} €</b><small>pousse ×1,8 · +20 % de récolte · qualité en baisse · <u>plus bio</u> (ni le miel)</small></button>
      </div></div>`;
  }
  if (free && !bedToPrep(b)) html += cropPicker(s, k, f, speed, i);
  html += greenhouseCard(s, d, k, f, allFree);
  const tech = s.technologies.map((t) => `${s.ref.technologies[t].emoji} ${s.ref.technologies[t].nom}`).join(", ");
  html += `<div class="zone-card"><ul class="mini-list">
      <li>Arrosage intelligent <span>${s.ameliorations.includes("arrosage") ? "Actif" : "Non installé"}</span></li>
      <li>Technologies <span>${tech || "Aucune"}</span></li>
      <li>Culture <span>${!ref || free ? "—" : b.chimique ? "Conventionnelle" : "🌿 Bio"}</span></li>
      ${d.pollinisation ? `<li>Pollinisation des abeilles <span>+${d.pollinisation} % de récolte</span></li>` : ""}
      <li>Fumier en stock <span>${nf0.format(s.stock.fumier)} kg</span></li>
      <li>Eau disponible <span>${nf0.format(s.reservoir.niveau)} L</span></li>
      ${ref ? `<li>Cours du jour <span>${nf2.format(s.prix[b.culture])} €/kg</span></li>` : ""}</ul></div>`;
  return html;
}

// soins d'une planche en culture : nuisibles et mauvaises herbes
function careCard(s, k, i, b) {
  const robot = s.technologies.includes("desherbeur"), t = s.ref.traitements;
  let html = `<div class="zone-card"><div class="card-head"><h3>${icon("shovel")} Soins de la planche</h3>${b.nuisible ? `<span class="pill-tag bad">🐛 Attaquée</span>` : ""}</div>`;
  if (b.nuisible) {
    html += `<div class="note warn">${icon("alert")}<span>Des <b>${b.nuisible}</b> rongent les plants : ils perdent de la santé à vue d'œil.</span></div>
      <div class="ferti" style="margin-top:10px">
        <button class="ferti-opt bio" ${A({ type: "traiter", champ: k, planche: i, traitement: "naturel" })} ${s.argent < t.naturel.prix ? "disabled" : ""}>
          <b>${icon("leaf")}${t.naturel.nom} · ${t.naturel.prix} € · bio</b><small>chasse les ${b.nuisible} · la culture reste bio · ils peuvent revenir</small></button>
        <button class="ferti-opt chem" ${A({ type: "traiter", champ: k, planche: i, traitement: "chimique" })} ${s.argent < t.chimique.prix ? "disabled" : ""}>
          <b>${icon("sparkle")}${t.chimique.nom} · ${t.chimique.prix} €</b><small>radical · protège la planche 3 jours · <u>plus bio</u> (ni le miel)</small></button>
      </div>`;
  } else if (b.protege_jusqua > s.minute) {
    html += `<div class="note info">${icon("check")}Protégée des nuisibles encore ${nf0.format(Math.ceil((b.protege_jusqua - s.minute) / 60))} h.</div>`;
  }
  if (robot) {
    html += `<div class="muted small" style="margin-top:10px">🤖 Le robot désherbeur garde la planche propre.</div>`;
  } else {
    html += meter("Mauvaises herbes", b.herbes, b.herbes >= 60 ? "red" : b.herbes >= 30 ? "amber" : "", b.herbes >= 60 ? "Envahie" : b.herbes >= 30 ? "Ça pousse" : pct(b.herbes));
    if (b.herbes >= 30) html += `<div class="muted small">${b.herbes >= 60 ? "Les herbes étouffent les plants : la pousse ralentit et la qualité baisse." : "Les herbes commencent à ralentir la pousse."}</div>`;
    html += `<div class="actions"><button class="btn ${b.herbes >= 30 ? "" : "ghost"}" ${A({ type: "desherber", champ: k, planche: i })} ${b.herbes < 1 ? "disabled" : ""}>${icon("hand")}Désherber à la main</button></div>`;
  }
  return html + `</div>`;
}

// planche à labourer (après une récolte) ou plants flétris à arracher
function prepCard(s, k, i, b, beds) {
  const tracteur = s.ameliorations.includes("tracteur"), n = beds.filter(bedToPrep).length;
  const what = b.etat === "fletri" ? "Arracher les plants flétris et labourer" : "Labourer la planche";
  return `<div class="zone-card"><div class="card-head"><h3>${icon("tractor")} Préparer le sol</h3><span class="pill-tag warn">À faire avant de semer</span></div>
    <div class="muted small">${b.etat === "fletri" ? "Les plants morts encombrent la planche." : "La terre est tassée et pleine d'herbes."} Retournez-la pour pouvoir semer.</div>
    <div class="actions"><button class="btn green" ${A({ type: "preparer", champ: k, planche: i })}>${icon(tracteur ? "tractor" : "shovel")}${tracteur && n > 1 ? `Labourer la parcelle au tracteur (${n} planches)` : what}</button></div></div>`;
}

function cropPicker(s, k, f, speed, i) {
  const n = f.planches.length;
  const size = (s.ref.parcelles[k].taille / n) * (s.ameliorations.includes("tracteur") ? s.ref.tracteur : 1);
  // cultures déjà en terre sur les autres planches : semer autre chose déclenche l'association
  const others = new Set(f.planches.filter((x, j) => j !== i && ["seme", "pousse", "mur"].includes(x.etat)).map((x) => x.culture));
  const crops = Object.entries(s.ref.cultures).sort(([, a], [, b]) => (a.serre ? 1 : 0) - (b.serre ? 1 : 0));
  const btns = crops.map(([c, r]) => {
    const assoc = others.size && !(others.size === 1 && others.has(c));
    const kg = Math.round(r.rendement * size * (assoc ? s.ref.association : 1));
    const perDay = (kg * s.prix[c] - r.graines) / (r.jours / speed);
    const locked = r.serre && !f.serre;
    const poor = s.argent < r.graines;
    return `<button class="crop ${r.serre ? "serre-only" : ""}" ${A({ type: "semer", champ: k, planche: i, culture: c })} ${locked || poor ? "disabled" : ""}
        title="${locked ? "Uniquement sous serre" : `${r.nom} : ${nf1.format(r.jours / speed)} j, ~${kg} kg`}">
      <span class="emo">${r.emoji}</span><b>${r.nom}</b>
      <small>${nf1.format(r.jours / speed)} j · graines ${r.graines} €</small>
      <span class="gain">${locked ? `${icon("lock")}Sous serre` : `≈ ${eur(perDay)} / jour${assoc ? " · 🤝" : ""}`}</span></button>`;
  }).join("");
  return `<div class="zone-card"><div class="card-head"><h3>Que semer ${n > 1 ? `sur la planche ${i + 1}` : ""} ?</h3></div>
    <div class="crop-grid">${btns}</div>
    <div class="muted small" style="margin-top:10px">Gain estimé au prix du jour, plants en pleine santé.${others.size ? ` 🤝 = association avec ${[...others].map((c) => s.ref.cultures[c].nom.toLowerCase()).join(" et ")} : +${Math.round((s.ref.association - 1) * 100)} % de récolte.` : ""}</div></div>`;
}

// technologies modernes : résumé (ferme) ou fiches d'achat (marché)
const TECH_ICON = { drone: "drone", desherbeur: "robot", semoir: "seeder", recolteur: "basket", robot_traite: "milk" };
function techStatus(s, d, t) {
  if (t === "drone") return d.drone_actif ? ["En vol", ""] : ["Au sol : orage", "warn"];
  return ["En service", ""];
}
function techCard(s, d, compact) {
  const owned = s.technologies;
  if (compact) {
    if (!owned.length) return "";
    return `<div class="zone-card"><div class="card-head"><h3>${icon("robot")} Technologies</h3><span class="pill-tag info">${owned.length} / ${Object.keys(s.ref.technologies).length}</span></div>
      <ul class="mini-list">${owned.map((t) => { const [st, c] = techStatus(s, d, t); return `<li>${s.ref.technologies[t].emoji} ${s.ref.technologies[t].nom}<span class="pill-tag ${c}">${st}</span></li>`; }).join("")}</ul></div>`;
  }
  return Object.entries(s.ref.technologies).map(([t, x]) => {
    const has = owned.includes(t), [st, c] = techStatus(s, d, t);
    return `<div class="upg tech ${has ? "owned" : ""}"><div class="tech-top"><div class="zone-ico tech-ico">${icon(TECH_ICON[t])}</div><span class="tech-emo">${x.emoji}</span></div>
      <h4>${x.nom}</h4><p>${x.desc}</p><div class="tech-cost"><span>Entretien</span><b>${x.entretien} €/jour</b></div>
      ${has ? `<span class="pill-tag ${c}">${icon("check")} ${st}</span>` : `<button class="btn" ${A({ type: "technologie", tech: t })} ${s.argent < x.prix ? "disabled" : ""}>Acheter · ${eur(x.prix)}</button>`}</div>`;
  }).join("");
}

function greenhouseCard(s, d, k, f, free) {
  const b = s.ref.batiments.serre;
  if (f.serre) {
    return `<div class="zone-card glass-card"><div class="card-head"><h3>${icon("greenhouse")} Sous serre</h3><span class="pill-tag info">Entretien ${b.entretien} €/j</span></div>
      <div class="muted small">Pousse +${Math.round((s.ref.serre_boost - 1) * 100)} %, sol qui sèche moins vite, à l'abri des orages et de la canicule. La pluie n'arrose plus : pensez au réservoir.</div></div>`;
  }
  if (!d.serre_debloquee) {
    return `<div class="zone-card"><div class="card-head"><h3>${icon("lock")} Serre</h3><span class="pill-tag grey">Verrouillée</span></div>
      <div class="muted small">Vendez pour ${nf0.format(b.ventes_requises)} € de produits pour pouvoir remplacer cette parcelle par une serre.</div>
      ${meter("Ventes cumulées", (s.stats.ventes / b.ventes_requises) * 100, "", `${eur(s.stats.ventes)} / ${nf0.format(b.ventes_requises)} €`)}</div>`;
  }
  return `<div class="zone-card"><div class="card-head"><h3>${icon("greenhouse")} Construire une serre</h3></div>
    <div class="muted small">${b.desc} Entretien ${b.entretien} €/jour.</div>
    <div class="actions"><button class="btn" ${A({ type: "construire", batiment: "serre", champ: k })} ${!free || s.argent < b.prix ? "disabled" : ""}>${icon("greenhouse")}Serre · ${eur(b.prix)}</button></div>
    ${free ? "" : `<div class="muted small" style="margin-top:8px">Récoltez d'abord : la parcelle doit être libre.</div>`}</div>`;
}

// terrain à vendre : il devient une parcelle libre de plus
function salePanel(s, d) {
  const t = d.terrain_a_vendre;
  if (!t) return `<div class="zone-card"><div class="muted">Tous les terrains autour de la ferme sont achetés.</div></div>`;
  const n = Object.keys(s.champs).length, max = s.ref.terrains_max;
  return `<div class="zone-card sale-card"><div class="zone-top"><div class="zone-ico" style="background:var(--green-soft);color:var(--green)">${icon("plus")}</div>
      <div><div class="zone-name">Terrain à vendre</div><div class="muted small">Prairie de 1 ha bordée d'une haie</div></div></div>
    <div class="kv"><div><b>${eur(t.prix)}</b><span>Prix</span></div><div><b>${s.ref.terrain_entretien} €</b><span>Entretien / jour</span></div><div><b>${n} → ${n + 1}</b><span>Parcelles (max ${max})</span></div></div>
    <div class="muted small">Une fois acheté, il devient la <b>${t.nom}</b> : libre, à semer comme les autres. Vous pourrez aussi y construire une serre, et le tracteur viendra la travailler.</div>
    <div class="actions"><button class="btn green" ${A({ type: "acheter_parcelle" })} ${s.argent < t.prix ? "disabled" : ""}>${icon("plus")}Acheter la ${t.nom} · ${eur(t.prix)}</button></div>
    ${s.argent < t.prix ? `<div class="muted small" style="margin-top:8px">Il vous manque ${eur(t.prix - s.argent)}.</div>` : ""}</div>`;
}

function housePanel(s, d) {
  const charges = d.charges;
  const ups = s.ameliorations.map((u) => `<li>${s.ref.ameliorations[u].nom}<span>✓</span></li>`).join("") || `<li>Aucune pour l'instant<span>—</span></li>`;
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("house")}</div><div><div class="zone-name">Maison</div><div class="muted small">Le bureau de la ferme</div></div></div>
    <div class="kv"><div><b>${eur(s.argent)}</b><span>Trésorerie</span></div><div><b>${eur(charges)}</b><span>Charges / jour</span></div><div><b>J${d.jour}</b><span>Saison</span></div></div>
    ${meter("Objectif", (s.argent / d.objectif_argent) * 100, "", `${eur(s.argent)} / ${nf0.format(d.objectif_argent)} €`)}
    <div class="actions"><button class="btn" ${A({ type: "goto", view: "marche" })}>${icon("store")}Aller au marché</button></div></div>
    ${beeCard(s, d)}
    ${windCard(s, d)}
    ${techCard(s, d, true)}
    <div class="zone-card"><div class="card-head"><h3>Améliorations</h3></div><ul class="mini-list">${ups}</ul></div>`;
}

function beeCard(s, d) {
  const b = s.ref.batiments.ruche, n = s.ruches;
  const buy = n < b.max ? `<div class="actions"><button class="btn" ${A({ type: "construire", batiment: "ruche" })} ${s.argent < b.prix ? "disabled" : ""}>${icon("bee")}${n ? "Une ruche de plus" : "Installer une ruche"} · ${eur(b.prix)}</button></div>` : "";
  if (!n) {
    return `<div class="zone-card"><div class="card-head"><h3>${icon("bee")} Ruches</h3><span class="pill-tag grey">Aucune</span></div>
      <div class="muted small">${b.desc} Le miel se garde longtemps et se vend bien.</div>${buy}</div>`;
  }
  return `<div class="zone-card"><div class="card-head"><h3>${icon("bee")} Ruches</h3><span class="pill-tag">${n} / ${b.max}</span></div>
    <div class="kv"><div><b>${nf1.format(d.miel_jour)} kg</b><span>Miel / jour</span></div><div><b>${qf(s.stock.miel)} kg</b><span>En stock</span></div><div><b>+${d.pollinisation} %</b><span>Pollinisation</span></div></div>
    <div class="tags">${qualityTag(d.qualite_miel, "fleurs variées")}${d.miel_bio ? bioTag(1) : `<span class="pill-tag warn">Engrais chimique récent : pas bio</span>`}</div>
    <div class="muted small" style="margin-top:8px">Plus il y a de cultures différentes en fleurs, meilleur est le miel. Pas de miel sous la pluie.</div>${buy}</div>`;
}

function windCard(s, d) {
  const b = s.ref.batiments.eolienne, n = s.eoliennes;
  const buy = n < b.max ? `<div class="actions"><button class="btn" ${A({ type: "construire", batiment: "eolienne" })} ${s.argent < b.prix ? "disabled" : ""}>${icon("wind")}${n ? "Une deuxième" : "Acheter une éolienne"} · ${eur(b.prix)}</button></div>` : "";
  if (!n) {
    return `<div class="zone-card"><div class="card-head"><h3>${icon("wind")} Éoliennes</h3><span class="pill-tag grey">Aucune</span></div>
      <div class="muted small">${b.desc} Il y a de la place pour ${b.max} à côté de la maison.</div>${buy}</div>`;
  }
  return `<div class="zone-card"><div class="card-head"><h3>${icon("wind")} Éoliennes</h3><span class="pill-tag">${n} / ${b.max}</span></div>
    <div class="kv"><div><b>${eur(d.gain_eoliennes)}</b><span>Aujourd'hui / j</span></div><div><b>${pct(d.vent * 100)}</b><span>Vent</span></div><div><b>${eur(s.stats.energie)}</b><span>Total gagné</span></div></div>${buy}</div>`;
}

function penPanel(s, d) {
  const next = d.repas.find((r) => r.statut === "maintenant") || d.repas.find((r) => r.statut === "a_venir");
  const cats = Object.entries(s.animaux).map(([k, g]) => `<li>${s.ref.animaux[k].nom}<span>${g.liste.length}</span></li>`).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico">${icon("cow")}</div><div><div class="zone-name">Enclos des animaux</div><div class="muted small">${d.n_animaux} animaux</div></div>
    ${d.malades ? `<span class="pill-tag bad">${d.malades} malade(s)</span>` : `<span class="pill-tag">En forme</span>`}</div>
    <div class="kv"><div><b>${pct(d.sante_animaux)}</b><span>Santé</span></div><div><b>${pct(d.nourriture)}</b><span>Nourris</span></div><div><b>${pct(d.production)}</b><span>Production</span></div></div>
    ${meter("Satiété", d.nourriture, barCls(d.nourriture))}
    <div class="muted small" style="margin-top:8px">${next ? `Prochain repas : <b>${next.heure}</b> — ${next.menu}${next.statut === "maintenant" ? " (maintenant !)" : ""}` : "Tous les repas du jour sont passés."}</div>
    ${d.n_animaux ? `${meter(`Humeur ${moodEmo(d.humeur)}`, d.humeur, barCls(d.humeur))}${meter("Propreté", d.proprete, d.proprete < s.ref.enclos_sale ? "red" : "")}` : `<div class="muted small" style="margin-top:8px">Pas encore d'animaux : achetez vos premières bêtes dans l'élevage.</div>`}
    <div class="actions"><button class="btn green" ${A({ type: "nourrir" })} ${d.n_animaux ? "" : "disabled"}>${icon("bowl")}Nourrir · ${d.ration} kg</button><button class="btn ghost" ${A({ type: "goto", view: "elevage" })}>Voir l'élevage</button></div>
    ${d.n_animaux ? `<div class="actions" style="margin-top:8px">${herdButtons(s, d)}</div>` : ""}</div>
    <div class="zone-card"><ul class="mini-list">${cats}<li>Foin en stock<span>${nf0.format(s.stock.foin)} kg</span></li>
      <li>Foin bio en stock<span>${nf0.format(s.stock.foin_bio)} kg</span></li><li>Dernier repas<span>${s.repas_bio >= .99 ? "🌿 100 % bio" : `${pct(s.repas_bio * 100)} bio`}</span></li></ul></div>`;
}

function tankPanel(s, d) {
  const r = s.reservoir, frac = (r.niveau / r.capacite) * 100;
  const smart = s.ameliorations.includes("arrosage");
  const feed = [["foin", "Foin"], ["foin_bio", "Foin bio"]].map(([k, nom]) => `<li>${emoji(s, k)} ${nom}<span>${qf(s.stock[k])} kg</span></li>`).join("");
  const stock = feed + Object.keys(s.ref.produits).filter((k) => s.stock[k] >= 1 || ["mais", "lait", "oeufs", "fumier"].includes(k)).map((k) => {
    const p = d.produits[k];
    return `<li><div>${emoji(s, k)} ${s.ref.produits[k].nom}<div class="tags">${s.stock[k] >= 1 ? qualityTag(p.qualite) + bioTag(p.bio) : ""}</div></div><span>${qf(s.stock[k])} ${unitOf(s, k)}</span></li>`;
  }).join("");
  return `<div class="zone-card"><div class="zone-top"><div class="zone-ico" style="background:var(--blue-soft);color:var(--blue)">${icon("tank")}</div><div><div class="zone-name">Réservoir d'eau</div><div class="muted small">Pompe ${s.ameliorations.includes("reservoir") ? "1 440" : "720"} L/jour + pluie</div></div>
    <span class="pill-tag ${frac < 20 ? "bad" : "info"}">${frac < 20 ? "Bas" : "OK"}</span></div>
    <div class="kv"><div><b>${pct(frac)}</b><span>Niveau</span></div><div><b>${nf0.format(r.niveau)} L</b><span>Disponible</span></div><div><b>${nf0.format(r.capacite)} L</b><span>Capacité</span></div></div>
    ${meter("Niveau d'eau", frac, "blue")}
    <div class="actions">${smart ? `<button class="btn green" disabled>${icon("check")}Arrosage intelligent actif</button>`
      : `<button class="btn green" ${A({ type: "ameliorer", amelioration: "arrosage" })}>${icon("sparkle")}Arrosage intelligent · 1 200 €</button>`}</div></div>
    <div class="zone-card"><div class="card-head"><h3>Stockage</h3><button class="btn ghost sm" ${A({ type: "goto", view: "marche" })}>Vendre</button></div><ul class="mini-list">${stock}</ul></div>`;
}

// ---------------------------------------------------------------- météo
let wxMode = null;            // null = la météo du jeu en direct, sinon l'ambiance choisie en aperçu
const MOOD_ICON = { soleil: "sun", nuageux: "cloud", vent: "breeze", pluie: "rain", orage: "storm", canicule: "heat", eclaircie: "rainbow" };
const MOOD_TEMP = { soleil: 28, nuageux: 25, vent: 24, pluie: 21, orage: 19, canicule: 36, eclaircie: 26 };
const MOOD_TEXT = {
  soleil: "Ciel dégagé et petite brise sur les champs.",
  nuageux: "Les nuages arrivent par l'ouest, l'air se rafraîchit.",
  vent: "Les rafales forcissent : les éoliennes tournent à plein régime.",
  pluie: "Il pleut sur la ferme : le réservoir et les sols se remplissent.",
  orage: "Orage sur la ferme : les cultures en plein champ souffrent.",
  canicule: "Chaleur écrasante : les sols sèchent à vue d'œil.",
  eclaircie: "La pluie est passée. Le sol est humide et l'arc-en-ciel est sorti.",
};
const wxCls = (t) => (t === "pluie" || t === "orage" ? "rain" : t === "nuageux" ? "cloud" : "");
const tempAt = (b, h) => b - 6 + 9 * Math.max(0, Math.sin(((h - 6) / 24) * 2 * Math.PI));
const lc = (j) => (j === "Aujourd'hui" ? "aujourd'hui" : j.toLowerCase());
const uvLabel = (u) => (u <= 2 ? "Faible" : u <= 5 ? "Modéré" : u <= 7 ? "Élevé" : u <= 10 ? "Très élevé" : "Extrême");

function renderWeather(s, d) {
  const liveMood = WeatherScene.liveMood(s), mood = wxMode || liveMood;
  WeatherScene.setMood(mood, !wxMode);
  $("#wx-hero").classList.toggle("dark", !wxMode && ART.nightAmount(d.heure_dec) > .5);
  $("#wx-clock").textContent = `${d.jour_semaine} · ${d.heure}`;
  const temp = wxMode ? MOOD_TEMP[mood] : Math.round(d.temperature);
  const clearNight = ART.nightAmount(d.heure_dec) > .5 && ["soleil", "canicule"].includes(s.meteo.type);
  const label = wxMode ? WeatherScene.MOODS[mood].nom : liveMood === "eclaircie" ? "Éclaircie" : clearNight ? "Nuit étoilée" : s.meteo.nom;
  setHTML($("#wx-head"), `<div class="wx-temp">${temp}<sup>°C</sup></div><div class="wx-label">${label}</div>
    ${wxMode ? `<button class="wx-preview" ${A({ type: "meteo_mode", mode: null })}>Aperçu · revenir au direct</button>` : ""}`);
  setHTML($("#wx-modes"), `<button class="wx-mode live ${wxMode ? "" : "on"}" title="La météo du jeu" ${A({ type: "meteo_mode", mode: null })}>${icon("live")}En direct</button>`
    + WeatherScene.ORDER.map((m) => `<button class="wx-mode ${wxMode === m ? "on" : ""}" title="${WeatherScene.MOODS[m].nom}" ${A({ type: "meteo_mode", mode: m })}>${icon(MOOD_ICON[m])}</button>`).join(""));

  // conditions du jour (toujours la vraie météo du jeu)
  const md = d.meteo_detail, base = s.meteo.temp;
  const hs = Array.from({ length: 19 }, (_, i) => 5 + i), ts = hs.map((h) => tempAt(base, h));
  const lo = Math.min(...ts), hi = Math.max(...ts);
  const px = (h) => ((h - 5) / 18) * 70 + 2, py = (t) => 30 - ((t - lo) / (hi - lo || 1)) * 24;
  const curH = Math.min(23, Math.max(5, d.heure_dec));
  const spark = `<svg class="wx-spark" viewBox="0 0 74 34"><path d="${hs.map((h, i) => `${i ? "L" : "M"}${px(h).toFixed(1)} ${py(ts[i]).toFixed(1)}`).join("")}" stroke="#E9A93A" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <circle cx="${px(curH).toFixed(1)}" cy="${py(tempAt(base, curH)).toFixed(1)}" r="3.6" fill="#fff" stroke="#C98A1A" stroke-width="2"/></svg>`;
  const spin = (3.2 - 2.8 * d.vent).toFixed(2);
  const turbine = `<svg class="wx-mini-turbine" viewBox="0 0 38 38"><path d="M18 16L16.5 37h3L19 16Z" fill="#C9D2D9"/>
    <g style="transform-origin:18.5px 15px;animation:spin ${spin}s linear infinite"><path d="M18.5 15C20 12 20.5 6 19.3 1h-1.6C16.5 6 17 12 18.5 15Z" fill="#9AA6B0"/>
    <path d="M18.5 15C20 12 20.5 6 19.3 1h-1.6C16.5 6 17 12 18.5 15Z" fill="#9AA6B0" transform="rotate(120 18.5 15)"/><path d="M18.5 15C20 12 20.5 6 19.3 1h-1.6C16.5 6 17 12 18.5 15Z" fill="#9AA6B0" transform="rotate(240 18.5 15)"/></g>
    <circle cx="18.5" cy="15" r="2.2" fill="#6F7B85"/></svg>`;
  const nextRain = d.semaine.findIndex((w, i) => i > 0 && w.risque >= 90);
  const tank = (s.reservoir.niveau / s.reservoir.capacite) * 100;
  const card = (ic, cls, right, k, v, sub, extra = "") => `<div class="wx-card"><div class="wx-card-top"><div class="wx-ic ${cls}">${icon(ic)}</div>${right}</div>
    <div class="wx-k">${k}</div><div class="wx-v">${v}</div><div class="wx-s">${sub}</div>${extra}</div>`;
  setHTML($("#wx-today"), `<div class="card-head"><h3>Conditions du jour</h3><span class="live-tag">En direct</span></div>
    <div class="wx-sub">${d.jour_semaine} ${d.jour} · ${MOOD_TEXT[liveMood]}</div>
    <div class="wx-cards">
      ${card("thermo", "a", spark, "Température", `${Math.round(d.temperature)}°`, `Ressenti ${md.ressenti}°`)}
      ${card("drop", "b", `<div class="wx-gauge"><i style="height:${md.humidite_air}%"></i></div>`, "Humidité de l'air", `${md.humidite_air} %`, `Point de rosée ${md.rosee}°`)}
      ${card("breeze", "g", turbine, "Vent", `${md.vent_kmh} km/h`, s.eoliennes ? `Éoliennes : ${eur(d.gain_eoliennes)} / jour` : "Aucune éolienne installée")}
      ${card("rain", "b", "", "Risque de pluie", `${md.risque_pluie} %`, d.pluie ? "Les champs s'arrosent tout seuls" : nextRain > 0 ? `Pluie attendue ${lc(d.semaine[nextRain].jour)}` : "Pas de pluie prévue")}
      ${card("sun", "p", `<span class="pill-tag ${md.uv_max >= 8 ? "bad" : md.uv_max >= 6 ? "warn" : ""}">${uvLabel(md.uv_max)}</span>`, "Indice UV", `${md.uv}`, `Maximum ${md.uv_max} vers 13 h`,
        `<div class="wx-uv"><div class="wx-uv-bar"><i style="left:${Math.min(100, (md.uv / 11) * 100)}%"></i></div></div>`)}
      ${card("sprout", "g", `<span class="pill-tag ${tank < 25 ? "bad" : "info"}">Réservoir ${pct(tank)}</span>`, "Humidité du sol", `${d.humidite_moy} %`, `Moyenne de vos ${Object.keys(s.champs).length} parcelles`)}
    </div>`);

  const now = d.horaire[0];
  setHTML($("#wx-hourly"), `<div class="card-head"><h3>Heure par heure</h3><span class="muted small">Maintenant · ${s.ref.meteo[now.type].nom} · ${now.risque} % de pluie</span></div>
    <div class="wx-hours">${d.horaire.map((h, i) => {
      const nightH = h.h >= 21 || h.h < 6;
      const ic = nightH && (h.type === "soleil" || h.type === "canicule") ? "moon" : WEATHER_ICON[h.type];
      return `<div class="wx-hour ${i ? "" : "now"} ${wxCls(h.type)}">${h.heure}${icon(ic)}<b>${h.temp}°</b><small>${h.risque >= 25 ? `${h.risque} %` : ""}</small></div>`;
    }).join("")}</div>`);

  const wmin = Math.min(...d.semaine.map((w) => w.min)), wmax = Math.max(...d.semaine.map((w) => w.max));
  const pos = (t) => ((t - wmin) / (wmax - wmin || 1)) * 100;
  setHTML($("#wx-week"), `<div class="card-head"><h3>Prévisions 7 jours</h3><span class="muted small">${wmin}° – ${wmax}°</span></div>
    <ul class="wx-days">${d.semaine.map((w, i) => `<li class="wx-day ${i ? "" : "today"} ${wxCls(w.type)}">
      <div class="d">${w.jour}<small>${w.marche ? "🧺 Jour de marché" : w.nom}</small></div>${icon(WEATHER_ICON[w.type])}
      <span class="rk">${w.risque >= 25 ? `${w.risque} %` : ""}</span><span class="mn">${w.min}°</span>
      <div class="wx-range"><i style="left:${pos(w.min)}%;right:${100 - pos(w.max)}%"></i>${i ? "" : `<b style="left:${pos(Math.round(d.temperature))}%"></b>`}</div>
      <span class="mx">${w.max}°</span></li>`).join("")}</ul>`);

  const recos = farmAdvice(s, d);
  setHTML($("#wx-reco"), `<div class="card-head"><div><h3>Conseils pour la ferme</h3><div class="muted small">D'après vos cultures et les prévisions</div></div></div>
    <div class="wx-recos">${recos.map((r) => `<div class="wx-reco ${r.cls || ""}"><div class="wx-ic ${r.cls === "bad" ? "a" : r.cls === "info" ? "b" : "g"}">${icon(r.ic)}</div>
      <div><span class="when">${r.when}</span><h4>${r.title}</h4><p>${r.text}</p>
      ${r.btn ? `<button class="btn sm ${r.cls === "bad" ? "" : "green"}" ${A(r.btn.act)}>${r.btn.label}</button>` : ""}</div></div>`).join("")}</div>`);
}

// conseils concrets tirés de l'état de la ferme et des prévisions
function farmAdvice(s, d) {
  const out = [], week = d.semaine, name = (k) => d.noms_champs[k];
  const fields = Object.keys(s.champs);
  const growing = (k) => s.champs[k].planches.some((b) => ["seme", "pousse", "mur"].includes(b.etat));
  const rainSoon = week.slice(0, 3).findIndex((w) => w.risque >= 90);
  const dry = fields.filter((k) => growing(k) && s.champs[k].humidite < 50).sort((a, b) => s.champs[a].humidite - s.champs[b].humidite);
  if (dry.length) {
    const k = dry[0], f = s.champs[k];
    const rainHelps = !f.serre && rainSoon >= 0 && rainSoon <= 1 && f.humidite >= 25;
    if (rainHelps) {
      out.push({ cls: "info", ic: "rain", when: week[rainSoon].jour, title: "La pluie va arroser pour vous",
        text: `${name(k)} à ${Math.round(f.humidite)} % d'humidité, mais la pluie arrive ${lc(week[rainSoon].jour)}. Gardez l'eau du réservoir.` });
    } else if (!(d.pluie && !f.serre)) {
      const hot = ["soleil", "canicule"].includes(week[1].type);
      out.push({ cls: f.humidite < 25 ? "bad" : "warn", ic: "drop", when: f.humidite < 25 ? "Urgent" : "Aujourd'hui",
        title: `Arroser la ${name(k)}`,
        text: `Sol à ${Math.round(f.humidite)} %${f.humidite < 25 ? " : les plants flétrissent sous 15 %" : ""}.${hot ? " Demain s'annonce sec, l'arrosage tiendra mieux en début de journée." : ""}`,
        btn: s.reservoir.niveau >= 600 ? { label: `Arroser · 600 L`, act: { type: "arroser", champ: k } } : null });
    }
  }
  const stormIdx = week.findIndex((w, i) => i <= 2 && w.type === "orage");
  if (stormIdx >= 0) {
    const open = fields.filter((k) => !s.champs[k].serre);
    const ripe = open.filter((k) => s.champs[k].planches.some((b) => b.etat === "mur")), exposed = open.filter(growing);
    out.push({ cls: "bad", ic: "storm", when: week[stormIdx].jour, title: "Orage annoncé",
      text: ripe.length ? `Récoltez la ${name(ripe[0])} avant : l'orage abîme les cultures en plein champ.`
        : exposed.length ? "Il peut abîmer une parcelle en plein champ (−25 % de santé). Les serres protègent leurs cultures." : "Vos parcelles ne risquent rien pour l'instant.",
      btn: ripe.length ? { label: `Récolter la ${name(ripe[0])}`, act: { type: "recolter", champ: ripe[0], planche: s.champs[ripe[0]].planches.findIndex((b) => b.etat === "mur") } } : null });
  }
  const heatIdx = week.findIndex((w, i) => i <= 2 && w.type === "canicule");
  if (heatIdx >= 0) {
    out.push({ cls: "warn", ic: "heat", when: week[heatIdx].jour, title: "Canicule en vue",
      text: `Les sols sèchent deux fois plus vite et la pousse ralentit au-dessus de 34 °C.${s.ameliorations.includes("arrosage") ? " L'arrosage intelligent prendra le relais." : " Gardez de l'eau dans le réservoir."}` });
  }
  const mk = week.findIndex((w, i) => i <= 3 && w.marche && (i > 0 || d.heure_dec < s.ref.marche_heures[1]));
  if (mk >= 0) {
    const w = week[mk], wet = w.risque >= 90;
    out.push({ cls: wet ? "info" : "", ic: "store", when: `${w.jour} · ${s.ref.marche_heures[0]} h – ${s.ref.marche_heures[1]} h`,
      title: wet ? "Marché sous la pluie" : "Beau temps pour le marché",
      text: wet ? "Moins de clients quand il pleut : baissez un peu vos prix, ou vendez en gros." : "Les clients seront nombreux : remplissez votre étal avec des produits frais.",
      btn: { label: "Mon étal", act: { type: "goto", view: "marche" } } });
  }
  const windy = week.slice(0, 3).findIndex((w) => s.ref.meteo[w.type].vent >= .7);
  if (windy >= 0) {
    const gain = s.ref.batiments.eolienne.gain_max * s.ref.meteo[week[windy].type].vent;
    out.push(s.eoliennes
      ? { ic: "wind", when: week[windy].jour, title: "Journée venteuse", text: `Vos éoliennes rapporteront environ ${eur(gain * s.eoliennes)} ce jour-là.` }
      : { ic: "wind", when: week[windy].jour, title: "Du vent en vue", text: `Une éolienne rapporterait près de ${eur(gain)} ce jour-là. La coopérative en vend.`,
        btn: { label: "Voir la coopérative", act: { type: "goto", view: "marche" } } });
  }
  if (s.reservoir.niveau / s.reservoir.capacite < .25 && rainSoon < 0) {
    out.push({ cls: "bad", ic: "tank", when: "Réservoir", title: "Réservoir presque vide",
      text: "Pas de pluie dans les trois jours : arrosez seulement les parcelles qui en ont vraiment besoin." });
  }
  if (!out.length) out.push({ ic: "sparkle", when: "Cette semaine", title: "Rien à signaler", text: "Les prévisions sont calmes : c'est le bon moment pour semer." });
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- élevage
const moodEmo = (h) => (h >= 70 ? "😊" : h >= 40 ? "🙂" : h >= 20 ? "😕" : "😢");
const moodLbl = (h) => (h >= 70 ? "Heureux" : h >= 40 ? "Tranquille" : h >= 20 ? "Grognon" : "Malheureux");
const herdsOut = (s) => Object.values(s.animaux).filter((g) => g.liste.length && g.au_pre).length;
const herds = (s) => Object.values(s.animaux).filter((g) => g.liste.length).length;
const PROD_LBL = { lait: "L de lait", oeufs: "œufs", laine: "kg de laine", fumier: "kg de fumier" };

// boutons « pour tout le troupeau » : ramasser, nettoyer, sortir / rentrer
function herdButtons(s, d) {
  const toCollect = Object.entries(d.a_ramasser).some(([c, q]) => s.animaux[c].liste.length && q >= (c === "poules" ? 1 : 0.1));
  const out = herdsOut(s), all = herds(s);
  const dirty = Object.values(s.animaux).some((g) => g.liste.length && g.proprete <= 95);
  const robot = s.technologies.includes("robot_traite");
  return `${robot ? "" : `<button class="btn ${toCollect ? "green" : "ghost"}" ${A({ type: "ramasser" })} ${toCollect ? "" : "disabled"}>${icon("basket")}Tout ramasser</button>`}
    <button class="btn ${d.proprete < s.ref.enclos_sale + 15 ? "" : "ghost"}" ${A({ type: "nettoyer" })} ${dirty ? "" : "disabled"}>${icon("shovel")}Nettoyer les enclos</button>
    ${out ? `<button class="btn ${d.nuit ? "red" : "ghost"}" ${A({ type: "sortir", dehors: false })}>${icon("house")}Rentrer tout le monde</button>`
      : `<button class="btn ghost" ${A({ type: "sortir", dehors: true })} ${all ? "" : "disabled"}>${icon("sun")}Sortir tout le monde</button>`}`;
}

function renderLivestock(s, d) {
  const allOk = d.malades === 0, empty = d.n_animaux === 0;
  setHTML($("#live-summary"), empty
    ? `<div class="live-top"><div><div class="card-kicker">Total du troupeau</div><div class="live-count">0</div><div class="muted small">animaux</div></div>
        <span class="pill-tag grey">Élevage vide</span></div>
        <div class="muted small">Vous démarrez sans bêtes. Choisissez une catégorie ci-dessous et achetez vos premiers animaux :
        des poules pour les œufs (pas chères), une vache pour le lait, un cochon pour le fumier…</div>`
    : `<div class="live-top"><div><div class="card-kicker">Total du troupeau</div><div class="live-count">${d.n_animaux}</div><div class="muted small">animaux</div></div>
    <span class="pill-tag ${allOk ? "" : "bad"}">${allOk ? "Tous en bonne santé" : `${d.malades} animal(aux) malade(s)`}</span></div>
    <div class="live-rings">
      <div><div class="ring-wrap sm">${ring(d.sante_animaux, "#2F7A4B", 76, 8)}</div><div class="lbl">Santé</div><div class="sub">moyenne</div></div>
      <div><div class="ring-wrap sm">${ring(d.nourriture, "#E9A93A", 76, 8)}</div><div class="lbl">Nourriture</div><div class="sub">satiété</div></div>
      <div><div class="ring-wrap sm">${ring(d.production, "#3C8CD6", 76, 8)}</div><div class="lbl">Production</div><div class="sub">rendement</div></div>
    </div>
    ${meter(`Humeur ${moodEmo(d.humeur)}`, d.humeur, barCls(d.humeur), `${moodLbl(d.humeur)} · ${pct(d.humeur)}`)}
    ${meter("Propreté des enclos", d.proprete, d.proprete < s.ref.enclos_sale ? "red" : d.proprete < 60 ? "amber" : "", d.proprete < s.ref.enclos_sale ? "sale : les bêtes tombent malades" : pct(d.proprete))}
    ${d.nuit && herdsOut(s) ? `<div class="note warn">${icon("alert")}<span>Il fait nuit et des bêtes sont encore dehors : rentrez-les !</span></div>` : ""}
    <div class="actions">${herdButtons(s, d)}
    ${d.malades ? `<button class="btn" ${A({ type: "soigner" })}>${icon("vet")}Appeler le vétérinaire · ${d.malades * s.ref.prix_veto} €</button>` : ""}</div>`);

  const lbl = { fait: "Fait", maintenant: "Maintenant", manque: "Manqué", a_venir: "À venir" };
  const auto = s.ameliorations.includes("distributeur");
  setHTML($("#feeding"), `<div class="feed-head"><div class="feed-ico">${icon("wheat")}</div><div><h3>Repas du jour</h3><div class="muted small">${empty ? "Pas encore de bêtes à nourrir" : auto ? "Distributeur automatique actif" : "Nourrissez le troupeau à chaque repas"}</div></div></div>
    <div class="timeline">${d.repas.map((r) => { const st = empty ? "a_venir" : r.statut; return `<div class="tl ${st}"><div class="tl-dot">${st === "fait" ? icon("check") : st === "manque" ? icon("x") : icon("clock") || ""}</div>
      <div class="tl-time">${r.heure}</div><div class="tl-menu">${r.menu}</div><div class="tl-state">${empty ? "—" : lbl[st]}</div></div>`; }).join("")}</div>
    <div class="feed-foot"><div class="muted small">Ration : <b>${d.ration} kg</b> · Stock : <b>${nf0.format(s.stock.foin_bio)} kg</b> de foin bio, ${nf0.format(s.stock.foin)} kg de foin, ${nf0.format(s.stock.mais)} kg de maïs<br>
      ${empty ? "Le foin se garde : il servira quand vous aurez des bêtes." : `Dernier repas ${s.repas_bio >= .99 ? "🌿 100 % bio" : `${pct(s.repas_bio * 100)} bio`} · le foin bio est servi en premier. Au pré, les bêtes ont moins faim.`}</div>
    <button class="btn green" ${A({ type: "nourrir" })} ${empty ? "disabled" : ""}>${icon("bowl")}Nourrir</button></div>`);

  setHTML($("#cats"), Object.entries(s.animaux).map(([k, g]) => {
    const ref = s.ref.animaux[k], n = g.liste.length;
    const p = s.stats.hier[ref.produit] ?? s.stats.production_jour[ref.produit] ?? 0;
    const wait = d.a_ramasser[k], flags = [];
    if (n && g.au_pre) flags.push(`<span class="pill-tag info">${icon("sun")}${s.ref.soins[k].pre}</span>`);
    if (n && wait >= (k === "poules" ? 1 : 0.1) && !s.technologies.includes("robot_traite")) flags.push(`<span class="pill-tag warn">🧺 ${qf(wait)} ${PROD_LBL[ref.produit]}</span>`);
    if (n && g.proprete < s.ref.enclos_sale) flags.push(`<span class="pill-tag bad">🧹 Sale</span>`);
    return `<button class="cat ${cat === k ? "active" : ""}" ${A({ type: "cat", cat: k })}><div class="cat-art">${ART.side[k]}</div>
      <div class="cat-n">${n}${n ? ` <span class="cat-mood" title="Humeur">${moodEmo(d.humeur_animaux[k])}</span>` : ""}</div><div class="cat-name">${ref.nom}</div>
      <div class="cat-prod">${n ? `${qf(p)} ${PROD_LBL[ref.produit]} / j` : `${nf0.format(ref.prix)} € l'unité`}</div>
      ${n ? `<div class="cat-q">${qualityTag(d.qualite_animaux[k])}</div>` : ""}${flags.length ? `<div class="tags">${flags.join("")}</div>` : ""}</button>`;
  }).join(""));

  const g = s.animaux[cat], ref = s.ref.animaux[cat], prices = d.prix_animaux[cat], soin = s.ref.soins[cat];
  const unite = ref.unite[0].toUpperCase() + ref.unite.slice(1);
  const rows = g.liste.map((a, i) => {
    const ready = d.calin_pret[a.id];
    return `<div class="arow"><div class="arow-ico">${ART.side[cat]}</div>
      <div><div class="arow-name">${a.nom} <span title="${moodLbl(a.humeur)}">${moodEmo(a.humeur)}</span></div><div class="arow-sub">${unite} · n°${a.id.slice(2)}</div></div>
      <div class="bar ${barCls(a.sante)}" title="Santé ${pct(a.sante)}"><i style="width:${a.sante}%"></i></div>
      <span class="pill-tag ${a.sante >= 70 ? "" : a.sante >= 50 ? "warn" : "bad"}">${a.sante >= 70 ? "En forme" : a.sante >= 50 ? "Fatigué" : "Malade"}</span>
      <div class="arow-btns"><button class="btn sm ${ready ? "" : "ghost"}" title="${ready ? `${soin.calin} ${a.nom}` : "Déjà câliné, repassez plus tard"}" ${A({ type: "caliner", categorie: cat, id: a.id })} ${ready ? "" : "disabled"}>${icon("heart")}</button>
      <button class="btn ghost sm" title="Vendre au marché aux bestiaux" ${A({ type: "vendre_animal", categorie: cat, id: a.id })}>Vendre · ${eur(prices[i])}</button></div></div>`;
  }).join("");
  const prodNom = s.ref.produits[ref.produit].nom.toLowerCase();
  setHTML($("#animal-list"), `<div class="card-head"><div><h3>Vos ${ref.nom.toLowerCase()}</h3>
      <div class="muted small">Produit : ${emoji(s, ref.produit)} ${prodNom} · qualité selon leur santé, leurs repas et leur humeur. Vendre l'animal ou garder sa production : à vous de voir.</div></div>
    <div class="head-btns"><button class="btn sm" ${A({ type: "acheter", article: cat, quantite: 1 })}>${icon("plus")}Acheter · ${nf0.format(ref.prix)} €</button></div></div>
    ${g.liste.length ? careBox(s, d, cat) : ""}
    <div class="animal-rows">${rows || `<div class="muted">Aucun animal dans cette catégorie. Achetez-en un pour commencer !</div>`}</div>`);
}

// soins d'un enclos : ramasser la production, nettoyer, sortir, câliner tout le monde
function careBox(s, d, k) {
  const g = s.animaux[k], ref = s.ref.animaux[k], soin = s.ref.soins[k];
  const wait = d.a_ramasser[k], max = d.ramassage_max[k], robot = s.technologies.includes("robot_traite");
  const anyReady = g.liste.some((a) => d.calin_pret[a.id]);
  const collect = robot
    ? `<div class="care"><div class="care-top"><b>${emoji(s, ref.produit)} ${soin.ramasser}</b></div><div class="muted small">🥛 Le robot de traite s'en charge tout seul.</div></div>`
    : `<div class="care"><div class="care-top"><b>${emoji(s, ref.produit)} ${soin.ramasser}</b><span class="muted small">${qf(wait)} ${PROD_LBL[ref.produit]} en attente</span></div>
        <div class="bar ${wait >= max * .95 ? "red" : wait >= max * .6 ? "amber" : ""}"><i style="width:${max ? Math.min(100, (wait / max) * 100) : 0}%"></i></div>
        <div class="muted small">${wait >= max * .95 ? "Plein : la production est perdue tant que vous ne passez pas !" : "Au-delà d'une journée d'attente, la production est perdue."}</div>
        <button class="btn sm ${wait >= max * .3 ? "green" : "ghost"}" ${A({ type: "ramasser", categorie: k })} ${wait >= (k === "poules" ? 1 : 0.05) ? "" : "disabled"}>${icon("basket")}${soin.ramasser}</button></div>`;
  return `<div class="care-grid">${collect}
    <div class="care"><div class="care-top"><b>🧹 Nettoyer ${soin.enclos}</b><span class="muted small">${pct(g.proprete)}</span></div>
      <div class="bar ${g.proprete < s.ref.enclos_sale ? "red" : g.proprete < 60 ? "amber" : ""}"><i style="width:${g.proprete}%"></i></div>
      <div class="muted small">${g.proprete < s.ref.enclos_sale ? "Litière sale : les bêtes tombent malades." : "Une litière propre garde les bêtes en bonne santé. Le fumier part au tas."}</div>
      <button class="btn sm ${g.proprete < 60 ? "" : "ghost"}" ${A({ type: "nettoyer", categorie: k })} ${g.proprete > 95 ? "disabled" : ""}>${icon("shovel")}Changer la litière</button></div>
    <div class="care"><div class="care-top"><b>${g.au_pre ? "🌳" : "🏠"} ${g.au_pre ? `Dehors, ${soin.pre}` : "À l'abri"}</b></div>
      <div class="muted small">${g.au_pre ? (d.nuit ? "Il fait nuit : rentrez-les vite !" : "Ils broutent (moins faim) et sont de bonne humeur. À rentrer le soir.") : `Sortis ${soin.pre}, ils ont moins faim et le moral remonte.${k === "poules" ? " Attention au renard la nuit." : ""}`}</div>
      <button class="btn sm ${g.au_pre && d.nuit ? "red" : "ghost"}" ${A({ type: "sortir", categorie: k, dehors: !g.au_pre })}>${icon(g.au_pre ? "house" : "sun")}${g.au_pre ? "Rentrer" : `Sortir ${soin.pre}`}</button></div>
    <div class="care"><div class="care-top"><b>${moodEmo(d.humeur_animaux[k])} Humeur</b><span class="muted small">${moodLbl(d.humeur_animaux[k])}</span></div>
      <div class="bar ${barCls(d.humeur_animaux[k])}"><i style="width:${d.humeur_animaux[k]}%"></i></div>
      <div class="muted small">Des bêtes heureuses produisent plus (+10 %) et mieux.</div>
      <button class="btn sm ${anyReady ? "" : "ghost"}" ${A({ type: "caliner", categorie: k })} ${anyReady ? "" : "disabled"}>${icon("heart")}${soin.calin} tout le monde</button></div></div>`;
}

// ---------------------------------------------------------------- marché
const STALL_TIPS = [
  "Les clients regardent la qualité : des récoltes cueillies à temps et un sol bien arrosé valent plus cher.",
  "Le bio se vend 30 % plus cher au marché : fumier plutôt qu'engrais chimique, foin bio pour les bêtes.",
  "Le lait et les salades s'abîment vite : vendez-les au plus tôt, ou laissez le camion de la fromagerie passer.",
  "Un étal varié attire plus de monde. Et une bonne réputation fait revenir les clients.",
  "Trop cher, les clients passent leur chemin… et votre réputation en pâtit un peu.",
  "Les abeilles pollinisent vos cultures : jusqu'à +15 % de récolte avec trois ruches.",
  "Il y a moins de monde au marché quand il pleut.",
];

// emojis des produits en vente sur votre étal, du plus précieux au moins précieux (pour la carte)
function myGoods(s) {
  return Object.keys(s.ref.produits)
    .filter((k) => s.derive.produits[k].en_vente)
    .sort((a, b) => s.stock[b] * s.derive.produits[b].prix_etal - s.stock[a] * s.derive.produits[a].prix_etal)
    .slice(0, 6).map((k) => emoji(s, k));
}

function trend(s, k) {
  const diff = ((s.prix[k] - s.prix_hier[k]) / s.prix_hier[k]) * 100;
  return Math.abs(diff) < 0.5 ? "" : `<span class="trend ${diff > 0 ? "up" : "down"}">${diff > 0 ? "▲" : "▼"} ${Math.abs(diff).toFixed(0)}%</span>`;
}

const priceFmt = (v) => (v < 1 ? nf2.format(v) : nf2.format(v));

// vente en gros à un marchand (immédiate, moins chère qu'au marché)
function sellRow(s, k) {
  const d = s.derive, p = s.ref.produits[k], info = d.produits[k];
  const buyer = s.ref.acheteurs[p.grossiste];
  const qty = k === "oeufs" ? Math.floor(s.stock[k]) : s.stock[k];
  const away = buyer.marche && !d.marche_ouvert;
  const ok = qty >= 1 && !away;
  return `<div class="buy-row"><span class="prod-dot">${emoji(s, k)}</span><div class="grow"><b>${p.nom}</b>
    <span class="muted small">${qf(qty)} ${p.unite} · en gros ${priceFmt(info.prix_gros)} €/${p.unite}${trend(s, k)}</span>
    ${qty >= 1 ? `<div class="tags">${qualityTag(info.qualite)}${bioTag(info.bio)}</div>` : ""}</div>
    <button class="btn sm ${ok ? "" : "ghost"}" ${ok ? "" : "disabled"} ${A({ type: "vendre", produit: k })}>${away ? "Jour de marché" : `Vendre · ${eur(qty * info.prix_gros)}`}</button></div>`;
}

function shopRow(ic, nom, sub, btn) {
  return `<div class="buy-row"><span class="prod-dot ic">${icon(ic)}</span><div class="grow"><b>${nom}</b><span class="muted small">${sub}</span></div>${btn}</div>`;
}

// ce que les clients pensent du prix affiché
function priceVerdict(chance) {
  if (chance >= 0.85) return ["Bon marché", "info"];
  if (chance >= 0.55) return ["Juste prix", ""];
  if (chance >= 0.3) return ["Un peu cher", "warn"];
  return ["Trop cher", "bad"];
}

function stallRow(s, k) {
  const d = s.derive, p = s.ref.produits[k], info = d.produits[k], e = s.etal[k];
  const price = info.prix_etal, step = Math.max(0.01, Math.round(price * 5) / 100);
  const [verdict, vcls] = priceVerdict(info.chance);
  const custom = e.prix !== null;
  return `<div class="etal-row ${e.actif ? "" : "off"}">
    <span class="prod-dot">${emoji(s, k)}</span>
    <div class="grow"><b>${p.nom} <span class="muted small">· ${qf(s.stock[k])} ${p.unite}</span></b>
      <div class="tags">${qualityTag(info.qualite, info.label)}${bioTag(info.bio)}</div></div>
    <button class="switch ${e.actif ? "on" : ""}" title="${e.actif ? "Retirer de l'étal" : "Mettre en vente"}" ${A({ type: "etal", produit: k, actif: !e.actif })}><i></i></button>
    <div class="etal-price">
      ${e.actif ? `<div class="price-ctl">
        <button ${A({ type: "etal", produit: k, prix: Math.max(0.01, +(price - step).toFixed(2)) })} title="Baisser le prix">−</button>
        <span><b>${priceFmt(price)} €</b>/${p.unite}</span>
        <button ${A({ type: "etal", produit: k, prix: +(price + step).toFixed(2) })} title="Monter le prix">+</button></div>
        <div class="price-sub"><span class="pill-tag ${vcls}">${verdict}</span>
          ${custom ? `<button class="link" ${A({ type: "etal", produit: k, prix: null })}>Prix conseillé (${priceFmt(info.prix_juste)} €)</button>` : `<span class="muted small">Prix conseillé</span>`}</div>`
      : `<span class="muted small">Pas en vente · gardé à la ferme</span>`}
    </div>
  </div>`;
}

function myStallPanel(s, d, card, head) {
  const mk = s.marche;
  const keys = Object.keys(s.ref.produits).filter((k) => s.stock[k] >= (k === "oeufs" ? 1 : 0.2))
    .sort((a, b) => (s.etal[b].actif - s.etal[a].actif) || s.stock[b] * s.prix[b] - s.stock[a] * s.prix[a]);
  const status = d.marche_ouvert
    ? `<span class="pill-tag">${icon("store")} Ouvert · ${nf1.format(d.clients_heure)} clients/h</span>`
    : `<span class="pill-tag grey">Fermé</span>`;
  const today = mk.jour === d.jour && mk.etat !== "ferme";
  const kv = `<div class="kv"><div><b>${d.marche_ouvert || today ? mk.clients : "—"}</b><span>Clients ${today ? "aujourd'hui" : ""}</span></div>
    <div><b>${today ? eur(mk.recette) : "—"}</b><span>Recette du jour</span></div><div><b>${Math.round(s.reputation)}</b><span>Réputation</span></div></div>`;
  const when = d.marche_ouvert ? `Les clients achètent tout seuls jusqu'à ${s.ref.marche_heures[1]} h.`
    : `Prochain marché : <b>${d.prochain_marche}</b> (${d.jours_marche.join(", ").toLowerCase()}, ${s.ref.marche_heures[0]} h – ${s.ref.marche_heures[1]} h).`;
  const rows = keys.map((k) => stallRow(s, k)).join("") || `<div class="muted small">Rien à vendre : récoltez, ramassez les œufs, installez des ruches…</div>`;
  const sales = mk.dernieres.length && today
    ? `<ul class="mini-list sales">${mk.dernieres.map((v) => `<li>${v.heure} · ${emoji(s, v.produit)} ${qf(v.qte)} ${unitOf(s, v.produit)} de ${s.ref.produits[v.produit].nom.toLowerCase()}<span>+${nf2.format(v.montant)} €</span></li>`).join("")}</ul>`
    : `<div class="muted small">${d.marche_ouvert ? "Les premiers clients arrivent…" : "Les ventes du prochain marché s'afficheront ici."}</div>`;
  return card(`${head("Votre stand · Ferme du Val Vert", status)}${kv}
      ${meter("Réputation", s.reputation, barCls(s.reputation), `${Math.round(s.reputation)}/100`)}
      <div class="muted small" style="margin:6px 0 4px">${when} Ils comparent votre prix à la qualité : bio et belle qualité se vendent plus cher.</div>`)
    + card(`<div class="card-head"><h3>Sur l'étal</h3><span class="muted small">prix par unité</span></div><div class="etal-list">${rows}</div>
      <div class="muted small" style="margin-top:10px">Ce qui ne part pas au marché peut se vendre en gros aux marchands (moins cher), tous les jours.</div>`)
    + card(`<div class="card-head"><h3>Dernières ventes</h3>${today && mk.acheteurs ? `<span class="muted small">${mk.acheteurs} acheteur(s)</span>` : ""}</div>${sales}`);
}

function stallPanel(s, d, id) {
  const st = MarketMap.STALLS[id];
  const card = (body) => `<div class="zone-card">${body}</div>`;
  const head = (sub, tag = "") => `<div class="zone-top"><div class="zone-ico emo">${st.emoji}</div><div><div class="zone-name">${st.nom}</div><div class="muted small">${sub}</div></div>${tag}</div>`;
  const quote = (txt) => `<div class="quote"><b>${st.vendeur} :</b> « ${txt} »</div>`;
  const absent = MarketMap.TEMPORARY.includes(id) && !d.marche_ouvert;
  const closedTag = absent ? `<span class="pill-tag grey">${d.prochain_marche}</span>` : "";

  if (id === "mon_etal") return myStallPanel(s, d, card, head);
  if (id === "grainetier") {
    const perDay = d.ration * 3;
    const days = perDay ? (s.stock.foin + s.stock.foin_bio + s.stock.mais) / perDay : 0;
    const hay = (art, nom, prix, sub) => `<div class="buy-row"><span class="prod-dot">${emoji(s, art)}</span><div class="grow"><b>${nom}</b><span class="muted small">${nf2.format(prix)} €/kg · ${sub}</span></div>
        <button class="btn ghost sm" ${A({ type: "acheter", article: art, quantite: 200 })}>200 kg · ${eur(200 * prix)}</button>
        <button class="btn sm" ${A({ type: "acheter", article: art, quantite: 1000 })}>1 t · ${eur(1000 * prix)}</button></div>`;
    return card(`${head(`Tenu par ${st.vendeur} · ouvert tous les jours`)}${quote(days < 2 ? "Vos bêtes vont bientôt manquer, faites le plein !" : "Le foin bio coûte un peu plus, mais votre lait se vendra mieux.")}
      <div class="kv"><div><b>${nf0.format(s.stock.foin + s.stock.foin_bio)} kg</b><span>Foin</span></div><div><b>${nf0.format(perDay)} kg</b><span>Besoin / jour</span></div><div><b>${nf1.format(days)} j</b><span>Autonomie</span></div></div>
      ${hay("foin_bio", "Foin bio", s.ref.prix_foin_bio, `stock ${nf0.format(s.stock.foin_bio)} kg · servi en premier`)}
      ${hay("foin", "Foin", s.ref.prix_foin, `stock ${nf0.format(s.stock.foin)} kg`)}`)
      + card(`<div class="card-head"><h3>Il vous achète</h3></div>${sellRow(s, "mais")}`);
  }
  if (id === "bestiaux") {
    const rows = Object.entries(s.ref.animaux).map(([k, a]) => {
      const prices = d.prix_animaux[k], n = prices.length, low = n ? Math.min(...prices) : 0;
      return `<div class="buy-row"><span class="prod-dot">${ART.side[k]}</span><div class="grow"><b>${a.nom}</b><span class="muted small">${n} à la ferme · ${a.ration} kg / repas</span></div>
        <button class="btn ghost sm" ${A({ type: "vendre_animal", categorie: k })} ${n ? "" : "disabled"} title="Vend l'animal le moins en forme">Vendre · ${eur(low)}</button>
        <button class="btn sm" ${A({ type: "acheter", article: k, quantite: 1 })} ${s.argent < a.prix ? "disabled" : ""}>Acheter · ${eur(a.prix)}</button></div>`;
    }).join("");
    return card(`${head(`Tenu par ${st.vendeur} · ouvert tous les jours`)}${quote("J'achète et je vends. Une bête en bonne santé, je la paie plus cher !")}${rows}
      <div class="muted small" style="margin-top:8px">« Vendre » cède l'animal le moins en forme. Pour en choisir un, passez par l'Élevage.</div>
      <div class="actions"><button class="btn ghost" ${A({ type: "goto", view: "elevage" })}>Voir mon élevage</button></div>`);
  }
  if (id === "artisan") {
    const eo = s.ref.batiments.eolienne, se = s.ref.batiments.serre, ru = s.ref.batiments.ruche;
    const upIcons = { arrosage: "drop", distributeur: "bowl", reservoir: "tank", cloture: "fence", tracteur: "tractor" };
    const done = `<span class="pill-tag">${icon("check")} Installé</span>`;
    let rows = shopRow("bee", `Ruche · ${s.ruches} / ${ru.max}`, `miel + pollinisation (+5 % de récolte par ruche)`,
      s.ruches >= ru.max ? done : `<button class="btn sm" ${A({ type: "construire", batiment: "ruche" })} ${s.argent < ru.prix ? "disabled" : ""}>${eur(ru.prix)}</button>`);
    rows += shopRow("wind", `Éolienne · ${s.eoliennes} / ${eo.max}`, `jusqu'à ${eo.gain_max} €/jour selon le vent`,
      s.eoliennes >= eo.max ? done : `<button class="btn sm" ${A({ type: "construire", batiment: "eolienne" })} ${s.argent < eo.prix ? "disabled" : ""}>${eur(eo.prix)}</button>`);
    rows += shopRow(d.serre_debloquee ? "greenhouse" : "lock", `Serre · ${d.n_serres} / ${FarmMap.FIELDS.length}`,
      d.serre_debloquee ? `${eur(se.prix)} · à construire sur une parcelle libre` : `après ${nf0.format(se.ventes_requises)} € de ventes (${eur(s.stats.ventes)})`,
      d.serre_debloquee ? `<button class="btn ghost sm" ${A({ type: "goto", view: "ferme" })}>Ma ferme</button>` : `<span class="pill-tag grey">Verrouillée</span>`);
    const t = d.terrain_a_vendre;
    rows += shopRow("plus", `Terrain · ${Object.keys(s.champs).length} / ${s.ref.terrains_max} parcelles`,
      t ? `${t.nom} · ${s.ref.terrain_entretien} €/jour d'entretien` : "Tous les terrains sont achetés",
      t ? `<button class="btn sm" ${A({ type: "acheter_parcelle" })} ${s.argent < t.prix ? "disabled" : ""}>${eur(t.prix)}</button>` : done);
    rows += Object.entries(s.ref.technologies).map(([k, x]) => shopRow(TECH_ICON[k], `${x.emoji} ${x.nom}`, `${x.desc} Entretien ${x.entretien} €/jour.`,
      s.technologies.includes(k) ? done : `<button class="btn sm" ${A({ type: "technologie", tech: k })} ${s.argent < x.prix ? "disabled" : ""}>${eur(x.prix)}</button>`)).join("");
    rows += Object.entries(s.ref.ameliorations).map(([k, u]) => shopRow(upIcons[k], u.nom, u.desc,
      s.ameliorations.includes(k) ? done : `<button class="btn sm" ${A({ type: "ameliorer", amelioration: k })} ${s.argent < u.prix ? "disabled" : ""}>${eur(u.prix)}</button>`)).join("");
    const pitch = !s.ruches ? "Des ruches ? Vos fraises vous diront merci, et le miel se vend bien !"
      : !s.eoliennes ? "Une éolienne, ça vous tente ? Elle se rembourse toute seule !"
        : !d.serre_debloquee ? "Vendez encore un peu et je vous construis une serre." : "Tout pour moderniser votre ferme !";
    return card(`${head(`Tenu par ${st.vendeur} · ouvert tous les jours`)}${quote(pitch)}<div class="sell-list">${rows}</div>`)
      + card(`<div class="card-head"><h3>Elle vous achète</h3></div>${sellRow(s, "laine")}`);
  }
  if (id === "fromager") {
    const c = s.collecte_lait;
    return card(`${head(`Tenu par ${st.vendeur} · ouvert tous les jours`)}${quote(`Votre lait m'intéresse ! S'il est frais et bio, je le paie mieux.`)}${sellRow(s, "lait")}
      <div class="collect"><div><b>Collecte chaque soir à ${s.ref.collecte_heure} h</b><div class="muted small">${c ? "Mon camion passe prendre tout votre lait au prix de gros." : "Arrêtée : gardez votre lait pour le marché (attention, il tourne vite)."}</div></div>
        <button class="switch ${c ? "on" : ""}" ${A({ type: "collecte", actif: !c })}><i></i></button></div>`);
  }
  if (id === "boulanger") {
    return card(`${head(`Tenue par ${st.vendeur} · ouvert tous les jours`)}${quote("Des œufs frais pour mes brioches et du miel pour mes pains d'épices, je prends !")}${sellRow(s, "oeufs")}${sellRow(s, "miel")}`);
  }
  if (id === "fleuriste") {
    const fc = s.previsions.slice(0, 3).map((p, i) => `<div class="fc">${["Demain", "J+2", "J+3"][i]}${icon(WEATHER_ICON[p.type])}${p.temp}°</div>`).join("");
    return card(`${head(`Tenue par ${st.vendeur} · les jours de marché`, closedTag)}${quote(absent ? "Je reviens au prochain marché avec mes bouquets !" : "Mes fleurs sentent la météo mieux que la radio. Et votre fumier ferait du bien à mes massifs !")}
      <div class="forecast stall-fc">${fc}</div>${sellRow(s, "fumier")}`);
  }
  if (id === "maraicher") {
    const ranking = Object.keys(s.ref.cultures).map((k) => [k, s.prix[k] / s.ref.cultures[k].prix])
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, r]) => `<li>${emoji(s, k)} ${s.ref.cultures[k].nom}<span>${r >= 1 ? "+" : ""}${Math.round((r - 1) * 100)} % vs normal${trend(s, k)}</span></li>`).join("");
    const mine = Object.keys(s.ref.cultures).filter((k) => k !== "mais" && s.stock[k] >= 1);
    return card(`${head(`${st.vendeur}, votre concurrent · les jours de marché`, closedTag)}${quote(absent ? "Pas de marché aujourd'hui, l'ami ! On se voit au prochain." : "Hé, le voisin ! Ce qui vous reste, je vous le rachète en gros… à mon prix.")}
      <div class="card-head" style="margin:6px 0 0"><h3>Ce qui se vend bien</h3></div><ul class="mini-list">${ranking}</ul>`)
      + card(`<div class="card-head"><h3>Il vous rachète en gros</h3></div>${mine.map((k) => sellRow(s, k)).join("") || `<div class="muted small">Aucun fruit ni légume en stock.</div>`}`);
  }
  // poissonnier
  return card(`${head(`Tenu par ${st.vendeur} · les jours de marché`, closedTag)}${quote(absent ? "Le poisson, c'est mardi, jeudi et samedi ! Un conseil quand même :" : "Pas de poisson à la ferme, hein ? Allez, un conseil gratuit :")}
    <div class="tip">${icon("sparkle")}${STALL_TIPS[Math.floor(d.jour) % STALL_TIPS.length]}</div>`);
}

// chaque nouvelle vente d'un client fait tinter la caisse au-dessus de votre étal
let lastSaleKey = null;
function notifySales(s) {
  const v = s.marche.dernieres;
  const key = (x) => `${s.marche.jour}|${x.heure}|${x.produit}|${x.montant}`;
  if (lastSaleKey === null) { lastSaleKey = v.length ? key(v[0]) : ""; return; }
  const fresh = [];
  for (const x of v) { if (key(x) === lastSaleKey) break; fresh.push(x); }
  if (!fresh.length) return;
  lastSaleKey = key(v[0]);
  const total = fresh.reduce((a, x) => a + x.montant, 0);
  MarketMap.celebrate(`+${nf2.format(total)} €`, fresh.slice(0, 3).map((x) => emoji(s, x.produit)));
}

let stall = "mon_etal";
function selectStall(id) {
  stall = id;
  MarketMap.select(id);
  enterAnim($("#stall-panel"));
  if (S) render(S);
}

function renderMarket(s, d) {
  setHTML($("#stall-panel"), stallPanel(s, d, stall));
  $("#market-hint-sub").textContent = d.marche_ouvert
    ? `${d.jour_semaine}, jour de marché jusqu'à ${s.ref.marche_heures[1]} h · ${MarketMap.crowdSize()} visiteurs sur la place`
    : `Marché fermé · prochain : ${d.prochain_marche} · les boutiques restent ouvertes`;

  setHTML($("#tech"), techCard(s, d, false));
  const upIcons = { arrosage: "drop", distributeur: "bowl", reservoir: "tank", cloture: "fence", tracteur: "tractor" };
  setHTML($("#upgrades"), Object.entries(s.ref.ameliorations).map(([k, u]) => {
    const owned = s.ameliorations.includes(k);
    return `<div class="upg ${owned ? "owned" : ""}"><div class="zone-ico">${icon(upIcons[k])}</div><h4>${u.nom}</h4><p>${u.desc}</p>
      ${owned ? `<span class="pill-tag">${icon("check")} Installé</span>` : `<button class="btn" ${A({ type: "ameliorer", amelioration: k })} ${s.argent < u.prix ? "disabled" : ""}>Acheter · ${eur(u.prix)}</button>`}</div>`;
  }).join(""));

  const eo = s.ref.batiments.eolienne, se = s.ref.batiments.serre;
  const eoBtn = s.eoliennes >= eo.max ? `<span class="pill-tag">${icon("check")} ${eo.max} / ${eo.max} installées</span>`
    : `<button class="btn" ${A({ type: "construire", batiment: "eolienne" })} ${s.argent < eo.prix ? "disabled" : ""}>Acheter · ${eur(eo.prix)}</button>`;
  let seBody;
  if (!d.serre_debloquee) {
    seBody = `${meter("Ventes cumulées", (s.stats.ventes / se.ventes_requises) * 100, "", `${eur(s.stats.ventes)} / ${nf0.format(se.ventes_requises)} €`)}
      <span class="pill-tag grey">${icon("lock")} Débloquée à ${nf0.format(se.ventes_requises)} € de ventes</span>`;
  } else {
    const targets = FarmMap.FIELDS.filter((k) => !s.champs[k].serre);
    seBody = targets.length ? `<div class="actions">${targets.map((k) => {
      const free = s.champs[k].planches.every(bedFree);
      return `<button class="btn sm" ${A({ type: "construire", batiment: "serre", champ: k })} ${!free || s.argent < se.prix ? "disabled" : ""} title="${free ? "" : "Parcelle occupée : récoltez d'abord"}">${d.noms_champs[k]}</button>`;
    }).join("")}</div><span class="muted small">${eur(se.prix)} · la parcelle doit être libre</span>`
      : `<span class="pill-tag">${icon("check")} Toutes les parcelles sont sous serre</span>`;
  }
  const ru = s.ref.batiments.ruche;
  const ruBtn = s.ruches >= ru.max ? `<span class="pill-tag">${icon("check")} ${ru.max} / ${ru.max} installées</span>`
    : `<button class="btn" ${A({ type: "construire", batiment: "ruche" })} ${s.argent < ru.prix ? "disabled" : ""}>Acheter · ${eur(ru.prix)}</button>`;
  const tv = d.terrain_a_vendre, nParc = Object.keys(s.champs).length;
  const terrain = `<div class="upg ${nParc > 3 ? "owned" : ""}"><div class="zone-ico" style="background:var(--green-soft);color:var(--green)">${icon("plus")}</div>
      <h4>Nouvelle parcelle <span class="muted small">${nParc} / ${s.ref.terrains_max}</span></h4>
      <p>Agrandissez la ferme : un terrain de 1 ha à semer comme vous voulez. Entretien ${s.ref.terrain_entretien} €/jour.</p>
      ${tv ? `<button class="btn" ${A({ type: "acheter_parcelle" })} ${s.argent < tv.prix ? "disabled" : ""}>${tv.nom} · ${eur(tv.prix)}</button>` : `<span class="pill-tag">${icon("check")} Tout est acheté</span>`}</div>`;
  setHTML($("#buildings"), `${terrain}<div class="upg ${s.ruches ? "owned" : ""}"><div class="zone-ico">${icon("bee")}</div><h4>Ruche <span class="muted small">${s.ruches} / ${ru.max}</span></h4>
      <p>${ru.desc} ${s.ruches ? `Aujourd'hui : ${nf1.format(d.miel_jour)} kg de miel.` : ""}</p>${ruBtn}</div>
    <div class="upg ${s.eoliennes ? "owned" : ""}"><div class="zone-ico">${icon("wind")}</div><h4>Éolienne <span class="muted small">${s.eoliennes} / ${eo.max}</span></h4>
      <p>${eo.desc} Aujourd'hui : ${eur(eo.gain_max * d.vent)} / jour chacune.</p>${eoBtn}</div>
    <div class="upg ${d.n_serres ? "owned" : ""} ${d.serre_debloquee ? "" : "locked"}"><div class="zone-ico glass">${icon("greenhouse")}</div><h4>Serre <span class="muted small">${d.n_serres} / ${FarmMap.FIELDS.length}</span></h4>
      <p>${se.desc} Entretien ${se.entretien} €/jour.</p>${seBody}</div>`);
}
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
  if (s.statut === "en_cours" || s.menu) { m.hidden = true; m.__html = ""; return; }
  const win = s.statut === "gagne";
  setHTML(m, `<div class="modal-card"><div class="modal-emoji">${win ? "🏆" : "🥀"}</div>
    <h2>${win ? "Victoire !" : "Faillite…"}</h2>
    <p>${win ? `En ${s.derive.jour} jours, la Ferme du Val Vert a dépassé ${nf0.format(s.derive.objectif_argent)} € de trésorerie.` : "Trois jours de suite dans le rouge : la banque a saisi la ferme."}</p>
    <button class="btn" ${A({ type: "nouvelle_partie" })}>Nouvelle partie</button></div>`);
  m.hidden = false;
}

// ---------------------------------------------------------------- démarrage
ICONS.moon = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>';
ICONS.clock = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
hydrateIcons();
$("#hero-art").innerHTML = ART.hero();
$("#title-art").innerHTML = ART.hero("t-");
$("#avatar").innerHTML = ART.avatar;
FarmMap.init($("#map"), selectZone);
WeatherScene.init($("#wx-scene"));
$("#weather-card").addEventListener("click", () => go("meteo"));
MarketMap.init($("#market-map"), selectStall);
act({ type: "menu", ouvert: true });   // on arrive toujours sur le menu principal
poll();

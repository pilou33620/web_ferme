// Carte de la ferme vue du dessus : décor statique, cultures, serres, éoliennes, réservoir, animaux animés,
// tracteur qui circule sur les chemins et travaille les champs, terrains à vendre, zoom.

const FarmMap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, BASE_H = 760, ROW_H = 218;   // chaque rangée de terrains achetés ajoute 218 px en bas
  let H = BASE_H;

  const ZONES = {
    maison:    { nom: "Maison",      icon: "house",  box: [20, 20, 450, 232] },
    parcelle_a: { nom: "Parcelle A", icon: "sprout", box: [530, 20, 450, 232] },
    parcelle_b: { nom: "Parcelle B", icon: "sprout", box: [20, 312, 450, 158] },
    parcelle_c: { nom: "Parcelle C", icon: "sprout", box: [530, 312, 450, 158] },
    enclos:    { nom: "Animaux",     icon: "fence",  box: [20, 530, 450, 212] },
    atelier:   { nom: "Atelier",     icon: "barn",   box: [530, 530, 222, 212] },
    reservoir: { nom: "Eau & stock", icon: "tank",   box: [760, 530, 220, 212] },
  };

  // zones où se promènent les animaux [x1, y1, x2, y2]
  const PENS = {
    vaches:  [176, 624, 358, 724],
    moutons: [262, 552, 452, 610],
    cochons: [384, 640, 450, 724],
    poules:  [50, 650, 146, 722],
  };
  const SCALE = { vaches: .78, moutons: .9, cochons: .9, poules: 1 };
  const MAX_SHOWN = { vaches: 20, moutons: 14, cochons: 8, poules: 26 };
  const BASE_FIELDS = ["parcelle_a", "parcelle_b", "parcelle_c"];
  const FIELDS = [...BASE_FIELDS];       // tableau mis à jour sur place quand on achète un terrain
  const EXTRA_SLOTS = ["parcelle_d", "parcelle_e", "parcelle_f", "parcelle_g", "parcelle_h", "parcelle_i"];
  const slotBox = (i) => [i % 2 ? 530 : 20, 802 + Math.floor(i / 2) * ROW_H, 450, 158];
  const RX = 500;                        // axe du chemin vertical
  // emplacements des éoliennes près de la maison (un arbre y pousse tant qu'on n'en a pas acheté)
  const TURBINE_SLOTS = [[340, 70], [432, 64]];

  let svg, layers = {}, vb = [0, 0, W, H], anim = null, onSelect = () => {};
  let layoutSig = "", sale = null, roadsY = [282, 500], gameRunning = true, upgraded = false, rainy = false;
  const herd = new Map();     // id → entité animée
  const cache = {};           // signatures de rendu
  let night = 0, lastT = 0, focused = null, names = {};

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const seeded = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const mix = (a, b, t) => {
    const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const A = p(a), B = p(b);
    return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
  };

  // ------------------------------------------------------------------ décor
  // couleurs du décor selon la saison : herbe verte au printemps, sèche l'été, rousse l'automne, givrée l'hiver
  const PAL = {
    printemps: { grass: "#A9D282", tuft: "#93C46B", lawn: "#9FD17C", field: "#8CC067", pen: "#9BCB72", plot: "#B4D98F", tree: ["#4E9A3A", "#5DA548"] },
    ete:       { grass: "#B5D07A", tuft: "#9DBB5E", lawn: "#A8CF76", field: "#97BF5E", pen: "#A6C96A", plot: "#BFD98A", tree: ["#4A8F35", "#5A9C3F"] },
    automne:   { grass: "#C3C27C", tuft: "#AFA45C", lawn: "#BAC47A", field: "#A9B467", pen: "#B2BB70", plot: "#CFCB8A", tree: ["#D9822E", "#C4552B"] },
    hiver:     { grass: "#DCE5DE", tuft: "#C3D0C8", lawn: "#D3DED6", field: "#C8D6C9", pen: "#D0DCD2", plot: "#E3EAE4", tree: ["#6E8B78", "#7F9A86"] },
  };
  let season = "printemps";
  const pal = () => PAL[season] || PAL.printemps;

  function tree(x, y, r, c = pal().tree[0]) {
    return `<g><circle cx="${x + 3}" cy="${y + 4}" r="${r}" fill="#000" opacity=".12"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .45}" fill="#fff" opacity=".13"/></g>`;
  }
  function bush(x, y, r) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="${pal().tree[1]}"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .4}" fill="#fff" opacity=".12"/>`; }

  function staticLayer() {
    let s = "";
    // herbe + texture
    const P = pal();
    s += `<rect width="${W}" height="${H}" fill="${P.grass}"/>`;
    for (let i = 0; i < 160; i++) {
      s += `<path d="M${seeded(i) * W} ${seeded(i + 999) * H} l2 -5 l2 5" stroke="${P.tuft}" stroke-width="1.4" fill="none"/>`;
    }
    // routes
    const road = "#EADBBD", edge = "#D8C59E";
    s += `<rect x="478" y="0" width="44" height="${H}" fill="${road}"/>`;
    for (const y of roadsY) {
      s += `<rect x="0" y="${y - 20}" width="${W}" height="40" fill="${road}"/>`;
      s += `<path d="M0 ${y - 20}H${W}M0 ${y + 20}H${W}" stroke="${edge}" stroke-width="2"/>`;
      s += `<path d="M0 ${y}H${W}" stroke="#F7EEDC" stroke-width="3" stroke-dasharray="14 14"/>`;
    }
    s += `<path d="M478 0V${H}M522 0V${H}" stroke="${edge}" stroke-width="2"/>`;
    s += `<path d="M500 0V${H}" stroke="#F7EEDC" stroke-width="3" stroke-dasharray="14 14"/>`;
    // canalisation d'irrigation
    s += `<path d="M512 0V${H}" stroke="#7FB6E0" stroke-width="3"/>`;
    for (let y = 30; y < H; y += 60) s += `<circle cx="512" cy="${y}" r="4.5" fill="#4C93D1" stroke="#fff" stroke-width="1.5"/>`;

    // ---- maison
    s += `<rect x="24" y="24" width="442" height="224" rx="26" fill="${P.lawn}" stroke="#4E8F3B" stroke-width="10"/>`;
    s += `<rect x="128" y="168" width="64" height="74" fill="#E9DCC2"/>`;
    for (let i = 0; i < 4; i++) s += `<rect x="${146 + (i % 2) * 14}" y="${178 + i * 16}" width="18" height="10" rx="4" fill="#D3C3A4"/>`;
    s += `<rect x="360" y="120" width="70" height="122" fill="#DCCFB4"/>`;
    s += `<g transform="translate(78 54)">
      <rect x="6" y="8" width="176" height="112" fill="#000" opacity=".14"/>
      <path d="M0 0H170V106H0Z" fill="#C4483A"/>
      <path d="M0 0L52 53L0 106Z M170 0L118 53L170 106Z" fill="#B33E31"/>
      <path d="M0 0L52 53H118L170 0Z" fill="#D45A47"/>
      <path d="M52 53H118" stroke="#9E3328" stroke-width="3"/>
      <path d="M0 0L52 53M170 0L118 53M0 106L52 53M170 106L118 53" stroke="#9E3328" stroke-width="2"/>
      <rect x="128" y="14" width="18" height="18" fill="#8B8E91"/><rect x="131" y="17" width="12" height="12" fill="#5D6064"/>
    </g>`;
    s += `<g transform="translate(46 176)"><rect width="66" height="52" rx="8" fill="#7C5136"/>`;
    for (let i = 0; i < 12; i++) s += `<circle cx="${10 + (i % 4) * 15}" cy="${12 + Math.floor(i / 4) * 14}" r="5" fill="${["#F2C14E", "#E8695A", "#F5F0E6", "#B07CD8"][i % 4]}"/>`;
    s += `</g>`;
    s += `<g transform="translate(384 196)"><rect x="-12" y="-21" width="24" height="42" rx="8" fill="#2F6FB5"/><rect x="-9" y="-12" width="18" height="10" rx="3" fill="#BFE0F7"/><rect x="-9" y="6" width="18" height="8" rx="3" fill="#BFE0F7"/></g>`;
    s += tree(48, 58, 18) + tree(298, 140, 15, P.tree[1]);
    for (let x = 220; x < 290; x += 18) s += bush(x, 222, 8);
    // cour gravillonnée où le tracteur dort la nuit
    s += `<rect x="290" y="204" width="72" height="54" rx="8" fill="#E2D3B2"/><path d="M296 214h60M296 224h60M296 234h60M296 244h60" stroke="#D3C19B" stroke-width="1.5" stroke-dasharray="3 4"/>`;

    // ---- haies des champs
    for (const k of FIELDS) {
      const [x, y, w, h] = ZONES[k].box;
      s += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="24" fill="${P.field}" stroke="#4E8F3B" stroke-width="10"/>`;
    }
    // bosquets dans les coins des rangées de terrains pas encore achetés
    for (let i = 0; i < EXTRA_SLOTS.length; i++) {
      const [x, y, w, h] = slotBox(i);
      if (y + h > H || ZONES[EXTRA_SLOTS[i]] || (sale && sale.cle === EXTRA_SLOTS[i])) continue;
      s += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="24" fill="${P.plot}"/>`;
      for (let j = 0; j < 7; j++) s += tree(x + 40 + seeded(i * 9 + j) * (w - 80), y + 30 + seeded(i * 7 + j + 3) * (h - 60), 10 + seeded(j + i) * 9, P.tree[j % 2 ? 1 : 0]);
    }

    // ---- enclos
    s += `<rect x="24" y="534" width="442" height="204" rx="22" fill="${P.pen}"/>`;
    s += `<rect x="30" y="540" width="430" height="192" rx="18" fill="none" stroke="#9A6B3E" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>`;
    s += `<rect x="30" y="540" width="430" height="192" rx="18" fill="none" stroke="#B58553" stroke-width="2"/>`;
    s += `<g transform="translate(44 550)"><rect x="5" y="6" width="130" height="66" fill="#000" opacity=".14"/><rect width="128" height="62" fill="#C33A30"/><path d="M0 31H128" stroke="#9E2C24" stroke-width="3"/><path d="M0 0L20 31L0 62M128 0L108 31L128 62" stroke="#A9322A" stroke-width="2" fill="none"/><rect x="54" y="20" width="20" height="20" fill="#9EA3A8" stroke="#7E848A" stroke-width="2"/><path d="M54 20l20 20M74 20l-20 20" stroke="#7E848A" stroke-width="2"/></g>`;
    for (const [x, y] of [[196, 568], [222, 580], [200, 598]]) {
      s += `<circle cx="${x + 2}" cy="${y + 3}" r="12" fill="#000" opacity=".12"/><circle cx="${x}" cy="${y}" r="12" fill="#E9C25B" stroke="#C99A2F" stroke-width="1.5"/><path d="M${x} ${y}m-7 0a7 7 0 1 0 7-7a4 4 0 1 0 4 4" stroke="#C99A2F" stroke-width="1.4" fill="none"/>`;
    }
    s += `<rect x="42" y="640" width="112" height="88" rx="12" fill="#D9B98A"/>`;
    for (let i = 0; i < 18; i++) s += `<circle cx="${50 + seeded(i + 40) * 96}" cy="${648 + seeded(i + 80) * 72}" r="1.6" fill="#B89466"/>`;
    s += `<g transform="translate(108 646)"><rect width="40" height="34" fill="#8A5A35"/><path d="M0 8H40M0 17H40M0 26H40" stroke="#6E4527" stroke-width="1.5"/></g>`;
    s += `<ellipse cx="416" cy="684" rx="40" ry="46" fill="#8C6A48"/><ellipse cx="410" cy="690" rx="22" ry="20" fill="#7A5A3B"/>`;
    s += `<rect x="376" y="634" width="80" height="96" rx="10" fill="none" stroke="#9A6B3E" stroke-width="3"/>`;
    s += `<ellipse cx="250" cy="700" rx="22" ry="12" fill="#7FB6E0" stroke="#9AA3AB" stroke-width="3"/>`;
    s += tree(452, 552, 12);

    // ---- réservoir & stockage
    s += `<rect x="764" y="534" width="212" height="204" rx="22" fill="#C9CCC4"/>`;
    s += `<path d="M764 600H976M764 670H976M820 534V738M880 534V738" stroke="#BABDB4" stroke-width="1.5"/>`;
    s += `<g transform="translate(884 548)"><rect x="5" y="6" width="80" height="176" rx="6" fill="#000" opacity=".14"/><rect width="80" height="176" rx="6" fill="#9AA1A8"/>`;
    for (let i = 1; i < 12; i++) s += `<path d="M${i * 6.6} 0V176" stroke="#868D94" stroke-width="1.5"/>`;
    s += `<path d="M40 0V176" stroke="#6F767D" stroke-width="3"/></g>`;
    s += `<g transform="translate(864 716)"><rect width="20" height="16" rx="3" fill="#5E6B78"/><circle cx="10" cy="8" r="4" fill="#8FB7D6"/></g>`;
    return s;
  }

  // ------------------------------------------------------------------ cultures
  function soilColor(hum) { return mix("#C4925F", "#6E4429", Math.min(1, hum / 100)); }

  // espacement des plants (px) selon la culture
  const SPACING = { tomates: 27, carottes: 23, salades: 24, pommes_de_terre: 26, mais: 22, fraises: 21,
                    potirons: 36, melons: 33, poivrons: 26 };

  function plantSVG(c, px, py, g, ripe, dead, j, col) {
    const brown = "#8C6B3F", brown2 = "#A88456";
    if (c === "tomates" || c === "poivrons") {
      const rr = 3 + 8 * g + j;
      let s = `<circle cx="${px}" cy="${py + 1.5}" r="${rr}" fill="#000" opacity=".15"/>
        <circle cx="${px}" cy="${py}" r="${rr}" fill="${dead ? brown : c === "tomates" ? "#3F8E3A" : "#2E7A3A"}"/>
        <circle cx="${px - rr * .3}" cy="${py - rr * .3}" r="${rr * .45}" fill="${dead ? brown2 : "#5DAE4B"}"/>`;
      if (!dead && (ripe || g > .75)) {
        if (c === "tomates") {
          const red = ripe ? "#E2412F" : "#F29B4B";
          s += `<circle cx="${px + rr * .45}" cy="${py + rr * .2}" r="2.6" fill="${red}"/><circle cx="${px - rr * .35}" cy="${py + rr * .45}" r="2.4" fill="${red}"/><circle cx="${px + rr * .05}" cy="${py - rr * .5}" r="2.2" fill="${red}"/>`;
        } else {
          const p = ripe ? ["#D9382F", "#F2B33A", "#E2412F"][col % 3] : "#7CC254";
          s += `<ellipse cx="${px + rr * .4}" cy="${py + rr * .25}" rx="2.2" ry="3.6" fill="${p}"/><ellipse cx="${px - rr * .4}" cy="${py + rr * .3}" rx="2.2" ry="3.6" fill="${p}" transform="rotate(25 ${px - rr * .4} ${py + rr * .3})"/>`;
        }
      }
      return s;
    }
    if (c === "carottes") {
      const rr = 3 + 7 * g;
      if (dead) return `<circle cx="${px}" cy="${py}" r="${rr * .8}" fill="${brown}"/>`;
      return `<path d="M${px} ${py}l${-rr} ${-rr * .6}M${px} ${py}l${rr} ${-rr * .6}M${px} ${py}l0 ${-rr}M${px} ${py}l${-rr * .7} ${rr * .4}M${px} ${py}l${rr * .7} ${rr * .4}" stroke="#4FA03C" stroke-width="2.4" stroke-linecap="round"/>`
        + (ripe || g > .8 ? `<circle cx="${px}" cy="${py}" r="3.2" fill="#EE8A2E"/>` : "");
    }
    if (c === "salades") {
      const rr = 3 + 7.5 * g;
      if (dead) return `<circle cx="${px}" cy="${py}" r="${rr}" fill="${brown}"/>`;
      return `<circle cx="${px}" cy="${py + 1}" r="${rr}" fill="#000" opacity=".12"/>
        <circle cx="${px}" cy="${py}" r="${rr}" fill="${ripe ? "#7DC24E" : "#8BCB5A"}"/>
        <circle cx="${px}" cy="${py}" r="${rr * .62}" fill="#A9DB72"/><circle cx="${px}" cy="${py}" r="${rr * .3}" fill="#CBEB98"/>`;
    }
    if (c === "pommes_de_terre") {
      const rr = 2.5 + 6 * g;
      const leaf = dead ? brown : ripe ? "#9DAF4A" : "#4C9440";
      let s = "";
      for (const [ox, oy] of [[-rr * .6, -rr * .3], [rr * .6, -rr * .2], [0, rr * .5]]) {
        s += `<circle cx="${px + ox}" cy="${py + oy}" r="${rr * .75}" fill="${leaf}"/>`;
      }
      if (ripe) s += `<ellipse cx="${px + rr * .9}" cy="${py + rr * .8}" rx="3" ry="2.3" fill="#D9B77A"/><ellipse cx="${px - rr}" cy="${py + rr * .6}" rx="2.6" ry="2" fill="#D9B77A"/>`;
      return s;
    }
    if (c === "mais") {
      const rr = 3 + 7 * g;
      const stroke = dead ? brown : ripe ? "#D8B44A" : mix("#79C04E", "#5E9E3A", g);
      return `<path d="M${px - rr} ${py}L${px + rr} ${py}M${px} ${py - rr}L${px} ${py + rr}M${px - rr * .7} ${py - rr * .7}L${px + rr * .7} ${py + rr * .7}M${px + rr * .7} ${py - rr * .7}L${px - rr * .7} ${py + rr * .7}" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/>`
        + (ripe ? `<ellipse cx="${px + 2}" cy="${py}" rx="2.4" ry="4" fill="#F4D35E"/>` : "");
    }
    if (c === "fraises") {
      const rr = 2 + 4.5 * g;
      const leaf = dead ? brown : "#3F9443";
      let s = "";
      for (let i = 0; i < 3; i++) {
        const a = i * 2.09 + j;
        s += `<circle cx="${px + Math.cos(a) * rr * .7}" cy="${py + Math.sin(a) * rr * .7}" r="${rr * .7}" fill="${leaf}"/>`;
      }
      if (!dead && g > .55 && !ripe) s += `<circle cx="${px}" cy="${py}" r="1.8" fill="#fff"/>`;
      if (ripe) s += `<path d="M${px + rr * .6} ${py + rr * .3}l2 4l2-4z" fill="#E0303B"/><path d="M${px - rr * .9} ${py - rr * .2}l2 4l2-4z" fill="#E0303B"/>`;
      return s;
    }
    // potirons et melons : lianes rampantes + gros fruits
    const rr = 4 + 9 * g;
    const leaf = dead ? brown : "#4E9A3A";
    let s = `<path d="M${px - rr} ${py + 2}q${rr * .5} ${-rr * .8} ${rr} 0t${rr} 0" stroke="${dead ? brown : "#5E9E3A"}" stroke-width="2" fill="none"/>
      <circle cx="${px - rr * .6}" cy="${py - rr * .3}" r="${rr * .45}" fill="${leaf}"/><circle cx="${px + rr * .5}" cy="${py - rr * .45}" r="${rr * .4}" fill="${leaf}"/>`;
    if (!dead && g > .5) {
      const fr = 2.5 + 5 * Math.min(1, (g - .5) * 2.2);
      if (c === "potirons") {
        const o = ripe ? "#EE8A2E" : mix("#8DBA4A", "#E9A93A", (g - .5) * 2);
        s += `<circle cx="${px + 1}" cy="${py + rr * .25 + 1.5}" r="${fr}" fill="#000" opacity=".15"/><circle cx="${px}" cy="${py + rr * .25}" r="${fr}" fill="${o}"/>
          <path d="M${px} ${py + rr * .25 - fr}v${fr * 2}M${px - fr * .55} ${py + rr * .25 - fr * .8}v${fr * 1.6}M${px + fr * .55} ${py + rr * .25 - fr * .8}v${fr * 1.6}" stroke="#000" stroke-width=".8" opacity=".18"/>`;
      } else {
        const o = ripe ? "#E3D27A" : "#A9CC6A";
        s += `<circle cx="${px + 1}" cy="${py + rr * .25 + 1.5}" r="${fr}" fill="#000" opacity=".15"/><circle cx="${px}" cy="${py + rr * .25}" r="${fr}" fill="${o}" stroke="#C3B25B" stroke-width=".8" stroke-dasharray="1.5 1.5"/>`;
      }
    }
    return s;
  }

  function greenhouseSVG(x, y, bw, bh) {
    let s = `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="#EAF5FB" opacity=".32"/>`;
    for (let i = 0; i < 6; i++) {
      const gx = x + 30 + i * (bw / 6);
      s += `<path d="M${gx} ${y + 6}l${bh * .35} ${bh - 12}" stroke="#fff" stroke-width="10" opacity=".13"/>`;
    }
    const n = Math.round(bw / 52);
    for (let i = 1; i < n; i++) s += `<path d="M${x + (bw / n) * i} ${y}V${y + bh}" stroke="#F2F7FA" stroke-width="2.4" opacity=".85"/>`;
    s += `<path d="M${x} ${y + bh / 2}H${x + bw}" stroke="#F7FAFC" stroke-width="4"/>`;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="10" fill="none" stroke="#F7FAFC" stroke-width="5"/>`;
    s += `<rect x="${x + bw / 2 - 16}" y="${y + bh - 6}" width="32" height="10" rx="3" fill="#DDE8EE" stroke="#BCCAD3" stroke-width="1.5"/>`;
    return s;
  }

  // une planche : sol, rangs, plants (une parcelle peut en avoir jusqu'à 3, séparées par un passage enherbé)
  function bedSVG(key, idx, b, x, y, bw, bh, hum, n) {
    let s = `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="${n > 1 ? 12 : 14}" fill="${soilColor(hum)}"/>`;
    const sp = SPACING[b.culture] || 24;
    const rows = Math.max(n > 1 ? 1 : 3, Math.round(bh / sp)), cols = Math.max(6, Math.round(bw / sp));
    const dy = bh / rows, dx = bw / cols;
    for (let r = 0; r < rows; r++) {
      s += `<rect x="${x + 8}" y="${y + r * dy + dy * .5 - 4}" width="${bw - 16}" height="8" rx="4" fill="#000" opacity=".13"/>`;
    }
    if (hum < 18) {
      for (let i = 0; i < 14 / n; i++) {
        const cx = x + 10 + seeded(i + key.length + idx * 31) * (bw - 20), cy = y + 6 + seeded(i * 3 + key.length + idx) * Math.max(4, bh - 16);
        s += `<path d="M${cx} ${cy}l6 4l-3 6l7 3" stroke="#9C7048" stroke-width="1.5" fill="none"/>`;
      }
    }
    if (hum > 75) s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="#4C93D1" opacity=".08"/>`;
    if (b.etat !== "vide" && b.culture) {
      const g = Math.max(0, Math.min(1, b.croissance / 100));
      const dead = b.etat === "fletri", ripe = b.etat === "mur";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = x + c * dx + dx / 2, py = y + r * dy + dy / 2;
          if (b.croissance < 6 && !dead) { s += `<circle cx="${px}" cy="${py}" r="2" fill="#9AD46B"/>`; continue; }
          s += plantSVG(b.culture, px, py, g, ripe, dead, seeded(r * 31 + c * 7 + key.length + idx * 101), c);
        }
      }
    }
    return s;
  }

  function fieldSVG(key, f) {
    const [x0, y0, w, h] = ZONES[key].box;
    const x = x0 + 22, y = y0 + 22, bw = w - 44, bh = h - 44;
    const n = f.planches.length;
    let s = "";
    f.planches.forEach((b, i) => {
      const [bx, by, bbw, bbh] = bedBox(key, i, n);
      s += bedSVG(key, i, b, bx, by, bbw, bbh, f.humidite, n);
    });
    if (f.serre) s += greenhouseSVG(x, y, bw, bh);
    return s;
  }

  // ------------------------------------------------------------------ éoliennes
  function turbineSVG(x, y, wind) {
    const dur = (7 - 5.5 * wind).toFixed(2);
    const blades = `<path d="M0 0C3 -6 3.8 -20 1.6 -31L-1.6 -31C-3.2 -19 -3 -6 0 0Z"/>`;
    const rotor = (fill, stroke) => `<g fill="${fill}" stroke="${stroke}" stroke-width="1">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${dur}s" repeatCount="indefinite"/>
      ${blades}<g transform="rotate(120)">${blades}</g><g transform="rotate(240)">${blades}</g></g>`;
    return `<g transform="translate(${x} ${y})">
      <ellipse cx="3" cy="4" rx="13" ry="9" fill="#000" opacity=".12"/>
      <circle r="11" fill="#D9D2C2" stroke="#C2B9A6" stroke-width="1.5"/>
      <g transform="translate(16 14)" opacity=".16">${rotor("#000", "none")}</g>
      <rect x="-4" y="-3" width="15" height="7" rx="3" fill="#E6EBEE" stroke="#C3CCD2" stroke-width="1"/>
      ${rotor("#FAFCFD", "#CCD5DB")}
      <circle r="4.6" fill="#EEF2F4" stroke="#B9C3CA" stroke-width="1.2"/></g>`;
  }

  // ruches alignées au bord du jardin, abeilles qui tournent autour (pas sous la pluie ni la nuit)
  function hivesSVG(n, active) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = 212 + i * 22, y = 186;
      s += `<g transform="translate(${x} ${y})"><rect x="2" y="3" width="17" height="15" rx="2" fill="#000" opacity=".15"/>
        <rect width="17" height="15" rx="2" fill="#F2C94C" stroke="#C99A2F" stroke-width="1.2"/>
        <path d="M0 5H17M0 10H17" stroke="#D9A93A" stroke-width="1.2"/><rect x="-1.5" y="-2" width="20" height="4" rx="1.5" fill="#B5835A"/>
        <rect x="6" y="12" width="5" height="2" rx="1" fill="#6B4A2E"/>`;
      if (active) {
        for (let b = 0; b < 3; b++) {
          const r = 9 + b * 4, dur = (1.6 + b * .5 + (i % 3) * .3).toFixed(1);
          s += `<circle r="1.6" fill="#2B2B2B"><animateMotion dur="${dur}s" repeatCount="indefinite" begin="-${(b * .4 + i * .2).toFixed(1)}s"
            path="M${8.5 - r} 6a${r} ${r * .7} 0 1 0 ${2 * r} 0a${r} ${r * .7} 0 1 0 ${-2 * r} 0"/></circle>`;
        }
      }
      s += `</g>`;
    }
    return s;
  }

  function windSVG(n, wind) {
    let s = "";
    TURBINE_SLOTS.forEach(([x, y], i) => {
      if (i < n) s += turbineSVG(x, y, wind);
      else s += i === 0 ? tree(330, 60, 22) + tree(366, 82, 16, pal().tree[1]) : tree(440, 50, 14);
    });
    return s;
  }

  // ------------------------------------------------------------------ réservoir
  function tankSVG(res, ups) {
    const frac = res.niveau / res.capacite;
    const tanks = ups.includes("reservoir") ? [[816, 588, 38], [816, 688, 38]] : [[816, 592, 32], [816, 684, 32]];
    let s = "";
    for (const [cx, cy, r] of tanks) {
      const circ = 2 * Math.PI * (r + 7);
      s += `<circle cx="${cx + 4}" cy="${cy + 6}" r="${r + 10}" fill="#000" opacity=".14"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="#E6EAED"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="none" stroke="#D3DAE0" stroke-width="6"/>
        <circle cx="${cx}" cy="${cy}" r="${r + 7}" fill="none" stroke="#3C8CD6" stroke-width="6" stroke-linecap="round"
          stroke-dasharray="${circ * frac} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="${mix("#CFE3F2", "#3F8FD8", .25 + .75 * frac)}"/>
        <circle cx="${cx}" cy="${cy}" r="${r * .62}" fill="none" stroke="#fff" stroke-width="2" opacity=".35">
          <animate attributeName="r" values="${r * .2};${r * .9}" dur="3.5s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".5;0" dur="3.5s" repeatCount="indefinite"/></circle>
        <circle cx="${cx - r * .35}" cy="${cy - r * .35}" r="${r * .18}" fill="#fff" opacity=".35"/>`;
    }
    return s;
  }

  // ------------------------------------------------------------------ atelier de transformation
  // emplacements du matériel dans la cour, devant le bâtiment
  const KIT_SLOTS = { cuve_fromage: [568, 676], chaudron: [607, 708], autoclave: [646, 676], rouet: [685, 708], four: [724, 676] };
  function kitSVG(eq, run) {
    const spin = (dur) => (run ? `<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${dur}s" repeatCount="indefinite"/>` : "");
    if (eq === "cuve_fromage") {
      return `<circle cx="2" cy="3" r="16" fill="#000" opacity=".14"/><circle r="16" fill="#C9D2D9" stroke="#8E9AA4" stroke-width="2"/>
        <circle r="12" fill="#F3EBD3"/><g><path d="M-9 0H9" stroke="#8E9AA4" stroke-width="2.4" stroke-linecap="round"/>${spin(2.4)}</g>
        <circle cx="15" cy="12" r="6" fill="#F2C14E" stroke="#C99A2F" stroke-width="1.2"/><circle cx="15" cy="12" r="2.4" fill="#E2B13B"/>`;
    }
    if (eq === "chaudron") {
      return `${run ? `<circle r="19" fill="none" stroke="#F29B4B" stroke-width="3" stroke-dasharray="3 4"><animate attributeName="opacity" values="1;.4;1" dur=".8s" repeatCount="indefinite"/></circle>` : ""}
        <circle cx="2" cy="3" r="15" fill="#000" opacity=".14"/><circle r="15" fill="#C27237" stroke="#8E4D20" stroke-width="2"/>
        <circle r="11" fill="#B3263A"/><circle cx="-3" cy="-3" r="3" fill="#D9485C" opacity=".8"/>
        ${run ? `<circle cx="3" cy="2" r="1.8" fill="#F07A8A"><animate attributeName="r" values="0;2.6;0" dur="1.1s" repeatCount="indefinite"/></circle>` : ""}`;
    }
    if (eq === "autoclave") {
      return `<rect x="-11" y="-14" width="26" height="32" rx="8" fill="#000" opacity=".14"/><rect x="-13" y="-16" width="24" height="32" rx="8" fill="#AEB8C0" stroke="#7F8B95" stroke-width="2"/>
        <circle cx="-1" cy="-6" r="4.5" fill="#fff" stroke="#7F8B95" stroke-width="1.2"/><path d="M-1 -6l2.4 -2" stroke="#D6544B" stroke-width="1.4"/>
        ${[["#D9382F", 16, -8], ["#EE8A2E", 16, 2], ["#D9382F", 16, 12]].map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="${c}"/><circle cx="${x}" cy="${y}" r="2.2" fill="#E9E2D0"/>`).join("")}
        ${run ? `<circle cx="-1" cy="-20" r="3" fill="#fff" opacity=".7"><animate attributeName="cy" values="-18;-30" dur="1.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;0" dur="1.4s" repeatCount="indefinite"/></circle>` : ""}`;
    }
    if (eq === "rouet") {
      return `<circle cx="2" cy="3" r="14" fill="#000" opacity=".12"/><circle r="13" fill="none" stroke="#8A5A35" stroke-width="3"/>
        <g stroke="#A8784E" stroke-width="1.6"><path d="M-12 0H12M0 -12V12M-8.5 -8.5L8.5 8.5M8.5 -8.5L-8.5 8.5"/>${spin(1.6)}</g>
        <circle r="3" fill="#6E4527"/><circle cx="15" cy="11" r="6" fill="#F5F0E6" stroke="#D8CFBF" stroke-width="1.2"/>
        <path d="M11 9q4 4 8 1" stroke="#D8CFBF" stroke-width="1" fill="none"/>`;
    }
    // four à pain : dôme de briques
    return `${run ? `<circle r="22" fill="#F7A440" opacity=".35"><animate attributeName="opacity" values=".15;.45;.15" dur="1.6s" repeatCount="indefinite"/></circle>` : ""}
      <circle cx="2" cy="3" r="16" fill="#000" opacity=".14"/><circle r="16" fill="#B5533C" stroke="#8E3B29" stroke-width="2"/>
      <path d="M-11 -5H11M-13 3H13M-6 -13V-5M6 -13V-5M0 -5V3M-7 3V11M7 3V11" stroke="#9E432F" stroke-width="1.2"/>
      <rect x="-7" y="10" width="14" height="8" rx="3" fill="${run ? "#F29B4B" : "#3A2A22"}"/>`;
  }
  function workshopSVG(state) {
    const at = state.atelier, [x, y, w, h] = ZONES.atelier.box;
    const cx = x + w / 2, cy = y + h / 2;
    if (!at.construit) {
      let s = `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="22" fill="${pal().plot}"/>`;
      s += `<rect x="${x + 14}" y="${y + 14}" width="${w - 28}" height="${h - 28}" rx="16" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="10 9" opacity=".9"/>`;
      for (const [px, py] of [[x + 14, y + 14], [x + w - 14, y + 14], [x + 14, y + h - 14], [x + w - 14, y + h - 14]]) s += `<circle cx="${px}" cy="${py}" r="5" fill="#B58553" stroke="#fff" stroke-width="2"/>`;
      s += `<g transform="translate(${cx} ${cy + 14})"><rect x="-3" y="0" width="6" height="30" fill="#7A5434"/>
        <rect x="-50" y="-34" width="100" height="40" rx="6" fill="#C89B62" stroke="#8E6638" stroke-width="2"/>
        <text x="0" y="-16" text-anchor="middle" class="sale-sign">ATELIER</text><text x="0" y="-3" text-anchor="middle" class="sale-sign sm">à construire</text></g>`;
      s += `<g class="sale-cta"><circle cx="${cx}" cy="${cy - 52}" r="20" fill="#fff" opacity=".95"/>
        <path d="M${cx - 8} ${cy - 52}h16M${cx} ${cy - 60}v16" stroke="#2F7A4B" stroke-width="4" stroke-linecap="round"/>
        <animate attributeName="opacity" values="1;.7;1" dur="2.4s" repeatCount="indefinite"/></g>`;
      return s;
    }
    const prog = state.derive.atelier, owned = at.equipements;
    const running = Object.values(owned).some((m) => m.lot);
    // cour pavée
    let s = `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="22" fill="#DCD4C3"/>`;
    for (let i = 0; i < 9; i++) s += `<path d="M${x + 12} ${y + 118 + i * 11}H${x + w - 12}" stroke="#CFC6B2" stroke-width="1.2"/>`;
    // bâtiment : toit à quatre pans en ardoise, verrières, cheminée
    const bx = x + 16, by = y + 16, bw = w - 32, bh = 92;
    s += `<rect x="${bx + 6}" y="${by + 8}" width="${bw}" height="${bh}" fill="#000" opacity=".14"/>
      <path d="M${bx} ${by}H${bx + bw}V${by + bh}H${bx}Z" fill="#5E7486"/>
      <path d="M${bx} ${by}L${bx + 40} ${by + bh / 2}L${bx} ${by + bh}Z M${bx + bw} ${by}L${bx + bw - 40} ${by + bh / 2}L${bx + bw} ${by + bh}Z" fill="#526676"/>
      <path d="M${bx} ${by}L${bx + 40} ${by + bh / 2}H${bx + bw - 40}L${bx + bw} ${by}Z" fill="#6D8597"/>
      <path d="M${bx + 40} ${by + bh / 2}H${bx + bw - 40}" stroke="#435564" stroke-width="3"/>
      <rect x="${bx + 56}" y="${by + 14}" width="22" height="14" rx="2" fill="#BFE0F7" opacity=".85"/><rect x="${bx + 96}" y="${by + 14}" width="22" height="14" rx="2" fill="#BFE0F7" opacity=".85"/>
      <rect x="${bx + bw - 34}" y="${by + 58}" width="14" height="14" fill="#8B8E91"/><rect x="${bx + bw - 31}" y="${by + 61}" width="8" height="8" fill="#4D5054"/>
      <rect x="${cx - 14}" y="${by + bh - 2}" width="28" height="8" rx="2" fill="#7C5136"/>`;
    if (running) {
      for (let i = 0; i < 3; i++) {
        s += `<circle cx="${bx + bw - 27}" cy="${by + 64}" r="5" fill="#EEF0F2"><animate attributeName="cy" values="${by + 64};${by + 20}" dur="2.6s" begin="-${(i * .85).toFixed(2)}s" repeatCount="indefinite"/>
          <animate attributeName="r" values="4;11" dur="2.6s" begin="-${(i * .85).toFixed(2)}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values=".85;0" dur="2.6s" begin="-${(i * .85).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
      }
    }
    // le matériel installé (ou son emplacement vide)
    for (const [eq, [ex, ey]] of Object.entries(KIT_SLOTS)) {
      const m = owned[eq];
      if (!m) {
        s += `<g transform="translate(${ex} ${ey})" opacity=".55"><rect x="-15" y="-15" width="30" height="30" rx="8" fill="none" stroke="#A89E88" stroke-width="2" stroke-dasharray="4 4"/>
          <path d="M-5 0h10M0 -5v10" stroke="#A89E88" stroke-width="2" stroke-linecap="round"/></g>`;
        continue;
      }
      const run = !!m.lot, p = run ? (prog[eq] ? prog[eq].progression : 0) / 100 : 0, circ = 2 * Math.PI * 21;
      s += `<g transform="translate(${ex} ${ey})">${kitSVG(eq, run)}
        ${run ? `<circle r="21" fill="none" stroke="#fff" stroke-width="3.5" opacity=".7"/><circle r="21" fill="none" stroke="#2F7A4B" stroke-width="3.5" stroke-linecap="round"
          stroke-dasharray="${(circ * p).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90)"/>` : ""}</g>`;
    }
    return s;
  }

  // ------------------------------------------------------------------ terrain à vendre
  function saleSVG() {
    if (!sale) return "";
    const [x, y, w, h] = ZONES.a_vendre.box;
    const cx = x + w / 2, cy = y + h / 2;
    let s = `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="24" fill="${pal().plot}"/>`;
    for (let i = 0; i < 40; i++) s += `<path d="M${x + 20 + seeded(i + 300) * (w - 40)} ${y + 20 + seeded(i + 600) * (h - 40)} l2 -5 l2 5" stroke="#9FCB78" stroke-width="1.4" fill="none"/>`;
    s += `<rect x="${x + 10}" y="${y + 10}" width="${w - 20}" height="${h - 20}" rx="20" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="10 9" opacity=".9"/>`;
    for (const [px, py] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + h - 10], [x + w - 10, y + h - 10]]) {
      s += `<circle cx="${px}" cy="${py}" r="5" fill="#B58553" stroke="#fff" stroke-width="2"/>`;
    }
    // panneau en bois
    s += `<g transform="translate(${x + 70} ${cy - 6})"><rect x="-3" y="0" width="6" height="34" fill="#7A5434"/>
      <rect x="-46" y="-30" width="92" height="38" rx="6" fill="#C89B62" stroke="#8E6638" stroke-width="2"/>
      <text x="0" y="-6" text-anchor="middle" class="sale-sign">À VENDRE</text></g>`;
    s += `<g class="sale-cta"><circle cx="${cx}" cy="${cy}" r="30" fill="#fff" opacity=".95"/>
      <path d="M${cx - 11} ${cy}h22M${cx} ${cy - 11}v22" stroke="#2F7A4B" stroke-width="5" stroke-linecap="round"/>
      <animate attributeName="opacity" values="1;.7;1" dur="2.4s" repeatCount="indefinite"/></g>`;
    s += `<text x="${cx}" y="${cy + 56}" text-anchor="middle" class="sale-price">Cliquez pour acheter</text>`;
    return s;
  }

  // Recalcule la disposition quand on achète un terrain : zones, routes, hauteur de la carte.
  function relayout(state) {
    const extras = Object.keys(state.champs).filter((k) => !BASE_FIELDS.includes(k)).sort();
    sale = state.derive.terrain_a_vendre;
    for (const k of Object.keys(ZONES)) if (k.startsWith("parcelle_") && !BASE_FIELDS.includes(k) || k === "a_vendre") delete ZONES[k];
    FIELDS.length = 0;
    FIELDS.push(...BASE_FIELDS, ...extras);
    let used = 0;
    extras.forEach((k) => {
      const i = Math.max(0, EXTRA_SLOTS.indexOf(k));
      ZONES[k] = { nom: k.replace("parcelle_", "Parcelle ").replace(/ (\w)$/, (m, l) => " " + l.toUpperCase()), icon: "sprout", box: slotBox(i) };
      used = Math.max(used, i + 1);
    });
    if (sale) {
      const i = EXTRA_SLOTS.indexOf(sale.cle);
      ZONES.a_vendre = { nom: "À vendre", icon: "plus", box: slotBox(i) };
      used = Math.max(used, i + 1);
    }
    const rows = Math.ceil(used / 2);
    H = BASE_H + rows * ROW_H;
    roadsY = [282, 500, ...Array.from({ length: rows }, (_, r) => 772 + r * ROW_H)];
    svg.style.aspectRatio = `${W} / ${H}`;
    layers.base.innerHTML = staticLayer();
    layers.fields.innerHTML = "";
    for (const k of FIELDS) { layers[k] = el("g", {}, layers.fields); delete cache[k]; }
    layers.sale.innerHTML = saleSVG();
    for (const id of ["map-heat", "map-night", "map-frost"]) svg.querySelector(`#${id}`).setAttribute("height", H);
    delete cache.wind; delete cache.workshop;
    if (focused && !ZONES[focused]) focused = null;
    setVB(boxFor(focused));
    vehicles.forEach((v) => v.reset());
  }

  // ------------------------------------------------------------------ véhicules
  // Tracteur et robots roulent sur les chemins, vont travailler les planches (passes aller-retour)
  // et rentrent dans la cour la nuit. Le drone, lui, vole en ligne droite au-dessus des champs.
  const onV = (p) => Math.abs(p.x - RX) < 1;
  const onRoad = (p) => onV(p) || roadsY.some((y) => Math.abs(p.y - y) < 1);
  const nightTime = (state) => { const h = state.derive.heure_dec; return h >= 21 || h < 6; };
  const growingBeds = (f) => f.planches.filter((b) => b.etat === "seme" || b.etat === "pousse");
  // itinéraire par les chemins : on rejoint le chemin vertical, puis la bonne route horizontale
  function route(from, to) {
    const pts = [];
    if (onV(from) && onV(to)) return [to];
    if (!onV(from) && !onV(to) && Math.abs(from.y - to.y) < 1) return [to];
    if (!onV(from)) pts.push({ x: RX, y: from.y });
    if (!onV(to)) pts.push({ x: RX, y: to.y });
    pts.push(to);
    return pts;
  }
  function nearestRoad(p) {
    let best = { x: RX, y: Math.max(20, Math.min(H - 20, p.y)) }, d = Math.abs(p.x - RX);
    for (const y of roadsY) if (Math.abs(p.y - y) < d) { d = Math.abs(p.y - y); best = { x: Math.max(30, Math.min(W - 30, p.x)), y }; }
    return best;
  }
  function roadEntry(box) {
    const [x, y, w, h] = box;
    let ry = roadsY[0], d = 1e9;
    for (const r of roadsY) {
      const dd = Math.min(Math.abs(r - y), Math.abs(r - (y + h)));
      if (dd < d) { d = dd; ry = r; }
    }
    return { x: x + w / 2, y: ry, above: ry < y };
  }
  // rectangle d'une planche dans sa parcelle (mêmes calculs que le dessin)
  function bedBox(key, i, n) {
    const [x0, y0, w, h] = ZONES[key].box;
    const x = x0 + 22, y = y0 + 22, bw = w - 44, bh = h - 44, gap = n > 1 ? 12 : 0;
    const bedH = (bh - gap * (n - 1)) / n;
    return [x, y + i * (bedH + gap), bw, bedH];
  }

  function makeVehicle(cfg) {
    const T = { x: cfg.park.x, y: cfg.park.y, a: -Math.PI / 2, path: [], mode: "sleep", wait: rnd(0, 3), puff: 0, dist: 0, lastRut: 0, work: false, on: false };
    let g = null, lastState = null;
    const parkPath = (here) => {
      const r0 = nearestRoad(here), start = onRoad(here) ? here : r0;
      return [...(onRoad(here) ? [] : [r0]), ...route(start, { x: cfg.park.x, y: 282 }), { x: cfg.park.x, y: cfg.park.y }];
    };
    function plan(state) {
      const here = { x: T.x, y: T.y };
      const parked = Math.hypot(T.x - cfg.park.x, T.y - cfg.park.y) < 2;
      const job = nightTime(state) ? null : cfg.choose(state);
      if (!job) {
        if (parked) { T.mode = "sleep"; return; }
        if (!nightTime(state) && cfg.roam && Math.random() < .5) {
          const ends = roadsY.flatMap((y) => [{ x: 40, y }, { x: RX, y }, { x: W - 40, y }]).concat([{ x: RX, y: 30 }, { x: RX, y: H - 30 }]);
          const from = onRoad(here) ? here : nearestRoad(here);
          T.path = [...(onRoad(here) ? [] : [from]), ...route(from, ends[Math.floor(Math.random() * ends.length)])];
          T.mode = "roam";
          return;
        }
        T.path = parkPath(here); T.mode = "park";
        return;
      }
      // travail : passes aller-retour dans une planche
      const [key, i] = job, n = state.champs[key].planches.length;
      const [bx, by, bw, bh] = bedBox(key, i, n), e = roadEntry(ZONES[key].box), box = ZONES[key].box;
      const x0 = bx + cfg.margin, x1 = bx + bw - cfg.margin;
      const edgeY = e.above ? box[1] + 22 + 12 : box[1] + box[3] - 22 - 12;
      const step = cfg.rowStep, nRows = Math.max(1, Math.floor((bh - 16) / step) + 1);
      const k = Math.min(nRows, cfg.passes());
      const first = Math.floor(Math.random() * (nRows - k + 1));
      const rows = Array.from({ length: k }, (_, j) => (nRows === 1 ? by + bh / 2 : by + 8 + (first + j) * ((bh - 16) / (nRows - 1 || 1))));
      if (!e.above) rows.reverse();
      const passes = [];
      rows.forEach((ry, j) => {
        const [a, b] = j % 2 ? [x1, x0] : [x0, x1];
        passes.push({ x: a, y: ry, work: j > 0 }, { x: b, y: ry, work: true });
      });
      const parked0 = Math.hypot(T.x - cfg.park.x, T.y - cfg.park.y) < 2;
      const start = parked0 ? [{ x: cfg.park.x, y: 282 }] : onRoad(here) ? [] : [nearestRoad(here)];
      const from = start.length ? start[start.length - 1] : here;
      T.path = [...start, ...route(from, { x: e.x, y: e.y }), { x: e.x, y: edgeY }, { x: passes[0].x, y: edgeY }, ...passes,
        { x: passes[passes.length - 1].x, y: edgeY }, { x: e.x, y: edgeY }, { x: e.x, y: e.y }];
      T.mode = "work";
    }
    function step(dt) {
      if (!g || !lastState || !T.on) return;
      const moving = gameRunning;
      if (T.mode === "sleep") {
        T.work = false;
        if (moving && (T.wait -= dt) <= 0) { T.wait = rnd(2, 5); plan(lastState); }
      } else if (moving && T.wait > 0) T.wait -= dt;
      else if (moving && !T.path.length) {
        if (T.mode === "park") { T.mode = "sleep"; T.a = -Math.PI / 2; T.wait = rnd(3, 6); }
        else { T.wait = rnd(1, 3); plan(lastState); }
      } else if (moving) {
        const p = T.path[0], dx = p.x - T.x, dy = p.y - T.y, d = Math.hypot(dx, dy);
        T.work = T.mode === "work" && !!p.work;
        const speed = (T.work ? cfg.workSpeed : cfg.speed) * (cfg.fast && cfg.fast() ? 1.25 : 1) * (rainy ? .8 : 1);
        if (d < .5) T.path.shift();
        else {
          const ta = Math.atan2(dy, dx);
          let da = ta - T.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          T.a += da * Math.min(1, dt * 6);
          const v = Math.min(d, speed * dt * (Math.abs(da) > 1.2 ? .25 : 1));
          T.x += (dx / d) * v; T.y += (dy / d) * v; T.dist += v;
          if (T.work && cfg.rut && T.dist - T.lastRut > 7) { T.lastRut = T.dist; cfg.rut(T); }
        }
      }
      if (cfg.puffs && T.mode !== "sleep" && gameRunning && (T.puff -= dt) <= 0) {
        T.puff = T.work ? .18 : (T.path.length ? .3 : .7);
        puff(T.x + Math.cos(T.a) * 6 + Math.sin(T.a) * 7.5, T.y + Math.sin(T.a) * 6 - Math.cos(T.a) * 7.5);
      }
      if (cfg.frame) cfg.frame(g, T, dt);
      g.setAttribute("transform", `translate(${T.x.toFixed(1)} ${T.y.toFixed(1)}) rotate(${(T.a * 57.3).toFixed(1)})`);
    }
    function update(state) {
      lastState = state;
      const on = cfg.enabled(state);
      if (on && !g) { g = el("g", { class: "vehicle" }, layers.tractor); g.innerHTML = cfg.svg; T.x = cfg.park.x; T.y = cfg.park.y; T.mode = "sleep"; }
      if (!on && g) { g.remove(); g = null; }
      T.on = on;
      if (g && cfg.paint) cfg.paint(g, state, T);
    }
    function reset() {
      if (!g) return;
      T.path = [];
      if (T.mode !== "sleep") { const p = nearestRoad({ x: T.x, y: T.y }); T.x = p.x; T.y = p.y; T.mode = "idle"; T.wait = .5; }
    }
    return { step, update, reset, state: T };
  }

  function rut(T, w = 30) {
    const r = el("rect", { x: -3, y: -w / 2, width: 6, height: w, rx: 2, class: "rut",
      transform: `translate(${(T.x - Math.cos(T.a) * 26).toFixed(1)} ${(T.y - Math.sin(T.a) * 26).toFixed(1)}) rotate(${(T.a * 57.3).toFixed(0)})` }, layers.ruts);
    setTimeout(() => r.remove(), 40000);
  }
  function puff(x, y) {
    const c = el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: 4, class: "puff" }, layers.puffs);
    setTimeout(() => c.remove(), 1700);
  }
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const openFields = (state) => FIELDS.filter((k) => state.champs[k] && !state.champs[k].serre);

  // Tracteur : laboure les planches libres, bine celles qui poussent. Rouge, puis vert une fois le neuf acheté.
  const tractor = makeVehicle({
    park: { x: 312, y: 232 }, speed: 58, workSpeed: 26, margin: 22, rowStep: 26, passes: () => 3 + Math.floor(Math.random() * 3),
    roam: true, puffs: true, rut: (T) => rut(T), fast: () => upgraded,
    enabled: () => true,
    choose: (state) => {
      if (Math.random() > .55) return null;
      const beds = openFields(state).flatMap((k) => state.champs[k].planches.map((b, i) => [k, i, b]));
      if (!beds.length) return null;
      const free = beds.filter(([, , b]) => b.etat === "vide" || b.etat === "fletri");
      const [k, i] = free.length && Math.random() < .7 ? pick(free) : pick(beds);
      return [k, i];
    },
    svg: `
        <g class="t-lights" opacity="0"><path d="M22 -9L86 -30L86 4Z M22 9L86 -4L86 30Z" fill="#FFE9A3" opacity=".45"/></g>
        <g class="t-plow" opacity="0"><rect class="t-tool" x="-36" y="-17" width="9" height="34" rx="3" fill="#8A8F94"/><path d="M-27 -12h7M-27 0h7M-27 12h7" stroke="#6C7176" stroke-width="3"/></g>
        <rect x="-19" y="-12" width="44" height="28" rx="7" fill="#000" opacity=".16"/>
        <rect x="-22" y="-19" width="18" height="9" rx="3" fill="#2B2B2B"/><rect x="-22" y="10" width="18" height="9" rx="3" fill="#2B2B2B"/>
        <path class="t-tread" d="M-21 -14.5H-5M-21 14.5H-5" stroke="#555" stroke-width="7" stroke-dasharray="2 2.5"/>
        <rect x="9" y="-14" width="10" height="6" rx="2" fill="#2B2B2B"/><rect x="9" y="8" width="10" height="6" rx="2" fill="#2B2B2B"/>
        <rect class="t-body" x="-16" y="-10" width="38" height="20" rx="6" fill="#C8392E"/>
        <rect class="t-hood" x="5" y="-7" width="16" height="14" rx="4" fill="#A72F26"/>
        <path d="M9 -4h10M9 0h10M9 4h10" stroke="#000" stroke-width="1" opacity=".18"/>
        <rect x="-17" y="-11" width="18" height="22" rx="4" fill="#F4F1EA" stroke="#D5CFC2" stroke-width="1"/>
        <rect x="-14" y="-8" width="12" height="16" rx="2" fill="#fff" opacity=".6"/>
        <circle cx="6" cy="-7.5" r="2.4" fill="#3A3A3A"/>`,
    paint: (g, state, T) => {
      g.querySelector(".t-body").setAttribute("fill", upgraded ? "#3A8A3F" : "#C8392E");
      g.querySelector(".t-hood").setAttribute("fill", upgraded ? "#2E7234" : "#A72F26");
      // avec le semoir autonome, le tracteur tire un semoir vert au lieu de la charrue
      g.querySelector(".t-tool").setAttribute("fill", state.technologies.includes("semoir") ? "#5FA344" : "#8A8F94");
      g.querySelector(".t-lights").setAttribute("opacity", night > .45 && T.mode !== "sleep" ? 1 : 0);
    },
    frame: (g, T) => {
      g.querySelectorAll(".t-tread").forEach((t) => t.setAttribute("stroke-dashoffset", (-T.dist * .6).toFixed(1)));
      g.querySelector(".t-plow").setAttribute("opacity", T.work ? 1 : 0);
    },
  });

  // Robot désherbeur : petit, électrique, il longe les rangs des planches qui poussent
  const weeder = makeVehicle({
    park: { x: 346, y: 220 }, speed: 34, workSpeed: 13, margin: 18, rowStep: 18, passes: () => 2 + Math.floor(Math.random() * 2),
    enabled: (state) => state.technologies.includes("desherbeur"),
    choose: (state) => {
      const beds = FIELDS.flatMap((k) => state.champs[k].planches.map((b, i) => [k, i, b])).filter(([, , b]) => b.etat === "seme" || b.etat === "pousse");
      return beds.length ? pick(beds).slice(0, 2) : null;
    },
    rut: (T) => { if (Math.random() < .5) { const l = el("circle", { cx: (T.x - Math.cos(T.a) * 10 + rnd(-5, 5)).toFixed(1), cy: (T.y - Math.sin(T.a) * 10 + rnd(-5, 5)).toFixed(1), r: 2, class: "weed" }, layers.ruts); setTimeout(() => l.remove(), 4000); } },
    svg: `<rect x="-11" y="-9" width="24" height="20" rx="5" fill="#000" opacity=".15"/>
      <rect x="-10" y="-11" width="7" height="4" rx="1.5" fill="#2B2B2B"/><rect x="4" y="-11" width="7" height="4" rx="1.5" fill="#2B2B2B"/>
      <rect x="-10" y="7" width="7" height="4" rx="1.5" fill="#2B2B2B"/><rect x="4" y="7" width="7" height="4" rx="1.5" fill="#2B2B2B"/>
      <rect x="-11" y="-8" width="22" height="16" rx="4" fill="#F08A24"/>
      <rect x="-8" y="-6" width="14" height="12" rx="2" fill="#2D4A7A"/><path d="M-8 -2h14M-8 2h14M-3 -6v12M2 -6v12" stroke="#6F8FC4" stroke-width=".8"/>
      <path d="M11 -5l4 -1M11 0h5M11 5l4 1" stroke="#9AA3AB" stroke-width="1.6" stroke-linecap="round"/>
      <circle class="r-led" cx="8" cy="-5" r="1.4" fill="#7CFC7C"/>`,
    frame: (g, T) => g.querySelector(".r-led").setAttribute("opacity", T.mode === "sleep" ? .3 : (Math.sin(performance.now() / 180) > 0 ? 1 : .2)),
  });

  // Robot de récolte : surveille les planches presque mûres (il récolte dès qu'elles sont prêtes)
  const harvester = makeVehicle({
    park: { x: 346, y: 246 }, speed: 40, workSpeed: 18, margin: 24, rowStep: 30, passes: () => 2,
    enabled: (state) => state.technologies.includes("recolteur"),
    choose: (state) => {
      const beds = FIELDS.flatMap((k) => state.champs[k].planches.map((b, i) => [k, i, b])).filter(([, , b]) => b.etat === "pousse" && b.croissance > 70);
      return beds.length && Math.random() < .8 ? pick(beds).slice(0, 2) : null;
    },
    svg: `<rect x="-15" y="-11" width="32" height="25" rx="5" fill="#000" opacity=".15"/>
      <rect x="-14" y="-14" width="9" height="5" rx="2" fill="#2B2B2B"/><rect x="5" y="-14" width="9" height="5" rx="2" fill="#2B2B2B"/>
      <rect x="-14" y="9" width="9" height="5" rx="2" fill="#2B2B2B"/><rect x="5" y="9" width="9" height="5" rx="2" fill="#2B2B2B"/>
      <rect x="-15" y="-11" width="30" height="22" rx="5" fill="#EEF1F3" stroke="#C9D0D6" stroke-width="1"/>
      <rect x="-12" y="-8" width="14" height="16" rx="2" fill="#B5835A"/><path d="M-12 -3h14M-12 2h14" stroke="#8E6638" stroke-width="1"/>
      <rect x="-12" y="-8" width="14" height="5" rx="1.5" fill="#E2412F" opacity=".85"/><rect x="-12" y="3" width="14" height="5" rx="1.5" fill="#F4D35E" opacity=".85"/>
      <path class="r-arm" d="M8 0h10" stroke="#5E6B78" stroke-width="3" stroke-linecap="round"/><circle cx="19" cy="0" r="3" fill="#5E6B78"/>
      <rect x="4" y="-9" width="9" height="4" rx="1" fill="#3A8A3F"/>`,
    frame: (g, T) => g.querySelector(".r-arm").setAttribute("transform", T.work ? `rotate(${(Math.sin(performance.now() / 260) * 25).toFixed(0)} 8 0)` : ""),
  });

  // Drone agricole : vole d'une planche en culture à l'autre et pulvérise ; reste sur son aire en cas d'orage
  const DRONE_PAD = { x: 446, y: 206 };
  const drone = (() => {
    const D = { x: DRONE_PAD.x, y: DRONE_PAD.y, a: 0, alt: 0, path: [], spray: false, wait: 2, mist: 0, on: false, grounded: true };
    let g = null, body = null, shadow = null, pad = null, lastState = null;
    function build() {
      pad = el("g", { class: "drone-pad" });
      svg.insertBefore(pad, layers.ruts);
      pad.innerHTML = `<circle cx="${DRONE_PAD.x}" cy="${DRONE_PAD.y}" r="15" fill="#5E6B78"/><circle cx="${DRONE_PAD.x}" cy="${DRONE_PAD.y}" r="12" fill="none" stroke="#F2C14E" stroke-width="1.5"/>
        <text x="${DRONE_PAD.x}" y="${DRONE_PAD.y + 4.5}" text-anchor="middle" class="pad-h">H</text>`;
      shadow = el("g", { opacity: .2 }, layers.drone);
      shadow.innerHTML = `<path d="M-9 -9L9 9M9 -9L-9 9" stroke="#000" stroke-width="4"/><circle r="6" fill="#000"/>` +
        [[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#000"/>`).join("");
      g = el("g", {}, layers.drone);
      body = el("g", {}, g);
      body.innerHTML = `<path d="M-10 -10L10 10M10 -10L-10 10" stroke="#3C4650" stroke-width="3.2" stroke-linecap="round"/>
        <rect x="-7" y="-6" width="14" height="12" rx="4" fill="#F4F6F7" stroke="#B9C3CA" stroke-width="1"/><rect x="-3" y="-3" width="6" height="6" rx="2" fill="#3C8CD6"/>
        <rect x="-5" y="6" width="10" height="4" rx="1.5" fill="#8FB7D6"/>` +
        [[-10, -10], [10, -10], [-10, 10], [10, 10]].map(([x, y]) => `<g transform="translate(${x} ${y})"><circle r="7.5" fill="#fff" opacity=".35" stroke="#C9D2D9" stroke-width=".8"/>
          <g class="rotor"><path d="M-7 0H7" stroke="#2B2B2B" stroke-width="1.8" stroke-linecap="round"/></g><circle r="1.6" fill="#2B2B2B"/></g>`).join("") +
        `<circle class="d-led" cx="0" cy="-7" r="1.6" fill="#E2412F"/>`;
    }
    function plan(state) {
      const beds = FIELDS.flatMap((k) => state.champs[k].planches.map((b, i) => [k, i, b])).filter(([, , b]) => ["seme", "pousse", "mur"].includes(b.etat));
      if (!beds.length) { D.path = [{ ...DRONE_PAD, land: true }]; D.wait = rnd(4, 8); return; }
      const [k, i] = pick(beds), n = state.champs[k].planches.length;
      const [bx, by, bw, bh] = bedBox(k, i, n);
      const rows = n === 1 ? [by + bh * .25, by + bh * .5, by + bh * .75] : [by + bh * .3, by + bh * .7];
      D.path = [];
      rows.forEach((y, j) => {
        const [a, b] = j % 2 ? [bx + bw - 14, bx + 14] : [bx + 14, bx + bw - 14];
        D.path.push({ x: a, y, spray: j > 0 }, { x: b, y, spray: true });
      });
    }
    function step(dt) {
      if (!g || !lastState) return;
      const stay = !D.on || D.grounded || nightTime(lastState);
      if (stay && !D.path.some((p) => p.land)) D.path = [{ ...DRONE_PAD, land: true }];
      if (gameRunning) {
        const target = D.path[0];
        const landed = Math.hypot(D.x - DRONE_PAD.x, D.y - DRONE_PAD.y) < 1 && (!target || target.land);
        D.alt += ((landed ? 0 : 1) - D.alt) * Math.min(1, dt * 2);
        if (D.wait > 0) D.wait -= dt;
        else if (!target) { if (!stay) plan(lastState); }
        else if (D.alt > .6 || landed || target.land) {
          const dx = target.x - D.x, dy = target.y - D.y, d = Math.hypot(dx, dy);
          if (d < 1) { D.path.shift(); if (target.land) { D.wait = rnd(3, 6); D.path = []; } }
          else {
            const v = Math.min(d, (target.spray ? 55 : 95) * dt);
            D.x += (dx / d) * v; D.y += (dy / d) * v;
            let da = Math.atan2(dy, dx) - D.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
            D.a += da * Math.min(1, dt * 4);
          }
          D.spray = !!target.spray && d > 1;
        }
        if (D.spray && (D.mist -= dt) <= 0) {
          D.mist = .07;
          const m = el("circle", { cx: (D.x + rnd(-8, 8)).toFixed(1), cy: (D.y + 14 + rnd(-6, 6)).toFixed(1), r: 3, class: "mist" }, layers.ruts);
          setTimeout(() => m.remove(), 1300);
        }
      }
      const off = 4 + D.alt * 18, sc = .8 + D.alt * .25;
      shadow.setAttribute("transform", `translate(${(D.x + off * .5).toFixed(1)} ${(D.y + off).toFixed(1)}) rotate(${(D.a * 57.3).toFixed(0)}) scale(${(.85 - D.alt * .15).toFixed(2)})`);
      shadow.setAttribute("opacity", (.22 - D.alt * .08).toFixed(2));
      g.setAttribute("transform", `translate(${D.x.toFixed(1)} ${(D.y - D.alt * 6).toFixed(1)}) rotate(${(D.a * 57.3 + 90).toFixed(0)}) scale(${sc.toFixed(2)})`);
      g.classList.toggle("flying", D.alt > .05);
      body.querySelector(".d-led").setAttribute("fill", Math.sin(performance.now() / 150) > .3 ? "#E2412F" : "#7CFC7C");
    }
    function update(state) {
      lastState = state;
      D.on = state.technologies.includes("drone");
      D.grounded = !state.derive.drone_actif;
      if (D.on && !g) build();
      if (!D.on && g) { g.remove(); shadow.remove(); pad.remove(); g = null; }
    }
    return { step, update, state: D };
  })();

  const vehicles = [tractor, weeder, harvester];

  // ------------------------------------------------------------------ étiquettes / zones cliquables
  function labelsSVG() {
    let s = "";
    const label = (id) => (id === "a_vendre" && sale ? `À vendre · ${new Intl.NumberFormat("fr-FR").format(sale.prix)} €` : names[id] || ZONES[id].nom);
    for (const [id, z] of Object.entries(ZONES)) {
      const [x, y, w, h] = z.box;
      s += `<g class="zone" data-zone="${id}"><rect class="zone-hit" x="${x}" y="${y}" width="${w}" height="${h}" rx="24"/></g>`;
    }
    for (const [id, z] of Object.entries(ZONES)) {
      const [x, y, w] = z.box;
      const nom = label(id), ico = /^Serre/.test(nom) ? "greenhouse" : z.icon;
      const tw = nom.length * 9.6 + 46;
      const lx = x + w / 2 - tw / 2, ly = y - 2;
      s += `<g class="zone-label" data-zone="${id}" transform="translate(${lx} ${ly + (id === "maison" ? 8 : 0)})" style="pointer-events:none">
        <rect width="${tw}" height="32" rx="16" filter="url(#lblshadow)"/>
        <svg x="12" y="7" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1D3527" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[ico]}</svg>
        <text x="36" y="21.5">${nom}</text></g>`;
    }
    return s;
  }

  // ------------------------------------------------------------------ animaux
  function syncHerd(animaux) {
    const keep = new Set();
    for (const [cat, grp] of Object.entries(animaux)) {
      grp.liste.slice(0, MAX_SHOWN[cat]).forEach((a) => {
        keep.add(a.id);
        let e = herd.get(a.id);
        if (!e) {
          const [x1, y1, x2, y2] = PENS[cat];
          const g = el("g", {}, layers.animals);
          g.innerHTML = ART.top[cat];
          const mark = el("circle", { r: 4, cx: 0, cy: -12, fill: "#D6544B", stroke: "#fff", "stroke-width": 1.5, opacity: 0 }, g);
          e = { cat, el: g, mark, x: rnd(x1, x2), y: rnd(y1, y2), a: rnd(0, 6.28), tx: 0, ty: 0, wait: rnd(0, 3),
                speed: { vaches: 9, moutons: 11, cochons: 10, poules: 22 }[cat] };
          e.tx = e.x; e.ty = e.y;
          herd.set(a.id, e);
        }
        e.sick = a.sante < 50;
        e.mark.setAttribute("opacity", e.sick ? 1 : 0);
      });
    }
    for (const [id, e] of herd) if (!keep.has(id)) { e.el.remove(); herd.delete(id); }
  }

  function stepHerd(dt) {
    for (const e of herd.values()) {
      if (e.wait > 0) { e.wait -= dt * (night > .6 ? .2 : 1); }
      else {
        const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
        if (d < 1) {
          const [x1, y1, x2, y2] = PENS[e.cat];
          e.tx = Math.min(x2, Math.max(x1, e.x + rnd(-70, 70)));
          e.ty = Math.min(y2, Math.max(y1, e.y + rnd(-40, 40)));
          e.wait = rnd(1, e.cat === "poules" ? 2.5 : 6);
        } else {
          const v = Math.min(d, e.speed * (e.sick ? .5 : 1) * dt);
          e.x += (dx / d) * v; e.y += (dy / d) * v;
          const ta = Math.atan2(dy, dx);
          let da = ta - e.a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          e.a += da * Math.min(1, dt * 5);
        }
      }
      e.el.setAttribute("transform", `translate(${e.x.toFixed(1)} ${e.y.toFixed(1)}) rotate(${(e.a * 57.3).toFixed(1)}) scale(${SCALE[e.cat]})`);
    }
  }

  // ------------------------------------------------------------------ zoom
  function setVB(v) { vb = v; svg.setAttribute("viewBox", v.map((n) => n.toFixed(1)).join(" ")); }
  function zoomTo(target, dur = 750) {
    const from = vb.slice(), t0 = performance.now();
    const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    anim = (now) => {
      const t = Math.min(1, (now - t0) / dur), k = ease(t);
      setVB(from.map((v, i) => v + (target[i] - v) * k));
      if (t >= 1) anim = null;
    };
  }
  function boxFor(id) {
    if (!id || !ZONES[id]) return [0, 0, W, H];
    let [x, y, w, h] = ZONES[id].box;
    const pad = 16; x -= pad; y -= pad; w += pad * 2; h += pad * 2;
    const ratio = W / H;
    if (w / h > ratio) { const nh = w / ratio; y -= (nh - h) / 2; h = nh; } else { const nw = h * ratio; x -= (nw - w) / 2; w = nw; }
    x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
    return [x, y, w, h];
  }
  function showLabels() {
    svg.querySelectorAll(".zone-label").forEach((l) => l.setAttribute("opacity", !focused || l.dataset.zone === focused ? 1 : 0));
  }
  function focus(id) {
    focused = id;
    zoomTo(boxFor(id));
    showLabels();
  }

  // ------------------------------------------------------------------ cycle
  function loop(t) {
    const dt = Math.min(.1, (t - lastT) / 1000 || 0);
    lastT = t;
    if (anim) anim(t);
    stepHerd(dt);
    vehicles.forEach((v) => v.step(dt));
    drone.step(dt);
    requestAnimationFrame(loop);
  }

  function init(svgEl, select) {
    svg = svgEl;
    onSelect = select;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><filter id="lblshadow" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity=".18"/></filter></defs>`;
    layers.base = el("g", {}, svg);
    layers.base.innerHTML = staticLayer();
    layers.fields = el("g", {}, svg);
    for (const k of FIELDS) layers[k] = el("g", {}, layers.fields);
    layers.sale = el("g", {}, svg);
    layers.ruts = el("g", { "pointer-events": "none" }, svg);
    layers.wind = el("g", {}, svg);
    layers.hives = el("g", {}, svg);
    layers.tank = el("g", {}, svg);
    layers.workshop = el("g", {}, svg);
    layers.animals = el("g", {}, svg);
    layers.tractor = el("g", { "pointer-events": "none" }, svg);
    layers.puffs = el("g", { "pointer-events": "none" }, svg);
    layers.drone = el("g", { "pointer-events": "none" }, svg);
    layers.weather = el("g", { "pointer-events": "none" }, svg);
    layers.weather.innerHTML = `<rect id="map-heat" width="${W}" height="${H}" fill="#FFB347" opacity="0"/>
      <rect id="map-frost" width="${W}" height="${H}" fill="#EAF3FA" opacity="0"/>
      <g id="map-snow" opacity="0" fill="#fff">${Array.from({ length: 140 }, (_, i) => {
        const RH = BASE_H + 3 * ROW_H, x = (i * 137) % W, y = (i * 59) % RH, d = (4 + (i % 7) * .6).toFixed(1), r = 1.6 + (i % 3) * .7;
        return `<circle cx="${x}" cy="${y}" r="${r}"><animateTransform attributeName="transform" type="translate" values="0 -${RH};${(i % 2 ? 14 : -14)} -${RH / 2};0 0" dur="${d}s" repeatCount="indefinite"/></circle>`;
      }).join("")}</g>
      <rect id="map-night" width="${W}" height="${H}" fill="#0E1A33" opacity="0"/>
      <g id="map-rain" opacity="0" stroke="#E8F2FA" stroke-width="2" stroke-linecap="round">${Array.from({ length: 170 }, (_, i) => {
        const RH = BASE_H + 3 * ROW_H;   // la pluie couvre la carte même agrandie au maximum
        const x = (i * 113) % W, y = (i * 71) % RH, d = ((.5 + (i % 5) * .08) * RH / BASE_H).toFixed(2);
        return `<line x1="${x}" y1="${y}" x2="${x - 5}" y2="${y + 14}"><animateTransform attributeName="transform" type="translate" from="0 -${RH}" to="0 0" dur="${d}s" repeatCount="indefinite"/></line>`;
      }).join("")}</g>`;
    layers.labels = el("g", {}, svg);
    layers.labels.innerHTML = labelsSVG();
    svg.addEventListener("click", (ev) => {
      const z = ev.target.closest(".zone");
      if (z) onSelect(z.dataset.zone);
    });
    requestAnimationFrame(loop);
  }

  function update(state) {
    const extras = Object.keys(state.champs).filter((k) => !BASE_FIELDS.includes(k)).sort();
    season = state.derive.saison ? state.derive.saison.id : "printemps";
    const sig = `${extras.join()}|${state.derive.terrain_a_vendre ? state.derive.terrain_a_vendre.cle : ""}|${season}`;
    if (sig !== layoutSig) { layoutSig = sig; relayout(state); cache.labels = null; }
    else if (sale && state.derive.terrain_a_vendre && sale.prix !== state.derive.terrain_a_vendre.prix) { sale = state.derive.terrain_a_vendre; layers.sale.innerHTML = saleSVG(); }
    gameRunning = state.vitesse > 0 && !state.menu;
    rainy = !!state.derive.pluie;
    for (const k of FIELDS) {
      const f = state.champs[k];
      const sig = `${f.serre}|${Math.round(f.humidite / 8)}|${f.humidite < 18}|${f.humidite > 75}|` + f.planches.map((b) => `${b.etat}${b.culture}${Math.round(b.croissance / 4)}`).join(",");
      if (cache[k] !== sig) { cache[k] = sig; layers[k].innerHTML = fieldSVG(k, f); }
    }
    const wsig = `${state.eoliennes}|${state.derive.vent}|${season}`;
    if (cache.wind !== wsig) { cache.wind = wsig; layers.wind.innerHTML = windSVG(state.eoliennes, state.derive.vent); }
    const bees = (state.ruches || 0) > 0 && !state.derive.pluie && ART.nightAmount(state.derive.heure_dec) < .5;
    const hsig = `${state.ruches}|${bees}`;
    if (cache.hives !== hsig) { cache.hives = hsig; layers.hives.innerHTML = hivesSVG(state.ruches || 0, bees); }
    const lsig = JSON.stringify(state.derive.noms_champs);
    if (cache.labels !== lsig) {
      cache.labels = lsig;
      names = state.derive.noms_champs;
      layers.labels.innerHTML = labelsSVG();
      showLabels();
    }
    const tsig = `${Math.round(state.reservoir.niveau / state.reservoir.capacite * 60)}|${state.ameliorations.join()}`;
    if (cache.tank !== tsig) { cache.tank = tsig; layers.tank.innerHTML = tankSVG(state.reservoir, state.ameliorations); }
    const at = state.atelier, asig = `${at.construit}|${season}|` + Object.entries(at.equipements).map(([k, m]) =>
      `${k}${m.lot ? Math.round((state.derive.atelier[k] || {}).progression / 4) : "-"}`).join(",");
    if (cache.workshop !== asig) { cache.workshop = asig; layers.workshop.innerHTML = workshopSVG(state); }
    syncHerd(state.animaux);
    const h = state.derive.heure_dec, w = state.meteo.type;
    night = ART.nightAmount(h);
    svg.querySelector("#map-night").setAttribute("opacity", (night * .42).toFixed(2));
    const wet = w === "pluie" || w === "orage", snow = wet && state.meteo.nom === "Neige";
    svg.querySelector("#map-rain").setAttribute("opacity", wet && !snow ? .6 : 0);
    svg.querySelector("#map-snow").setAttribute("opacity", snow ? .9 : 0);
    svg.querySelector("#map-frost").setAttribute("opacity", season === "hiver" ? (state.derive.gel ? .28 : .14) : 0);
    svg.querySelector("#map-heat").setAttribute("opacity", w === "canicule" && night < .5 ? .08 : 0);
    upgraded = state.ameliorations.includes("tracteur");
    vehicles.forEach((v) => v.update(state));
    drone.update(state);
  }

  return { init, update, focus, ZONES, FIELDS, tractor: tractor.state, drone: drone.state, weeder: weeder.state };
})();

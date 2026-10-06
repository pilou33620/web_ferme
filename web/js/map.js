// Carte de la ferme vue du dessus : décor statique, cultures, serres, éoliennes, réservoir, animaux animés, zoom.

const FarmMap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, H = 760;

  const ZONES = {
    maison:    { nom: "Maison",      icon: "house",  box: [20, 20, 450, 232] },
    parcelle_a: { nom: "Parcelle A", icon: "sprout", box: [530, 20, 450, 232] },
    parcelle_b: { nom: "Parcelle B", icon: "sprout", box: [20, 312, 450, 158] },
    parcelle_c: { nom: "Parcelle C", icon: "sprout", box: [530, 312, 450, 158] },
    enclos:    { nom: "Animaux",     icon: "fence",  box: [20, 530, 450, 212] },
    reservoir: { nom: "Eau & stock", icon: "tank",   box: [530, 530, 450, 212] },
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
  const FIELDS = ["parcelle_a", "parcelle_b", "parcelle_c"];
  // emplacements des éoliennes près de la maison (un arbre y pousse tant qu'on n'en a pas acheté)
  const TURBINE_SLOTS = [[340, 70], [432, 64]];

  let svg, layers = {}, vb = [0, 0, W, H], anim = null, onSelect = () => {};
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
  function tree(x, y, r, c = "#4E9A3A") {
    return `<g><circle cx="${x + 3}" cy="${y + 4}" r="${r}" fill="#000" opacity=".12"/>
      <circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .45}" fill="#fff" opacity=".13"/></g>`;
  }
  function bush(x, y, r) { return `<circle cx="${x}" cy="${y}" r="${r}" fill="#5DA548"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .4}" fill="#fff" opacity=".12"/>`; }

  function staticLayer() {
    let s = "";
    // herbe + texture
    s += `<rect width="${W}" height="${H}" fill="#A9D282"/>`;
    for (let i = 0; i < 160; i++) {
      s += `<path d="M${seeded(i) * W} ${seeded(i + 999) * H} l2 -5 l2 5" stroke="#93C46B" stroke-width="1.4" fill="none"/>`;
    }
    // routes
    const road = "#EADBBD", edge = "#D8C59E";
    s += `<rect x="478" y="0" width="44" height="${H}" fill="${road}"/>`;
    s += `<rect x="0" y="262" width="${W}" height="40" fill="${road}"/><rect x="0" y="480" width="${W}" height="40" fill="${road}"/>`;
    s += `<path d="M478 0V${H}M522 0V${H}M0 262H${W}M0 302H${W}M0 480H${W}M0 520H${W}" stroke="${edge}" stroke-width="2"/>`;
    s += `<path d="M500 0V${H}M0 282H${W}M0 500H${W}" stroke="#F7EEDC" stroke-width="3" stroke-dasharray="14 14"/>`;
    // canalisation d'irrigation
    s += `<path d="M512 0V${H}" stroke="#7FB6E0" stroke-width="3"/>`;
    for (let y = 30; y < H; y += 60) s += `<circle cx="512" cy="${y}" r="4.5" fill="#4C93D1" stroke="#fff" stroke-width="1.5"/>`;

    // ---- maison
    s += `<rect x="24" y="24" width="442" height="224" rx="26" fill="#9FD17C" stroke="#4E8F3B" stroke-width="10"/>`;
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
    s += tree(48, 58, 18) + tree(298, 140, 15, "#5DA548");
    for (let x = 220; x < 300; x += 18) s += bush(x, 222, 8);
    s += `<g id="tractor-art" opacity="0" transform="translate(300 214)"><rect x="-18" y="-11" width="36" height="22" rx="5" fill="#3A8A3F"/><rect x="-4" y="-9" width="14" height="18" rx="3" fill="#2B2B2B" opacity=".5"/><rect x="-24" y="-16" width="14" height="8" rx="2" fill="#222"/><rect x="-24" y="8" width="14" height="8" rx="2" fill="#222"/><rect x="12" y="-14" width="10" height="6" rx="2" fill="#222"/><rect x="12" y="8" width="10" height="6" rx="2" fill="#222"/></g>`;

    // ---- haies des champs
    for (const k of FIELDS) {
      const [x, y, w, h] = ZONES[k].box;
      s += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="${h - 8}" rx="24" fill="#8CC067" stroke="#4E8F3B" stroke-width="10"/>`;
    }

    // ---- enclos
    s += `<rect x="24" y="534" width="442" height="204" rx="22" fill="#9BCB72"/>`;
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
    s += `<rect x="534" y="534" width="442" height="204" rx="22" fill="#C9CCC4"/>`;
    s += `<path d="M534 600H976M534 670H976M640 534V738M760 534V738M880 534V738" stroke="#BABDB4" stroke-width="1.5"/>`;
    s += `<g transform="translate(884 548)"><rect x="5" y="6" width="80" height="176" rx="6" fill="#000" opacity=".14"/><rect width="80" height="176" rx="6" fill="#9AA1A8"/>`;
    for (let i = 1; i < 12; i++) s += `<path d="M${i * 6.6} 0V176" stroke="#868D94" stroke-width="1.5"/>`;
    s += `<path d="M40 0V176" stroke="#6F767D" stroke-width="3"/></g>`;
    s += `<g transform="translate(840 700)"><rect width="30" height="24" rx="4" fill="#5E6B78"/><circle cx="15" cy="12" r="6" fill="#8FB7D6"/></g>`;
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

  function fieldSVG(key, f) {
    const [x0, y0, w, h] = ZONES[key].box;
    const x = x0 + 22, y = y0 + 22, bw = w - 44, bh = h - 44;
    let s = `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="${soilColor(f.humidite)}"/>`;
    const sp = SPACING[f.culture] || 24;
    const rows = Math.max(3, Math.round(bh / sp)), cols = Math.max(6, Math.round(bw / sp));
    const dy = bh / rows, dx = bw / cols;
    for (let r = 0; r < rows; r++) {
      s += `<rect x="${x + 8}" y="${y + r * dy + dy * .5 - 4}" width="${bw - 16}" height="8" rx="4" fill="#000" opacity=".13"/>`;
    }
    if (f.humidite < 18) {
      for (let i = 0; i < 14; i++) {
        const cx = x + 10 + seeded(i + key.length) * (bw - 20), cy = y + 10 + seeded(i * 3 + key.length) * (bh - 20);
        s += `<path d="M${cx} ${cy}l6 4l-3 6l7 3" stroke="#9C7048" stroke-width="1.5" fill="none"/>`;
      }
    }
    if (f.humidite > 75) s += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="14" fill="#4C93D1" opacity=".08"/>`;
    if (f.etat !== "vide" && f.culture) {
      const g = Math.max(0, Math.min(1, f.croissance / 100));
      const dead = f.etat === "fletri", ripe = f.etat === "mur";
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const px = x + c * dx + dx / 2, py = y + r * dy + dy / 2;
          if (f.croissance < 6 && !dead) { s += `<circle cx="${px}" cy="${py}" r="2" fill="#9AD46B"/>`; continue; }
          s += plantSVG(f.culture, px, py, g, ripe, dead, seeded(r * 31 + c * 7 + key.length), c);
        }
      }
    }
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
      else s += i === 0 ? tree(330, 60, 22) + tree(366, 82, 16, "#5DA548") : tree(440, 50, 14);
    });
    return s;
  }

  // ------------------------------------------------------------------ réservoir
  function tankSVG(res, ups) {
    const frac = res.niveau / res.capacite;
    const tanks = ups.includes("reservoir") ? [[630, 610, 58], [770, 610, 58], [700, 700, 34]] : [[640, 636, 70], [790, 636, 70]];
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

  // ------------------------------------------------------------------ étiquettes / zones cliquables
  function labelsSVG() {
    let s = "";
    const label = (id) => names[id] || ZONES[id].nom;
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
    requestAnimationFrame(loop);
  }

  function init(svgEl, select) {
    svg = svgEl;
    onSelect = select;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = `<defs><filter id="lblshadow" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity=".18"/></filter></defs>`;
    layers.base = el("g", {}, svg);
    layers.base.innerHTML = staticLayer();
    for (const k of FIELDS) layers[k] = el("g", {}, svg);
    layers.wind = el("g", {}, svg);
    layers.hives = el("g", {}, svg);
    layers.tank = el("g", {}, svg);
    layers.animals = el("g", {}, svg);
    layers.weather = el("g", { "pointer-events": "none" }, svg);
    layers.weather.innerHTML = `<rect id="map-heat" width="${W}" height="${H}" fill="#FFB347" opacity="0"/>
      <rect id="map-night" width="${W}" height="${H}" fill="#0E1A33" opacity="0"/>
      <g id="map-rain" opacity="0" stroke="#E8F2FA" stroke-width="2" stroke-linecap="round">${Array.from({ length: 90 }, (_, i) => {
        const x = (i * 113) % W, y = (i * 71) % H, d = (.5 + (i % 5) * .08).toFixed(2);
        return `<line x1="${x}" y1="${y}" x2="${x - 5}" y2="${y + 14}"><animateTransform attributeName="transform" type="translate" from="0 -${H}" to="0 0" dur="${d}s" repeatCount="indefinite"/></line>`;
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
    for (const k of FIELDS) {
      const f = state.champs[k];
      const sig = `${f.etat}|${f.culture}|${f.serre}|${Math.round(f.croissance / 4)}|${Math.round(f.humidite / 8)}|${f.humidite < 18}`;
      if (cache[k] !== sig) { cache[k] = sig; layers[k].innerHTML = fieldSVG(k, f); }
    }
    const wsig = `${state.eoliennes}|${state.derive.vent}`;
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
    svg.querySelector("#tractor-art").setAttribute("opacity", state.ameliorations.includes("tracteur") ? 1 : 0);
    syncHerd(state.animaux);
    const h = state.derive.heure_dec, w = state.meteo.type;
    night = ART.nightAmount(h);
    svg.querySelector("#map-night").setAttribute("opacity", (night * .42).toFixed(2));
    svg.querySelector("#map-rain").setAttribute("opacity", w === "pluie" || w === "orage" ? .6 : 0);
    svg.querySelector("#map-heat").setAttribute("opacity", w === "canicule" && night < .5 ? .08 : 0);
  }

  return { init, update, focus, ZONES, FIELDS };
})();

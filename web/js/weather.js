// Écran Météo : paysage de la ferme vu de côté, animé selon le temps qu'il fait.
// Soleil, nuages, vent, pluie, orage, canicule, éclaircie (arc-en-ciel), jour et nuit.
// Le décor reprend la ferme du joueur : cultures semées, niveau du réservoir, vaches, éoliennes, tracteur.

const WeatherScene = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const VW = 1200, VH = 520;
  const LANE_Y = 392;                 // bas des roues du tracteur

  // Réglages de chaque ambiance : ciel (haut, bas), nuages, pluie, vent, soleil…
  const MOODS = {
    soleil:    { nom: "Ensoleillé",        sky: ["#62BDF0", "#CFEBFA"], clouds: 2, grey: 0,   rain: 0,   wind: .25, sun: 1,  rays: 1, birds: 1, spray: 0 },
    nuageux:   { nom: "Les nuages arrivent", sky: ["#8FBEDD", "#E2EEF4"], clouds: 6, grey: .15, rain: 0, wind: .45, sun: .55, rays: 0, birds: .5, spray: 1 },
    vent:      { nom: "Le vent se lève",    sky: ["#88B9DA", "#D9ECF5"], clouds: 5, grey: .25, rain: 0,   wind: 1,   sun: .45, rays: 0, birds: 0, spray: 0, leaves: 1 },
    pluie:     { nom: "Averse",             sky: ["#6F8193", "#AAB7C3"], clouds: 7, grey: .75, rain: 1,  wind: .55, sun: 0,  rays: 0, birds: 0, spray: 0, wet: 1 },
    orage:     { nom: "Orage",              sky: ["#46505E", "#7B8794"], clouds: 7, grey: 1,   rain: 1.5, wind: 1,   sun: 0,  rays: 0, birds: 0, spray: 0, wet: 1, bolts: 1 },
    canicule:  { nom: "Canicule",           sky: ["#7FC0EA", "#FBE2A2"], clouds: 0, grey: 0,   rain: 0,   wind: .1,  sun: 1.3, rays: 1, birds: 0, spray: 1, heat: 1 },
    eclaircie: { nom: "Éclaircie",          sky: ["#74BDEB", "#E6F4FB"], clouds: 4, grey: .1,  rain: 0,   wind: .35, sun: .9, rays: 1, birds: 1, spray: 0, rainbow: 1, wet: .5 },
  };
  const ORDER = ["soleil", "nuageux", "vent", "pluie", "orage", "canicule", "eclaircie"];

  let svg, R = {}, mood = null, M = MOODS.soleil, active = false, lastT = 0, time = 0;
  let night = 0, hour = 13, live = true, sprayUntil = 0, autoSpray = false, tankFrac = .8, upgraded = false, gameRunning = true;
  const cur = { sky0: "#62BDF0", sky1: "#CFEBFA", wind: .25, rain: 0 };    // valeurs lissées
  const clouds = [], drops = [], leaves = [], streaks = [], birds = [], sways = [], rotors = [], cows = [];
  const tractor = { x: 200, dir: 1, wait: 0, wheel: 0, puff: 0 };
  const flyer = { x: 700, dir: 1, on: false, grounded: false };
  const crawler = { t: .2, dir: 1, on: false };
  let boltTimer = 4, cropSig = "", herdSig = "", turbSig = "";

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => "#" + hex(a).map((v, i) => Math.round(lerp(v, hex(b)[i], t)).toString(16).padStart(2, "0")).join("");
  const seeded = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

  // ------------------------------------------------------------------ décor fixe
  function treeSVG(s, c) {
    return `<rect x="-4" y="-6" width="8" height="34" rx="3" fill="#7A5434"/>
      <circle cy="-26" r="${24 * s}" fill="${c}"/><circle cx="${-16 * s}" cy="${-12}" r="${16 * s}" fill="${c}"/>
      <circle cx="${16 * s}" cy="-12" r="${17 * s}" fill="${c}"/><circle cx="${-7 * s}" cy="${-34 * s}" r="${10 * s}" fill="#fff" opacity=".14"/>`;
  }
  function pineSVG(s) {
    return `<rect x="-3" y="-4" width="6" height="14" fill="#6B4A2E"/>
      <path d="M0 ${-62 * s}L${20 * s} ${-22 * s}H${-20 * s}Z M0 ${-40 * s}L${26 * s} 0H${-26 * s}Z" fill="#2F7A3E"/>
      <path d="M0 ${-62 * s}L${-20 * s} ${-22 * s}H0Z" fill="#fff" opacity=".08"/>`;
  }
  function cloudSVG() {
    return `<ellipse cx="0" cy="22" rx="78" ry="24"/><circle cx="-34" cy="8" r="30"/><circle cx="10" cy="-8" r="42"/>
      <circle cx="48" cy="10" r="28"/><ellipse class="wx-cloud-shade" cx="0" cy="34" rx="70" ry="12"/>`;
  }
  function turbineSVG(h, big) {
    const b = `<path d="M0 0C3 -5 4 ${-h * .3} 1.6 ${-h * .48}L-1.6 ${-h * .48}C-3 ${-h * .3} -3 -5 0 0Z"/>`;
    return `<path d="M-2 0L-${big ? 5 : 3} ${h}H${big ? 5 : 3}L2 0Z" fill="#F4F6F7"/>
      <g class="wx-rotor" fill="#FAFCFD" stroke="#D5DDE2" stroke-width="1">${b}<g transform="rotate(120)">${b}</g><g transform="rotate(240)">${b}</g></g>
      <circle r="${big ? 4.5 : 2.6}" fill="#E2E7EA"/>`;
  }
  function barnSVG() {
    return `<g transform="translate(1000 244)">
      <rect x="4" y="6" width="150" height="96" fill="#000" opacity=".12"/>
      <path d="M-6 34L75 -18L156 34Z" fill="#8E2A22"/><path d="M-6 34L75 -18L156 34" stroke="#F4EEE2" stroke-width="5" fill="none"/>
      <rect x="0" y="34" width="150" height="66" fill="#C8392E"/>
      <path d="M0 50H150M0 66H150M0 82H150" stroke="#B23228" stroke-width="2"/>
      <rect x="52" y="48" width="46" height="52" fill="#F4EEE2"/><rect x="56" y="52" width="38" height="48" fill="#C8392E"/>
      <path d="M56 52L94 100M94 52L56 100" stroke="#F4EEE2" stroke-width="5"/>
      <rect x="64" y="8" width="22" height="20" fill="#F4EEE2"/><rect id="wx-window" x="67" y="11" width="16" height="14" fill="#5A3B2B"/>
      <path d="M67 18h16M75 11v14" stroke="#F4EEE2" stroke-width="2"/></g>
      <g transform="translate(1160 220)"><rect x="-18" y="0" width="36" height="124" fill="#C9CDD2"/><path d="M-18 0a18 12 0 0 1 36 0Z" fill="#AEB4BA"/>
      <path d="M-18 30H18M-18 60H18M-18 90H18" stroke="#B4BAC0" stroke-width="2"/></g>`;
  }
  function tankSVG() {
    return `<g transform="translate(905 214)">
      <path d="M-20 70L-26 132M20 70L26 132M-20 100H20" stroke="#8A9197" stroke-width="4"/>
      <rect x="-26" y="0" width="52" height="72" rx="8" fill="#E9EEF2" stroke="#C9D2D9" stroke-width="2"/>
      <clipPath id="wx-tank-clip"><rect x="-22" y="4" width="44" height="64" rx="5"/></clipPath>
      <g clip-path="url(#wx-tank-clip)"><rect x="-22" y="4" width="44" height="64" fill="#D7E6F1"/>
        <g id="wx-water"><rect x="-24" y="0" width="48" height="80" fill="#3F8FD8"/>
        <path d="M-24 0q6 -3 12 0t12 0t12 0t12 0" fill="none" stroke="#9CCBF0" stroke-width="2"><animateTransform attributeName="transform" type="translate" values="0 0;-12 0;0 0" dur="2.4s" repeatCount="indefinite"/></path></g></g>
      <path d="M-26 8a26 7 0 0 1 52 0" fill="#C9D2D9"/><rect x="-14" y="22" width="5" height="34" rx="2" fill="#fff" opacity=".4"/></g>`;
  }
  function fenceSVG() {
    let s = `<path d="M0 330H940M0 344H940" stroke="#B88A5A" stroke-width="5"/>`;
    for (let x = 10; x < 940; x += 46) s += `<rect x="${x}" y="318" width="7" height="40" rx="2" fill="#C9A47A"/>`;
    return s;
  }
  function pondSVG() {
    let s = `<ellipse cx="175" cy="474" rx="168" ry="44" fill="#4E8F3B" opacity=".35"/>
      <ellipse cx="170" cy="468" rx="158" ry="38" fill="#C9B48A"/><ellipse cx="170" cy="466" rx="148" ry="33" fill="#4F9BD6"/>
      <ellipse cx="160" cy="460" rx="120" ry="22" fill="#6DB3E6"/>
      <path d="M70 462h40M150 470h50M230 458h26" stroke="#E6F4FD" stroke-width="3" stroke-linecap="round" opacity=".8"/>
      <ellipse cx="110" cy="476" rx="12" ry="5" fill="#5DA548"/><ellipse cx="236" cy="472" rx="10" ry="4" fill="#5DA548"/>`;
    for (let i = 0; i < 7; i++) {
      const x = 276 + i * 7, h = 34 + seeded(i + 4) * 22;
      s += `<path d="M${x} 470q${-3 + i % 3} ${-h / 2} ${-1 + (i % 2) * 2} ${-h}" stroke="#5E8F3A" stroke-width="2.4" fill="none"/>`;
      if (i % 2 === 0) s += `<rect x="${x - 2.5 + (i % 2)}" y="${470 - h - 2}" width="5" height="13" rx="2.5" fill="#7A5434"/>`;
    }
    return s;
  }

  // ------------------------------------------------------------------ champ en perspective
  const ROWS = 10;
  const rowLine = (i) => [lerp(440, 1200, i / ROWS), lerp(290, 1380, i / ROWS)];   // x en haut (y 404), x en bas (y 520)
  function fieldSVG() {
    let s = `<path d="M440 404H1200V520H290Z" fill="#9C6A43"/>`;
    for (let i = 0; i < ROWS; i++) {
      const [a0, b0] = rowLine(i), [a1, b1] = rowLine(i + 1);
      s += `<path d="M${a0} 404L${lerp(a0, a1, .55)} 404L${lerp(b0, b1, .55)} 520L${b0} 520Z" fill="#7E5233" opacity=".55"/>`;
    }
    s += `<path d="M440 404H1200" stroke="#6E4429" stroke-width="3"/>`;
    return s;
  }
  // un plant vu de côté, posé en (x, y), à l'échelle k, croissance g (0-1)
  function plantSide(c, x, y, k, g, ripe, dead) {
    const brown = "#8C6B3F", G = dead ? brown : null;
    const h = (10 + 30 * g) * k;
    if (g < .06 && !dead) return `<path d="M${x} ${y}l-3 -5M${x} ${y}l3 -5" stroke="#8BCB5A" stroke-width="${2 * k}" stroke-linecap="round"/>`;
    if (c === "mais") {
      let s = `<path d="M${x} ${y}V${y - h * 1.5}" stroke="${G || (ripe ? "#C9A440" : "#5E9E3A")}" stroke-width="${2.6 * k}"/>`;
      for (let i = 1; i < 4; i++) s += `<path d="M${x} ${y - h * .35 * i}q${(i % 2 ? 1 : -1) * 12 * k} ${-6 * k} ${(i % 2 ? 1 : -1) * 18 * k} ${4 * k}" stroke="${G || (ripe ? "#D3B04F" : "#6DB04D")}" stroke-width="${2.4 * k}" fill="none"/>`;
      if (ripe || g > .8) s += `<ellipse cx="${x + 4 * k}" cy="${y - h * .8}" rx="${3 * k}" ry="${7 * k}" fill="#F4D35E"/><path d="M${x + 4 * k} ${y - h * .8 - 7 * k}l${2 * k} ${-5 * k}" stroke="#C99A2F" stroke-width="${k}"/>`;
      return s;
    }
    if (c === "tomates" || c === "poivrons") {
      const r = 4 + 6 * g;
      let s = `<path d="M${x} ${y}V${y - h}" stroke="${G || "#4E8F3B"}" stroke-width="${2 * k}"/>
        <circle cx="${x}" cy="${y - h * .7}" r="${r * k}" fill="${G || "#3F8E3A"}"/><circle cx="${x - 4 * k}" cy="${y - h * .8}" r="${r * .55 * k}" fill="${G || "#5DAE4B"}"/>`;
      if (!dead && (ripe || g > .7)) {
        const col = c === "tomates" ? (ripe ? "#E2412F" : "#F29B4B") : (ripe ? "#E2412F" : "#7CC254");
        s += `<circle cx="${x + r * .5 * k}" cy="${y - h * .55}" r="${3 * k}" fill="${col}"/><circle cx="${x - r * .5 * k}" cy="${y - h * .45}" r="${2.8 * k}" fill="${c === "poivrons" && ripe ? "#F2B33A" : col}"/>`;
      }
      return s;
    }
    if (c === "salades") {
      const r = (5 + 8 * g) * k;
      return `<ellipse cx="${x}" cy="${y - r * .5}" rx="${r}" ry="${r * .7}" fill="${G || "#7DC24E"}"/><ellipse cx="${x}" cy="${y - r * .7}" rx="${r * .6}" ry="${r * .5}" fill="${G || "#A9DB72"}"/>`;
    }
    if (c === "carottes") {
      let s = "";
      for (const a of [-.5, -.2, .15, .45]) s += `<path d="M${x} ${y}q${a * 10 * k} ${-h * .5} ${a * 18 * k} ${-h}" stroke="${G || "#4FA03C"}" stroke-width="${1.8 * k}" fill="none"/>`;
      if (!dead && (ripe || g > .8)) s += `<path d="M${x - 3 * k} ${y}h${6 * k}l${-3 * k} ${7 * k}z" fill="#EE8A2E"/>`;
      return s;
    }
    if (c === "pommes_de_terre") {
      const r = (4 + 6 * g) * k, leaf = dead ? brown : ripe ? "#9DAF4A" : "#4C9440";
      let s = `<circle cx="${x - r * .7}" cy="${y - r * .6}" r="${r * .8}" fill="${leaf}"/><circle cx="${x + r * .7}" cy="${y - r * .6}" r="${r * .8}" fill="${leaf}"/><circle cx="${x}" cy="${y - r * 1.2}" r="${r}" fill="${leaf}"/>`;
      if (!dead && g > .5 && !ripe) s += `<circle cx="${x}" cy="${y - r * 2}" r="${1.8 * k}" fill="#fff"/>`;
      return s;
    }
    if (c === "fraises") {
      const r = (3 + 4 * g) * k;
      let s = `<circle cx="${x - r * .6}" cy="${y - r * .5}" r="${r * .7}" fill="${G || "#3F9443"}"/><circle cx="${x + r * .6}" cy="${y - r * .5}" r="${r * .7}" fill="${G || "#3F9443"}"/><circle cx="${x}" cy="${y - r}" r="${r * .7}" fill="${G || "#4FA548"}"/>`;
      if (ripe) s += `<path d="M${x + r} ${y - 2 * k}l${2 * k} ${4 * k}l${2 * k} ${-4 * k}z" fill="#E0303B"/><path d="M${x - r - 3 * k} ${y - 1 * k}l${2 * k} ${4 * k}l${2 * k} ${-4 * k}z" fill="#E0303B"/>`;
      return s;
    }
    // potirons, melons : lianes + gros fruits
    const r = (4 + 6 * g) * k;
    let s = `<path d="M${x - 12 * k} ${y}q${6 * k} ${-6 * k} ${12 * k} 0t${12 * k} 0" stroke="${G || "#5E9E3A"}" stroke-width="${2 * k}" fill="none"/>
      <circle cx="${x - 6 * k}" cy="${y - r}" r="${r * .8}" fill="${G || "#4E9A3A"}"/>`;
    if (!dead && g > .5) {
      const fr = (3 + 6 * Math.min(1, (g - .5) * 2)) * k;
      const col = c === "potirons" ? (ripe ? "#EE8A2E" : "#B6B848") : (ripe ? "#E3D27A" : "#A9CC6A");
      s += `<ellipse cx="${x + 5 * k}" cy="${y - fr * .8}" rx="${fr * 1.15}" ry="${fr * .85}" fill="${col}"/>`;
    }
    return s;
  }
  function cropsSVG(state) {
    // toutes les planches en plein champ, réparties sur les rangs du champ
    const beds = Object.values(state.champs).filter((f) => !f.serre).flatMap((f) => f.planches);
    if (!beds.length) return "";
    let s = "";
    for (let i = 0; i < ROWS; i++) {
      const f = beds[Math.floor(i / ROWS * beds.length)];
      if (f.etat === "vide" || !f.culture) continue;
      const g = Math.max(0, Math.min(1, f.croissance / 100));
      const [a0, b0] = rowLine(i), [a1, b1] = rowLine(i + 1);
      const ta = lerp(a0, a1, .78), tb = lerp(b0, b1, .78);
      for (let j = 0; j < 7; j++) {
        const t = .06 + j * .15, y = 404 + t * 116, x = lerp(ta, tb, t);
        if (x > VW + 30) continue;
        s += plantSide(f.culture, x, y, .5 + .8 * t, g, f.etat === "mur", f.etat === "fletri");
      }
    }
    return s;
  }
  function irrigationSVG() {
    let s = `<path d="M905 346V446" stroke="#5E6B78" stroke-width="5"/><path d="M380 446H1200" stroke="#5E6B78" stroke-width="5"/>
      <path d="M380 446H1200" stroke="#8FA0AE" stroke-width="1.5"/>`;
    for (const x of [520, 700, 880, 1060]) s += `<rect x="${x - 2}" y="432" width="4" height="14" fill="#5E6B78"/><circle cx="${x}" cy="431" r="3.5" fill="#3C8CD6"/>`;
    return s;
  }
  function spraySVG() {
    let s = "";
    [520, 700, 880, 1060].forEach((x, k) => {
      for (let i = 0; i < 8; i++) {
        const side = i % 2 ? 1 : -1, reach = 34 + (i % 4) * 10, hgt = 22 + (i % 3) * 8;
        const dur = (1 + (i % 3) * .15).toFixed(2), begin = -((i * .13 + k * .2) % 1).toFixed(2);
        s += `<circle r="${1.8 + (i % 2) * .6}" fill="#CFE9FA" opacity=".9"><animateMotion dur="${dur}s" begin="${begin}s" repeatCount="indefinite"
          path="M${x} 431q${side * reach / 2} ${-hgt * 2} ${side * reach} ${12}"/></circle>`;
      }
      s += `<path d="M${x - 40} 444q40 -60 80 0" stroke="#CFE9FA" stroke-width="1.2" fill="none" stroke-dasharray="2 5" opacity=".6"/>`;
    });
    return s;
  }

  // ------------------------------------------------------------------ éléments animés
  function cowSVG(kind) {
    return `<svg x="-32" y="-41" width="64" height="45" viewBox="0 0 ${kind === "vaches" ? 100 : 90} 70">${ART.side[kind].replace(/^<svg[^>]*>|<\/svg>$/g, "")}</svg>`;
  }
  function tractorSVG() {
    return `<g class="wx-tlight" opacity="0"><path d="M44 -26L190 -64L190 2Z" fill="#FFE9A3" opacity=".5"/></g>
      <rect x="-36" y="-26" width="82" height="11" rx="4" fill="#3B3B3B"/>
      <rect class="wx-tbody" x="-6" y="-40" width="50" height="18" rx="5" fill="#C8392E"/>
      <path d="M8 -36h30M8 -31h30" stroke="#000" stroke-width="1.4" opacity=".15"/>
      <rect class="wx-tbody" x="-34" y="-70" width="32" height="48" rx="5" fill="#C8392E"/>
      <rect x="-30" y="-66" width="24" height="22" rx="3" fill="#CFE8F5"/><path d="M-26 -62l10 14" stroke="#fff" stroke-width="3" opacity=".6"/>
      <rect x="-38" y="-74" width="40" height="7" rx="3" fill="#F4F1EA"/>
      <rect x="28" y="-58" width="5" height="20" rx="1.5" fill="#555"/>
      <circle cx="44" cy="-30" r="3.5" fill="#FFE18A"/>
      <g transform="translate(-20 -20)"><circle r="20" fill="#2B2B2B"/><g class="wx-wheel"><circle r="11" class="wx-rim" fill="#EDEDED"/>
        <path d="M-11 0H11M0 -11V11M-8 -8L8 8M8 -8L-8 8" stroke="#9A9A9A" stroke-width="2"/><circle r="3.5" fill="#666"/></g>
        <circle r="20" fill="none" stroke="#1B1B1B" stroke-width="4" stroke-dasharray="3 3"/></g>
      <g transform="translate(34 -11)"><circle r="11" fill="#2B2B2B"/><g class="wx-wheel"><circle r="6" class="wx-rim" fill="#EDEDED"/>
        <path d="M-6 0H6M0 -6V6" stroke="#9A9A9A" stroke-width="1.6"/></g></g>`;
  }
  // drone vu de côté : deux rotors visibles, nacelle, brume de pulvérisation
  function droneSVG() {
    let mist = "";
    for (let i = 0; i < 10; i++) {
      const x = -14 + (i % 5) * 7, d = (.9 + (i % 3) * .2).toFixed(1);
      mist += `<circle r="1.6" fill="#DDF0FB"><animateMotion dur="${d}s" begin="-${(i * .11).toFixed(2)}s" repeatCount="indefinite" path="M${x / 3} 10L${x} 70"/>
        <animate attributeName="opacity" values=".9;0" dur="${d}s" begin="-${(i * .11).toFixed(2)}s" repeatCount="indefinite"/></circle>`;
    }
    return `<g class="wx-dmist">${mist}</g>
      <path d="M-30 -2H30" stroke="#3C4650" stroke-width="3" stroke-linecap="round"/>
      <rect x="-12" y="-8" width="24" height="12" rx="5" fill="#F4F6F7" stroke="#B9C3CA" stroke-width="1"/>
      <rect x="-5" y="4" width="10" height="7" rx="2" fill="#8FB7D6"/><circle cx="0" cy="-2" r="2.6" fill="#3C8CD6"/>
      <circle class="wx-dled" cx="9" cy="-4" r="1.6" fill="#E2412F"/>
      <path d="M-30 -2V-7M30 -2V-7" stroke="#3C4650" stroke-width="2.4"/>
      <ellipse class="wx-prop" cx="-30" cy="-8" rx="15" ry="1.8" fill="#2B2B2B" opacity=".55"/>
      <ellipse class="wx-prop" cx="30" cy="-8" rx="15" ry="1.8" fill="#2B2B2B" opacity=".55"/>`;
  }
  // robot désherbeur vu de côté
  function robotSVG() {
    return `<g class="wx-rob"><rect x="-22" y="-26" width="44" height="18" rx="5" fill="#F08A24"/>
      <path d="M-24 -28L22 -36L24 -30L-22 -22Z" fill="#2D4A7A"/><path d="M-12 -30.5l2 7M0 -32.5l2 7M12 -34.5l2 7" stroke="#6F8FC4" stroke-width="1"/>
      <circle cx="-13" cy="-6" r="7" fill="#2B2B2B"/><circle cx="13" cy="-6" r="7" fill="#2B2B2B"/><circle cx="-13" cy="-6" r="2.5" fill="#9A9A9A"/><circle cx="13" cy="-6" r="2.5" fill="#9A9A9A"/>
      <path d="M22 -12l7 10M18 -12l5 12" stroke="#9AA3AB" stroke-width="2" stroke-linecap="round"/>
      <circle class="wx-rled" cx="16" cy="-20" r="2" fill="#7CFC7C"/></g>`;
  }
  function birdSVG() {
    return `<path d="M-8 0q4 -6 8 0q4 -6 8 0" stroke="#3A4A55" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }

  // ------------------------------------------------------------------ construction
  function init(svgEl) {
    svg = svgEl;
    svg.setAttribute("viewBox", `0 0 ${VW} ${VH}`);
    svg.innerHTML = `<defs>
      <linearGradient id="wx-sky" x1="0" y1="0" x2="0" y2="1"><stop id="wx-sky0" offset="0"/><stop id="wx-sky1" offset="1"/></linearGradient>
      <radialGradient id="wx-glow"><stop offset="0" stop-color="#FFF4C2" stop-opacity=".95"/><stop offset=".45" stop-color="#FFE38A" stop-opacity=".45"/><stop offset="1" stop-color="#FFE38A" stop-opacity="0"/></radialGradient>
      <linearGradient id="wx-beam" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6D6" stop-opacity=".55"/><stop offset="1" stop-color="#FFF6D6" stop-opacity="0"/></linearGradient>
      <linearGradient id="wx-haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE7A8" stop-opacity="0"/><stop offset="1" stop-color="#FFD27A" stop-opacity=".35"/></linearGradient>
    </defs>`;
    const g = (name, attrs = {}) => (R[name] = el("g", attrs, svg));
    el("rect", { width: VW, height: VH, fill: "url(#wx-sky)" }, svg);
    g("stars", { class: "wx-fade", opacity: 0 }).innerHTML = Array.from({ length: 60 }, (_, i) =>
      `<circle cx="${(i * 137) % VW}" cy="${(i * 53) % 230}" r="${1 + (i % 3) * .6}" fill="#fff"><animate attributeName="opacity" values="1;.3;1" dur="${2 + (i % 5)}s" repeatCount="indefinite"/></circle>`).join("");
    g("moon", { class: "wx-fade", opacity: 0 }).innerHTML = `<circle r="26" fill="#F3F1E6"/><circle cx="9" cy="-6" r="22" fill="#000" opacity=".0"/><circle cx="-8" cy="-4" r="5" fill="#DDD9C8"/><circle cx="6" cy="8" r="3.5" fill="#DDD9C8"/>`;
    g("sun", { class: "wx-fade" }).innerHTML = `<circle r="120" fill="url(#wx-glow)"/><g class="wx-rays">${Array.from({ length: 12 }, (_, i) =>
      `<path d="M0 -58L5 -84L-5 -84Z" fill="#FFE59A" opacity=".8" transform="rotate(${i * 30})"/>`).join("")}</g>
      <circle r="44" fill="#FFD95A"/><circle r="44" fill="none" stroke="#FFE99B" stroke-width="6" opacity=".7"/>`;
    g("rainbow", { class: "wx-fade", opacity: 0 }).innerHTML = ["#E8505B", "#F39C4A", "#F6D55C", "#6CC27A", "#4FA3E0", "#7A6BD8"].map((c, i) =>
      `<path d="M${780 + i * 9} 330A${330 - i * 9} ${300 - i * 9} 0 0 1 ${1440 - i * 9} 330" stroke="${c}" stroke-width="10" fill="none" opacity=".75"/>`).join("");
    g("beams", { class: "wx-fade", opacity: 0 }).innerHTML = [0, 1, 2, 3].map((i) =>
      `<path d="M${880 + i * 30} 60L${600 + i * 140} 520L${680 + i * 140} 520Z" fill="url(#wx-beam)" opacity=".5"/>`).join("");
    g("birds");
    for (let i = 0; i < 4; i++) {
      const b = el("g", {}, R.birds); b.innerHTML = birdSVG();
      birds.push({ el: b, x: rnd(-200, VW), y: rnd(50, 170), v: rnd(30, 50), ph: rnd(0, 6) });
    }
    g("bolt", { opacity: 0 });
    g("cloudsL");
    for (let i = 0; i < 9; i++) {
      const c = el("g", { class: "wx-cloud" }, R.cloudsL);
      c.innerHTML = cloudSVG();
      clouds.push({ el: c, x: (i * 173 + 60) % (VW + 300) - 150, y: 40 + (i % 4) * 34 + (i * 7) % 20, s: .7 + (i % 3) * .25, v: .6 + (i % 4) * .2, i });
    }
    // collines lointaines + éoliennes du voisin
    el("path", { d: "M0 262Q200 214 430 246T840 232T1200 224V520H0Z", fill: "#A6D788" }, svg);
    g("farTurb");
    [[1078, 196, 64], [1140, 206, 56], [610, 232, 46]].forEach(([x, y, h]) => {
      const t = el("g", { transform: `translate(${x} ${y})` }, R.farTurb); t.innerHTML = turbineSVG(h, false);
      rotors.push({ el: t.querySelector(".wx-rotor"), a: rnd(0, 360), k: .8 });
    });
    el("path", { d: "M0 302Q320 268 660 296T1200 284V520H0Z", fill: "#8FCC6B" }, svg);
    g("ownTurb");
    g("trees");
    [[64, 306, 1, "#5FA344"], [140, 318, .78, "#6DB04D"], [228, 300, 1.1, "#579A3D"], [780, 300, .7, "#6DB04D"], [856, 296, .55, "#5FA344"]].forEach(([x, y, s, c], i) => {
      const t = el("g", {}, R.trees); t.innerHTML = treeSVG(s, c);
      sways.push({ el: t, x, y, ph: i * 1.3, k: s });
    });
    [[560, 300, 1], [600, 312, .8], [648, 296, 1.15]].forEach(([x, y, s], i) => {
      const t = el("g", {}, R.trees); t.innerHTML = pineSVG(s);
      sways.push({ el: t, x, y, ph: i * 2.1 + 1, k: s * .6 });
    });
    el("path", { d: "M0 332Q600 316 1200 330V520H0Z", fill: "#7EBF5B" }, svg);
    g("barn").innerHTML = barnSVG() + tankSVG();
    g("fence").innerHTML = fenceSVG();
    g("herd");
    el("path", { d: "M0 364Q600 354 1200 364L1200 398Q600 390 0 398Z", fill: "#D9BC8E" }, svg);
    el("path", { d: "M0 381Q600 372 1200 381", stroke: "#C9A877", "stroke-width": 2, "stroke-dasharray": "10 12", fill: "none" }, svg);
    g("tractor").innerHTML = tractorSVG();
    g("puffs");
    el("path", { d: "M0 398Q600 390 1200 398V520H0Z", fill: "#76B653" }, svg);
    g("field").innerHTML = fieldSVG();
    g("crops");
    g("robot", { class: "wx-fade", opacity: 0 }).innerHTML = robotSVG();
    g("irrig").innerHTML = irrigationSVG();
    g("spray", { class: "wx-fade", opacity: 0 }).innerHTML = spraySVG();
    g("drone", { class: "wx-fade", opacity: 0 }).innerHTML = droneSVG();
    g("pond").innerHTML = pondSVG();
    g("ripples", { class: "wx-fade", opacity: 0 }).innerHTML = Array.from({ length: 9 }, (_, i) => {
      const x = 50 + (i * 67) % 240, y = 452 + (i * 13) % 26, d = (1.1 + (i % 3) * .3).toFixed(1);
      return `<ellipse cx="${x}" cy="${y}" rx="2" ry="1" fill="none" stroke="#E6F4FD" stroke-width="1.5">
        <animate attributeName="rx" values="2;16" dur="${d}s" begin="-${(i * .37).toFixed(2)}s" repeatCount="indefinite"/>
        <animate attributeName="ry" values="1;5" dur="${d}s" begin="-${(i * .37).toFixed(2)}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0" dur="${d}s" begin="-${(i * .37).toFixed(2)}s" repeatCount="indefinite"/></ellipse>`;
    }).join("");
    g("wet", { class: "wx-fade", opacity: 0 }).innerHTML = `<path d="M0 300Q320 268 660 296T1200 284V520H0Z" fill="#1F3D52" opacity=".16"/>`;
    g("heat", { class: "wx-fade", opacity: 0 }).innerHTML = `<rect width="${VW}" height="${VH}" fill="url(#wx-haze)"/>` +
      [0, 1, 2].map((i) => `<path d="M-60 ${300 + i * 60}q60 -8 120 0t120 0t120 0t120 0t120 0t120 0t120 0t120 0t120 0t120 0t120 0" stroke="#FFF3D1" stroke-width="10" fill="none" opacity=".18">
        <animateTransform attributeName="transform" type="translate" values="0 0;-120 0" dur="${3 + i}s" repeatCount="indefinite"/></path>`).join("");
    g("drops", { stroke: "#E8F2FA", "stroke-width": 2, "stroke-linecap": "round" });
    for (let i = 0; i < 150; i++) {
      const d = el("line", { x1: 0, y1: 0, x2: -4, y2: 16, opacity: 0 }, R.drops);
      drops.push({ el: d, x: rnd(-100, VW + 100), y: rnd(-VH, VH), v: rnd(520, 720), on: false });
    }
    g("splash");
    g("streaks", { class: "wx-fade", opacity: 0 });
    for (let i = 0; i < 9; i++) {
      const p = el("path", { d: `M0 0q40 -10 80 0t80 0`, stroke: "#fff", "stroke-width": 2.4, fill: "none", "stroke-linecap": "round", opacity: .55 }, R.streaks);
      streaks.push({ el: p, x: rnd(-200, VW), y: rnd(60, 340), v: rnd(380, 560) });
    }
    g("leaves", { class: "wx-fade", opacity: 0 });
    for (let i = 0; i < 16; i++) {
      const l = el("path", { d: "M0 0q4 -5 9 0q-4 5 -9 0Z", fill: ["#6DB04D", "#9CC85A", "#D7A94B"][i % 3] }, R.leaves);
      leaves.push({ el: l, x: rnd(-100, VW), y: rnd(120, 420), v: rnd(160, 300), ph: rnd(0, 6), r: rnd(0, 360) });
    }
    g("night", { class: "wx-fade", opacity: 0 }).innerHTML = `<rect width="${VW}" height="${VH}" fill="#0E1A33" opacity=".5"/>`;
    g("lights");     // phares et fenêtre, au-dessus de la nuit
    R.lights.innerHTML = `<rect id="wx-glowwin" x="1067" y="255" width="16" height="14" fill="#FFD27A" opacity="0"/>`;
    g("flash", { opacity: 0 }).innerHTML = `<rect width="${VW}" height="${VH}" fill="#fff"/>`;

    R.tractorBody = [...R.tractor.querySelectorAll(".wx-tbody")];
    R.wheels = [...R.tractor.querySelectorAll(".wx-wheel")];
    R.rims = [...R.tractor.querySelectorAll(".wx-rim")];
    R.tlight = R.tractor.querySelector(".wx-tlight");
    R.water = svg.querySelector("#wx-water");
    R.sky0 = svg.querySelector("#wx-sky0");
    R.sky1 = svg.querySelector("#wx-sky1");
    R.rays = R.sun.querySelector(".wx-rays");
    R.props = [...R.drone.querySelectorAll(".wx-prop")];
    R.props.forEach((p) => (p.dataset.cx = p.getAttribute("cx")));
    R.dled = R.drone.querySelector(".wx-dled");
    R.rled = R.robot.querySelector(".wx-rled");
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------------ boucle d'animation
  function loop(t) {
    const dt = Math.min(.1, (t - lastT) / 1000 || 0);
    lastT = t;
    if (active) frame(dt);
    requestAnimationFrame(loop);
  }

  function frame(dt) {
    time += dt;
    const k = Math.min(1, dt * 1.6);
    // ciel : couleurs du moment (heure + temps) lissées
    let [s0, s1] = M.sky;
    if (live) {
      const [n0, n1] = ART.skyAt(hour, "soleil");
      const day = 1 - night;
      s0 = mix(n0, s0, day * .85); s1 = mix(n1, s1, day * .85);
      if (hour > 5 && hour < 8.5 || hour > 17 && hour < 21) { s0 = mix(s0, n0, .5); s1 = mix(s1, n1, .5); }
    }
    cur.sky0 = mix(cur.sky0, s0, k); cur.sky1 = mix(cur.sky1, s1, k);
    R.sky0.setAttribute("stop-color", cur.sky0); R.sky1.setAttribute("stop-color", cur.sky1);
    cur.wind = lerp(cur.wind, M.wind, k);
    cur.rain = lerp(cur.rain, M.rain * (gameRunning || !live ? 1 : 1), k);

    // soleil / lune
    let sx = 930, sy = 112;
    if (live) {
      const st = (hour - 6) / 14;
      sx = 140 + Math.max(0, Math.min(1, st)) * 920; sy = 300 - Math.sin(Math.max(0, Math.min(1, st)) * Math.PI) * 220;
      const mt = ((hour + 4) % 24) / 10;
      R.moon.setAttribute("transform", `translate(${140 + Math.min(1, mt) * 920} ${300 - Math.sin(Math.min(1, mt) * Math.PI) * 200})`);
    }
    R.sun.setAttribute("transform", `translate(${sx.toFixed(1)} ${sy.toFixed(1)}) scale(${M.heat ? 1.25 : 1})`);
    R.rays.setAttribute("transform", `rotate(${(time * 6) % 360})`);

    // nuages poussés par le vent
    clouds.forEach((c) => {
      c.x += (8 + 60 * cur.wind) * c.v * dt;
      if (c.x > VW + 180) c.x = -200;
      c.el.setAttribute("transform", `translate(${c.x.toFixed(1)} ${c.y}) scale(${c.s})`);
    });
    // éoliennes
    rotors.forEach((r) => { r.a = (r.a + dt * (40 + 420 * cur.wind) * r.k) % 360; r.el.setAttribute("transform", `rotate(${r.a.toFixed(1)})`); });
    // arbres qui ploient sous le vent
    sways.forEach((s) => {
      const a = (1.2 + 7 * cur.wind) * s.k * Math.sin(time * (1.4 + 2.2 * cur.wind) + s.ph) + 4 * cur.wind * s.k;
      s.el.setAttribute("transform", `translate(${s.x} ${s.y}) rotate(${a.toFixed(2)})`);
    });
    // oiseaux
    birds.forEach((b) => {
      b.x += b.v * dt; if (b.x > VW + 40) { b.x = rnd(-300, -40); b.y = rnd(50, 170); }
      const flap = Math.sin(time * 9 + b.ph) * .35 + .75;
      b.el.setAttribute("transform", `translate(${b.x.toFixed(1)} ${(b.y + Math.sin(time * 1.5 + b.ph) * 6).toFixed(1)}) scale(1 ${flap.toFixed(2)})`);
    });
    // pluie
    const want = Math.round(drops.length * Math.min(1, cur.rain / 1.5));
    const slant = 4 + 30 * cur.wind;
    drops.forEach((d, i) => {
      const on = i < want;
      if (!on && !d.on) return;
      if (on && !d.on) { d.on = true; d.y = rnd(-VH, 0); d.el.setAttribute("opacity", .8); }
      d.y += d.v * dt; d.x += slant * 2 * dt;
      const ground = 320 + (i * 37) % 200;
      if (d.y > ground) {
        if (on && Math.random() < .25) splash(d.x, ground);
        if (!on) { d.on = false; d.el.setAttribute("opacity", 0); return; }
        d.y = rnd(-80, -10); d.x = rnd(-100, VW);
      }
      d.el.setAttribute("x2", (-slant * .6).toFixed(1));
      d.el.setAttribute("transform", `translate(${d.x.toFixed(1)} ${d.y.toFixed(1)})`);
    });
    // rafales et feuilles
    if (M.wind > .6 || cur.wind > .6) streaks.forEach((s) => {
      s.x += s.v * dt; if (s.x > VW + 60) { s.x = rnd(-400, -160); s.y = rnd(60, 340); }
      s.el.setAttribute("transform", `translate(${s.x.toFixed(1)} ${s.y.toFixed(1)})`);
    });
    if (M.leaves) leaves.forEach((l) => {
      l.x += l.v * dt; l.r += dt * 260;
      if (l.x > VW + 20) { l.x = rnd(-200, -20); l.y = rnd(120, 420); }
      l.el.setAttribute("transform", `translate(${l.x.toFixed(1)} ${(l.y + Math.sin(time * 3 + l.ph) * 22).toFixed(1)}) rotate(${l.r.toFixed(0)})`);
    });
    // éclairs
    if (M.bolts) {
      boltTimer -= dt;
      if (boltTimer <= 0) { boltTimer = rnd(2.5, 6); lightning(); }
    }
    stepHerd(dt);
    stepTractor(dt);
    stepTech(dt);
    // arrosage : en continu dans certaines ambiances, ou quelques secondes après « Arroser »
    const spraying = (live ? autoSpray : M.spray) || performance.now() < sprayUntil;
    R.spray.setAttribute("opacity", spraying && cur.rain < .3 ? 1 : 0);
  }

  function splash(x, y) {
    if (R.splash.childNodes.length > 30) return;
    const s = el("ellipse", { cx: x.toFixed(0), cy: y.toFixed(0), rx: 1, ry: .5, class: "wx-splash" }, R.splash);
    setTimeout(() => s.remove(), 450);
  }
  function lightning() {
    let x = rnd(240, 900), y = 70, d = `M${x} ${y}`;
    while (y < 300) { x += rnd(-26, 26); y += rnd(22, 38); d += `L${x.toFixed(0)} ${y.toFixed(0)}`; }
    R.bolt.innerHTML = `<path d="${d}" stroke="#FFF7C8" stroke-width="5" fill="none" stroke-linejoin="round"/><path d="${d}" stroke="#fff" stroke-width="2" fill="none"/>`;
    R.bolt.setAttribute("opacity", 1);
    R.flash.classList.remove("wx-flash"); void R.flash.getBBox(); R.flash.classList.add("wx-flash");
    setTimeout(() => R.bolt.setAttribute("opacity", 0), 160);
  }

  // vaches et moutons qui broutent devant la clôture
  function stepHerd(dt) {
    cows.forEach((c) => {
      if (c.wait > 0) { c.wait -= dt; c.bob = Math.sin(time * 2 + c.ph) * .8; }
      else {
        const d = c.tx - c.x;
        if (Math.abs(d) < 1) { c.wait = rnd(2, 7); c.tx = Math.max(330, Math.min(860, c.x + rnd(-140, 140))); }
        else { c.dir = Math.sign(d); c.x += c.dir * Math.min(Math.abs(d), 14 * dt); c.bob = Math.abs(Math.sin(time * 6 + c.ph)) * 1.6; }
      }
      c.el.setAttribute("transform", `translate(${c.x.toFixed(1)} ${(c.y - c.bob).toFixed(1)}) scale(${c.s * c.dir} ${c.s})`);
    });
  }
  function syncHerd(state) {
    const nv = Math.min(4, state.animaux.vaches.liste.length), nm = Math.min(2, state.animaux.moutons.liste.length);
    const sig = `${nv}|${nm}`;
    if (sig === herdSig) return;
    herdSig = sig;
    R.herd.innerHTML = ""; cows.length = 0;
    const list = [...Array(nv).fill("vaches"), ...Array(nm).fill("moutons")];
    list.forEach((kind, i) => {
      const g = el("g", {}, R.herd); g.innerHTML = cowSVG(kind);
      const x = 340 + (i * 131) % 500;
      cows.push({ el: g, x, tx: x, y: 360 - (i % 2) * 4, s: kind === "vaches" ? .9 : .7, dir: i % 2 ? -1 : 1, wait: rnd(0, 4), bob: 0, ph: i });
    });
  }

  // le tracteur fait des allers-retours sur le chemin ; la nuit, il dort devant la grange
  function stepTractor(dt) {
    const sleeping = live && (hour >= 21 || hour < 6);
    const running = gameRunning || !live;
    if (sleeping) { tractor.x = lerp(tractor.x, 940, Math.min(1, dt * .8)); tractor.dir = 1; }
    else if (running) {
      if (tractor.wait > 0) tractor.wait -= dt;
      else {
        const v = (upgraded ? 62 : 48) * (cur.rain > .5 ? .75 : 1);
        tractor.x += tractor.dir * v * dt;
        tractor.wheel += tractor.dir * v * dt * 3;
        if (tractor.x > VW + 120) { tractor.dir = -1; tractor.wait = rnd(1, 4); }
        if (tractor.x < -120) { tractor.dir = 1; tractor.wait = rnd(1, 4); }
        tractor.puff -= dt;
        if (tractor.puff <= 0) {
          tractor.puff = .22;
          const p = el("circle", { cx: (tractor.x + tractor.dir * 30).toFixed(0), cy: LANE_Y - 60, r: 5, class: "wx-puff" }, R.puffs);
          setTimeout(() => p.remove(), 1800);
        }
      }
    }
    R.wheels.forEach((w) => w.setAttribute("transform", `rotate(${(tractor.wheel % 360).toFixed(0)})`));
    R.tractor.setAttribute("transform", `translate(${tractor.x.toFixed(1)} ${LANE_Y}) scale(${tractor.dir} 1)`);
    R.tlight.setAttribute("opacity", night > .45 && !sleeping ? 1 : 0);
  }

  // drone qui survole le champ en pulvérisant, robot qui longe un rang
  function stepTech(dt) {
    const sleeping = live && (hour >= 21 || hour < 6);
    const flying = flyer.on && !(live && flyer.grounded) && !sleeping;
    R.drone.setAttribute("opacity", flying ? 1 : 0);
    if (flying) {
      if (gameRunning || !live) {
        flyer.x += flyer.dir * 70 * dt;
        if (flyer.x > 1150) flyer.dir = -1;
        if (flyer.x < 460) flyer.dir = 1;
      }
      const y = 330 + Math.sin(time * 2.2) * 6, tilt = flyer.dir * 6;
      R.drone.setAttribute("transform", `translate(${flyer.x.toFixed(1)} ${y.toFixed(1)}) rotate(${tilt})`);
      const sq = (.35 + Math.abs(Math.sin(time * 40)) * .65).toFixed(2);
      R.props.forEach((p) => p.setAttribute("transform", `translate(${p.dataset.cx} 0) scale(${sq} 1) translate(${-p.dataset.cx} 0)`));
      R.dled.setAttribute("fill", Math.sin(time * 9) > .3 ? "#E2412F" : "#7CFC7C");
    }
    const crawling = crawler.on && !sleeping;
    R.robot.setAttribute("opacity", crawling ? 1 : 0);
    if (crawling) {
      if (gameRunning || !live) {
        crawler.t += crawler.dir * .035 * dt;
        if (crawler.t > .92) crawler.dir = -1;
        if (crawler.t < .12) crawler.dir = 1;
      }
      const [a0, b0] = rowLine(6), [a1, b1] = rowLine(7);
      const x = lerp(lerp(a0, a1, .3), lerp(b0, b1, .3), crawler.t), y = 404 + crawler.t * 116, k = .45 + .8 * crawler.t;
      R.robot.setAttribute("transform", `translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${(k * crawler.dir).toFixed(2)} ${k.toFixed(2)})`);
      R.rled.setAttribute("opacity", Math.sin(time * 6) > 0 ? 1 : .2);
    }
  }

  // ------------------------------------------------------------------ API
  function setMood(m, isLive) {
    live = isLive;
    if (m === mood) return;
    mood = m; M = MOODS[m];
    const op = (name, v) => R[name].setAttribute("opacity", v);
    op("sun", Math.min(1, M.sun));
    R.rays.setAttribute("opacity", M.rays);
    op("rainbow", M.rainbow ? 1 : 0);
    op("beams", M.rainbow || M.heat ? .9 : 0);
    op("birds", M.birds);
    op("ripples", M.rain ? 1 : 0);
    op("wet", M.wet || 0);
    op("heat", M.heat ? 1 : 0);
    op("streaks", M.wind > .6 ? 1 : 0);
    op("leaves", M.leaves ? 1 : 0);
    // nuages : quantité et teinte
    const cloudFill = mix("#FFFFFF", "#6E7884", M.grey), shade = mix("#E3ECF2", "#4E5864", M.grey);
    clouds.forEach((c, i) => {
      c.el.style.opacity = i < M.clouds ? (M.grey > .5 ? .95 : .9) : 0;
      c.el.style.fill = cloudFill;
      c.el.querySelector(".wx-cloud-shade").style.fill = shade;
      c.y = 34 + (i % 4) * (M.grey > .5 ? 22 : 34) + (i * 7) % 20;
    });
    boltTimer = 1.2;
  }

  function update(state, opts) {
    const d = state.derive;
    hour = d.heure_dec;
    night = live ? ART.nightAmount(hour) : 0;
    gameRunning = state.vitesse > 0 && !state.menu;
    upgraded = state.ameliorations.includes("tracteur");
    flyer.on = state.technologies.includes("drone");
    flyer.grounded = !d.drone_actif;
    crawler.on = state.technologies.includes("desherbeur");
    R.night.setAttribute("opacity", (night * .9).toFixed(2));
    R.stars.setAttribute("opacity", night.toFixed(2));
    R.moon.setAttribute("opacity", live ? night.toFixed(2) : 0);
    if (live) R.sun.setAttribute("opacity", (Math.min(1, M.sun) * (1 - night)).toFixed(2));
    svg.querySelector("#wx-glowwin").setAttribute("opacity", night > .4 ? .9 : 0);
    R.tractorBody.forEach((b) => b.setAttribute("fill", upgraded ? "#3A8A3F" : "#C8392E"));
    R.rims.forEach((r) => r.setAttribute("fill", upgraded ? "#F2C14E" : "#EDEDED"));
    // réservoir : niveau réel
    tankFrac = state.reservoir.niveau / state.reservoir.capacite;
    R.water.setAttribute("transform", `translate(0 ${(4 + 64 * (1 - tankFrac)).toFixed(1)})`);
    autoSpray = state.ameliorations.includes("arrosage") && !d.pluie && d.humidite_moy < 55 && night < .5;
    // cultures semées sur les parcelles en plein champ
    const sig = Object.values(state.champs).filter((f) => !f.serre).flatMap((f) => f.planches).map((f) => `${f.etat}${f.culture}${Math.round(f.croissance / 5)}`).join("|");
    if (sig !== cropSig) { cropSig = sig; R.crops.innerHTML = cropsSVG(state); }
    syncHerd(state);
    const tsig = `${state.eoliennes}`;
    if (tsig !== turbSig) {
      turbSig = tsig;
      R.ownTurb.innerHTML = "";
      rotors.splice(3);
      [[700, 196, 118], [790, 186, 128]].slice(0, state.eoliennes).forEach(([x, y, h]) => {
        const t = el("g", { transform: `translate(${x} ${y})` }, R.ownTurb); t.innerHTML = turbineSVG(h, true);
        rotors.push({ el: t.querySelector(".wx-rotor"), a: rnd(0, 360), k: 1 });
      });
    }
    if (opts && opts.splash) sprayUntil = performance.now() + 9000;
  }

  // ambiance correspondant à la météo du jeu (éclaircie le matin qui suit une journée de pluie)
  function liveMood(state) {
    const t = state.meteo.type, h = state.derive.heure_dec;
    if ((t === "soleil" || t === "nuageux") && ["pluie", "orage"].includes(state.meteo_hier) && h < 12) return "eclaircie";
    return t;
  }

  return {
    init, update, setMood, liveMood, MOODS, ORDER,
    setActive: (v) => { active = v; lastT = performance.now(); },
    splash: () => { sprayUntil = performance.now() + 9000; },
  };
})();

// Place du marché vue du dessus : étals des marchands, votre étal, fontaine, clients et animaux animés.

const MarketMap = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const W = 1000, H = 700;

  // box [x, y, l, h] · face : côté du comptoir tourné vers la place
  const STALLS = {
    mon_etal:    { nom: "Mon étal", emoji: "🧺", vendeur: "Vous", box: [395, 508, 210, 166], face: "up",
                   awning: ["#2F7A4B", "#F4EEDF"], shirt: "#3E6B4E", hair: "hat",
                   cris: ["Produits frais du Val Vert !", "Goûtez-moi ça !", "Tout vient de la ferme !"] },
    fromager:    { nom: "Fromagerie", emoji: "🧀", vendeur: "Gérard", box: [60, 40, 175, 150], face: "down",
                   awning: ["#F2C94C", "#FFF6DA"], shirt: "#F4F1EA", hair: "#BDBDBD",
                   cris: ["Comté de 18 mois !", "Fromages affinés !", "Goûtez, c'est offert !"] },
    boulanger:   { nom: "Boulangerie", emoji: "🥖", vendeur: "Odile", box: [270, 40, 175, 150], face: "down",
                   awning: ["#C0703A", "#F7E7CF"], shirt: "#FFFFFF", hair: "#6B4632",
                   cris: ["Baguettes toutes chaudes !", "Pain de campagne !", "Brioches du matin !"] },
    fleuriste:   { nom: "Fleuriste", emoji: "💐", vendeur: "Rose", box: [545, 40, 175, 150], face: "down",
                   awning: ["#E07BA0", "#FCE9F0"], shirt: "#7A5BA6", hair: "#D9B26A",
                   cris: ["Bouquets du jour !", "Des fleurs pour la maison ?", "Pivoines toutes fraîches !"] },
    maraicher:   { nom: "Primeur", emoji: "🥦", vendeur: "Marius", box: [760, 40, 175, 150], face: "down",
                   awning: ["#D6544B", "#FFF1EC"], shirt: "#4FA3A5", hair: "#1E1E1E",
                   cris: ["Les plus beaux légumes !", "Moins cher qu'à côté !", "Allez, allez, c'est frais !"] },
    grainetier:  { nom: "Grainetier", emoji: "🌾", vendeur: "Lucien", box: [215, 522, 165, 150], face: "up",
                   awning: ["#A57B4F", "#F1E3C8"], shirt: "#8C6B3F", hair: "#BDBDBD",
                   cris: ["Foin bien sec !", "Graines et fourrage !", "Première coupe !"] },
    poissonnier: { nom: "Poissonnerie", emoji: "🐟", vendeur: "Yvon", box: [620, 522, 165, 150], face: "up",
                   awning: ["#3C8CD6", "#EAF4FB"], shirt: "#2F5D8A", hair: "#A0522D",
                   cris: ["Arrivage du matin !", "Il est frais mon poisson !", "Sardines, maquereaux !"] },
    bestiaux:    { nom: "Bestiaux", emoji: "🐑", vendeur: "Bastien", box: [22, 225, 180, 255], face: "right",
                   shirt: "#5B7F3A", hair: "cap",
                   cris: ["Belles bêtes à vendre !", "Poules pondeuses !", "Vaches laitières !"] },
    artisan:     { nom: "Coopérative", emoji: "🛠️", vendeur: "Mme Laporte", box: [798, 225, 180, 255], face: "left",
                   shirt: "#2F6FB5", hair: "#3A2A20",
                   cris: ["Éoliennes, serres, outils !", "Modernisez votre ferme !", "Tracteur en promo !"] },
  };
  const TEMPORARY = ["mon_etal", "maraicher", "fleuriste", "poissonnier"];   // présents seulement les jours de marché
  const PLAZA = [228, 214, 772, 490];          // zone où l'on se promène
  const FOUNTAIN = [500, 352, 64];
  const GATES = [[[495, -30], [495, 214]], [[-30, 495], [215, 495]], [[1030, 495], [785, 495]]];
  const PEN = [44, 268, 168, 462];              // enclos des bestiaux (animaux en liberté)

  const SKINS = ["#F0C9A4", "#E3AE84", "#C98E62", "#8D5B3D", "#F6D7BF"];
  const SHIRTS = ["#D6544B", "#3C8CD6", "#E9A93A", "#7A5BA6", "#2F7A4B", "#E07BA0", "#4FA3A5", "#8C6B3F", "#EDEDED"];
  const HAIRS = ["#3A2A20", "#6B4632", "#D9B26A", "#1E1E1E", "#A0522D", "#BDBDBD"];
  const UMBRELLAS = ["#D6544B", "#3C8CD6", "#E9A93A", "#2F7A4B", "#7A5BA6", "#1D3527"];

  let svg, layers = {}, onSelect = () => {};
  let people = [], birds = [], beasts = [], fx = [];
  let target = 0, rainy = false, night = 0, myWeight = 1, ready = false, lastT = 0, cryAt = 2, open = false;
  const cache = {};

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const seeded = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

  // ------------------------------------------------------------------ personnages
  function vendorSVG(x, y, st, i) {
    const skin = SKINS[i % SKINS.length];
    let top;
    if (st.hair === "hat") top = `<ellipse cy="-3" rx="11" ry="10" fill="#D9A93F"/><circle cy="-3" r="6.5" fill="#E8BC52"/><path d="M-6.5 -1h13" stroke="#B5482F" stroke-width="2"/>`;
    else if (st.hair === "cap") top = `<circle cy="-3" r="7.5" fill="${skin}"/><path d="M-7.5 -3a7.5 7.5 0 0 1 15 0z" fill="#3E5B2A"/><rect x="-6" y="-3" width="12" height="3" rx="1.5" fill="#2F4720"/>`;
    else top = `<circle cy="-3" r="7.5" fill="${skin}"/><path d="M-7.6 -2.5a7.6 7.6 0 0 1 15.2 0c-3-2-12-2-15.2 0z" fill="${st.hair}"/>`;
    const dur = (1.6 + seeded(i) * 1.2).toFixed(2);
    return `<g transform="translate(${x} ${y})"><g>
      <animateTransform attributeName="transform" type="translate" values="0 0;0 -1.6;0 0" dur="${dur}s" repeatCount="indefinite"/>
      <ellipse cy="6" rx="14" ry="8" fill="#000" opacity=".12"/>
      <ellipse cy="4" rx="13" ry="8" fill="${st.shirt}" stroke="#000" stroke-opacity=".08"/>
      <circle cx="-12" cy="6" r="3.4" fill="${skin}"/><circle cx="12" cy="6" r="3.4" fill="${skin}"/>
      ${st.hair === "hat" ? `<circle cy="-3" r="7.5" fill="#F0BF98"/>` : ""}${top}</g></g>`;
  }

  // client vu du dessus, tourné vers +x
  function shopperSVG(p) {
    const basket = p.basket ? `<ellipse cx="-1" cy="10.5" rx="4.6" ry="3.4" fill="#B98A55" stroke="#8E6240"/><circle cx="-2" cy="9.6" r="1.6" fill="${pick(["#E2412F", "#EE8A2E", "#8BCB5A"])}"/>` : "";
    return `<g class="walker"><ellipse cx="1" cy="1.5" rx="8" ry="10" fill="#000" opacity=".12"/>
      <ellipse rx="5.5" ry="9.5" fill="${p.shirt}" stroke="#000" stroke-opacity=".1"/>${basket}
      <circle cx="1" r="5.4" fill="${p.hair}"/><ellipse cx="3.6" rx="2.2" ry="3.2" fill="${p.skin}"/></g>
      <g class="umbrella" opacity="0"><circle r="13.5" fill="${pick(UMBRELLAS)}"/>
      <path d="M0 -13.5V13.5M-13.5 0H13.5M-9.5 -9.5L9.5 9.5M9.5 -9.5L-9.5 9.5" stroke="#fff" stroke-opacity=".35" stroke-width="1.2"/><circle r="1.8" fill="#333"/></g>`;
  }
  const dogSVG = `<g class="walker"><ellipse cx="1" cy="1.5" rx="9" ry="5" fill="#000" opacity=".12"/>
    <ellipse rx="8" ry="4.6" fill="#B07A45"/><circle cx="8" r="3.8" fill="#9A6535"/><ellipse cx="7" cy="-3.6" rx="1.8" ry="1.2" fill="#6E4527"/><ellipse cx="7" cy="3.6" rx="1.8" ry="1.2" fill="#6E4527"/>
    <path class="tail" d="M-8 0l-5 0" stroke="#9A6535" stroke-width="2.4" stroke-linecap="round"/></g>`;
  const birdSVG = `<g><ellipse cx=".6" cy="1" rx="5.4" ry="3.6" fill="#000" opacity=".1"/>
    <g class="wings" opacity="0"><ellipse cx="-1" cy="-5" rx="3" ry="6" fill="#8D939B"/><ellipse cx="-1" cy="5" rx="3" ry="6" fill="#8D939B"/></g>
    <ellipse rx="5" ry="3.4" fill="#9AA0A8"/><circle cx="4.4" r="2.4" fill="#6F8A88"/><path d="M6.6 -.6l1.8 .6-1.8 .6z" fill="#E9A93A"/><path d="M-5 0l-3 -2v4z" fill="#6F757D"/></g>`;

  // ------------------------------------------------------------------ décor fixe
  function tree(x, y, r, c = "#4E9A3A") {
    return `<g><circle cx="${x + 3}" cy="${y + 4}" r="${r}" fill="#000" opacity=".12"/><circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/><circle cx="${x - r * .3}" cy="${y - r * .3}" r="${r * .45}" fill="#fff" opacity=".13"/></g>`;
  }
  function crate(x, y, w = 30, h = 22) {
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="#C39563" stroke="#8E6240" stroke-width="1.5"/><path d="M${x + 2} ${y + h / 2}h${w - 4}" stroke="#8E6240" stroke-width="1"/>`;
  }

  function staticLayer() {
    let s = `<defs>
      <pattern id="mk-paving" width="44" height="28" patternUnits="userSpaceOnUse">
        <rect width="44" height="28" fill="#E6DAC0"/><path d="M0 .5H44M0 14.5H44M.5 0V14M22.5 14V28" stroke="#D5C6A6" stroke-width="1.2"/>
        <circle cx="10" cy="7" r="1" fill="#D9CBAF"/><circle cx="33" cy="21" r="1.2" fill="#D9CBAF"/></pattern>
      <radialGradient id="mk-glow"><stop offset="0" stop-color="#FFE7A3" stop-opacity=".95"/><stop offset="1" stop-color="#FFD36B" stop-opacity="0"/></radialGradient>
      <filter id="mk-shadow" x="-20%" y="-30%" width="140%" height="180%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-opacity=".18"/></filter></defs>`;
    s += `<rect width="${W}" height="${H}" fill="#A9D282"/>`;
    s += `<rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="30" fill="url(#mk-paving)"/>`;
    // allée centrale plus claire et rosace autour de la fontaine
    s += `<circle cx="${FOUNTAIN[0]}" cy="${FOUNTAIN[1]}" r="118" fill="#EDE3CD"/><circle cx="${FOUNTAIN[0]}" cy="${FOUNTAIN[1]}" r="118" fill="none" stroke="#D5C6A6" stroke-width="3" stroke-dasharray="4 10"/>`;
    // coins : arbres, bancs, camionnette de la ferme
    s += tree(30, 30, 18) + tree(972, 30, 18, "#5DA548") + tree(975, 205, 14) + tree(28, 205, 14, "#5DA548");
    s += tree(935, 660, 24) + tree(880, 676, 16, "#5DA548") + tree(820, 690, 12);
    for (const [bx, by] of [[812, 545], [812, 610]]) {
      s += `<g transform="translate(${bx} ${by})"><rect x="3" y="4" width="64" height="20" rx="4" fill="#000" opacity=".12"/><rect width="64" height="20" rx="4" fill="#9A6B3E"/><path d="M4 7H60M4 13H60" stroke="#7E552F" stroke-width="2"/></g>`;
    }
    s += `<g transform="translate(882 560)"><circle r="26" fill="#9A8F7C"/><circle r="21" fill="#7A5A3B"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<circle cx="${Math.cos(i) * 11}" cy="${Math.sin(i * 1.7) * 11}" r="5" fill="${["#E8695A", "#F2C14E", "#F5F0E6", "#B07CD8"][i % 4]}"/>`).join("")}</g>`;
    // camionnette du Val Vert
    s += `<g transform="translate(48 560)"><rect x="5" y="6" width="150" height="70" rx="14" fill="#000" opacity=".14"/>
      <rect width="150" height="70" rx="14" fill="#2F7A4B"/><rect x="104" y="6" width="40" height="58" rx="10" fill="#BFE0F7"/><rect x="104" y="6" width="40" height="58" rx="10" fill="none" stroke="#1D3527" stroke-width="3"/>
      <rect x="8" y="8" width="88" height="54" rx="6" fill="#8C5A35"/>${crate(14, 14, 36, 20)}${crate(54, 14, 36, 20)}${crate(14, 38, 36, 20)}
      <text x="72" y="54" text-anchor="middle" font-size="15">🥕</text>
      <rect x="-4" y="6" width="8" height="16" rx="3" fill="#222"/><rect x="-4" y="48" width="8" height="16" rx="3" fill="#222"/><rect x="128" y="-4" width="16" height="8" rx="3" fill="#222"/><rect x="128" y="66" width="16" height="8" rx="3" fill="#222"/></g>`;
    // réverbères
    for (const [lx, ly] of [[220, 206], [780, 206], [220, 500], [780, 500]]) {
      s += `<circle cx="${lx + 2}" cy="${ly + 3}" r="7" fill="#000" opacity=".15"/><circle cx="${lx}" cy="${ly}" r="7" fill="#2E3A33"/><circle cx="${lx}" cy="${ly}" r="3.5" fill="#F7E7B5"/>`;
    }
    return s;
  }

  function fountainSVG() {
    const [cx, cy, r] = FOUNTAIN;
    let s = `<g transform="translate(${cx} ${cy})"><circle cx="5" cy="7" r="${r + 2}" fill="#000" opacity=".14"/>
      <circle r="${r + 2}" fill="#C9BEA6"/><circle r="${r - 6}" fill="#DCD3BF"/><circle r="${r - 12}" fill="#5FA7DD"/>`;
    for (let i = 0; i < 3; i++) {
      s += `<circle r="10" fill="none" stroke="#fff" stroke-width="2" opacity="0">
        <animate attributeName="r" values="14;${r - 14}" dur="3s" begin="${i}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values=".55;0" dur="3s" begin="${i}s" repeatCount="indefinite"/></circle>`;
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, d = 26 + (i % 3) * 6, dur = (1 + (i % 4) * .15).toFixed(2);
      s += `<circle r="2.2" fill="#E3F2FC"><animate attributeName="cx" values="0;${(Math.cos(a) * d).toFixed(1)}" dur="${dur}s" repeatCount="indefinite"/>
        <animate attributeName="cy" values="0;${(Math.sin(a) * d).toFixed(1)}" dur="${dur}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="1;0" dur="${dur}s" repeatCount="indefinite"/></circle>`;
    }
    s += `<circle r="13" fill="#D8D0BE" stroke="#BFB59F" stroke-width="2"/><circle r="6" fill="#BFE3FA"/><circle cx="-2" cy="-2" r="2" fill="#fff"/></g>`;
    return s;
  }

  // ------------------------------------------------------------------ étals
  // dessine en coordonnées locales, comptoir en bas ; `up` retourne verticalement (comptoir en haut)
  function stallSVG(id) {
    const st = STALLS[id], [x, y, w, h] = st.box, up = st.face === "up";
    const Y = (v) => (up ? h - v : v);
    const R = (rx, v, rw, rh, attrs) => `<rect x="${rx}" y="${up ? h - v - rh : v}" width="${rw}" height="${rh}" ${attrs}/>`;
    const aw = 62, ct = h - 60, gv = ct + 25;
    let s = `<g transform="translate(${x} ${y})">`;
    s += `<rect x="5" y="7" width="${w}" height="${h}" rx="10" fill="#000" opacity=".12"/>`;
    s += R(10, aw - 4, w - 20, ct - aw + 10, `fill="#CDB48E"`);
    const n = 7, sw = w / n;
    for (let i = 0; i < n; i++) s += R(i * sw, 0, sw + .5, aw, `fill="${st.awning[i % 2]}"`);
    s += R(0, 0, w, 5, `fill="#000" opacity=".12"`) + R(0, aw - 9, w, 9, `fill="#000" opacity=".07"`);
    for (let i = 0; i < n; i++) s += `<circle cx="${i * sw + sw / 2}" cy="${Y(aw)}" r="${sw / 2}" fill="${st.awning[i % 2]}"/>`;
    s += `<g class="mk-open" data-stall="${id}">${vendorSVG(w / 2 + (id === "mon_etal" ? -18 : 14), Y(aw + 15), st, Object.keys(STALLS).indexOf(id))}</g>`;
    s += R(8, ct, w - 16, 50, `rx="6" fill="#B5835A" stroke="#8E6240" stroke-width="2"`);
    s += `<path d="M14 ${Y(ct + 17)}H${w - 14}M14 ${Y(ct + 34)}H${w - 14}" stroke="#9E7049" stroke-width="1.2"/>`;
    s += `<g class="mk-open" data-stall="${id}">${id === "mon_etal" ? `<g id="mk-goods"></g>` : GOODS[id](w, Y, gv)}</g>`;
    if (TEMPORARY.includes(id)) {   // bâche tendue sur le comptoir les jours sans marché
      s += `<g class="mk-closed" data-stall="${id}" display="none">${R(4, ct - 6, w - 8, 60, `rx="8" fill="${st.awning[0]}" opacity=".92"`)}
        <path d="M10 ${Y(ct - 2)}L${w - 10} ${Y(ct + 50)}M${w - 10} ${Y(ct - 2)}L10 ${Y(ct + 50)}" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>
        <rect x="${w / 2 - 30}" y="${Y(ct + 25) - 11}" width="60" height="22" rx="5" fill="#F4EEDF" stroke="#8E6240"/>
        <text class="m-empty" x="${w / 2}" y="${Y(ct + 25) + 4.5}" text-anchor="middle">Fermé</text></g>`;
    }
    return s + `</g>`;
  }

  const GOODS = {
    fromager(w, Y, gv) {
      let s = "";
      for (let i = 0; i < 4; i++) {
        const cx = 30 + i * ((w - 60) / 3), cy = Y(gv);
        s += `<circle cx="${cx}" cy="${cy}" r="14" fill="#F3CD5C" stroke="#D9A93A" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="8.5" fill="none" stroke="#E7BE4A" stroke-width="1.5"/>`;
        if (i % 2) s += `<path d="M${cx} ${cy}L${cx + 15} ${cy - 6}L${cx + 15} ${cy + 6}Z" fill="#B5835A"/>`;
        else s += `<circle cx="${cx - 4}" cy="${cy + 3}" r="1.6" fill="#E0B23E"/><circle cx="${cx + 4}" cy="${cy - 3}" r="1.3" fill="#E0B23E"/>`;
      }
      return s;
    },
    boulanger(w, Y, gv) {
      let s = "";
      for (let i = 0; i < 3; i++) {
        const cx = 34 + i * 26, cy = Y(gv);
        s += `<g transform="rotate(-28 ${cx} ${cy})"><rect x="${cx - 22}" y="${cy - 4.5}" width="44" height="9" rx="4.5" fill="#D9A15E" stroke="#B57A3A"/>
          <path d="M${cx - 12} ${cy - 2}l4 4M${cx - 2} ${cy - 2}l4 4M${cx + 8} ${cy - 2}l4 4" stroke="#F2D6A2" stroke-width="1.5"/></g>`;
      }
      for (let i = 0; i < 2; i++) {
        const cx = w - 50 + i * 26, cy = Y(gv + (i ? 6 : -6));
        s += `<circle cx="${cx}" cy="${cy}" r="11" fill="#B87333" stroke="#8E5A26"/><path d="M${cx - 6} ${cy - 3}l12 0M${cx - 6} ${cy + 3}l12 0" stroke="#E2B074" stroke-width="1.6"/>`;
      }
      return s;
    },
    fleuriste(w, Y, gv) {
      let s = "";
      const cols = [["#E8695A", "#F7B2A8"], ["#F2C14E", "#FBE3A1"], ["#B07CD8", "#DCC2F0"], ["#F5F0E6", "#FFFFFF"], ["#E07BA0", "#F7C6D8"]];
      cols.forEach(([a, b], i) => {
        const cx = 24 + i * ((w - 48) / 4), cy = Y(gv);
        s += `<circle cx="${cx}" cy="${cy}" r="12" fill="#8E9AA3"/><circle cx="${cx}" cy="${cy}" r="10" fill="#5DA548"/>`;
        for (let k = 0; k < 5; k++) {
          const a2 = k * 1.256 + i;
          s += `<circle cx="${(cx + Math.cos(a2) * 5.5).toFixed(1)}" cy="${(cy + Math.sin(a2) * 5.5).toFixed(1)}" r="3.4" fill="${a}"/>`;
        }
        s += `<circle cx="${cx}" cy="${cy}" r="2.4" fill="${b}"/>`;
      });
      return s;
    },
    maraicher(w, Y, gv) {
      let s = "";
      const fills = ["#E2412F", "#EE8A2E", "#8BCB5A", "#7A4E9E"];
      fills.forEach((c, i) => {
        const bx = 18 + i * ((w - 36) / 4), by = Y(gv) - 12;
        s += crate(bx, by, 30, 24);
        for (let k = 0; k < 6; k++) s += `<circle cx="${bx + 7 + (k % 3) * 8}" cy="${by + 7 + Math.floor(k / 3) * 10}" r="${c === "#8BCB5A" ? 4.6 : 3.8}" fill="${c}"/>`;
      });
      return s;
    },
    grainetier(w, Y, gv) {
      let s = "";
      for (let i = 0; i < 2; i++) {
        const bx = 18 + i * 42, by = Y(gv) - 13;
        s += `<rect x="${bx}" y="${by}" width="36" height="26" rx="3" fill="#E9CC6A" stroke="#C9A33F" stroke-width="1.5"/><path d="M${bx + 3} ${by + 9}h30M${bx + 3} ${by + 17}h30" stroke="#C9A33F"/>`;
      }
      for (let i = 0; i < 2; i++) {
        const cx = w - 52 + i * 26, cy = Y(gv);
        s += `<ellipse cx="${cx}" cy="${cy}" rx="11" ry="14" fill="#E3D2B0" stroke="#BFA77C" stroke-width="1.5"/><circle cx="${cx}" cy="${cy}" r="6" fill="${i ? "#D8B44A" : "#9C7048"}"/>`;
      }
      return s;
    },
    poissonnier(w, Y, gv) {
      let s = `<rect x="16" y="${Y(gv) - 16}" width="${w - 32}" height="32" rx="6" fill="#DCEFFA"/>`;
      for (let i = 0; i < 5; i++) {
        const cx = 34 + i * ((w - 68) / 4), cy = Y(gv) + (i % 2 ? 5 : -5);
        s += `<ellipse cx="${cx}" cy="${cy}" rx="12" ry="4.6" fill="${i % 2 ? "#9AAAB8" : "#7E93A6"}"/><path d="M${cx - 11} ${cy}l-6 -4v8z" fill="#6E8396"/><circle cx="${cx + 7}" cy="${cy - 1}" r="1.1" fill="#222"/>`;
      }
      s += `<circle cx="${w - 24}" cy="${Y(gv) - 10}" r="4" fill="#F4D35E"/><circle cx="24" cy="${Y(gv) + 10}" r="4" fill="#F4D35E"/>`;
      return s;
    },
  };

  function penSVG() {
    const [x, y, w, h] = STALLS.bestiaux.box;
    let s = `<g transform="translate(${x} ${y})"><rect x="4" y="6" width="${w}" height="${h}" rx="14" fill="#000" opacity=".1"/>
      <rect width="${w}" height="${h}" rx="14" fill="#E8D49A"/>`;
    for (let i = 0; i < 40; i++) s += `<path d="M${8 + seeded(i) * (w - 16)} ${30 + seeded(i + 50) * (h - 40)}l5 2" stroke="#C9AE6A" stroke-width="1.5"/>`;
    s += `<rect x="16" y="${h - 34}" width="60" height="16" rx="6" fill="#9AA3AB"/><rect x="19" y="${h - 31}" width="54" height="10" rx="4" fill="#7FB6E0"/>`;
    s += `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="12" fill="none" stroke="#9A6B3E" stroke-width="5" stroke-dasharray="${h - 70} 46 ${w * 4} 0"/>`;
    for (let i = 0; i < 9; i++) s += `<circle cx="${i % 2 ? w - 3 : 3}" cy="${20 + Math.floor(i / 2) * 55}" r="4" fill="#7E552F"/>`;
    s += `</g>`;
    s += vendorSVG(x + w - 18, y + h / 2 + 40, STALLS.bestiaux, 7);
    return s;
  }

  function coopSVG() {
    const [x, y, w, h] = STALLS.artisan.box, sx = x + 78;
    let s = `<g><rect x="${sx + 5}" y="${y + 8}" width="${w - 78}" height="${h - 20}" fill="#000" opacity=".14"/>
      <rect x="${sx}" y="${y + 2}" width="${w - 78}" height="${h - 20}" fill="#6B7F96"/>
      <path d="M${sx} ${y + 2}L${sx + (w - 78) / 2} ${y + 40}V${y + h - 58}L${sx} ${y + h - 18}Z" fill="#7D92A9"/>
      <path d="M${sx + (w - 78) / 2} ${y + 40}V${y + h - 58}" stroke="#55677B" stroke-width="3"/>
      <path d="M${sx} ${y + 2}L${sx + (w - 78) / 2} ${y + 40}M${sx + w - 78} ${y + 2}L${sx + (w - 78) / 2} ${y + 40}M${sx} ${y + h - 18}L${sx + (w - 78) / 2} ${y + h - 58}M${sx + w - 78} ${y + h - 18}L${sx + (w - 78) / 2} ${y + h - 58}" stroke="#55677B" stroke-width="2"/>`;
    // maquette d'éolienne qui tourne
    const tx = x + 32, ty = y + 64, blade = `<path d="M0 0C2 -4 2.6 -13 1 -20L-1 -20C-2 -12 -2 -4 0 0Z"/>`;
    s += `<g transform="translate(${tx} ${ty})"><circle r="9" fill="#D9D2C2" stroke="#C2B9A6"/><g fill="#FAFCFD" stroke="#CCD5DB">
      <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="3s" repeatCount="indefinite"/>${blade}<g transform="rotate(120)">${blade}</g><g transform="rotate(240)">${blade}</g></g><circle r="3.4" fill="#EEF2F4" stroke="#B9C3CA"/></g>`;
    // mini serre, arrosoir, petit tracteur
    s += `<g transform="translate(${x + 12} ${y + 104})"><rect width="44" height="30" rx="4" fill="#9CC98A"/><rect width="44" height="30" rx="4" fill="#EAF5FB" opacity=".55"/>
      <path d="M11 0V30M22 0V30M33 0V30M0 15H44" stroke="#fff" stroke-width="1.6"/><rect width="44" height="30" rx="4" fill="none" stroke="#F7FAFC" stroke-width="2.5"/></g>`;
    s += `<g transform="translate(${x + 26} ${y + 160})"><circle r="9" fill="#5E9EC9"/><path d="M7 -2l10 -8" stroke="#5E9EC9" stroke-width="3.5" stroke-linecap="round"/><circle r="4" fill="#8FC0E2"/></g>`;
    s += `<g transform="translate(${x + 34} ${y + 222})"><rect x="-18" y="-11" width="36" height="22" rx="5" fill="#D6544B"/><rect x="-4" y="-9" width="14" height="18" rx="3" fill="#2B2B2B" opacity=".5"/>
      <rect x="-24" y="-16" width="14" height="8" rx="2" fill="#222"/><rect x="-24" y="8" width="14" height="8" rx="2" fill="#222"/><rect x="12" y="-14" width="10" height="6" rx="2" fill="#222"/><rect x="12" y="8" width="10" height="6" rx="2" fill="#222"/></g>`;
    s += vendorSVG(x + 62, y + h / 2 + 12, STALLS.artisan, 8);
    return s + `</g>`;
  }

  // ------------------------------------------------------------------ guirlandes, étiquettes
  function buntingSVG() {
    let s = "";
    const cols = ["#D6544B", "#F2C94C", "#3C8CD6", "#2F7A4B", "#F4EEDF", "#E07BA0"];
    for (const [x1, y1, x2, y2] of [[220, 206, 780, 206], [220, 500, 780, 500]]) {
      s += `<path d="M${x1} ${y1}Q500 ${y1 + 34} ${x2} ${y2}" stroke="#5C4A3A" stroke-width="1.5" fill="none"/>`;
      for (let i = 1; i < 24; i++) {
        const t = i / 24, px = x1 + (x2 - x1) * t, py = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * (y1 + 34) + t * t * y2;
        if (i % 2) {
          s += `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})"><path d="M-6 0h12l-6 12z" fill="${cols[i % cols.length]}">
            <animateTransform attributeName="transform" type="rotate" values="-10;10;-10" dur="${(1.8 + (i % 5) * .2).toFixed(1)}s" begin="-${(i * .37).toFixed(2)}s" repeatCount="indefinite"/></path></g>`;
        } else {
          s += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.6" fill="#FFF3C4" stroke="#C9A33F" stroke-width=".8"/>`;
          s += `<circle class="bulb" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="14" fill="url(#mk-glow)" opacity="0"/>`;
        }
      }
    }
    return s;
  }

  function labelAnchor(id) {
    const [x, y, w, h] = STALLS[id].box, f = STALLS[id].face;
    if (f === "down") return [x + w / 2, y - 2];
    if (f === "up") return [x + w / 2, y + h - 30];
    return [x + w / 2, y - 2];
  }

  function labelsSVG() {
    let s = "";
    for (const [id, st] of Object.entries(STALLS)) {
      const [x, y, w, h] = st.box;
      s += `<g class="zone" data-stall="${id}"><rect class="zone-hit" x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="14"/></g>`;
    }
    for (const [id, st] of Object.entries(STALLS)) {
      const [cx, ly] = labelAnchor(id), tw = st.nom.length * 8 + 48;
      s += `<g class="zone-label stall-label ${id === "mon_etal" ? "mine" : ""}" transform="translate(${(cx - tw / 2).toFixed(1)} ${ly})" style="pointer-events:none">
        <rect width="${tw}" height="28" rx="14" filter="url(#mk-shadow)"/><text class="emo" x="11" y="19.5">${st.emoji}</text><text x="34" y="19">${st.nom}</text></g>`;
    }
    return s;
  }

  // ------------------------------------------------------------------ étal du joueur
  function goodsSVG(goods) {
    const [, , w, h] = STALLS.mon_etal.box;
    const ct = h - 60, cy = h - ct - 25;               // comptoir en haut (étal tourné vers la place)
    let s = "";
    for (let i = 0; i < 6; i++) {
      const bx = 18 + i * ((w - 36 - 26) / 5);
      s += crate(bx, cy - 13, 26, 26);
      if (goods[i]) s += `<text x="${bx + 13}" y="${cy + 1}" text-anchor="middle" dominant-baseline="central" font-size="17">${goods[i]}</text>`;
    }
    if (!goods.length) s += `<rect x="${w / 2 - 44}" y="${cy - 11}" width="88" height="22" rx="11" fill="#F4EEDF" opacity=".92"/><text class="m-empty" x="${w / 2}" y="${cy + 4.5}" text-anchor="middle">Étal vide</text>`;
    return s;
  }

  // ------------------------------------------------------------------ foule
  function frontOf(id) {
    const [x, y, w, h] = STALLS[id].box, f = STALLS[id].face;
    if (f === "down") return [x + w / 2 + rnd(-w * .32, w * .32), y + h + rnd(14, 22), Math.PI / -2];
    if (f === "up") return [x + w / 2 + rnd(-w * .32, w * .32), y - rnd(14, 22), Math.PI / 2];
    if (f === "right") return [x + w + rnd(16, 24), y + h / 2 + rnd(-60, 70), Math.PI];
    return [x - rnd(16, 24), y + h / 2 + rnd(-60, 70), 0];
  }
  function plazaPoint() {
    for (;;) {
      const p = [rnd(PLAZA[0], PLAZA[2]), rnd(PLAZA[1], PLAZA[3])];
      if (Math.hypot(p[0] - FOUNTAIN[0], p[1] - FOUNTAIN[1]) > FOUNTAIN[2] + 26) return p;
    }
  }
  // contourne la fontaine si le trajet la traverse
  function route(from, to) {
    const [fx, fy, fr] = FOUNTAIN, dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy) || 1;
    const t = Math.max(0, Math.min(1, ((fx - from[0]) * dx + (fy - from[1]) * dy) / (L * L)));
    const px = from[0] + dx * t, py = from[1] + dy * t, d = Math.hypot(px - fx, py - fy);
    if (d > fr + 22 || t <= 0 || t >= 1) return [to];
    let nx = -dy / L, ny = dx / L;
    if ((px - fx) * nx + (py - fy) * ny < 0) { nx = -nx; ny = -ny; }
    return [[fx + nx * (fr + 40), fy + ny * (fr + 40)], to];
  }

  function chooseStall() {
    const ids = Object.keys(STALLS).filter((id) => open || !TEMPORARY.includes(id));
    const weights = ids.map((id) => (id === "mon_etal" ? myWeight : 1));
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ids.length; i++) { r -= weights[i]; if (r <= 0) return ids[i]; }
    return ids[0];
  }

  function nextGoal(p) {
    if (p.leaving) {
      const g = p.gate;
      p.path = [...route([p.x, p.y], g[1]), g[0]];
      p.face = null;
      return;
    }
    if (p.dog || Math.random() < .4) {
      p.path = route([p.x, p.y], plazaPoint()); p.face = null; p.stay = rnd(.5, 2.5);
    } else {
      const id = chooseStall(), [tx, ty, fa] = frontOf(id);
      p.path = route([p.x, p.y], [tx, ty]); p.face = fa; p.stay = rnd(2.5, 7);
    }
  }

  function spawn(atRandom) {
    const dog = !people.some((p) => p.dog) && Math.random() < .25;
    const p = {
      dog, x: 0, y: 0, a: 0, wait: 0, phase: rnd(0, 6), leaving: false, path: [], face: null, stay: 0,
      speed: dog ? rnd(45, 60) : rnd(24, 38), gate: pick(GATES),
      shirt: pick(SHIRTS), skin: pick(SKINS), hair: pick(HAIRS), basket: Math.random() < .45,
    };
    if (atRandom) [p.x, p.y] = plazaPoint();
    else { [p.x, p.y] = p.gate[0]; p.path = [p.gate[1]]; }
    p.el = el("g", {}, layers.people);
    p.el.innerHTML = dog ? dogSVG : shopperSVG(p);
    p.umb = p.el.querySelector(".umbrella");
    p.tail = p.el.querySelector(".tail");
    if (!p.path.length) nextGoal(p);
    people.push(p);
  }

  function stepPeople(dt, t) {
    const active = people.filter((p) => !p.leaving);
    if (active.length < target && Math.random() < dt * 1.2) spawn(false);
    if (active.length > target && Math.random() < dt * .8) {
      const p = pick(active); p.leaving = true; p.wait = 0; nextGoal(p);
    }
    for (const p of people) {
      let moving = false;
      if (p.wait > 0) p.wait -= dt;
      else if (p.path.length) {
        const [tx, ty] = p.path[0], dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
        if (d < 1.5) {
          p.path.shift();
          if (!p.path.length) {
            if (p.leaving) { p.gone = true; continue; }
            p.wait = p.stay;
            if (p.face !== null) p.a = p.face;
          }
        } else {
          const v = Math.min(d, p.speed * dt * (rainy && !p.dog ? 1.25 : 1));
          p.x += (dx / d) * v; p.y += (dy / d) * v;
          let da = Math.atan2(dy, dx) - p.a;
          while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          p.a += da * Math.min(1, dt * 6);
          moving = true;
        }
      } else nextGoal(p);
      const wob = moving ? Math.sin(t * (p.dog ? 18 : 9) + p.phase) * (p.dog ? 4 : 7) : 0;
      p.el.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${(p.a * 57.3 + wob).toFixed(1)})`);
      if (p.umb) p.umb.setAttribute("opacity", rainy ? 1 : 0);
      if (p.tail) p.tail.setAttribute("transform", `rotate(${(Math.sin(t * 16) * 30).toFixed(0)} -8 0)`);
    }
    people = people.filter((p) => { if (p.gone) p.el.remove(); return !p.gone; });
  }

  // ------------------------------------------------------------------ pigeons & bêtes
  function initBirds() {
    for (let i = 0; i < 6; i++) {
      const a = rnd(0, 6.28), d = rnd(FOUNTAIN[2] + 14, FOUNTAIN[2] + 50);
      const b = { x: FOUNTAIN[0] + Math.cos(a) * d, y: FOUNTAIN[1] + Math.sin(a) * d, a: rnd(0, 6.28), hop: rnd(0, 2), fly: 0, tx: 0, ty: 0 };
      b.el = el("g", {}, layers.birds); b.el.innerHTML = birdSVG; b.wings = b.el.querySelector(".wings");
      birds.push(b);
    }
  }
  function stepBirds(dt) {
    for (const b of birds) {
      if (b.fly > 0) {
        const dx = b.tx - b.x, dy = b.ty - b.y, d = Math.hypot(dx, dy);
        if (d < 2) b.fly = 0;
        else { const v = Math.min(d, 160 * dt); b.x += (dx / d) * v; b.y += (dy / d) * v; b.a = Math.atan2(dy, dx); }
      } else {
        const near = people.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 26);
        if (near) {
          const a = rnd(0, 6.28), d = rnd(FOUNTAIN[2] + 16, FOUNTAIN[2] + 56);
          b.tx = FOUNTAIN[0] + Math.cos(a) * d; b.ty = FOUNTAIN[1] + Math.sin(a) * d; b.fly = 1;
        } else if ((b.hop -= dt) < 0) {
          b.hop = rnd(.6, 2.4); b.a += rnd(-1.2, 1.2);
          b.x += Math.cos(b.a) * 4; b.y += Math.sin(b.a) * 4;
        }
      }
      const sc = b.fly ? 1.35 : 1;
      b.wings.setAttribute("opacity", b.fly ? 1 : 0);
      b.el.setAttribute("transform", `translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${(b.a * 57.3).toFixed(0)}) scale(${sc})`);
    }
  }

  function initBeasts() {
    const kinds = ["moutons", "moutons", "poules", "poules", "poules", "cochons", "vaches"];
    kinds.forEach((cat) => {
      const e = { cat, x: rnd(PEN[0], PEN[2]), y: rnd(PEN[1], PEN[3]), a: rnd(0, 6.28), wait: rnd(0, 3),
                  speed: cat === "poules" ? 20 : 8, sc: cat === "vaches" ? .62 : cat === "poules" ? .95 : .8 };
      e.tx = e.x; e.ty = e.y;
      e.el = el("g", {}, layers.beasts); e.el.innerHTML = ART.top[cat];
      beasts.push(e);
    });
  }
  function stepBeasts(dt) {
    for (const e of beasts) {
      if (e.wait > 0) e.wait -= dt;
      else {
        const dx = e.tx - e.x, dy = e.ty - e.y, d = Math.hypot(dx, dy);
        if (d < 1) {
          e.tx = Math.min(PEN[2], Math.max(PEN[0], e.x + rnd(-50, 50)));
          e.ty = Math.min(PEN[3], Math.max(PEN[1], e.y + rnd(-50, 50)));
          e.wait = rnd(1, e.cat === "poules" ? 2 : 5);
        } else {
          const v = Math.min(d, e.speed * dt);
          e.x += (dx / d) * v; e.y += (dy / d) * v;
          let da = Math.atan2(dy, dx) - e.a;
          while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
          e.a += da * Math.min(1, dt * 5);
        }
      }
      e.el.setAttribute("transform", `translate(${e.x.toFixed(1)} ${e.y.toFixed(1)}) rotate(${(e.a * 57.3).toFixed(1)}) scale(${e.sc})`);
    }
  }

  // ------------------------------------------------------------------ cris des marchands, effets
  function vendorPoint(id) {
    const [x, y, w, h] = STALLS[id].box, f = STALLS[id].face;
    if (f === "down") return [x + w / 2 + 14, y + 77];
    if (f === "up") return [x + w / 2 + (id === "mon_etal" ? -18 : 14), y + h - 77];
    if (f === "right") return [x + w - 18, y + h / 2 + 40];
    return [x + 62, y + h / 2 + 12];
  }
  function cry() {
    const ids = Object.keys(STALLS).filter((k) => open || !TEMPORARY.includes(k)), id = pick(ids), st = STALLS[id];
    const txt = id === "mon_etal" && myWeight < 1 ? "Revenez bientôt !" : pick(st.cris);
    const [vx, vy] = vendorPoint(id), tw = txt.length * 6.4 + 22;
    const bx = Math.max(14, Math.min(W - tw - 14, vx - tw / 2)), by = vy - 46;
    const g = el("g", { opacity: 0 }, layers.fx);
    g.innerHTML = `<rect x="${bx}" y="${by}" width="${tw}" height="26" rx="13" fill="#fff" filter="url(#mk-shadow)"/>
      <path d="M${vx - 6} ${by + 25}l6 8 6-8z" fill="#fff"/><text class="m-cry" x="${bx + tw / 2}" y="${by + 17.5}" text-anchor="middle">${txt}</text>`;
    fx.push({ el: g, t: 0, dur: 2.8, step(k) { g.setAttribute("opacity", k < .1 ? k * 10 : k > .85 ? (1 - k) / .15 : 1); } });
  }

  function celebrate(msg, emojis = []) {
    if (!svg || svg.getBoundingClientRect().width === 0) return;
    const txt = /^\+/.test(msg) ? msg : "Vendu !";
    const [x, y, w] = STALLS.mon_etal.box, cx = x + w / 2, cy = y - 8;
    emojis.forEach((e, i) => {   // les produits achetés s'envolent du comptoir
      const t = el("text", { x: cx - 30 + i * 30, y: y + 40, "text-anchor": "middle", "font-size": 20 }, layers.fx);
      t.textContent = e;
      fx.push({ el: t, t: 0, dur: 1.4, step(k) {
        t.setAttribute("y", (y + 40 - 60 * k).toFixed(1));
        t.setAttribute("opacity", (1 - k).toFixed(2));
      } });
    });
    const t = el("text", { class: "m-gain", x: cx, y: cy, "text-anchor": "middle" }, layers.fx);
    t.textContent = txt;
    fx.push({ el: t, t: 0, dur: 1.9, step(k) {
      t.setAttribute("y", (cy - 70 * (1 - Math.pow(1 - k, 2))).toFixed(1));
      t.setAttribute("opacity", k > .7 ? ((1 - k) / .3).toFixed(2) : 1);
    } });
    for (let i = 0; i < 9; i++) {
      const c = el("g", {}, layers.fx);
      c.innerHTML = `<circle r="6" fill="#F2C94C" stroke="#C99A2F" stroke-width="1.5"/><path d="M-2 -2.5h4M-2 0h4" stroke="#C99A2F" stroke-width="1.2"/>`;
      const vx = rnd(-90, 90), vy = rnd(-230, -150), x0 = cx + rnd(-20, 20);
      fx.push({ el: c, t: 0, dur: 1.3, step(k) {
        const s = k * 1.3;
        c.setAttribute("transform", `translate(${(x0 + vx * s).toFixed(1)} ${(cy + 20 + vy * s + 260 * s * s).toFixed(1)})`);
        c.setAttribute("opacity", k > .75 ? ((1 - k) / .25).toFixed(2) : 1);
      } });
    }
  }

  function stepFx(dt) {
    for (const f of fx) { f.t += dt; f.step(Math.min(1, f.t / f.dur)); }
    fx = fx.filter((f) => { if (f.t >= f.dur) f.el.remove(); return f.t < f.dur; });
  }

  // ------------------------------------------------------------------ sélection
  function select(id) {
    if (!svg) return;
    if (!id || !STALLS[id]) { layers.sel.innerHTML = ""; return; }
    const [x, y, w, h] = STALLS[id].box;
    layers.sel.innerHTML = `<rect x="${x - 6}" y="${y - 6}" width="${w + 12}" height="${h + 12}" rx="16" fill="none" stroke="#fff" stroke-width="4" stroke-dasharray="12 8">
      <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="1.2s" repeatCount="indefinite"/></rect>`;
    svg.querySelectorAll(".stall-label").forEach((l, i) => l.setAttribute("opacity", Object.keys(STALLS)[i] === id ? 1 : .82));
  }

  // ------------------------------------------------------------------ cycle
  function loop(t) {
    const dt = Math.min(.1, (t - lastT) / 1000 || 0);
    lastT = t;
    if (ready && svg.getBoundingClientRect().width > 0) {  // en pause quand l'onglet Marché est masqué
      const ts = t / 1000;
      stepPeople(dt, ts);
      stepBirds(dt);
      stepBeasts(dt);
      stepFx(dt);
      if ((cryAt -= dt) < 0 && night < .7 && people.length) { cry(); cryAt = rnd(2.5, 5); }
    }
    requestAnimationFrame(loop);
  }

  function init(svgEl, select) {
    svg = svgEl;
    onSelect = select;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = staticLayer();
    layers.base = el("g", {}, svg);
    layers.base.innerHTML = fountainSVG() + penSVG() + coopSVG() + Object.keys(GOODS).concat("mon_etal").map(stallSVG).join("");
    layers.beasts = el("g", {}, svg);
    layers.birds = el("g", {}, svg);
    layers.sel = el("g", { "pointer-events": "none" }, svg);
    layers.people = el("g", {}, svg);
    layers.bunting = el("g", { "pointer-events": "none" }, svg);
    layers.bunting.innerHTML = buntingSVG();
    layers.weather = el("g", { "pointer-events": "none" }, svg);
    layers.weather.innerHTML = `<rect id="mk-heat" width="${W}" height="${H}" fill="#FFB347" opacity="0"/>
      <rect id="mk-night" width="${W}" height="${H}" fill="#0E1A33" opacity="0"/>
      <g id="mk-rain" opacity="0" stroke="#E8F2FA" stroke-width="2" stroke-linecap="round">${Array.from({ length: 80 }, (_, i) => {
        const x = (i * 113) % W, y = (i * 71) % H, d = (.5 + (i % 5) * .08).toFixed(2);
        return `<line x1="${x}" y1="${y}" x2="${x - 5}" y2="${y + 14}"><animateTransform attributeName="transform" type="translate" from="0 -${H}" to="0 0" dur="${d}s" repeatCount="indefinite"/></line>`;
      }).join("")}</g>`;
    layers.glow = el("g", { "pointer-events": "none", opacity: 0 }, svg);
    layers.glow.innerHTML = [[220, 206], [780, 206], [220, 500], [780, 500]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="70" fill="url(#mk-glow)" opacity=".75"/>`).join("");
    layers.fx = el("g", { "pointer-events": "none" }, svg);
    layers.labels = el("g", {}, svg);
    layers.labels.innerHTML = labelsSVG();
    svg.addEventListener("click", (ev) => {
      const z = ev.target.closest(".zone");
      if (z) onSelect(z.dataset.stall);
    });
    initBirds();
    initBeasts();
    select("mon_etal");
    requestAnimationFrame(loop);
  }

  // jour de marché : la foule suit l'affluence calculée par le moteur ; sinon quelques passants vers les boutiques
  function crowdTarget(d, w) {
    const h = d.heure_dec;
    if (d.marche_ouvert) return Math.round(Math.max(6, Math.min(26, d.clients_heure * .7 + 6)));
    let n = h < 7 || h >= 20 ? 0 : 4;
    if (w === "pluie") n *= .5;
    if (w === "orage") n = 0;
    return Math.round(n);
  }

  function setOpen(o) {
    open = o;
    svg.querySelectorAll(".mk-open").forEach((g) => {
      if (TEMPORARY.includes(g.dataset.stall)) g.setAttribute("display", o ? "inline" : "none");
    });
    svg.querySelectorAll(".mk-closed").forEach((g) => g.setAttribute("display", o ? "none" : "inline"));
  }

  function update(state, goods = []) {
    if (!svg) return;
    const d = state.derive, h = d.heure_dec, w = state.meteo.type;
    night = ART.nightAmount(h);
    rainy = w === "pluie" || w === "orage";
    if (cache.open !== d.marche_ouvert) { cache.open = d.marche_ouvert; setOpen(d.marche_ouvert); }
    target = crowdTarget(d, w);
    myWeight = goods.length ? 1.6 + goods.length * .35 : .25;
    const sig = goods.join("|");
    if (cache.goods !== sig) { cache.goods = sig; svg.querySelector("#mk-goods").innerHTML = goodsSVG(goods); }
    svg.querySelector("#mk-night").setAttribute("opacity", (night * .42).toFixed(2));
    svg.querySelector("#mk-rain").setAttribute("opacity", rainy ? .6 : 0);
    svg.querySelector("#mk-heat").setAttribute("opacity", w === "canicule" && night < .5 ? .08 : 0);
    layers.glow.setAttribute("opacity", night.toFixed(2));
    layers.bunting.querySelectorAll(".bulb").forEach((b) => b.setAttribute("opacity", night.toFixed(2)));
    if (!ready) {                     // première image : la place est déjà animée
      for (let i = 0; i < target; i++) spawn(true);
      ready = true;
    }
  }

  const crowdSize = () => people.filter((p) => !p.leaving && !p.dog).length;

  return { init, update, select, celebrate, crowdSize, STALLS, TEMPORARY };
})();

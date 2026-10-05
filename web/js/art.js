// Illustrations : bannière d'accueil, avatar, animaux (profil et vue du dessus).

const ART = (() => {
  const lerp = (a, b, t) => a + (b - a) * t;
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return "#" + A.map((v, i) => Math.round(lerp(v, B[i], t)).toString(16).padStart(2, "0")).join("");
  };

  // couleurs du ciel selon l'heure [heure, haut, bas]
  const SKY = [
    [0, "#14213F", "#2C3D68"], [5, "#2B3A63", "#5B6A94"], [6.5, "#F2A97F", "#FCD9AE"],
    [8.5, "#7FC4EE", "#D6EEFA"], [17, "#7FC4EE", "#D6EEFA"], [19.5, "#E9825A", "#F8C79B"],
    [21, "#2B3A63", "#56648E"], [24, "#14213F", "#2C3D68"],
  ];
  function skyAt(h, weather) {
    let i = 0;
    while (i < SKY.length - 2 && SKY[i + 1][0] <= h) i++;
    const [h0, t0, b0] = SKY[i], [h1, t1, b1] = SKY[i + 1];
    const t = (h - h0) / (h1 - h0);
    let top = mix(t0, t1, t), bot = mix(b0, b1, t);
    if (weather === "pluie" || weather === "orage") { top = mix(top, "#7A8693", .55); bot = mix(bot, "#B5BEC6", .55); }
    if (weather === "nuageux") { top = mix(top, "#A9B8C4", .3); bot = mix(bot, "#E3E8EC", .3); }
    if (weather === "canicule") { bot = mix(bot, "#FCE3A6", .35); }
    return [top, bot];
  }
  const nightAmount = (h) => {
    if (h >= 7.5 && h <= 18.5) return 0;
    if (h > 18.5 && h < 21) return (h - 18.5) / 2.5;
    if (h > 5 && h < 7.5) return 1 - (h - 5) / 2.5;
    return 1;
  };

  function cloud(x, y, s, op = 1) {
    return `<g transform="translate(${x} ${y}) scale(${s})" opacity="${op}" fill="#fff">
      <ellipse cx="0" cy="18" rx="62" ry="20"/><circle cx="-22" cy="6" r="24"/><circle cx="12" cy="-4" r="32"/><circle cx="40" cy="10" r="20"/></g>`;
  }
  function tree(x, y, s, c = "#5FA344") {
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-4" y="10" width="8" height="26" rx="3" fill="#7A5434"/>
      <circle cx="0" cy="0" r="24" fill="${c}"/><circle cx="-14" cy="10" r="16" fill="${c}"/><circle cx="14" cy="10" r="17" fill="${c}"/>
      <circle cx="-6" cy="-8" r="10" fill="#fff" opacity=".12"/></g>`;
  }
  function pine(x, y, s) {
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <rect x="-3" y="40" width="6" height="14" fill="#6B4A2E"/>
      <path d="M0 -10 L20 22 L-20 22Z M0 8 L24 44 L-24 44Z" fill="#2F7A3E"/></g>`;
  }
  function windmill(x, y, s) {
    return `<g transform="translate(${x} ${y}) scale(${s})">
      <path d="M-3 0 L-6 150 L6 150 L3 0Z" fill="#F4F6F7"/>
      <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="${5 + s * 3}s" repeatCount="indefinite"/><g fill="#F7F9FA" stroke="#DDE3E7" stroke-width="1">
        <path d="M0 0 L-4 -70 Q0 -76 4 -70Z"/><path d="M0 0 L-4 -70 Q0 -76 4 -70Z" transform="rotate(120)"/>
        <path d="M0 0 L-4 -70 Q0 -76 4 -70Z" transform="rotate(240)"/></g></g>
      <circle r="5" fill="#E2E7EA"/></g>`;
  }

  function hero() {
    let rows = "";
    for (let i = 0; i < 9; i++) {
      const y = 262 + i * 15 + i * i * 1.4;
      rows += `<path d="M${-40} ${y} Q600 ${y - 18} 1240 ${y}" stroke="#7A4A2C" stroke-width="${5 + i}" fill="none" opacity=".55"/>`;
      for (let j = 0; j < 22; j++) {
        const x = 30 + j * 55 + (i % 2) * 26;
        const r = 4 + i * 1.1;
        rows += `<circle cx="${x}" cy="${y - 4 - (1 - Math.abs(x - 600) / 650) * 10}" r="${r}" fill="${i % 2 ? "#4E9A3A" : "#5EAD45"}"/>`;
      }
    }
    let stripes = "";
    for (let i = 0; i < 18; i++) stripes += `<path d="M${380 + i * 26} 214 L${300 + i * 30} 258" stroke="#E7C46A" stroke-width="7"/>`;
    return `
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop id="sky-top" offset="0"/><stop id="sky-bot" offset="1"/></linearGradient>
        <clipPath id="wheatclip"><path d="M320 214 Q560 196 820 214 L860 262 Q560 236 280 262Z"/></clipPath>
      </defs>
      <rect width="1200" height="380" fill="url(#sky)"/>
      <g id="hero-stars" opacity="0">${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 137) % 1200}" cy="${(i * 53) % 170}" r="${1 + (i % 3) * .5}" fill="#fff"/>`).join("")}</g>
      <circle id="hero-sun" r="34" fill="#FFE18A" cx="900" cy="80"/>
      <circle id="hero-moon" r="24" fill="#F3F1E6" cx="900" cy="80" opacity="0"/>
      <g class="drift">${cloud(200, 80, 1)}${cloud(620, 50, .7, .9)}</g>
      <g class="drift" style="animation-duration:90s;animation-delay:-40s">${cloud(300, 120, .55, .85)}${cloud(900, 70, .9)}</g>
      <path d="M0 210 Q200 150 420 190 T820 175 T1200 190 V380 H0Z" fill="#A7D58A"/>
      <path d="M0 230 Q300 190 600 222 T1200 215 V380 H0Z" fill="#8CC66B"/>
      ${windmill(570, 92, .78)}${windmill(650, 110, .62)}${windmill(500, 128, .45)}
      <g clip-path="url(#wheatclip)"><rect x="250" y="190" width="650" height="80" fill="#F3D27A"/>${stripes}</g>
      ${tree(120, 200, 1.1)}${tree(185, 214, .85, "#6DB04D")}${tree(60, 222, .8, "#579A3D")}
      ${pine(1010, 150, 1)}${pine(1060, 168, .8)}${pine(1110, 140, 1.1)}
      <g transform="translate(1000 168)">
        <path d="M0 40 L60 0 L120 40Z" fill="#A72F26"/><rect x="6" y="40" width="108" height="70" fill="#C8392E"/>
        <rect x="40" y="62" width="40" height="48" fill="#F4EEE2"/><path d="M40 62 L80 110 M80 62 L40 110" stroke="#C8392E" stroke-width="5"/>
        <rect x="52" y="20" width="16" height="14" fill="#F4EEE2"/>
      </g>
      <path d="M0 252 Q600 228 1200 252 V380 H0Z" fill="#9C6440"/>
      ${rows}
      <rect id="hero-night" width="1200" height="380" fill="#0E1A33" opacity="0"/>
      <g id="hero-rain" opacity="0" stroke="#fff" stroke-width="2" stroke-linecap="round">
        ${Array.from({ length: 70 }, (_, i) => `<line x1="${(i * 97) % 1200}" y1="${(i * 61) % 380}" x2="${(i * 97) % 1200 - 6}" y2="${(i * 61) % 380 + 16}"><animate attributeName="y1" values="${(i * 61) % 380 - 400};${(i * 61) % 380}" dur="${.6 + (i % 5) * .1}s" repeatCount="indefinite"/><animate attributeName="y2" values="${(i * 61) % 380 - 384};${(i * 61) % 380 + 16}" dur="${.6 + (i % 5) * .1}s" repeatCount="indefinite"/></line>`).join("")}
      </g>`;
  }

  function updateHero(svg, h, weather) {
    const [top, bot] = skyAt(h, weather);
    svg.querySelector("#sky-top").setAttribute("stop-color", top);
    svg.querySelector("#sky-bot").setAttribute("stop-color", bot);
    const n = nightAmount(h);
    svg.querySelector("#hero-night").setAttribute("opacity", (n * .45).toFixed(2));
    svg.querySelector("#hero-stars").setAttribute("opacity", n.toFixed(2));
    // trajectoire du soleil 6h → 20h, de la lune 20h → 6h
    const sunT = (h - 6) / 14;
    const sun = svg.querySelector("#hero-sun"), moon = svg.querySelector("#hero-moon");
    if (sunT >= 0 && sunT <= 1) {
      sun.setAttribute("cx", 120 + sunT * 960);
      sun.setAttribute("cy", 210 - Math.sin(sunT * Math.PI) * 160);
      sun.setAttribute("opacity", weather === "pluie" || weather === "orage" ? .35 : 1);
    } else sun.setAttribute("opacity", 0);
    const mt = ((h + 4) % 24) / 10;
    if (mt <= 1) {
      moon.setAttribute("cx", 120 + mt * 960);
      moon.setAttribute("cy", 210 - Math.sin(mt * Math.PI) * 150);
      moon.setAttribute("opacity", .95);
    } else moon.setAttribute("opacity", 0);
    svg.querySelector("#hero-rain").setAttribute("opacity", weather === "pluie" || weather === "orage" ? .55 : 0);
  }

  const avatar = `<svg viewBox="0 0 64 64">
    <rect width="64" height="64" fill="#CFE7F5"/>
    <path d="M10 64c2-12 10-17 22-17s20 5 22 17z" fill="#3E6B4E"/>
    <path d="M26 47l6 7 6-7" fill="#F4EEE2"/>
    <rect x="27" y="38" width="10" height="10" rx="3" fill="#E5AE88"/>
    <ellipse cx="32" cy="31" rx="12" ry="13" fill="#F0BF98"/>
    <path d="M21 33c0 7 5 11 11 11s11-4 11-11c-2 3-5 3-6 2-2 3-8 3-10 0-1 1-4 1-6-2z" fill="#6B4632"/>
    <circle cx="27.5" cy="30" r="1.6" fill="#2A1E17"/><circle cx="36.5" cy="30" r="1.6" fill="#2A1E17"/>
    <path d="M29 37q3 2 6 0" stroke="#2A1E17" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="32" cy="20" rx="20" ry="4.5" fill="#D9A93F"/>
    <path d="M21 20c0-8 5-11 11-11s11 3 11 11z" fill="#E8BC52"/>
    <path d="M21 17.5h22" stroke="#B5482F" stroke-width="2.6"/>
  </svg>`;

  // ---------- animaux de profil (cartes) ----------
  const side = {
    vaches: `<svg viewBox="0 0 100 70"><g>
      <rect x="22" y="44" width="7" height="20" rx="3" fill="#3A3A3A"/><rect x="66" y="44" width="7" height="20" rx="3" fill="#3A3A3A"/>
      <rect x="30" y="46" width="7" height="18" rx="3" fill="#555"/><rect x="58" y="46" width="7" height="18" rx="3" fill="#555"/>
      <rect x="16" y="20" width="64" height="32" rx="16" fill="#fff" stroke="#E2DED5" stroke-width="1.5"/>
      <path d="M30 22c6 3 6 12 0 15-5-2-6-11 0-15zM55 36c5-3 12 0 12 6-5 3-11 1-12-6zM62 21c5 0 9 4 8 8-5 1-9-3-8-8z" fill="#2E2E2E"/>
      <path d="M16 30c-6 4-7 12-4 16" stroke="#C9C4BA" stroke-width="2" fill="none"/>
      <ellipse cx="84" cy="30" rx="12" ry="11" fill="#fff" stroke="#E2DED5" stroke-width="1.5"/>
      <ellipse cx="90" cy="35" rx="8" ry="6" fill="#F3B6B1"/><circle cx="88" cy="34" r="1" fill="#8A4B47"/><circle cx="93" cy="34" r="1" fill="#8A4B47"/>
      <circle cx="82" cy="26" r="1.8" fill="#222"/><path d="M76 20l-3-6M88 20l3-6" stroke="#C9A36B" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="72" cy="23" rx="5" ry="3" fill="#2E2E2E"/></g></svg>`,
    poules: `<svg viewBox="0 0 80 70">
      <path d="M36 58v8M44 58v8" stroke="#E2A23A" stroke-width="3" stroke-linecap="round"/>
      <path d="M12 30c6-6 14-2 16 2" fill="#B5652E"/>
      <ellipse cx="40" cy="42" rx="24" ry="18" fill="#C9763B"/>
      <path d="M22 40c8 10 26 12 34 2-6 14-30 14-34-2z" fill="#A85E2A"/>
      <circle cx="58" cy="24" r="12" fill="#D2834A"/>
      <path d="M52 13c1-5 4-5 5-2 1-4 5-4 5 0 2-3 5-1 4 2z" fill="#D9382F"/>
      <path d="M69 24l7 3-7 2z" fill="#F0B23A"/><path d="M64 31c1 5-1 7-3 7 0-4 1-5 3-7z" fill="#D9382F"/>
      <circle cx="61" cy="22" r="1.8" fill="#222"/></svg>`,
    moutons: `<svg viewBox="0 0 90 70">
      <rect x="26" y="44" width="5" height="20" rx="2" fill="#3B3B3B"/><rect x="58" y="44" width="5" height="20" rx="2" fill="#3B3B3B"/>
      <g fill="#F5F2EA" stroke="#E2DCCD" stroke-width="1.5">
        <circle cx="26" cy="36" r="13"/><circle cx="40" cy="28" r="14"/><circle cx="55" cy="30" r="13"/><circle cx="62" cy="42" r="11"/>
        <circle cx="44" cy="44" r="14"/><circle cx="26" cy="46" r="10"/></g>
      <ellipse cx="72" cy="32" rx="9" ry="11" fill="#3B3B3B"/>
      <ellipse cx="64" cy="27" rx="6" ry="3" fill="#3B3B3B" transform="rotate(-20 64 27)"/>
      <circle cx="75" cy="29" r="1.8" fill="#fff"/>
      <circle cx="72" cy="22" r="6" fill="#F5F2EA" stroke="#E2DCCD" stroke-width="1.5"/></svg>`,
    cochons: `<svg viewBox="0 0 90 70">
      <rect x="24" y="46" width="7" height="16" rx="3" fill="#E79A9E"/><rect x="58" y="46" width="7" height="16" rx="3" fill="#E79A9E"/>
      <ellipse cx="44" cy="38" rx="30" ry="20" fill="#F6B7BA"/>
      <path d="M14 34c-6-2-6 6-1 5 3-1 1-6-3-3" stroke="#E79A9E" stroke-width="2" fill="none"/>
      <path d="M62 20l6-8 4 10z" fill="#EA9DA1"/>
      <ellipse cx="76" cy="38" rx="7" ry="8" fill="#EE9EA3"/><circle cx="75" cy="36" r="1.3" fill="#A55A60"/><circle cx="75" cy="41" r="1.3" fill="#A55A60"/>
      <circle cx="66" cy="31" r="1.8" fill="#222"/></svg>`,
  };

  // ---------- animaux vus du dessus (carte) ----------
  const top = {
    vaches: `<g><ellipse rx="17" ry="10" fill="#fff" stroke="#D9D4C7" stroke-width="1"/>
      <path d="M-8 -6c4 1 5 7 1 9-4-1-5-7-1-9zM5 1c4-1 7 2 6 6-4 1-7-2-6-6z" fill="#2E2E2E"/>
      <ellipse cx="19" cy="0" rx="6" ry="5" fill="#fff" stroke="#D9D4C7" stroke-width="1"/><ellipse cx="23" cy="0" rx="3" ry="3.4" fill="#F0B2AC"/>
      <path d="M-17 0h-5" stroke="#2E2E2E" stroke-width="1.5"/></g>`,
    poules: `<g><ellipse rx="6" ry="5" fill="#F7F3EA" stroke="#D8CFBE" stroke-width=".8"/><circle cx="5" cy="0" r="3" fill="#F7F3EA"/>
      <circle cx="6" cy="0" r="1.3" fill="#D9382F"/><path d="M8 -.8l2.4 .8-2.4 .8z" fill="#F0B23A"/></g>`,
    moutons: `<g><g fill="#F5F2EA" stroke="#DDD6C5" stroke-width=".8"><circle cx="-5" cy="-3" r="6"/><circle cx="3" cy="-4" r="6"/><circle cx="-4" cy="4" r="6"/><circle cx="4" cy="4" r="6"/></g>
      <ellipse cx="11" cy="0" rx="4.5" ry="3.6" fill="#333"/></g>`,
    cochons: `<g><ellipse rx="12" ry="8" fill="#F6B7BA" stroke="#E79A9E" stroke-width="1"/>
      <ellipse cx="13" cy="0" rx="3" ry="3.6" fill="#EE9EA3"/><path d="M8 -6l3-3 1 4zM8 6l3 3 1-4z" fill="#EA9DA1"/></g>`,
  };

  return { hero, updateHero, avatar, side, top, skyAt, nightAmount };
})();

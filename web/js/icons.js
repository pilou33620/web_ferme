// Jeu d'icônes au trait (24×24), dessinées à la main.
const ICONS = {
  home: '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  cow: '<path d="M6 8c-2 0-3-1-3-3 2 0 3 1 3 3zM18 8c2 0 3-1 3-3-2 0-3 1-3 3z"/><path d="M6 8h12v6a6 6 0 0 1-12 0z"/><path d="M9 17.5a3 2 0 0 0 6 0"/><circle cx="9.5" cy="11.5" r=".6" fill="currentColor"/><circle cx="14.5" cy="11.5" r=".6" fill="currentColor"/>',
  store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a2.7 2.7 0 0 1-5.3 0 2.7 2.7 0 0 1-5.4 0A2.7 2.7 0 0 1 4 11z"/><path d="M5 12.5V20h14v-7.5"/><path d="M10 20v-4h4v4"/>',
  leaf: '<path d="M5 19c0-9 6-14 15-14-1 9-6 14-15 14z"/><path d="M5 19l8-8"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10V4.5a1.5 1.5 0 0 1 3 0V11"/><path d="M15 10.5V6.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.5a6 6 0 0 1-4.6-2.2L3.5 15.5a1.6 1.6 0 0 1 2.4-2.1L9 16V8.5a1.5 1.5 0 0 1 3 0"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 10a4 4 0 0 1-1 8z"/>',
  rain: '<path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 7a4 4 0 0 1-1 8z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  storm: '<path d="M7 15a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 7a4 4 0 0 1-1 8z"/><path d="M12 13l-2 4h4l-2 4"/>',
  heat: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/><path d="M18 5h3M18 9h3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  drop: '<path d="M12 3s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 10 12 3 12 3z"/>',
  sprout: '<path d="M12 21v-9"/><path d="M12 12C12 8 9 5 4 5c0 4 3 7 8 7z"/><path d="M12 14c0-4 3-7 8-7 0 4-3 7-8 7z"/>',
  wheat: '<path d="M12 22V8"/><path d="M12 8c-2-1-3-3-3-5 2 1 3 3 3 5zM12 8c2-1 3-3 3-5-2 1-3 3-3 5zM12 13c-2.5-1-3.5-3-3.5-5 2.5 1 3.5 3 3.5 5zM12 13c2.5-1 3.5-3 3.5-5-2.5 1-3.5 3-3.5 5zM12 18c-2.5-1-3.5-3-3.5-5 2.5 1 3.5 3 3.5 5zM12 18c2.5-1 3.5-3 3.5-5-2.5 1-3.5 3-3.5 5z"/>',
  tomato: '<circle cx="12" cy="13.5" r="7"/><path d="M9 6.5l3 2 3-2M12 8.5V4"/>',
  carrot: '<path d="M15 9 4 20c-.5.5 0 1 .5.5L17 11z"/><path d="M15 9c1-2 3-3 5-3M15 9c2-1 3-3 3-5M15 9c-.5-1.5 0-3 1-4"/>',
  corn: '<path d="M12 21c-3 0-4-4-4-9s2-9 4-9 4 4 4 9-1 9-4 9z"/><path d="M8 11h8M8.3 15h7.4M9 7h6M12 3v18"/><path d="M8 18c-2-1-4-3-4-6M16 18c2-1 4-3 4-6"/>',
  house: '<path d="M3 11 12 4l9 7"/><path d="M5.5 9.5V20h13V9.5"/><rect x="10" y="14" width="4" height="6"/>',
  fence: '<path d="M5 21V6l2-2 2 2v15M15 21V6l2-2 2 2v15"/><path d="M3 10h18M3 16h18"/>',
  tank: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/>',
  barn: '<path d="M3 10l9-6 9 6v11H3z"/><path d="M9 21v-7h6v7M9 14l6 7M15 14l-6 7"/>',
  egg: '<path d="M12 3c3.5 0 6.5 5.5 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.5 8.5 3 12 3z"/>',
  milk: '<path d="M8 2h8M9 2v3l-2 3v13h10V8l-2-3V2"/><path d="M7 13h10"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 8.5a4 4 0 1 0 0 7M7.5 11h6M7.5 13.5h6"/>',
  heart: '<path d="M12 20s-8-4.6-8-10.3A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.7C20 15.4 12 20 12 20z"/>',
  bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M8 7c0-1.5 1-2 1-3M12 7c0-1.5 1-2 1-3M16 7c0-1.5 1-2 1-3"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
  sparkle: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  tractor: '<circle cx="7" cy="16" r="4"/><circle cx="18" cy="17" r="3"/><path d="M3 12V6h7l2 6h6v2"/><path d="M10 6v6H3"/>',
  vet: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
  shovel: '<path d="M14 10 4 20M16 4l4 4-3 3-4-4zM2 22l3-3"/>',
  poop: '<path d="M8 10c0-2 2-3 4-3 0-2 1-3 2-4 0 2 2 2 2 4 2 0 3 1 3 3"/><path d="M5 14c0-2 1.5-4 4-4h6c2.5 0 4 2 4 4"/><path d="M3 18c0-2 2-4 4-4h10c2 0 4 2 4 4v1H3z"/>',
  greenhouse: '<path d="M3 21V11l9-7 9 7v10z"/><path d="M3 11h18M12 4v17M7.5 7.5V21M16.5 7.5V21"/>',
  wind: '<path d="M12 9v12M9 21h6"/><path d="M12 9V2.5M12 9l-5.6 3.3M12 9l5.6 3.3"/><circle cx="12" cy="9" r="1.4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  bee:'<ellipse cx="12" cy="14" rx="4.5" ry="6"/><path d="M7.6 12.5h8.8M7.8 15.8h8.4"/><path d="M10 8.5C8 5 4.5 5 4.5 7.5S8 10 10 9.5M14 8.5C16 5 19.5 5 19.5 7.5S16 10 14 9.5"/><path d="M12 20v1.5"/>',
  lock:'<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  rainbow: '<path d="M2.5 18a9.5 9.5 0 0 1 19 0"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M9.5 18a2.5 2.5 0 0 1 5 0"/>',
  breeze: '<path d="M3 8h10.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15.5a2.5 2.5 0 1 1-2.5 2.5"/><path d="M3 16h8"/>',
  live: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14"/>',
  thermo: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>',
  wool: '<circle cx="12" cy="12" r="8"/><path d="M6 8c4 0 9 4 12 9M5 13c4-1 8 1 10 5M9 4.5c2 3 6 5 10 5"/>',
};

function icon(name, cls = "") {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.dataset.hydrated) {
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon));
      el.dataset.hydrated = "1";
    }
  });
}

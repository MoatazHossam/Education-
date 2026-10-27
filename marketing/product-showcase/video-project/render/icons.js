// Line icons (24 × 24, stroke = currentColor) drawn for the video; no third-party icon set.
const P = {
  sheet: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16M15 4v16"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  paper: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 11h7M9 14h7M9 17h5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  app: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  scatter: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="5" width="6" height="6" rx="1"/><rect x="6" y="15" width="6" height="6" rx="1"/><path d="M17 15v2M17 19v2M19 17h2" />',
  unlink: '<path d="M10 14l-2 2a3 3 0 01-4-4l2-2M14 10l2-2a3 3 0 014 4l-2 2"/><path d="M8 4v3M4 8h3M16 20v-3M20 16h-3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7s-5-1.5-7-5l-1-2a1.5 1.5 0 012.6-1.5L8 14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V9M16 16v-6"/>',
  book: '<path d="M4 5c3-1.5 5.5-1.5 8 0v15c-2.5-1.5-5-1.5-8 0z"/><path d="M12 5c2.5-1.5 5-1.5 8 0v15c-3-1.5-5.5-1.5-8 0"/>',
  class: '<rect x="3" y="4" width="18" height="11" rx="1.5"/><path d="M7 19h10M12 15v4M7 8h6"/>',
  task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>',
  grade: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11M13 13h4M13 16h3"/>',
  student: '<path d="M2 9l10-4 10 4-10 4z"/><path d="M6 11v5c3 2.5 9 2.5 12 0v-5M22 9v6"/>',
  rtl: '<path d="M20 7H6M10 3L6 7l4 4"/><path d="M4 14h14M4 18h9"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 018 0v3"/><circle cx="12" cy="15" r="1.4"/>',
  access: '<circle cx="12" cy="4.5" r="2"/><path d="M5 8l7 1.5L19 8M12 9.5V14l-3.5 7M12 14l3.5 7"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
  school: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M10 21v-5h4v5M9 11h6"/>',
  edtech: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/><path d="M9 8l-2 2 2 2M15 8l2 2-2 2"/>',
  center: '<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 20c.6-3.4 3-5 6-5s5.4 1.6 6 5M12.5 15.6c1-.4 2.2-.6 3.5-.6 3 0 5.4 1.6 6 5"/>',
  uni: '<path d="M3 9l9-5 9 5-9 5z"/><path d="M5 10.5V17M9 12.5v6M15 12.5v6M19 10.5V17M3 21h18"/>',
  plan: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  meter: '<path d="M4 18a8 8 0 1116 0"/><path d="M12 18l4-6"/><circle cx="12" cy="18" r="1.4"/>',
  audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 10h7M9 13h7M9 16h4"/><circle cx="17" cy="17" r="3" /><path d="M19.2 19.2L21 21"/>',
  teacher: '<circle cx="8" cy="7" r="3"/><path d="M2 20c.6-3.6 2.8-6 6-6s5.4 2.4 6 6"/><rect x="14" y="4" width="8" height="6" rx="1"/><path d="M16 7h4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3M8 17h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  save: '<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-6h8v6"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12l2 2 4-4"/>',
  cloud: '<path d="M7 18a4 4 0 01-.5-8 6 6 0 0111.4 1.5A3.5 3.5 0 0117.5 18z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  server: '<rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/><path d="M8 6.5h.01M8 17.5h.01"/>',
  db: '<ellipse cx="12" cy="5.5" rx="7.5" ry="2.8"/><path d="M4.5 5.5v13c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8v-13M4.5 12c0 1.6 3.4 2.8 7.5 2.8s7.5-1.2 7.5-2.8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l2 2M14 9l2 2"/>',
  gauge: '<path d="M4 17a8 8 0 1116 0"/><path d="M12 17l-3-5"/><path d="M8 9.5l.01 0M12 8v.01M16 9.5v.01"/>',
  bug: '<rect x="7" y="7" width="10" height="13" rx="5"/><path d="M12 7V4M9 4l1.5 1.5M15 4l-1.5 1.5M3 12h4M17 12h4M4 18l3-2M20 18l-3-2M4 7l3 2M20 7l-3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  worker: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3z"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/>',
  arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
};

export function icon(name, size = 48, stroke = 1.6) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${P[name] ?? P.check}</svg>`;
  return span;
}

/** The product's logo mark (public/favicon.svg), as an element of a given size. */
export function logoMark(size) {
  const span = document.createElement('span');
  span.className = 'icon logo-mark';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.innerHTML = '<svg viewBox="0 0 32 32"><rect class="lm-bg" width="32" height="32" rx="6" fill="#1f4e8c"/><rect class="lm-margin" x="7" y="5" width="2.5" height="22" fill="#c0473b"/><rect class="lm-l1" x="12" y="9" width="13" height="2" rx="1" fill="#fff"/><rect class="lm-l2" x="12" y="15" width="13" height="2" rx="1" fill="#fff"/><rect class="lm-l3" x="12" y="21" width="9" height="2" rx="1" fill="#fff"/></svg>';
  return span;
}

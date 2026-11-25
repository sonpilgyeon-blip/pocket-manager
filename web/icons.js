// 단색 픽토그램 아이콘 모음. 선 하나 굵기(1.75)로 통일하고 색은 글자색(currentColor)을 따릅니다.
// icon("home") → <svg …> 문자열
const P = {
  home: `<path d="M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>`,
  card: `<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 14.5h4"/>`,
  repeat: `<path d="M17 3l3 3-3 3"/><path d="M4 12v-2a4 4 0 0 1 4-4h12"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v2a4 4 0 0 1-4 4H4"/>`,
  check: `<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M8 12.2l2.8 2.8L16 9.5"/>`,
  bot: `<rect x="4" y="8" width="16" height="12" rx="3.5"/><path d="M12 4.5V8"/><circle cx="12" cy="3.5" r="1"/><path d="M9 13v1.5M15 13v1.5M2 13v3M22 13v3"/>`,
  settings: `<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>`,
  pen: `<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 7.5l2 2"/>`,
  camera: `<path d="M4 8h3l1.8-2.5h6.4L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>`,
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>`,
  flag: `<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>`,
  receipt: `<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4z"/><path d="M9 8h6M9 12h6M9 16h3"/>`,
  search: `<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>`,
  chart: `<path d="M4 20h16"/><path d="M7 17v-5M12 17V7M17 17v-8"/>`,
  swap: `<path d="M4 8h14l-3.5-3.5"/><path d="M20 16H6l3.5 3.5"/>`,
  bulb: `<path d="M9.5 18h5M10.5 21h3"/><path d="M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>`,
  send: `<circle cx="12" cy="12" r="9"/><path d="M9 15l6-6M10 9h5v5"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>`,
  chevronDown: `<path d="M6 9l6 6 6-6"/>`,
  chevronRight: `<path d="M9 6l6 6-6 6"/>`,
  warning: `<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>`,
  tick: `<path d="M6 12.5l4 4L18 8" stroke-width="2.5"/>`,
  done: `<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.7 2.7L16 9.6"/>`,
  power: `<path d="M12 3v8"/><path d="M6.3 6.5a8 8 0 1 0 11.4 0"/>`,
  // 지출 분류
  food: `<path d="M6 3v6a3 3 0 0 0 6 0V3M9 3v18"/><path d="M17.5 3c-2 2-2 6.5 0 8.5V21"/>`,
  coffee: `<path d="M4 9.5h12v4.5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v3M12 3.5v3"/>`,
  bus: `<rect x="5" y="3" width="14" height="15" rx="3"/><path d="M5 11h14M8 18v3M16 18v3"/><path d="M8.5 14.5h.01M15.5 14.5h.01" stroke-width="2.4"/>`,
  bag: `<path d="M5 8h14l-1.2 13H6.2z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>`,
  phone: `<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>`,
  medical: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>`,
  film: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18M3 14.5h18M8 5v4.5M16 5v4.5M8 14.5V19M16 14.5V19"/>`,
  book: `<path d="M4.5 5.5a2 2 0 0 1 2-2H19v14H6.5a2 2 0 0 0-2 2z"/><path d="M4.5 19.5a2 2 0 0 0 2 2H19v-4"/>`,
};

export function icon(name, size = 20, extra = "") {
  const body = P[name] || P.card;
  return `<svg class="pi ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// 지출 분류 → 아이콘
export const CAT_ICON = { 식비: "food", 카페: "coffee", 교통: "bus", 쇼핑: "bag", 구독: "repeat", 통신: "phone", 주거: "home", 의료: "medical", 문화: "film", 교육: "book", 기타: "card" };
export const catIcon = (cat, size = 20) => icon(CAT_ICON[cat] || "card", size);

// HTML 안의 <span data-icon="이름"></span> 자리에 아이콘을 채웁니다.
export function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 22);
  });
}

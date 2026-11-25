// 모든 데이터는 이 휴대폰의 브라우저 저장소(localStorage)에만 저장됩니다.
const KEY = "pocket-manager-data-v1";

export const CATEGORIES = ["식비", "카페", "교통", "쇼핑", "구독", "통신", "주거", "의료", "문화", "교육", "기타"];

const empty = () => ({
  expenses: [], // {id, date:"YYYY-MM-DD", amount, merchant, category, card, memo, source}
  subscriptions: [], // {id, name, amount, cycle:"monthly"|"yearly", nextDate, category, active}
  todos: [], // {id, title, note, priority:"high"|"normal"|"low", due, status:"open"|"doing"|"done", createdAt}
  payments: [], // {id, payee, amount, reason, dueDate, status:"pending"|"approved"|"paid"|"rejected", createdAt}
  flows: [], // 은행 입출금 알림 중 지출이 아닌 것 {id, kind:"in"|"out", amount, who, bank, date, time, extId, source}
  settings: { provider: "gemini", geminiKey: "", geminiModel: "gemini-flash-lite-latest", apiKey: "", model: "claude-opus-5-5", effort: "low", monthlyBudget: 0, payAppUrl: "intent://#Intent;package=viva.republica.toss;end" },
  chat: [], // 화면 표시용 대화 기록 {role, text}
});

let data = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    const base = empty();
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) } };
  } catch {
    return empty();
  }
}

export function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
  listeners.forEach((fn) => fn(data));
}

export const get = () => data;
export const subscribe = (fn) => listeners.add(fn);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const today = () => toISO(new Date());
export function toISO(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export const won = (n) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
export const monthOf = (iso) => iso.slice(0, 7);

// ---------- 지출 ----------
// 같은 결제가 문자와 카드사 앱 알림으로 두 번 들어오는 경우를 찾습니다.
// 금액이 같고, 5분 안에 왔고, 카드 끝자리가 서로 다르지 않으면 같은 결제로 봅니다.
const digitsOf = (card = "") => (card.match(/\(([\d*]{4})\)/) || [])[1] || "";
function findTwin(e) {
  if (!e.time) return null;
  const amount = Number(e.amount);
  return data.expenses.find((x) => {
    if (!x.time) return false;
    // 해외 결제는 문자(추정 원화)와 은행 출금(실제 원화) 금액이 조금 달라서 15%·10분까지 같은 결제로 봅니다.
    if (x.foreign || e.foreign) {
      if (Math.abs(x.time - e.time) > 10 * 60000 || Math.sign(x.amount) !== Math.sign(amount)) return false;
      if (Math.abs(x.amount - amount) > Math.abs(amount) * 0.15) return false;
    } else if (x.amount !== amount || Math.abs(x.time - e.time) > 5 * 60000) return false;
    const a = digitsOf(x.card), b = digitsOf(e.card);
    return !a || !b || a === b;
  });
}

export function addExpense(e) {
  if (e.extId && data.expenses.some((x) => x.extId === e.extId)) return null; // 이미 기록한 문자·알림
  const twin = findTwin(e);
  if (twin) {
    // 두 번째로 온 쪽에서 빠진 정보만 채우고 새로 기록하지 않습니다.
    if (!digitsOf(twin.card) && digitsOf(e.card)) twin.card = e.card;
    if ((twin.merchant === "알 수 없음" || twin.merchant.length < 2) && e.merchant) twin.merchant = e.merchant.trim();
    if (!twin.source.includes(e.source)) twin.source = `${twin.source}+${e.source}`;
    // 해외 결제의 추정 원화를 실제 출금된 원화로 바꿉니다.
    const foreign = twin.foreign || e.foreign;
    if (foreign && (twin.foreign ? !e.foreign : e.foreign)) {
      if (twin.foreign) twin.amount = Number(e.amount);
      twin.foreign = foreign;
      twin.memo = `해외 ${foreign} · 원화 확인됨`;
    }
    save();
    return null;
  }
  const item = {
    extId: e.extId || undefined,
    time: e.time || undefined,
    id: uid(),
    date: e.date || today(),
    amount: Number(e.amount) || 0,
    merchant: (e.merchant || "").trim() || "알 수 없음",
    category: CATEGORIES.includes(e.category) ? e.category : "기타",
    card: e.card || "",
    memo: e.memo || "",
    source: e.source || "manual",
    foreign: e.foreign || undefined,
  };
  data.expenses.unshift(item);
  data.expenses.sort((a, b) => b.date.localeCompare(a.date));
  autoCompleteCardChange(item);
  save();
  return item;
}
export function removeExpense(id) {
  data.expenses = data.expenses.filter((x) => x.id !== id);
  save();
}

// ---------- 입출금 (들어온 돈, 이체·송금으로 나간 돈) ----------
// 지출 합계에는 넣지 않고 따로 보여 줍니다.
// 사용자가 "지출로" 바꾼 적이 있는 받는 사람. 다음부터 이 사람에게 보낸 이체는 바로 지출로 기록합니다.
const spendPayees = () => (data.settings.spendPayees ||= []);
export const listSpendPayees = () => [...spendPayees()];
export function removeSpendPayee(who) {
  data.settings.spendPayees = spendPayees().filter((w) => w !== who);
  save();
}
function transferAsExpense(f) {
  const who = (f.who || "").trim();
  return addExpense({
    amount: Math.abs(Number(f.amount) || 0),
    merchant: who || "계좌이체",
    category: f.category || guessCategoryFromName(who),
    card: f.bank || "",
    memo: ["계좌이체", f.memo].filter(Boolean).join(" · "),
    date: f.date,
    time: f.time,
    extId: f.extId,
    source: f.source || "manual",
  });
}
// 이체·송금 기록을 지출로 옮깁니다. remember면 같은 받는 사람은 다음부터 자동으로 지출이 됩니다.
export function flowToExpense(id, remember = true) {
  const f = data.flows.find((x) => x.id === id);
  if (!f || f.kind !== "out") return null;
  data.flows = data.flows.filter((x) => x.id !== id);
  const e = transferAsExpense(f);
  if (remember && f.who && !spendPayees().includes(f.who)) spendPayees().push(f.who);
  save();
  return e;
}

// 수입(월급·용돈·판매 대금 등)으로 표시한 입금. 내 통장끼리 옮긴 돈과 구분합니다.
// 한 번 수입으로 표시한 보낸 사람은 다음부터 자동으로 수입이 됩니다.
const incomeSenders = () => (data.settings.incomeSenders ||= []);
export const listIncomeSenders = () => [...incomeSenders()];
export function removeIncomeSender(who) {
  data.settings.incomeSenders = incomeSenders().filter((w) => w !== who);
  save();
}
export function setFlowIncome(id, on, remember = true) {
  const f = data.flows.find((x) => x.id === id);
  if (!f || f.kind !== "in") return null;
  f.income = !!on;
  if (remember && f.who) {
    if (on && !incomeSenders().includes(f.who)) incomeSenders().push(f.who);
    if (!on) data.settings.incomeSenders = incomeSenders().filter((w) => w !== f.who);
  }
  save();
  return f;
}

export function addFlow(f) {
  if (f.extId && (data.flows.some((x) => x.extId === f.extId) || data.expenses.some((x) => x.extId === f.extId))) return null;
  if (f.kind === "out" && f.who && spendPayees().includes(f.who.trim())) return transferAsExpense(f);
  const item = {
    id: uid(),
    kind: f.kind === "in" ? "in" : "out",
    amount: Math.abs(Number(f.amount) || 0),
    who: (f.who || "").trim(),
    bank: f.bank || "",
    memo: (f.memo || "").trim() || undefined,
    income: f.kind === "in" && (f.income === true || (f.income !== false && !!f.who && incomeSenders().includes(f.who.trim()))) ? true : undefined,
    date: f.date || today(),
    time: f.time || undefined,
    extId: f.extId || undefined,
    source: f.source || "manual",
  };
  if (!item.amount) return null;
  data.flows.unshift(item);
  data.flows.sort((a, b) => (b.time || 0) - (a.time || 0) || b.date.localeCompare(a.date));
  save();
  return item;
}
export function removeFlow(id) {
  data.flows = data.flows.filter((x) => x.id !== id);
  save();
}
export function monthFlows(month = monthOf(today())) {
  const list = data.flows.filter((f) => monthOf(f.date) === month);
  const sum = (k) => list.filter((f) => f.kind === k).reduce((t, f) => t + f.amount, 0);
  const income = list.filter((f) => f.kind === "in" && f.income).reduce((t, f) => t + f.amount, 0);
  return { list, in: sum("in"), out: sum("out"), income };
}

export function monthSummary(month = monthOf(today())) {
  const list = data.expenses.filter((e) => monthOf(e.date) === month);
  const byCat = {};
  let total = 0, refunds = 0;
  for (const e of list) {
    total += e.amount;
    // 결제 취소·환불·할인(마이너스)은 분류별 합계에서 빼고 따로 모읍니다. 총지출에는 빠진 만큼 반영됩니다.
    if (e.amount < 0) { refunds += -e.amount; continue; }
    byCat[e.category] = (byCat[e.category] || 0) + e.amount;
  }
  const budget = data.settings.monthlyBudget || 0;
  const income = monthFlows(month).income;
  return {
    month,
    total,
    refunds, // 환불·할인으로 돌아온 돈 (총지출에서 이미 뺐음)
    income,
    net: income - total, // 수입 − 지출
    count: list.length,
    byCategory: Object.entries(byCat).sort((a, b) => b[1] - a[1]),
    budget,
    budgetLeft: budget ? budget - total : null,
    topMerchants: topBy(list, "merchant", 5),
  };
}
function topBy(list, key, n) {
  const m = {};
  for (const e of list) m[e[key]] = (m[e[key]] || 0) + e.amount;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------- 구독 ----------
export function addSubscription(s) {
  const item = {
    id: uid(),
    name: s.name.trim(),
    amount: Number(s.amount) || 0,
    cycle: s.cycle === "yearly" ? "yearly" : "monthly",
    nextDate: s.nextDate || today(),
    category: s.category || "구독",
    card: s.card || "",
    active: true,
  };
  data.subscriptions.push(item);
  save();
  return item;
}
export function removeSubscription(id) {
  data.subscriptions = data.subscriptions.filter((x) => x.id !== id);
  save();
}
export function daysUntil(iso) {
  const a = new Date(today() + "T00:00:00");
  const b = new Date(iso + "T00:00:00");
  return Math.round((b - a) / 86400000);
}
// 결제일이 지난 구독은 다음 주기로 넘깁니다.
export function rollSubscriptions() {
  let changed = false;
  for (const s of data.subscriptions) {
    while (s.active && daysUntil(s.nextDate) < 0) {
      const d = new Date(s.nextDate + "T00:00:00");
      if (s.cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
      else d.setMonth(d.getMonth() + 1);
      s.nextDate = toISO(d);
      changed = true;
    }
  }
  if (changed) save();
}
export const monthlySubTotal = () =>
  data.subscriptions.filter((s) => s.active).reduce((t, s) => t + (s.cycle === "yearly" ? s.amount / 12 : s.amount), 0);

// 같은 가맹점에서 비슷한 금액이 서로 다른 달에 2번 이상 나오면 정기결제 후보로 봅니다.
export function detectSubscriptions() {
  const known = new Set(data.subscriptions.map((s) => s.name));
  const groups = {};
  for (const e of data.expenses) {
    if (e.amount <= 0) continue;
    (groups[e.merchant] ||= []).push(e);
  }
  const found = [];
  for (const [merchant, list] of Object.entries(groups)) {
    if (known.has(merchant)) continue;
    // 두 달 이상 비슷한 금액으로 반복됐거나, 한 번이라도 '구독'으로 분류된 결제를 후보로 봅니다.
    const months = new Set(list.map((e) => monthOf(e.date)));
    const markedSub = list.some((e) => e.category === "구독");
    if (months.size < 2 && !markedSub) continue;
    const amounts = list.map((e) => e.amount);
    const min = Math.min(...amounts), max = Math.max(...amounts);
    if (!markedSub && max - min > max * 0.1) continue;
    const last = list.sort((a, b) => b.date.localeCompare(a.date))[0];
    const next = new Date(last.date + "T00:00:00");
    do next.setMonth(next.getMonth() + 1);
    while (daysUntil(toISO(next)) < 0);
    found.push({ name: merchant, amount: last.amount, nextDate: toISO(next), times: list.length, card: last.card || "" });
  }
  return found;
}

// ---------- 할 일·이슈 ----------
export function addTodo(t) {
  const item = {
    id: uid(),
    title: t.title.trim(),
    note: t.note || "",
    priority: ["high", "normal", "low"].includes(t.priority) ? t.priority : "normal",
    due: t.due || "",
    link: t.link || "",
    cardChange: t.cardChange || null, // {merchant, fromCard, toCard}
    status: "open",
    createdAt: today(),
  };
  data.todos.unshift(item);
  save();
  return item;
}
export function updateTodo(id, patch) {
  const t = data.todos.find((x) => x.id === id);
  if (!t) return null;
  Object.assign(t, patch);
  save();
  return t;
}
export function removeTodo(id) {
  data.todos = data.todos.filter((x) => x.id !== id);
  save();
}
const PRI = { high: 0, normal: 1, low: 2 };
export function sortedTodos() {
  return [...data.todos].sort(
    (a, b) =>
      (a.status === "done") - (b.status === "done") ||
      PRI[a.priority] - PRI[b.priority] ||
      (a.due || "9999").localeCompare(b.due || "9999"),
  );
}

// ---------- 카드 바꾸기 ----------
// 카드 이름은 "신한카드(1234)"처럼 저장됩니다. 사용자는 "1234"나 "신한"만 입력해도 찾을 수 있게 합니다.
export const cardMatches = (card, query) => !!query && !!card && card.replace(/\s/g, "").toLowerCase().includes(query.replace(/\s/g, "").toLowerCase());

export function knownCards() {
  const m = {};
  for (const e of data.expenses) if (e.card) m[e.card] = (m[e.card] || 0) + 1;
  for (const s of data.subscriptions) if (s.card) m[s.card] = (m[s.card] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([card]) => card);
}

// 토스페이·카카오페이 같은 간편결제에 연결된 곳은, 그 앱에서 카드를 한 번 바꾸면 여러 곳이 같이 바뀝니다.
// 카드 문자에는 실제 서비스 대신 "토스페이", "카카오페이"처럼 찍히는 경우가 많아 따로 묶습니다.
export const WALLETS = [
  { key: "토스페이", words: ["토스페이", "토스페이먼츠", "tosspay", "toss"],
    link: "intent://#Intent;package=viva.republica.toss;S.browser_fallback_url=https%3A%2F%2Ftoss.im;end",
    guide: "토스 앱 → 토스페이 → 결제수단에서 새 카드를 등록하고 기본으로 정한 뒤, 자동결제(정기결제) 관리에서 항목마다 결제수단이 새 카드인지 확인하세요." },
  { key: "카카오페이", words: ["카카오페이", "kakaopay"],
    link: "intent://#Intent;package=com.kakaopay.app;S.browser_fallback_url=https%3A%2F%2Fwww.kakaopay.com;end",
    guide: "카카오페이 앱(또는 카카오톡 → 페이)의 결제수단에서 새 카드를 등록하고, 자동결제 관리에서 항목마다 결제수단을 확인하세요." },
  { key: "네이버페이", words: ["네이버페이", "naverpay", "npay"], link: "https://pay.naver.com",
    guide: "네이버페이 → 결제수단 관리에서 새 카드를 등록하고, 정기결제 항목의 결제수단을 확인하세요." },
  { key: "페이코", words: ["페이코", "payco"], link: "https://www.payco.com",
    guide: "페이코 → 결제수단에서 새 카드를 등록하고, 자동결제 항목을 확인하세요." },
];
export function walletOf(merchant = "") {
  const m = merchant.toLowerCase().replace(/s/g, "");
  return WALLETS.find((w) => w.words.some((x) => m.includes(x))) || null;
}
const groupKey = (merchant) => walletOf(merchant)?.key || merchant;

// 기존 카드로 반복해서 나가는 결제(구독·통신·공과금 등)와 간편결제 연결을 모읍니다.
export function recurringForCard(fromCard) {
  const groups = {};
  for (const e of data.expenses) {
    if (e.amount <= 0 || !cardMatches(e.card, fromCard)) continue;
    const key = groupKey(e.merchant);
    const g = (groups[key] ||= { merchant: key, amount: e.amount, lastDate: e.date, months: new Set(), count: 0, category: e.category, wallet: !!walletOf(e.merchant), names: new Set() });
    g.months.add(monthOf(e.date));
    g.count++;
    g.names.add(e.merchant);
    if (e.date > g.lastDate) { g.lastDate = e.date; g.amount = e.amount; }
  }
  const subNames = new Set(data.subscriptions.map((s) => s.name));
  const out = Object.values(groups)
    .filter((g) => g.wallet || g.months.size >= 2 || subNames.has(g.merchant) || ["구독", "통신", "주거"].includes(g.category))
    .map((g) => ({
      merchant: g.merchant,
      amount: g.amount,
      lastDate: g.lastDate,
      months: g.months.size,
      wallet: g.wallet,
      reason: g.wallet
        ? `간편결제 ${g.count}건 · 여기서 한 번 바꾸면 연결된 곳이 같이 바뀌어요`
        : g.months.size >= 2 ? `${g.months.size}개월 반복` : "정기결제 분류",
    }));
  for (const s of data.subscriptions) {
    if (s.active && cardMatches(s.card, fromCard) && !out.some((o) => o.merchant === groupKey(s.name))) {
      out.push({ merchant: s.name, amount: s.amount, lastDate: "", months: 0, wallet: false, reason: "등록된 구독" });
    }
  }
  // 간편결제를 맨 위에: 한 번에 여러 곳이 해결되니 먼저 하는 게 좋습니다.
  return out.sort((a, b) => b.wallet - a.wallet || b.amount - a.amount);
}

// 서비스별 결제수단 변경 페이지. 확실한 곳만 적고, 나머지는 검색 링크로 보냅니다.
const PAY_PAGES = [
  [["넷플릭스", "netflix"], "https://www.netflix.com/YourAccount"],
  [["유튜브", "youtube"], "https://www.youtube.com/paid_memberships"],
  [["구글플레이", "google play", "google"], "https://play.google.com/store/paymentmethods"],
  [["스포티파이", "spotify"], "https://www.spotify.com/account/overview/"],
  [["디즈니", "disney"], "https://www.disneyplus.com/account"],
  [["claude", "anthropic"], "https://claude.ai/settings/billing"],
];
export function paymentPageFor(merchant) {
  const w = walletOf(merchant);
  if (w) return w.link;
  const m = merchant.toLowerCase();
  for (const [words, url] of PAY_PAGES) if (words.some((x) => m.includes(x))) return url;
  return `https://www.google.com/search?q=${encodeURIComponent(`${merchant} 결제수단 변경`)}`;
}

export function createCardChangeTasks(fromCard, toCard, merchants) {
  const made = [];
  const keys = [...new Set(merchants.map(groupKey))];
  for (const merchant of keys) {
    const dup = data.todos.some((t) => t.status !== "done" && t.cardChange?.merchant === merchant && t.cardChange?.toCard === toCard);
    if (dup) continue;
    const w = walletOf(merchant);
    made.push(addTodo({
      title: w ? `[카드 변경] ${w.key} 결제카드 → ${toCard}` : `[카드 변경] ${merchant} → ${toCard}`,
      note: w ? `기존: ${fromCard} · ${w.guide}` : `기존: ${fromCard}`,
      priority: "high",
      link: paymentPageFor(merchant),
      cardChange: { merchant, fromCard, toCard, wallet: !!w },
    }));
  }
  return made;
}

// 새 카드로 그 가맹점(또는 그 간편결제) 결제 문자가 오면, 바꾸기 완료로 자동 체크합니다.
function autoCompleteCardChange(expense) {
  if (!expense.card || expense.amount <= 0) return;
  const key = groupKey(expense.merchant);
  for (const t of data.todos) {
    const c = t.cardChange;
    if (!c || t.status === "done" || c.merchant !== key) continue;
    if (cardMatches(expense.card, c.toCard) || cardMatches(c.toCard, expense.card)) {
      t.status = "done";
      t.note = `${t.note} · ${expense.date} 새 카드 결제 확인`;
    }
  }
  for (const s of data.subscriptions) {
    if (s.name === expense.merchant) s.card = expense.card;
  }
}

// ---------- 결제 요청 (AI는 만들기만 하고, 승인과 실제 결제는 사용자가 합니다) ----------
export function addPaymentRequest(p) {
  const item = {
    id: uid(),
    payee: p.payee.trim(),
    amount: Number(p.amount) || 0,
    reason: p.reason || "",
    dueDate: p.dueDate || "",
    status: "pending",
    createdAt: today(),
  };
  data.payments.unshift(item);
  save();
  return item;
}
export function setPaymentStatus(id, status) {
  const p = data.payments.find((x) => x.id === id);
  if (!p) return null;
  p.status = status;
  if (status === "paid") {
    addExpense({ amount: p.amount, merchant: p.payee, category: guessCategoryFromName(p.payee), memo: p.reason, source: "payment" });
  }
  save();
  return p;
}
function guessCategoryFromName(name) {
  const sub = data.subscriptions.find((s) => s.name === name);
  return sub ? sub.category : "기타";
}

// ---------- 설정·백업 ----------
export function updateSettings(patch) {
  Object.assign(data.settings, patch);
  save();
}
export function exportJSON() {
  const copy = { ...data, settings: { ...data.settings, apiKey: "", geminiKey: "" } }; // 백업에는 API 키를 넣지 않습니다
  return JSON.stringify(copy, null, 2);
}
// 백업 파일로 전체를 바꿉니다. 지출만 든 파일이면 덮어쓰지 않고 "더하기"로 처리합니다.
// 바꾸기 전 상태는 따로 보관해서 '되돌리기'로 복구할 수 있습니다.
export function importJSON(text) {
  const parsed = JSON.parse(text);
  const isFullBackup = parsed && !Array.isArray(parsed) && parsed.type !== "pocket-manager-import" && parsed.settings && Array.isArray(parsed.subscriptions);
  if (!isFullBackup) return { merged: mergeImport(text) };
  snapshot();
  const { apiKey, geminiKey } = data.settings;
  data = { ...empty(), ...parsed };
  data.settings = { ...empty().settings, ...(parsed.settings || {}), apiKey, geminiKey };
  data.expenses = data.expenses.map((e) => ({ ...e, id: e.id || uid() }));
  save();
  return { replaced: true };
}

const PREV_KEY = KEY + "-before-restore";
function snapshot() {
  localStorage.setItem(PREV_KEY, JSON.stringify({ at: new Date().toISOString(), data }));
}
export const hasSnapshot = () => !!localStorage.getItem(PREV_KEY);
export function restoreSnapshot() {
  const raw = localStorage.getItem(PREV_KEY);
  if (!raw) return false;
  const { data: prev } = JSON.parse(raw);
  const { apiKey, geminiKey } = data.settings;
  data = { ...empty(), ...prev, settings: { ...empty().settings, ...prev.settings, apiKey, geminiKey } };
  localStorage.removeItem(PREV_KEY);
  save();
  return true;
}

// 구독 후보를 한 번에 등록합니다.
export function addAllDetected() {
  const list = detectSubscriptions();
  for (const c of list) addSubscription({ name: c.name, amount: c.amount, cycle: "monthly", nextDate: c.nextDate, card: c.card });
  return list.length;
}
// 결제 내역 파일(지메일에서 뽑은 것 등)을 기존 기록에 "더합니다". 같은 건(extId)은 다시 넣지 않습니다.
export function mergeImport(text) {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : parsed.expenses || [];
  const subs = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
  if (!list.length && !subs.length) throw new Error("결제 내역이나 구독이 들어 있는 파일이 아니에요");
  // 파일에 구독 목록이 있으면 등록합니다(같은 이름은 금액·결제일·카드만 새로 고침).
  let subsAdded = 0;
  for (const s of subs) {
    if (!s || !s.name || !Number(s.amount)) continue;
    const old = data.subscriptions.find((x) => x.name === s.name);
    if (old) Object.assign(old, { amount: Number(s.amount), cycle: s.cycle === "yearly" ? "yearly" : "monthly", nextDate: s.nextDate || old.nextDate, card: s.card || old.card, active: true });
    else { addSubscription(s); subsAdded++; }
  }
  let added = 0, skipped = 0, updated = 0;
  for (const e of list) {
    if (!e || !Number(e.amount) || !e.date) { skipped++; continue; }
    // 이미 넣은 건이면 금액·날짜는 그대로 두고 사용처·분류·메모만 새 정보로 바꿉니다.
    const old = e.extId && data.expenses.find((x) => x.extId === e.extId);
    if (old) {
      const before = `${old.merchant}|${old.category}|${old.memo}`;
      if (e.merchant) old.merchant = String(e.merchant).trim();
      if (CATEGORIES.includes(e.category)) old.category = e.category;
      if (e.memo !== undefined) old.memo = e.memo;
      if (before !== `${old.merchant}|${old.category}|${old.memo}`) updated++; else skipped++;
      continue;
    }
    const r = addExpense({ ...e, source: e.source || "가져오기" });
    if (r) added++; else skipped++;
  }
  save();
  return { added, skipped, updated, subsAdded, subsTotal: subs.length };
}

export function resetChat() {
  data.chat = [];
  save();
}

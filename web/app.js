import * as S from "./store.js";
import { parsePaymentText, guessCategory } from "./sms.js";
import * as N from "./native.js";
import { icon, catIcon, fillIcons } from "./icons.js";

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const TITLES = { home: "홈", spend: "지출", subs: "구독·정기결제", todo: "할 일·이슈", agent: "AI 비서" };
const PRI_LABEL = { high: "높음", normal: "보통", low: "낮음" };

let tab = "home";
let draftExpense = null; // 문자 공유로 채워진 지출 입력값
let agentMod = null; // AI 모듈은 필요할 때만 불러옵니다(오프라인에서도 앱이 열리도록)
let pendingImages = [];
let busy = false;

// 안내 메시지: 화면 위쪽에 차례로 쌓이고(최대 3개), 설정 창이 열려 있어도 그 위에 보입니다.
// 같은 내용은 한 번만 보이고, 입력창·하단 메뉴를 가리지 않습니다.
// 설정 창이 열려 있으면 창 안쪽 아래(저장 버튼 위)에 끼워 넣어 창 내용을 가리지 않습니다.
const toastBox = $("#toasts");
function toast(msg, kind = "info") {
  const inSheet = document.getElementById("settings").open;
  const box = inSheet ? $("#sheet-toasts") : toastBox;
  if ([...box.children].some((el) => el.textContent === msg)) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  el.addEventListener("click", () => el.remove());
  box.append(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  if (!inSheet) bringToastsToFront();
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => { el.remove(); if (!toastBox.children.length && toastBox.matches?.(":popover-open")) toastBox.hidePopover(); }, 250);
  }, kind === "error" ? 4500 : 2800);
}
function bringToastsToFront() {
  if (!toastBox.showPopover) return; // 오래된 브라우저는 z-index로 처리
  if (toastBox.matches(":popover-open")) toastBox.hidePopover();
  toastBox.showPopover();
}

// 새 결제가 연달아 들어오면 하나로 묶어서 알립니다.
let arrived = [];
let arrivedTimer = null;
function announcePayment(e) {
  if (!e) { if (tab === "home" || tab === "spend") render(); return; } // 기존 기록에 합쳐진 경우
  arrived.push(e);
  clearTimeout(arrivedTimer);
  arrivedTimer = setTimeout(() => {
    const [first, ...rest] = arrived;
    const label = (x) => (x.kind === "in" ? `입금 ${x.who || ""}` : x.kind === "out" ? `이체 ${x.who || ""}` : x.merchant).trim();
    toast(rest.length ? `새 기록 ${arrived.length}건: ${label(first)} 외 ${rest.length}건` : `새 기록: ${label(first)} ${S.won(first.amount)}`, "pay");
    arrived = [];
    if (tab === "home" || tab === "spend") render();
  }, 1500);
}

function go(next) {
  tab = next;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $("#title").textContent = TITLES[tab];
  render();
  window.scrollTo(0, tab === "agent" ? document.body.scrollHeight : 0);
}

function render() {
  setTimeout(bindAddAll, 0);
  ({ home: renderHome, spend: renderSpend, subs: renderSubs, todo: renderTodo, agent: renderAgent })[tab]();
}

function bindAddAll() {
  view.querySelectorAll("[data-add-all]").forEach((b) =>
    b.addEventListener("click", () => {
      const n = S.addAllDetected();
      toast(`구독 ${n}개를 등록했어요`, "pay");
      render();
    }),
  );
}

// ---------------- 홈 ----------------
function renderHome() {
  const d = S.get();
  const sum = S.monthSummary();
  const pct = sum.budget ? Math.min(100, Math.round((sum.total / sum.budget) * 100)) : 0;
  const upcoming = d.subscriptions.filter((s) => s.active && S.daysUntil(s.nextDate) <= 7).sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const openPays = d.payments.filter((p) => p.status === "pending" || p.status === "approved");
  const urgent = S.sortedTodos().filter((t) => t.status !== "done" && (t.priority === "high" || (t.due && S.daysUntil(t.due) <= 2))).slice(0, 5);
  const candidates = S.detectSubscriptions();

  view.innerHTML = `
    <section class="card hero">
      <h2>${Number(sum.month.slice(5))}월 지출</h2>
      <div class="big">${S.won(sum.total)}</div>
      ${sum.budget
        ? `<div class="bar ${sum.total > sum.budget ? "over" : ""}"><i style="width:${pct}%"></i></div>
           <div class="muted">예산 ${S.won(sum.budget)} 중 ${pct}% · ${sum.budgetLeft >= 0 ? `${S.won(sum.budgetLeft)} 남음` : `${S.won(-sum.budgetLeft)} 초과`}</div>`
        : `<div class="muted">${sum.count}건 · 설정에서 월 예산을 정하면 남은 금액을 알려드려요</div>`}
      ${sum.refunds ? `<div class="muted">환불·할인 ${S.won(sum.refunds)}은 빼고 계산했어요</div>` : ""}
      ${sum.income ? `<div class="income-line"><span>수입 <b>${S.won(sum.income)}</b></span><span>수입 − 지출 <b class="${sum.net < 0 ? "neg" : "pos"}">${sum.net < 0 ? "−" : "+"}${S.won(Math.abs(sum.net))}</b></span></div>` : ""}
    </section>

    <div class="quick">
      <button data-go="spend">${icon("pen", 24)}지출 기록</button>
      <label>${icon("camera", 24)}영수증<input type="file" id="home-receipt" accept="image/*" capture="environment" hidden /></label>
      <button data-go="agent">${icon("bot", 24)}AI 비서</button>
    </div>

    ${autoRecordCard()}

    ${openPays.length ? `<section class="card pay"><h2>결제 요청 ${openPays.length}건</h2><ul class="list">${openPays.map(payItem).join("")}</ul>
      <p class="muted">AI는 돈을 보내지 않아요. 승인하면 결제 앱이 열리고, 결제를 마친 뒤 '결제 완료'를 눌러 주세요.</p></section>` : ""}

    <section class="card">
      <h2>${icon("calendar", 18)}7일 안에 나갈 정기결제<a class="sub" href="#" data-go="subs">전체${icon("chevronRight", 14)}</a></h2>
      ${upcoming.length ? `<ul class="list">${upcoming.map((s) => `
        <li><span class="ico">${catIcon(s.category || "구독")}</span><div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${s.nextDate}</div></div>
        <div style="text-align:right"><div class="amount">${S.won(s.amount)}</div><span class="tag ${S.daysUntil(s.nextDate) <= 1 ? "warn" : ""}">${ddayText(s.nextDate)}</span></div></li>`).join("")}</ul>` : `<div class="empty">예정된 결제가 없어요</div>`}
    </section>

    <section class="card">
      <h2>${icon("flag", 18)}급한 할 일<a class="sub" href="#" data-go="todo">전체${icon("chevronRight", 14)}</a></h2>
      ${urgent.length ? `<ul class="list">${urgent.map((t) => `
        <li><div class="grow"><div class="title">${esc(t.title)}</div><div class="muted">${t.due ? `마감 ${t.due} (${ddayText(t.due)})` : "마감 없음"}</div></div>
        <span class="tag ${t.priority === "high" ? "warn" : ""}">${PRI_LABEL[t.priority]}</span></li>`).join("")}</ul>` : `<div class="empty">${icon("done", 28)}<span>급한 일이 없어요</span></div>`}
    </section>

    ${recentToday()}

    ${flowsCard()}

    ${candidates.length ? `<section class="card"><h2>${icon("search", 18)}정기결제로 보이는 지출<button class="small sub" data-add-all>모두 등록</button></h2><ul class="list">${candidates.map((c, i) => `
      <li><div class="grow"><div class="title">${esc(c.name)}</div><div class="muted">${c.times}번 결제 · 다음 예상 ${c.nextDate}</div></div>
      <span class="amount">${S.won(c.amount)}</span><button class="small" data-cand="${i}">등록</button></li>`).join("")}</ul></section>` : ""}
  `;
  bindPayButtons();
  bindAutoRecord();
  bindFlowDelete();
  $("#home-receipt").addEventListener("change", async (ev) => {
    if (!ev.target.files[0]) return;
    await attachImage(ev.target.files[0]);
    go("agent");
    $("#prompt").value = "이 영수증을 지출로 기록해 줘.";
  });
  bindExpenseDelete();
  view.querySelectorAll("[data-cand]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = candidates[Number(b.dataset.cand)];
      S.addSubscription({ name: c.name, amount: c.amount, cycle: "monthly", nextDate: c.nextDate });
      toast(`${c.name} 구독을 등록했어요`);
      render();
    }),
  );
}

const SOURCE_LABEL = (s = "") => (s.includes("문자") || s === "sms" ? "문자" : s.includes("알림") ? "알림" : s === "ai" ? "AI" : s === "payment" ? "결제요청" : "");

function expenseItem(x) {
  const src = SOURCE_LABEL(x.source);
  return `<li><span class="ico">${catIcon(x.category)}</span>
    <div class="grow"><div class="title">${esc(x.merchant)}</div>
      <div class="muted">${x.category}${x.card ? ` · ${esc(x.card)}` : ""}${src ? ` · ${src}` : ""}${x.memo ? ` · ${esc(x.memo)}` : ""}</div></div>
    <span class="amount ${x.amount < 0 ? "minus" : ""}">${S.won(x.amount)}</span>
    <button class="x" data-del="${x.id}" aria-label="${esc(x.merchant)} 삭제">${icon("close", 18)}</button></li>`;
}

function bindExpenseDelete() {
  view.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => { if (confirm("이 지출을 삭제할까요?")) { S.removeExpense(b.dataset.del); render(); } }),
  );
}

// 홈: 오늘 기록된 지출 (자동 기록된 것 확인용)
function recentToday() {
  const list = S.get().expenses.filter((e) => e.date === S.today());
  if (!list.length) return "";
  const total = list.reduce((t, e) => t + e.amount, 0);
  return `<section class="card"><h2>${icon("receipt", 18)}오늘 쓴 돈<span class="sub">${S.won(total)}</span></h2>
    <ul class="list">${list.slice(0, 5).map(expenseItem).join("")}</ul>
    ${list.length > 5 ? `<a class="small" href="#" data-go="spend">${list.length - 5}건 더 보기</a>` : ""}</section>`;
}

// 은행 입출금 알림 중 지출이 아닌 것(입금, 이체·송금). 지출 합계와 따로 보여 줍니다.
function flowsCard() {
  const f = S.monthFlows();
  if (!f.list.length) return "";
  const label = (x) => (x.kind === "out" ? "이체·송금" : x.income ? "수입" : "입금");
  const action = (x) => x.kind === "out"
    ? `<button class="small ghost" data-flow-spend="${x.id}">지출로</button>`
    : x.income
      ? `<button class="small ghost" data-flow-income="${x.id}" data-on="0" aria-label="수입 표시 빼기">수입 ✕</button>`
      : `<button class="small ghost" data-flow-income="${x.id}" data-on="1">수입으로</button>`;
  return `<section class="card"><h2>${icon("swap", 18)}이번 달 입출금</h2>
    <div class="muted">들어옴 <b>${S.won(f.in)}</b>${f.income ? ` (수입 <b>${S.won(f.income)}</b>)` : ""} · 보냄 <b>${S.won(f.out)}</b></div>
    <ul class="list">${f.list.slice(0, 5).map((x) => `
      <li><div class="grow"><div class="title">${label(x)}${x.who ? ` · ${esc(x.who)}` : ""}</div>
        <div class="muted">${x.date.slice(5).replace("-", "/")}${x.time ? ` ${new Date(x.time).toTimeString().slice(0, 5)}` : ""}${x.bank ? ` · ${esc(x.bank)}` : ""}${x.memo ? ` · ${esc(x.memo)}` : ""}</div></div>
        <span class="amount ${x.kind === "in" ? "minus" : ""}">${x.kind === "in" ? "+" : "−"}${S.won(x.amount)}</span>
        ${action(x)}
        <button class="x" data-del-flow="${x.id}" aria-label="입출금 기록 삭제">${icon("close", 18)}</button></li>`).join("")}</ul>
    <p class="muted">월급·용돈처럼 번 돈은 '수입으로', 물건값·월세처럼 쓴 돈은 '지출로'를 누르세요. 한 번 누르면 같은 사람은 다음부터 자동이에요.</p></section>`;
}
function bindFlowDelete() {
  view.querySelectorAll("[data-del-flow]").forEach((b) => b.addEventListener("click", () => { S.removeFlow(b.dataset.delFlow); render(); }));
  view.querySelectorAll("[data-flow-spend]").forEach((b) => b.addEventListener("click", () => {
    const f = S.get().flows.find((x) => x.id === b.dataset.flowSpend);
    const e = S.flowToExpense(b.dataset.flowSpend);
    if (e) toast(f?.who ? `지출로 옮겼어요. 다음부터 ${f.who}에게 보낸 돈도 지출로 기록해요.` : "지출로 옮겼어요.");
    render();
  }));
  view.querySelectorAll("[data-flow-income]").forEach((b) => b.addEventListener("click", () => {
    const on = b.dataset.on === "1";
    const f = S.setFlowIncome(b.dataset.flowIncome, on);
    if (f) toast(on ? (f.who ? `수입으로 기록했어요. 다음부터 ${f.who}님이 보낸 돈도 수입으로 기록해요.` : "수입으로 기록했어요.") : "수입 표시를 뺐어요.");
    render();
  }));
}

// ---------------- 자동 기록 (안드로이드 앱에서만) ----------------
let nativeStatus = null; // {sms, notifications}
function autoRecordCard() {
  if (!N.isNative() || !nativeStatus) return "";
  const { sms, notifications } = nativeStatus;
  if (sms && notifications) return "";
  return `<section class="card pay">
    <h2>입출금·결제 자동 기록 켜기</h2>
    <p class="muted">은행 앱 입출금 알림과 카드·토스·카카오페이 알림이 오는 대로 기록돼요. 결제와 상관없는 문자·알림은 읽고 바로 버려요.</p>
    <ul class="list">
      <li><div class="grow">알림 읽기 (중요)<div class="muted">KB스타뱅킹 같은 은행 앱 입출금, 카드사 앱, 토스, 카카오페이 · 카카오톡 대화는 읽지 않아요</div></div>
        ${notifications ? `<span class="tag">켜짐</span>` : `<button class="small" id="btn-notif">설정 열기</button>`}</li>
      <li><div class="grow">문자 읽기<div class="muted">문자로 오는 결제 (해외 결제 등)</div></div>
        ${sms ? `<span class="tag">켜짐</span>` : `<button class="small" id="btn-sms">허용하기</button>`}</li>
    </ul>
  </section>`;
}
function bindAutoRecord() {
  $("#btn-sms")?.addEventListener("click", async () => {
    nativeStatus = await N.requestSms();
    if (nativeStatus.sms && confirm("지난 90일 동안의 카드 결제 문자도 가져올까요?")) {
      const n = await N.importInbox(90);
      toast(`지난 결제 ${n}건을 기록했어요`);
    }
    render();
  });
  $("#btn-notif")?.addEventListener("click", () => {
    toast("목록에서 '포켓매니저'를 찾아 켜 주세요");
    N.openNotificationSettings();
  });
}
async function refreshNative() {
  if (!N.isNative()) return;
  try {
    nativeStatus = await N.status();
    const n = await N.drain();
    if (n) toast(`새 결제 ${n}건을 자동 기록했어요`);
  } catch (e) {
    console.warn(e);
  }
  if (tab === "home" || tab === "spend") render();
}

function payItem(p) {
  return `<li data-pay="${p.id}">
    <div class="grow"><b>${esc(p.payee)}</b> <span class="amount">${S.won(p.amount)}</span>
      <div class="muted">${esc(p.reason)}${p.dueDate ? ` · ${p.dueDate}까지` : ""}</div></div>
    ${p.status === "pending"
      ? `<button class="small" data-act="approve">승인</button><button class="small warn" data-act="reject">거절</button>`
      : `<button class="small" data-act="open">결제 앱</button><button class="small" data-act="paid">결제 완료</button>`}
  </li>`;
}

function bindPayButtons() {
  view.querySelectorAll("[data-pay] [data-act]").forEach((b) =>
    b.addEventListener("click", () => {
      const id = b.closest("[data-pay]").dataset.pay;
      const p = S.get().payments.find((x) => x.id === id);
      const act = b.dataset.act;
      if (act === "approve") {
        if (!confirm(`${p.payee}에 ${S.won(p.amount)} 결제를 승인할까요?\n결제 앱이 열리면 직접 결제를 마쳐 주세요.`)) return;
        S.setPaymentStatus(id, "approved");
        copyText(`${p.payee} ${p.amount}`);
        openPayApp();
      } else if (act === "reject") {
        S.setPaymentStatus(id, "rejected");
        toast("결제 요청을 거절했어요");
      } else if (act === "open") {
        openPayApp();
      } else if (act === "paid") {
        S.setPaymentStatus(id, "paid");
        toast("결제 완료로 표시하고 지출에 기록했어요");
      }
      render();
    }),
  );
}

function openPayApp() {
  const url = S.get().settings.payAppUrl;
  if (url) window.location.href = url;
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast("받는 곳과 금액을 복사했어요"), () => {});
}
function dayLabel(iso) {
  const n = S.daysUntil(iso);
  const d = new Date(iso + "T00:00:00");
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`;
  return n === 0 ? `오늘 · ${md}` : n === -1 ? `어제 · ${md}` : md;
}
function ddayText(iso) {
  const n = S.daysUntil(iso);
  return n === 0 ? "오늘" : n === 1 ? "내일" : n < 0 ? `${-n}일 지남` : `D-${n}`;
}

// ---------------- 지출 ----------------
function renderSpend() {
  const d = S.get();
  const sum = S.monthSummary();
  const e = draftExpense || {};
  const max = sum.byCategory[0]?.[1] || 1;
  const recent = d.expenses.slice(0, 80);
  const dayTotals = {};
  for (const x of recent) dayTotals[x.date] = (dayTotals[x.date] || 0) + x.amount;
  let lastDate = "";
  const auto = N.isNative() && nativeStatus?.sms;

  view.innerHTML = `
    <details class="card" id="add-expense" ${draftExpense || !auto ? "open" : ""}>
      <summary>${icon("pen", 18)}${draftExpense ? "읽은 내용 확인 후 저장" : auto ? "직접 기록하기 (문자는 자동 기록 중)" : "지출 기록하기"}</summary>
      ${draftExpense ? "" : `
      <textarea id="sms" placeholder="카드 결제 문자를 붙여넣으세요"></textarea>
      <div class="row" style="margin:8px 0 14px">
        <button class="ghost grow" id="btn-parse">문자 읽기</button>
        <label class="ghost file-btn grow" style="margin:0;gap:6px">${icon("camera", 18)}영수증 사진<input type="file" id="receipt" accept="image/*" capture="environment" hidden /></label>
      </div>`}
      <form id="expense-form">
        <div class="grid2">
          <label>금액<input name="amount" type="number" inputmode="numeric" required value="${esc(e.amount ?? "")}" /></label>
          <label>날짜<input name="date" type="date" value="${esc(e.date || S.today())}" /></label>
        </div>
        <label>사용처<input name="merchant" required value="${esc(e.merchant || "")}" /></label>
        <div class="grid2">
          <label>분류<select name="category">${S.CATEGORIES.map((c) => `<option ${c === (e.category || "기타") ? "selected" : ""}>${c}</option>`).join("")}</select></label>
          <label>카드<input name="card" value="${esc(e.card || "")}" /></label>
        </div>
        <label>메모<input name="memo" value="${esc(e.memo || "")}" /></label>
        <div class="row end">${draftExpense ? `<button type="button" class="ghost" id="btn-clear-draft">취소</button>` : ""}<button class="primary">저장</button></div>
      </form>
    </details>

    <section class="card">
      <h2>${icon("chart", 18)}${Number(sum.month.slice(5))}월 분류별<span class="sub">${S.won(sum.total)}</span></h2>
      ${sum.byCategory.length ? sum.byCategory.map(([c, v]) => `
        <div class="catrow"><span class="catname">${catIcon(c, 16)}${c}</span><div class="bar"><i style="width:${Math.max(3, (v / max) * 100)}%"></i></div><span class="amount">${S.won(v)}</span></div>`).join("") : `<div class="empty">아직 지출이 없어요</div>`}
      ${sum.refunds ? `<div class="catrow refund"><span class="catname">${icon("repeat", 16)}환불·할인</span><div class="bar"></div><span class="amount minus">−${S.won(sum.refunds)}</span></div>` : ""}
    </section>

    <section class="card">
      <h2>${icon("receipt", 18)}최근 내역</h2>
      ${recent.length ? `<ul class="list">${recent.map((x) => {
        const head = x.date !== lastDate ? `<div class="date-head"><span>${dayLabel(x.date)}</span><span>${S.won(dayTotals[x.date])}</span></div>` : "";
        lastDate = x.date;
        return head + expenseItem(x);
      }).join("")}</ul>` : `<div class="empty">기록된 지출이 없어요</div>`}
    </section>
  `;

  $("#btn-parse")?.addEventListener("click", () => {
    const parsed = parsePaymentText($("#sms").value);
    if (!parsed) return toast("금액을 찾지 못했어요. 직접 입력해 주세요");
    draftExpense = parsed;
    render();
    $("#add-expense").scrollIntoView({ behavior: "smooth" });
  });
  $("#btn-clear-draft")?.addEventListener("click", () => { draftExpense = null; render(); });
  $("#expense-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    S.addExpense({ ...f, category: f.category === "기타" ? guessCategory(f.merchant) : f.category, source: draftExpense?.source || "manual" });
    draftExpense = null;
    toast("저장했어요");
    render();
  });
  $("#receipt")?.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    await attachImage(file);
    go("agent");
    $("#prompt").value = "이 영수증을 지출로 기록해 줘.";
  });
  view.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => { if (confirm("이 지출을 삭제할까요?")) { S.removeExpense(b.dataset.del); render(); } }),
  );
}

// ---------------- 구독 ----------------
function renderSubs() {
  const d = S.get();
  const subs = [...d.subscriptions].sort((a, b) => a.nextDate.localeCompare(b.nextDate));
  const candidates = S.detectSubscriptions();
  view.innerHTML = `
    <section class="card">
      <h2>${icon("repeat", 18)}매달 나가는 돈</h2>
      <div class="big">${S.won(S.monthlySubTotal())}</div>
      <div class="muted">${subs.length}개 구독 · 1년이면 ${S.won(S.monthlySubTotal() * 12)}</div>
    </section>
    <section class="card">
      <h2>${icon("calendar", 18)}구독 목록</h2>
      ${subs.length ? `<ul class="list">${subs.map((s) => `
        <li><span class="ico">${catIcon(s.category || "구독")}</span>
        <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${s.cycle === "yearly" ? "매년" : "매달"} · ${s.nextDate.slice(5).replace("-", "/")}</div></div>
        <div style="text-align:right"><div class="amount">${S.won(s.amount)}</div><span class="tag ${S.daysUntil(s.nextDate) <= 3 ? "warn" : ""}">${ddayText(s.nextDate)}</span></div>
        <button class="x" data-pay-sub="${s.id}" aria-label="결제 요청 만들기" title="결제 요청">${icon("send", 18)}</button>
        <button class="x" data-del="${s.id}" aria-label="삭제">${icon("close", 18)}</button></li>`).join("")}</ul>` : `<div class="empty">등록된 구독이 없어요</div>`}
    </section>
    ${candidates.length ? `<section class="card"><h2>${icon("search", 18)}정기결제로 보이는 지출<button class="small sub" data-add-all>모두 등록</button></h2><ul class="list">${candidates.map((c, i) => `
      <li><div class="grow">${esc(c.name)}<div class="muted">${c.times}번 · 다음 예상 ${c.nextDate}</div></div><span class="amount">${S.won(c.amount)}</span>
      <button class="small" data-cand="${i}">등록</button></li>`).join("")}</ul></section>` : ""}
    ${cardChangeSection()}
    <section class="card">
      <h2>${icon("pen", 18)}구독 추가</h2>
      <form id="sub-form">
        <label>이름<input name="name" required placeholder="예: 넷플릭스" /></label>
        <div class="grid2">
          <label>금액<input name="amount" type="number" inputmode="numeric" required /></label>
          <label>주기<select name="cycle"><option value="monthly">매달</option><option value="yearly">매년</option></select></label>
        </div>
        <label>다음 결제일<input name="nextDate" type="date" value="${S.today()}" /></label>
        <div class="row end"><button class="primary">추가</button></div>
      </form>
    </section>
  `;
  $("#sub-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    S.addSubscription(Object.fromEntries(new FormData(ev.target)));
    toast("구독을 추가했어요");
    render();
  });
  view.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => { if (confirm("이 구독을 삭제할까요?")) { S.removeSubscription(b.dataset.del); render(); } }),
  );
  view.querySelectorAll("[data-pay-sub]").forEach((b) =>
    b.addEventListener("click", () => {
      const s = d.subscriptions.find((x) => x.id === b.dataset.paySub);
      S.addPaymentRequest({ payee: s.name, amount: s.amount, reason: "정기결제", dueDate: s.nextDate });
      toast("결제 요청을 만들었어요. 홈에서 승인하세요");
    }),
  );
  view.querySelectorAll("[data-cand]").forEach((b) =>
    b.addEventListener("click", () => {
      const c = candidates[Number(b.dataset.cand)];
      S.addSubscription({ name: c.name, amount: c.amount, cycle: "monthly", nextDate: c.nextDate });
      render();
    }),
  );
  bindCardChange();
}

// ---------------- 카드 바꾸기 ----------------
let cc = { from: "", to: "", found: null };
function cardChangeSection() {
  const cards = S.knownCards();
  const progress = S.get().todos.filter((t) => t.cardChange);
  const done = progress.filter((t) => t.status === "done").length;
  return `
    <details class="card" id="card-change" ${cc.found || progress.some((t) => t.status !== "done") ? "open" : ""}>
      <summary>${icon("swap", 18)}카드 바꾸기 (자동결제 옮기기)${progress.length ? ` <span class="tag">${done}/${progress.length}</span>` : ""}</summary>
      <p class="muted">기존 카드로 매달 나가는 곳을 찾아서, 바꿀 곳 목록을 할 일로 만들어 드려요. 새 카드로 결제 문자가 오면 자동으로 완료 처리돼요. 카드번호 전체는 입력하지 마세요.</p>
      <div class="grid2">
        <label>기존 카드<input id="cc-from" list="cc-cards" placeholder="예: 신한카드(1234)" value="${esc(cc.from)}" /></label>
        <label>새 카드<input id="cc-to" list="cc-cards" placeholder="예: 신한카드(5678)" value="${esc(cc.to)}" /></label>
      </div>
      <datalist id="cc-cards">${cards.map((c) => `<option value="${esc(c)}"></option>`).join("")}</datalist>
      <button class="ghost full" id="cc-find">기존 카드의 자동결제 찾기</button>
      ${cc.found ? (cc.found.length ? `
        <ul class="list" style="margin-top:8px">${cc.found.map((f, i) => `
          <li><input type="checkbox" data-cc="${i}" checked style="width:20px;margin:0" aria-label="${esc(f.merchant)} 선택" />
          <div class="grow">${f.wallet ? `<span class="tag">간편결제</span> ` : ""}${esc(f.merchant)}<div class="muted">${f.reason}${f.lastDate ? ` · 마지막 ${f.lastDate}` : ""}</div></div>
          <span class="amount">${S.won(f.amount)}</span></li>`).join("")}</ul>
        <label style="margin-top:8px">목록에 없는 곳 추가 (쉼표로 구분)<input id="cc-extra" placeholder="예: 통신비, 보험료, 관리비" /></label>
        <button class="primary full" id="cc-make">선택한 곳을 할 일로 만들기</button>`
      : `<div class="empty" style="margin-top:8px">이 카드로 반복된 결제를 찾지 못했어요. 아래에 직접 적어 주세요.</div>
        <label>바꿀 곳 (쉼표로 구분)<input id="cc-extra" placeholder="예: 넷플릭스, 통신비, 보험료" /></label>
        <button class="primary full" id="cc-make">할 일로 만들기</button>`) : ""}
      ${progress.length ? `<p class="muted" style="margin-top:10px">진행 상황: ${done}/${progress.length}곳 완료 · <a href="#" data-go="todo">할 일에서 보기</a></p>` : ""}
      <p class="muted tip">${icon("bulb", 16)}<span>토스페이·카카오페이·네이버페이에 연결된 자동결제는 그 앱에서 결제카드를 한 번 바꾸면 같이 바뀌어요. 그래서 맨 위에 보여 드려요. 문자에 '토스페이'처럼만 찍혀서 실제 서비스 이름을 모를 때도 이 방법으로 해결돼요.</span></p>
      <p class="muted tip">${icon("bulb", 16)}<span>같은 카드사 카드끼리는 카드사 고객센터나 앱에서 자동납부를 한 번에 옮겨 주는 경우가 있어요. 통신비·보험료·공과금은 먼저 물어보세요.</span></p>
    </details>`;
}

function bindCardChange() {
  const from = $("#cc-from"), to = $("#cc-to");
  if (!from) return;
  const keep = () => { cc.from = from.value.trim(); cc.to = to.value.trim(); };
  from.addEventListener("input", keep);
  to.addEventListener("input", keep);
  $("#cc-find").addEventListener("click", () => {
    keep();
    if (!cc.from) return toast("기존 카드를 입력해 주세요");
    cc.found = S.recurringForCard(cc.from);
    render();
    $("#card-change").scrollIntoView({ block: "start" });
  });
  $("#cc-make")?.addEventListener("click", () => {
    keep();
    if (!cc.to) return toast("새 카드를 입력해 주세요");
    const picked = [...view.querySelectorAll("[data-cc]")].filter((c) => c.checked).map((c) => cc.found[Number(c.dataset.cc)].merchant);
    const extra = ($("#cc-extra")?.value || "").split(",").map((s) => s.trim()).filter(Boolean);
    const merchants = [...new Set([...picked, ...extra])];
    if (!merchants.length) return toast("바꿀 곳을 하나 이상 골라 주세요");
    const made = S.createCardChangeTasks(cc.from, cc.to, merchants);
    toast(`${made.length}곳을 할 일로 만들었어요`);
    cc = { from: cc.from, to: cc.to, found: null };
    todoFilter = "open";
    go("todo");
  });
}

// ---------------- 할 일 ----------------
let todoFilter = "open";
function renderTodo() {
  const all = S.sortedTodos();
  const list = all.filter((t) => (todoFilter === "all" ? true : todoFilter === "open" ? t.status !== "done" : t.status === "done"));
  view.innerHTML = `
    <section class="card">
      <form id="todo-form">
        <label>할 일 / 처리할 문제<input name="title" required placeholder="예: 카드 연회비 문의하기" /></label>
        <div class="grid2">
          <label>우선순위<select name="priority"><option value="normal">보통</option><option value="high">높음</option><option value="low">낮음</option></select></label>
          <label>마감일<input name="due" type="date" /></label>
        </div>
        <label>메모<input name="note" /></label>
        <div class="row end"><button class="primary">추가</button></div>
      </form>
    </section>
    <div class="seg">
      ${[["open", "진행 중"], ["done", "완료"], ["all", "전체"]].map(([k, l]) => `<button class="${todoFilter === k ? "on" : ""}" data-filter="${k}">${l}</button>`).join("")}
    </div>
    <section class="card">
      ${list.length ? `<ul class="list">${list.map((t) => `
        <li class="${t.status}">
          <button class="todo-check ${t.status}" data-cycle="${t.id}" aria-label="상태 바꾸기">${t.status === "done" ? icon("tick", 16) : t.status === "doing" ? "<i class='dot'></i>" : ""}</button>
          <div class="grow"><div class="title" style="white-space:normal">${esc(t.title)}</div><div class="muted"><span class="pri-${t.priority}">${PRI_LABEL[t.priority]}</span>${t.due ? ` · 마감 ${t.due} (${ddayText(t.due)})` : ""}${t.status === "doing" ? " · 진행 중" : ""}${t.note ? ` · ${esc(t.note)}` : ""}</div></div>
          ${t.link && t.status !== "done" ? `<a class="small" href="${esc(t.link)}" target="_blank" rel="noopener" style="text-decoration:none">변경하러 가기</a>` : ""}
          <button class="x" data-del="${t.id}" aria-label="삭제">${icon("close", 18)}</button>
        </li>`).join("")}</ul>` : `<div class="empty">할 일이 없어요</div>`}
      <p class="muted">동그라미를 누르면 할 일 → 진행 중 → 완료 순서로 바뀌어요.</p>
    </section>
  `;
  $("#todo-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    S.addTodo(Object.fromEntries(new FormData(ev.target)));
    render();
  });
  view.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { todoFilter = b.dataset.filter; render(); }));
  view.querySelectorAll("[data-cycle]").forEach((b) =>
    b.addEventListener("click", () => {
      const t = S.get().todos.find((x) => x.id === b.dataset.cycle);
      const next = { open: "doing", doing: "done", done: "open" }[t.status];
      S.updateTodo(t.id, { status: next });
      render();
    }),
  );
  view.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { S.removeTodo(b.dataset.del); render(); }));
}

// ---------------- AI 비서 ----------------
// AI 답에 섞여 오는 마크다운 기호를 휴대폰에서 보기 좋게 바꿉니다(**굵게** → 굵게, "* " → "· ").
function chatText(text = "") {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/^\s*[*-]\s+/gm, "· ")
    .replace(/^#+\s*/gm, "");
}
const QUICK = ["이번 달 지출 요약해 줘", "구독 정리할 만한 거 있어?", "오늘 할 일 알려줘", "지난달이랑 비교해 줘", "다음 주에 나갈 돈은?"];

function renderAgent() {
  const d = S.get();
  const isClaude = d.settings.provider === "claude";
  const hasKey = !!(isClaude ? d.settings.apiKey : d.settings.geminiKey);
  view.innerHTML = `
    <div class="chat" id="chat">
      ${!hasKey ? `<div class="card"><b>시작하려면 API 키가 필요해요</b><p class="muted">${isClaude
        ? "오른쪽 위 설정 버튼에서 Claude API 키를 넣어 주세요. 키는 console.anthropic.com에서 만들 수 있어요."
        : "오른쪽 위 설정 버튼에서 Gemini API 키를 넣어 주세요. aistudio.google.com에 구글 계정으로 들어가 'Get API key'를 누르면 만들 수 있어요."}</p></div>` : ""}
      ${d.chat.length === 0 && hasKey ? `<div class="msg assistant">안녕하세요! 지출 기록, 구독 정리, 영수증 정리, 할 일 관리를 도와드려요. 결제 문자를 그대로 붙여넣거나 영수증 사진을 보내 보세요.</div>` : ""}
      ${d.chat.map((m) => `<div class="msg ${m.role}">${m.error ? icon("warning", 16) : ""}${m.image ? `<img src="${m.image}" alt="첨부 사진" />` : ""}${chatText(m.text)}</div>`).join("")}
      ${busy ? `<div class="msg status" id="status">생각하는 중…</div>` : ""}
    </div>
    <div class="composer">
      <div class="attach-preview">${pendingImages.map((i) => `<img src="${i.preview}" alt="첨부 예정 사진" />`).join("")}</div>
      <div class="chips">${QUICK.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join("")}${d.chat.length ? `<button id="btn-newchat">새 대화</button>` : ""}</div>
      <div class="row">
        <label class="ghost file-btn" style="margin:0;padding:10px 12px" aria-label="사진 첨부">${icon("camera", 22)}<input type="file" id="agent-photo" accept="image/*" hidden /></label>
        <textarea id="prompt" class="grow" rows="1" placeholder="무엇이든 말해 보세요"></textarea>
        <button class="primary" id="btn-send" ${busy ? "disabled" : ""}>보내기</button>
      </div>
    </div>
  `;
  const composer = view.querySelector(".composer");
  new ResizeObserver(() => document.documentElement.style.setProperty("--composer-h", `${composer.offsetHeight + 16}px`)).observe(composer);
  $("#btn-send").addEventListener("click", send);
  $("#prompt").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); send(); } });
  view.querySelectorAll("[data-q]").forEach((b) => b.addEventListener("click", () => { $("#prompt").value = b.dataset.q; send(); }));
  $("#btn-newchat")?.addEventListener("click", async () => {
    S.resetChat();
    (await loadAgent())?.resetConversation();
    render();
  });
  $("#agent-photo").addEventListener("change", async (ev) => {
    if (ev.target.files[0]) await attachImage(ev.target.files[0]);
    const keep = $("#prompt").value;
    render();
    $("#prompt").value = keep || "이 영수증을 지출로 기록해 줘.";
  });
}

async function loadAgent() {
  if (agentMod) return agentMod;
  try {
    agentMod = await import("./agent.js");
    return agentMod;
  } catch {
    toast("AI 비서를 불러오지 못했어요. 인터넷 연결을 확인해 주세요");
    return null;
  }
}

async function attachImage(file) {
  const mod = await loadAgent();
  if (!mod) return;
  try {
    pendingImages.push(await mod.imageFileToBase64(file));
  } catch {
    toast("사진을 읽지 못했어요");
  }
}

async function send() {
  if (busy) return;
  const text = $("#prompt").value.trim();
  if (!text && !pendingImages.length) return;
  const mod = await loadAgent();
  if (!mod) return;
  const d = S.get();
  const images = pendingImages;
  pendingImages = [];
  d.chat.push({ role: "user", text: text || "(영수증 사진)", image: images[0]?.preview ? await thumb(images[0].preview) : undefined });
  S.save();
  busy = true;
  render();
  window.scrollTo(0, document.body.scrollHeight);
  try {
    const reply = await mod.ask({
      text,
      images,
      onStep: (name) => { const s = $("#status"); if (s) s.textContent = stepLabel(name); },
    });
    S.get().chat.push({ role: "assistant", text: reply });
  } catch (e) {
    S.get().chat.push({ role: "status", text: `${e.message}`, error: true });
  } finally {
    busy = false;
    S.save();
    if (tab === "agent") { render(); window.scrollTo(0, document.body.scrollHeight); }
  }
}

const STEP = {
  add_expense: "지출 기록하는 중…", add_money_flow: "입출금 기록하는 중…", list_money_flows: "입출금 내역 보는 중…", list_expenses: "지출 내역 보는 중…", get_month_summary: "이번 달 정리하는 중…", mark_income: "수입 표시하는 중…",
  list_subscriptions: "구독 확인하는 중…", add_subscription: "구독 등록하는 중…", detect_subscriptions: "반복 결제 찾는 중…",
  list_todos: "할 일 확인하는 중…", add_todo: "할 일 추가하는 중…", update_todo: "할 일 바꾸는 중…",
  find_card_autopays: "카드 자동결제 찾는 중…", create_card_change_tasks: "카드 변경 목록 만드는 중…",
  fallback: "모델이 붐벼서 빠른 모델로 다시 묻는 중…",
  create_payment_request: "결제 요청 만드는 중…", list_payment_requests: "결제 요청 보는 중…", set_monthly_budget: "예산 설정하는 중…",
};
const stepLabel = (n) => STEP[n] || "작업하는 중…";

// 대화 기록에는 작은 썸네일만 저장합니다(저장 공간 절약).
function thumb(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 240 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = img.width * scale; c.height = img.height * scale;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

// ---------------- 설정 ----------------
const dlg = $("#settings");
const SETTING_KEYS = ["provider", "geminiKey", "geminiModel", "apiKey", "model", "effort", "monthlyBudget", "payAppUrl"];
function showProviderFields() {
  const p = $("#settings-form").elements.provider.value;
  document.querySelectorAll("[data-provider]").forEach((el) => (el.hidden = el.dataset.provider !== p));
}
function ensureModelOption(id) {
  const sel = $("#settings-form").elements.geminiModel;
  if (id && ![...sel.options].some((o) => o.value === id)) sel.add(new Option(id, id));
}
function renderSpendPayees() {
  const chips = (wrap, box, list, remove) => {
    $(wrap).hidden = !list.length;
    $(box).innerHTML = list.map((w) => `<button type="button" data-who="${esc(w)}">${esc(w)} ✕</button>`).join("");
    $(box).querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => { remove(b.dataset.who); renderSpendPayees(); render(); }));
  };
  chips("#spend-payees-wrap", "#spend-payees", S.listSpendPayees(), S.removeSpendPayee);
  chips("#income-senders-wrap", "#income-senders", S.listIncomeSenders(), S.removeIncomeSender);
}
$("#btn-settings").addEventListener("click", () => {
  const s = S.get().settings;
  const f = $("#settings-form");
  ensureModelOption(s.geminiModel);
  for (const k of SETTING_KEYS) f.elements[k].value = s[k] ?? "";
  showProviderFields();
  renderSpendPayees();
  $("#recent-wrap").hidden = !N.isNative();
  $("#recent-wrap").open = false;
  dlg.showModal();
});

// 확인용: 휴대폰이 최근 받은 결제·입출금 알림 (안드로이드 앱에서만)
$("#recent-wrap").addEventListener("toggle", async (ev) => {
  if (!ev.target.open) return;
  const box = $("#recent-log");
  box.innerHTML = `<div class="muted">불러오는 중…</div>`;
  try {
    const items = await N.recent();
    box.innerHTML = items.length
      ? `<ul class="list">${items.map((it) => `<li><div class="grow">
          <div class="muted">${new Date(it.time).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · ${esc(it.from)}</div>
          <div class="recent-text">${esc(it.text)}</div>
          <div><span class="tag ${it.read ? "" : "warn"}">${esc(it.read ? `기록: ${it.read}` : it.result === "앱으로 보냄" ? "앱이 읽지 못함" : it.result)}</span></div>
        </div></li>`).join("")}</ul>`
      : `<div class="empty">아직 받은 결제·입출금 알림이 없어요. 은행 앱이나 카카오톡 알림톡으로 입출금 알림이 오는지 확인해 주세요.</div>`;
  } catch (e) {
    box.innerHTML = `<div class="muted">${esc(e.message || "읽지 못했어요")}</div>`;
  }
});
$("#btn-clear-recent").addEventListener("click", async () => {
  await N.clearRecent();
  $("#recent-log").innerHTML = `<div class="empty">지웠어요</div>`;
});
$("#settings-form").elements.provider.addEventListener("change", showProviderFields);
$("#btn-load-models").addEventListener("click", async () => {
  const f = $("#settings-form");
  const key = f.elements.geminiKey.value.trim();
  if (!key) return toast("Gemini API 키를 먼저 넣어 주세요");
  try {
    const { listModels } = await import("./gemini.js");
    const models = await listModels(key);
    const sel = f.elements.geminiModel;
    const keep = sel.value;
    sel.innerHTML = `<option value="gemini-flash-lite-latest">최신 Flash Lite (빠름·추천)</option><option value="gemini-flash-latest">최신 Flash (더 똑똑함·느릴 수 있음)</option>` + models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)} (${esc(m.id)})</option>`).join("");
    ensureModelOption(keep);
    sel.value = keep;
    toast(`모델 ${models.length}개를 불러왔어요`);
  } catch (e) {
    toast(e.message);
  }
});
$("#btn-save-settings").addEventListener("click", () => {
  const f = $("#settings-form");
  S.updateSettings({
    provider: f.elements.provider.value,
    geminiKey: f.elements.geminiKey.value.trim(),
    geminiModel: f.elements.geminiModel.value,
    apiKey: f.elements.apiKey.value.trim(),
    model: f.elements.model.value,
    effort: f.elements.effort.value,
    monthlyBudget: Number(f.elements.monthlyBudget.value) || 0,
    payAppUrl: f.elements.payAppUrl.value.trim(),
  });
  toast("설정을 저장했어요");
  setTimeout(render, 0);
});
$("#btn-export").addEventListener("click", () => {
  const blob = new Blob([S.exportJSON()], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `pocket-manager-backup-${S.today()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$("#file-merge").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const { added, skipped, updated, subsTotal } = S.mergeImport(await file.text());
    toast(`결제 ${added}건을 더했어요${updated ? ` · ${updated}건 사용처 고침` : ""}${subsTotal ? ` · 구독 ${subsTotal}개 등록` : ""}${skipped ? ` · ${skipped}건은 그대로` : ""}`, "pay");
    render();
  } catch (e) {
    toast(e.message || "파일을 읽지 못했어요", "error");
  }
  ev.target.value = "";
});
$("#file-import").addEventListener("change", async (ev) => {
  const file = ev.target.files[0];
  if (!file) return;
  const text = await file.text();
  ev.target.value = "";
  try {
    const peek = JSON.parse(text);
    const isBackup = peek && peek.type !== "pocket-manager-import" && peek.settings && Array.isArray(peek.subscriptions);
    if (isBackup && !confirm("백업 파일로 지금 기록을 모두 바꿀까요?\n(잘못 바꿨으면 설정의 '되돌리기'로 돌아갈 수 있어요)")) return;
    const r = S.importJSON(text);
    if (r.merged) {
      const m = r.merged;
      toast(`백업이 아니라 결제 내역 파일이라서 덮어쓰지 않고 더했어요 (결제 ${m.added}건${m.subsTotal ? ` · 구독 ${m.subsTotal}개` : ""})`, "pay");
    } else {
      toast("백업을 불러왔어요. 이전 상태는 '되돌리기'로 복구할 수 있어요");
    }
    showUndo();
    render();
  } catch {
    toast("파일을 읽지 못했어요", "error");
  }
});
function showUndo() {
  $("#btn-undo").hidden = !S.hasSnapshot();
}
$("#btn-undo").addEventListener("click", () => {
  if (!confirm("백업을 불러오기 전 상태로 되돌릴까요?")) return;
  if (S.restoreSnapshot()) toast("이전 상태로 되돌렸어요");
  showUndo();
  render();
});
showUndo();
$("#btn-wipe").addEventListener("click", () => {
  if (!confirm("지출·구독·할 일·대화를 모두 지울까요? 되돌릴 수 없어요.")) return;
  localStorage.clear();
  location.reload();
});

// ---------------- 시작 ----------------
fillIcons();
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
view.addEventListener("click", (ev) => { const g = ev.target.closest("[data-go]"); if (g) { ev.preventDefault(); go(g.dataset.go); } });

S.rollSubscriptions();

// 문자 앱 등에서 '공유 → 포켓매니저'로 들어온 경우
const params = new URLSearchParams(location.search);
const shared = [params.get("title"), params.get("text"), params.get("url")].filter(Boolean).join("\n");
if (shared) {
  history.replaceState(null, "", location.pathname);
  const parsed = parsePaymentText(shared);
  if (parsed) {
    draftExpense = parsed;
    go("spend");
    toast("결제 문자를 읽었어요. 확인 후 저장하세요");
  } else {
    go("agent");
    $("#prompt").value = shared;
  }
} else if (location.hash === "#agent") {
  go("agent");
} else if (location.hash === "#add-expense") {
  go("spend");
} else {
  go("home");
}

if (N.isNative()) {
  // 안드로이드 앱: 시작할 때와 다시 화면에 돌아올 때 모인 결제를 가져옵니다.
  refreshNative();
  N.listen(announcePayment);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshNative(); });
} else if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

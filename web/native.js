// 안드로이드 앱으로 설치했을 때만 동작하는 부분: 결제 문자·알림 자동 기록.
// 웹(브라우저)에서는 isNative()가 false라서 아무 일도 하지 않습니다.
import * as S from "./store.js";
import { parsePaymentText } from "./sms.js";

// 컴퓨터 테스트 화면(dev/phone.html) 안에서 열렸을 때: 가짜 휴대폰 기능을 연결합니다.
// 실제 앱·웹에서는 주소에 ?mock 이 없으므로 아무 영향이 없습니다.
try {
  if (new URLSearchParams(location.search).has("mock") && window.parent !== window && window.parent.__phoneMock) {
    window.Capacitor = window.parent.__phoneMock.create();
  }
} catch {}

const cap = () => window.Capacitor;
export const isNative = () => !!cap()?.isNativePlatform?.() && cap().isPluginAvailable?.("PaymentReader");
const call = (method, options = {}) => cap().nativePromise("PaymentReader", method, options);

export const status = () => call("status");
export const requestSms = () => call("requestSms");
export const openNotificationSettings = () => call("openNotificationSettings");

// 확인용: 휴대폰이 최근 받은 결제·입출금 알림과, 앱이 그것을 무엇으로 읽었는지
export async function recent() {
  const { items = [] } = await call("recent");
  return items.reverse().map((it) => {
    const p = it.result === "앱으로 보냄" ? parsePaymentText(it.text) : null;
    const read = !p ? "" : p.kind === "in" ? `입금 ${S.won(p.amount)}` : p.kind === "out" ? `이체·송금 ${S.won(p.amount)}` : `지출 ${p.merchant} ${S.won(p.amount)}`;
    return { ...it, read };
  });
}
export const clearRecent = () => call("clearRecent");

// 문자·알림 한 건을 지출로 기록합니다. 같은 건은 두 번 기록하지 않습니다.
function record(item) {
  const parsed = parsePaymentText(item.text);
  if (!parsed) return null;
  if (item.time) parsed.date = S.toISO(new Date(item.time));
  const meta = { extId: item.id, time: item.time, source: item.source === "notification" ? "알림" : "문자" };
  // 입금, 이체·송금은 지출이 아니라 입출금으로 따로 기록합니다.
  if (parsed.kind === "in" || parsed.kind === "out") return S.addFlow({ ...parsed, ...meta });
  return S.addExpense({ ...parsed, ...meta });
}

function recordAll(items) {
  let n = 0;
  for (const it of items) if (record(it)) n++;
  return n;
}

// 앱이 꺼져 있는 동안 모인 것을 가져옵니다.
export async function drain() {
  if (!isNative()) return 0;
  const { items = [] } = await call("drain");
  return recordAll(items);
}

// 문자함에서 지난 N일 결제 문자를 가져옵니다.
export async function importInbox(days = 90) {
  const { items = [] } = await call("readInbox", { days });
  return recordAll(items);
}

// 앱이 열려 있는 동안 새 결제가 오면 바로 기록합니다.
export function listen(onRecorded) {
  if (!isNative()) return;
  cap().addListener("PaymentReader", "payment", (item) => {
    // 새 기록이면 그 항목을, 기존 기록에 합쳐졌으면(같은 결제의 두 번째 알림) null을 넘겨 화면만 새로 그립니다.
    onRecorded?.(record(item));
  });
}

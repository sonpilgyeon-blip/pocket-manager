// 카드사 결제 문자/알림 문장을 읽어 지출 항목으로 바꿉니다. (AI 없이 동작)
import { toISO } from "./store.js";

const CARD_RE = /(신한|KB국민|국민|삼성|현대|롯데|하나|우리|BC|비씨|NH농협|농협|IBK기업|기업|씨티|카카오뱅크|카카오페이|토스뱅크|토스|케이뱅크)\s?(카드|체크|페이|뱅크)?/;

const CATEGORY_WORDS = [
  ["카페", ["스타벅스", "투썸", "이디야", "메가커피", "메가mgc", "컴포즈", "빽다방", "폴바셋", "할리스", "커피", "카페"]],
  ["식비", ["배달의민족", "배민", "요기요", "쿠팡이츠", "맥도날드", "버거킹", "롯데리아", "식당", "김밥", "치킨", "피자", "편의점", "gs25", "cu", "세븐일레븐", "이마트24", "마트", "베이커리", "파리바게뜨", "뚜레쥬르"]],
  ["교통", ["택시", "카카오t", "카카오모빌리티", "버스", "지하철", "코레일", "srt", "주유", "gs칼텍스", "sk에너지", "s-oil", "티머니", "주차"]],
  ["구독", ["넷플릭스", "netflix", "유튜브", "youtube", "스포티파이", "spotify", "멜론", "지니", "디즈니", "티빙", "웨이브", "쿠팡와우", "왓챠", "apple", "애플", "google", "구글", "chatgpt", "openai", "claude", "anthropic", "notion", "노션"]],
  ["통신", ["skt", "sk텔레콤", "kt", "lg유플러스", "lgu+", "알뜰폰", "통신"]],
  ["쇼핑", ["쿠팡", "11번가", "g마켓", "옥션", "무신사", "올리브영", "다이소", "네이버페이", "ssg", "이마트", "홈플러스", "롯데마트", "코스트코"]],
  ["의료", ["병원", "의원", "약국", "치과", "한의원"]],
  ["문화", ["cgv", "메가박스", "롯데시네마", "yes24", "교보문고", "인터파크", "티켓"]],
  ["주거", ["관리비", "전기", "가스", "수도", "월세"]],
  ["교육", ["학원", "인프런", "클래스101", "강의", "교육"]],
];

export function guessCategory(merchant = "") {
  const m = merchant.toLowerCase().replace(/\s/g, "");
  for (const [cat, words] of CATEGORY_WORDS) {
    if (words.some((w) => m.includes(w.toLowerCase().replace(/\s/g, "")))) return cat;
  }
  return "기타";
}

// 예: "[Web발신]\n신한카드(1234)승인 홍*동 12,500원(일시불)11/24 13:20 스타벅스 강남점 누적1,234,000원"
// 은행 입출금 알림 예: "[KB]11/24 13:20\n123456**789\n홍길동\n입금\n50,000\n잔액309,962"
//                     "토스뱅크\n홍길동님에게 10,000원을 보냈어요"
// 결과의 kind: "spend"(지출) | "in"(들어온 돈) | "out"(이체·송금으로 나간 돈, 지출과 따로 봅니다)
export function parsePaymentText(text) {
  if (!text) return null;
  const clean = text.replace(/\[Web발신\]|\[국외발신\]/g, " ").replace(/\r/g, "");
  const amountMatch = findAmount(clean);
  if (!amountMatch) return parseForeign(clean);
  let amount = Number(amountMatch[1].replace(/,/g, ""));
  if (!amount) return null;
  const kind = moneyKind(clean);
  // 카드 승인 문자에 "할인"이 들어가는 경우가 있어서, 캐시백·할인은 입금 알림일 때만 환불로 봅니다.
  const isCancel = kind === "spend" && (/취소|환불/.test(clean) || (/입금|들어왔|받았/.test(clean) && REFUND_IN.test(clean)));
  if (isCancel) amount = -Math.abs(amount);

  const card = readCard(clean);

  const date = readDate(clean);

  if (kind !== "spend") {
    return { kind, amount: Math.abs(amount), who: findPerson(clean, amountMatch[0]), bank: readBank(clean), date, source: "sms" };
  }
  const merchant = findMerchant(clean, amountMatch[0]);
  const bankDebit = !/카드|체크|승인|결제|페이/.test(clean) && /출금/.test(clean);
  return { kind, amount, merchant, card, date, category: isCancel ? "기타" : guessCategory(merchant), memo: isCancel ? (/캐시백|할인/.test(clean) ? "환불·할인" : "결제 취소") : bankDebit ? "계좌 출금" : "", source: "sms" };
}

// "11/24" 같은 날짜. 9.99 같은 소수나 계좌번호 조각은 날짜로 보지 않습니다.
function readDate(text) {
  const now = new Date();
  for (const dm of text.matchAll(/(?<![\d.,*-])(\d{1,2})[/.-](\d{1,2})(?![\d.,*])/g)) {
    const mo = Number(dm[1]), day = Number(dm[2]);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    const d = new Date(now.getFullYear(), mo - 1, day);
    if (d - now > 7 * 86400000) d.setFullYear(d.getFullYear() - 1); // 연말에 받은 1월 문자 등
    return toISO(d);
  }
  return toISO(now);
}

// 해외 결제: "USD 9.99", "$9.99", "9.99달러", "JPY 1,200" → 대략 원화로 바꿔 기록하고 원래 금액은 메모에 남깁니다.
// 실제 청구 원화는 환율·수수료로 달라질 수 있어요. 같은 결제의 원화 출금 알림이 오면 그 금액으로 바뀝니다(store.js findTwin).
const RATE = { USD: 1400, EUR: 1500, GBP: 1800, JPY: 9.3, CNY: 195, HKD: 180, SGD: 1050, AUD: 920, CAD: 1000 };
const CUR_WORD = { 달러: "USD", 유로: "EUR", 엔: "JPY", 위안: "CNY", 파운드: "GBP", $: "USD" };
function parseForeign(text) {
  const codes = Object.keys(RATE).join("|");
  const m = text.match(new RegExp(`(${codes}|US\\$|\\$)\\s?([\\d,]+(?:\\.\\d{1,2})?)`)) ||
    text.match(new RegExp(`([\\d,]+(?:\\.\\d{1,2})?)\\s?(${codes}|달러|유로|엔|위안|파운드)`));
  if (!m) return null;
  const [num, cur0] = /\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const cur = CUR_WORD[cur0] || (cur0 === "US$" ? "USD" : cur0);
  const value = Number(num.replace(/,/g, ""));
  if (!value || !RATE[cur]) return null;
  const isCancel = /취소|환불/.test(text);
  const krw = Math.round(value * RATE[cur]) * (isCancel ? -1 : 1);
  const rest = text.replace(m[0], " ");
  const date = readDate(rest);
  const merchant = findMerchant(rest, "\u0000");
  const foreign = `${cur} ${value.toLocaleString("en-US")}`;
  return { kind: "spend", amount: krw, merchant, card: readCard(text), date, category: guessCategory(merchant),
    memo: `해외 ${foreign} · 원화는 추정${isCancel ? " · 결제 취소" : ""}`, foreign, source: "sms" };
}

// 잔액·누적 금액이 아닌 첫 금액을 고릅니다. '원'이 붙은 금액을 먼저 보고, 없으면 은행식 "12,000"을 봅니다.
function findAmount(text) {
  const notTotal = (m) => !/(잔액|누적|잔고|한도)\s*:?\s*$/.test(text.slice(Math.max(0, m.index - 6), m.index));
  const withWon = [...text.matchAll(/(-?\d[\d,]{0,11})\s*원/g)].find(notTotal);
  if (withWon) return withWon;
  if (!/입금|출금|이체|송금|잔액/.test(text)) return null;
  // 계좌번호(123-45**)·날짜·시간은 건너뜁니다.
  return [...text.matchAll(/(?<![\d*-])(\d{1,3}(?:,\d{3})+)(?![\d*-])/g)].find(notTotal) || null;
}

const REFUND_IN = /취소|환불|캐시백|할인|돌려/;
function moneyKind(raw) {
  const text = raw.replace(/입출금/g, " "); // "입출금 알림" 같은 제목은 입금·출금 판단에서 뺍니다
  if (/입금|받았|들어왔|입금되었/.test(text) && !/출금|결제|승인|보냈/.test(text)) {
    // 결제 취소·환불·캐시백으로 들어온 돈은 수입이 아니라 지출을 줄이는 돈(마이너스 지출)으로 봅니다.
    return REFUND_IN.test(text) ? "spend" : "in";
  }
  // 카드 결제·자동이체(공과금 등)는 지출, 사람·내 계좌로 보낸 이체·송금·충전은 따로 봅니다.
  const purchase = /카드|체크|승인|결제|자동이체|CMS|공과금/i.test(text);
  if (!purchase && /이체|송금|보냈|보내기|충전/.test(text)) return "out";
  return "spend";
}

const BANK_RE = /(KB국민|KB|국민|신한|우리|하나|NH농협|농협|IBK기업|기업|카카오뱅크|토스뱅크|케이뱅크|새마을|우체국|SC제일|씨티|수협|부산|대구|경남|광주|전북|제주)(은행|뱅크)?/;
function readBank(text) {
  const m = text.match(BANK_RE);
  return m ? m[0].replace(/^\[|\]$/g, "") : "";
}

// 입금·이체 상대: "홍길동님에게", "홍길동님이", 또는 은행 알림의 이름 줄
function findPerson(text, amountToken) {
  const named = text.match(/([가-힣A-Za-z*]{2,12})\s*님\s*(?:에게|께|이|으로부터|한테|의|계좌)/);
  if (named && !/고객|회원/.test(named[1])) return named[1];
  const afterWord = text.match(/(?:입금|송금|이체)\s+([가-힣*]{2,6})(?:\s|$)/);
  if (afterWord && !/완료|되었|했어|안내/.test(afterWord[1])) return afterWord[1];
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes(amountToken) || /\*\*|^\[|입금|출금|이체|송금|잔액|은행|뱅크|^\d/.test(l)) continue;
    return tidy(l);
  }
  return "";
}

// "신한카드(1234)", "KB국민카드 1*2*", "삼성카드 5678승인" → "신한카드(1234)"처럼 카드 이름 + 끝자리
function readCard(text) {
  // "토스페이"처럼 간편결제 이름보다 "신한카드"처럼 실제 카드 이름을 먼저 고릅니다.
  const all = [...text.matchAll(new RegExp(CARD_RE.source, "g"))];
  const m = all.find((x) => /카드|체크/.test(x[0])) || all[0];
  if (!m) return "";
  const name = m[0].trim();
  const after = text.slice(m.index + m[0].length, m.index + m[0].length + 14);
  const digits = after.match(/^\s*[(\[]?\s*([\d*]{4})(?![\d,])/);
  return digits ? `${name}(${digits[1]})` : name;
}

function findMerchant(text, amountToken) {
  // 1순위: 시간(13:20) 뒤에 오는 글자
  const afterTime = text.match(/\d{1,2}:\d{2}[ \t]+([^\n]+?)(?:\s+누적|\s+잔액|\s*$|\n)/);
  if (afterTime && afterTime[1].trim() && !/\*\*/.test(afterTime[1])) return tidy(afterTime[1]);
  // 2순위: 줄 단위로 나눠서 금액·카드·날짜·계좌번호가 아닌 마지막 줄
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes(amountToken) || CARD_RE.test(l) || /누적|잔액|승인|일시불|할부|출금|^입금$|\*\*|^\[/.test(l) || /^\d/.test(l)) continue;
    return tidy(l);
  }
  // 3순위: 금액 뒤의 단어
  const after = text.split(amountToken)[1] || "";
  const word = after.replace(/\(.*?\)|일시불|할부\d*개월?|\d{1,2}[/.-]\d{1,2}|\d{1,2}:\d{2}/g, " ").trim().split(/\s{2,}|\n/)[0];
  if (word) return tidy(word);
  // 4순위: 한 줄짜리 문자에서 카드·이름·날짜·금액·안내 단어를 지우고 남은 마지막 단어
  const left = text.replace(new RegExp(CARD_RE.source, "g"), " ").replace(/[(\[][\d*]{4}[)\]]/g, " ").replace(/\S*\*\S*/g, " ")
    .replace(/\d{1,2}[/.-]\d{1,2}|\d{1,2}:\d{2}|[\d,]+(?:\.\d+)?/g, " ").replace(/해외|승인|취소|일시불|할부|결제|사용|누적|잔액|원|님/g, " ")
    .trim().split(/\s+/).filter((w) => w.length > 1);
  return tidy(left[left.length - 1] || "알 수 없음");
}
const tidy = (s) => s.replace(/누적.*$|잔액.*$/, "").replace(/결제\s*완료|해외\s*승인|해외|결제|승인|사용|[·•|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "알 수 없음";

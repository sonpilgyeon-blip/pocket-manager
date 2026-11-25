// AI 비서가 쓰는 도구와 지침. Claude와 Gemini가 같이 씁니다.
// 돈을 직접 보내는 도구는 없습니다. AI는 "결제 요청"만 만들 수 있고, 승인과 실제 결제는 사용자가 합니다.
import * as S from "./store.js";

export const tools = [
  {
    name: "add_expense",
    description: "지출 1건을 장부에 기록한다. 사용자가 무언가를 샀다고 말하거나, 결제 문자·영수증 내용을 줬을 때 쓴다. 결제 취소·환불은 음수 금액으로 기록한다.",
    input_schema: {
      type: "object",
      properties: {
        amount: { type: "number", description: "원 단위 금액" },
        merchant: { type: "string", description: "가맹점/사용처 이름" },
        category: { type: "string", enum: S.CATEGORIES },
        date: { type: "string", description: "YYYY-MM-DD. 모르면 생략(오늘)" },
        memo: { type: "string" },
      },
      required: ["amount", "merchant", "category"],
    },
  },
  {
    name: "add_money_flow",
    description:
      "통장에 들어온 돈(입금: 월급, 용돈, 내 다른 통장에서 옮긴 돈 등)이나 이체·송금으로 보낸 돈을 입출금 기록에 남긴다. 지출 합계에는 들어가지 않는다. 계좌이체라도 물건·서비스·월세 등 돈을 쓴 것이면 이 도구 대신 add_expense를 쓴다.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["in", "out"], description: "in = 들어온 돈(입금), out = 보낸 돈(이체·송금)" },
        amount: { type: "number", description: "원 단위 금액(양수)" },
        who: { type: "string", description: "보낸 사람 또는 받는 사람. 내 통장끼리 옮겼으면 '내 계좌'" },
        bank: { type: "string", description: "은행 이름 (예: KB국민). 계좌번호는 넣지 않는다" },
        date: { type: "string", description: "YYYY-MM-DD. 모르면 생략(오늘)" },
        memo: { type: "string" },
        income: { type: "boolean", description: "입금(in)일 때만. 월급·용돈·판매 대금·환급처럼 번 돈이면 true, 내 통장끼리 옮긴 돈이면 false" },
      },
      required: ["kind", "amount"],
    },
  },
  {
    name: "list_money_flows",
    description: "한 달의 입금·이체 기록(id 포함)과 들어온 돈·수입·보낸 돈 합계를 돌려준다.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM. 생략하면 이번 달" } } },
  },
  {
    name: "mark_income",
    description: "이미 기록된 입금을 수입으로 표시하거나 표시를 뺀다. id는 list_money_flows에서 얻는다. 같은 보낸 사람의 다음 입금도 자동으로 따라간다.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" }, income: { type: "boolean" } },
      required: ["id", "income"],
    },
  },
  {
    name: "list_expenses",
    description: "지출 내역을 조회한다. 월(YYYY-MM)과 분류로 거를 수 있다.",
    input_schema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM. 생략하면 이번 달" },
        category: { type: "string", enum: S.CATEGORIES },
        limit: { type: "integer", description: "최대 건수(기본 30)" },
      },
    },
  },
  {
    name: "get_month_summary",
    description: "한 달의 총지출, 분류별 합계, 많이 쓴 곳, 예산 대비 잔액을 돌려준다.",
    input_schema: { type: "object", properties: { month: { type: "string", description: "YYYY-MM. 생략하면 이번 달" } } },
  },
  {
    name: "set_monthly_budget",
    description: "월 예산(원)을 설정한다. 0이면 예산 해제.",
    input_schema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
  },
  {
    name: "list_subscriptions",
    description: "등록된 구독·정기결제 목록과 다음 결제일, 월 환산 합계를 돌려준다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "add_subscription",
    description: "구독·정기결제를 등록한다.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        amount: { type: "number" },
        cycle: { type: "string", enum: ["monthly", "yearly"] },
        next_date: { type: "string", description: "다음 결제일 YYYY-MM-DD" },
      },
      required: ["name", "amount", "cycle"],
    },
  },
  {
    name: "detect_subscriptions",
    description: "지출 내역에서 매달 반복되는 결제(구독 후보)를 찾는다. 등록은 하지 않는다.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "list_todos",
    description: "할 일·이슈 목록을 우선순위 순으로 돌려준다.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "doing", "done", "all"], description: "기본은 끝나지 않은 것" } },
    },
  },
  {
    name: "add_todo",
    description: "할 일이나 처리할 문제(이슈)를 등록한다.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        priority: { type: "string", enum: ["high", "normal", "low"] },
        due: { type: "string", description: "마감일 YYYY-MM-DD" },
        note: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "update_todo",
    description: "할 일의 상태·우선순위·마감일을 바꾼다. id는 list_todos에서 얻는다.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        status: { type: "string", enum: ["open", "doing", "done"] },
        priority: { type: "string", enum: ["high", "normal", "low"] },
        due: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "find_card_autopays",
    description: "특정 카드로 반복해서 나가는 자동결제(구독·통신비 등)를 찾는다. 카드를 바꾸려는 사용자를 도울 때 먼저 쓴다. card는 '신한카드(1234)', '1234', '신한'처럼 일부만 줘도 된다.",
    input_schema: { type: "object", properties: { card: { type: "string" } }, required: ["card"] },
  },
  {
    name: "create_card_change_tasks",
    description: "카드 변경 체크리스트를 할 일로 만든다. 가맹점마다 결제수단 변경 링크가 붙고, 새 카드로 결제 문자가 오면 자동으로 완료된다. 사용자가 어떤 곳을 바꿀지 확인한 뒤에 쓴다. 카드번호 전체는 절대 다루지 않는다.",
    input_schema: {
      type: "object",
      properties: {
        from_card: { type: "string", description: "기존 카드 (예: 신한카드(1234))" },
        to_card: { type: "string", description: "새 카드 (예: 신한카드(5678))" },
        merchants: { type: "array", items: { type: "string" }, description: "결제수단을 바꿀 가맹점들" },
      },
      required: ["from_card", "to_card", "merchants"],
    },
  },
  {
    name: "create_payment_request",
    description:
      "결제(송금·납부)가 필요할 때 '결제 요청' 카드를 만든다. 실제로 돈이 나가지는 않는다. 사용자가 앱에서 직접 승인하고, 자기 결제 앱에서 결제를 마쳐야 한다. 사용자가 결제를 원한다고 분명히 말했을 때만 만든다.",
    input_schema: {
      type: "object",
      properties: {
        payee: { type: "string", description: "받는 곳" },
        amount: { type: "number" },
        reason: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["payee", "amount", "reason"],
    },
  },
  {
    name: "list_payment_requests",
    description: "결제 요청 목록과 상태(pending 대기, approved 승인됨, paid 완료, rejected 거절)를 돌려준다.",
    input_schema: { type: "object", properties: {} },
  },
];

const str = (v) => typeof v === "string" && v.trim() !== "";
const num = (v) => typeof v === "number" && isFinite(v);
const ok = (obj) => JSON.stringify(obj);

export function runTool(name, input, onChange) {
  const d = S.get();
  switch (name) {
    case "add_expense": {
      if (!num(input.amount) || !str(input.merchant)) throw new Error("amount(숫자)와 merchant가 필요합니다");
      const e = S.addExpense({ ...input, source: "ai" });
      onChange?.();
      return ok({ saved: e });
    }
    case "add_money_flow": {
      if (!["in", "out"].includes(input.kind) || !num(input.amount) || input.amount <= 0) throw new Error("kind(in/out)와 0보다 큰 amount가 필요합니다");
      if (/\d{8,}/.test(`${input.who || ""}${input.bank || ""}${input.memo || ""}`.replace(/[-\s]/g, ""))) throw new Error("계좌번호는 저장하지 않습니다. 은행 이름만 쓰세요.");
      const f = S.addFlow({ ...input, source: "ai" });
      if (!f) throw new Error("기록하지 못했습니다");
      onChange?.();
      if (!f.kind) return ok({ saved: f, note: "사용자가 이 받는 사람에게 보낸 이체는 지출로 기록하도록 정해 두어서 지출로 저장됨." });
      return ok({ saved: f, note: "입출금 기록에 저장됨. 지출 합계에는 포함되지 않음." });
    }
    case "list_money_flows": {
      const m = S.monthFlows(input.month || undefined);
      return ok({ month: input.month || S.monthOf(S.today()), in: m.in, income: m.income, out: m.out, items: m.list.slice(0, 50) });
    }
    case "mark_income": {
      if (!str(input.id) || typeof input.income !== "boolean") throw new Error("id와 income(true/false)이 필요합니다");
      const f = S.setFlowIncome(input.id, input.income);
      if (!f) throw new Error("해당 id의 입금 기록이 없습니다");
      onChange?.();
      return ok({ updated: f });
    }
    case "list_expenses": {
      const month = input.month || S.monthOf(S.today());
      let list = d.expenses.filter((e) => S.monthOf(e.date) === month);
      if (input.category) list = list.filter((e) => e.category === input.category);
      return ok({ month, count: list.length, items: list.slice(0, input.limit || 30) });
    }
    case "get_month_summary":
      return ok(S.monthSummary(input.month || undefined));
    case "set_monthly_budget":
      if (!num(input.amount) || input.amount < 0) throw new Error("amount는 0 이상의 숫자여야 합니다");
      S.updateSettings({ monthlyBudget: input.amount });
      onChange?.();
      return ok({ monthlyBudget: input.amount });
    case "list_subscriptions":
      return ok({ monthlyTotal: Math.round(S.monthlySubTotal()), items: d.subscriptions.map((s) => ({ ...s, daysLeft: S.daysUntil(s.nextDate) })) });
    case "add_subscription": {
      if (!str(input.name) || !num(input.amount)) throw new Error("name과 amount가 필요합니다");
      const s = S.addSubscription({ ...input, nextDate: input.next_date });
      onChange?.();
      return ok({ saved: s });
    }
    case "detect_subscriptions":
      return ok({ candidates: S.detectSubscriptions() });
    case "list_todos": {
      const st = input.status || "open";
      const list = S.sortedTodos().filter((t) => (st === "all" ? true : st === "open" ? t.status !== "done" : t.status === st));
      return ok({ items: list });
    }
    case "add_todo": {
      if (!str(input.title)) throw new Error("title이 필요합니다");
      const t = S.addTodo(input);
      onChange?.();
      return ok({ saved: t });
    }
    case "update_todo": {
      if (!str(input.id)) throw new Error("id가 필요합니다");
      const patch = {};
      for (const k of ["status", "priority", "due"]) if (input[k] !== undefined) patch[k] = input[k];
      const t = S.updateTodo(input.id, patch);
      if (!t) throw new Error("해당 id의 할 일이 없습니다");
      onChange?.();
      return ok({ updated: t });
    }
    case "find_card_autopays":
      if (!str(input.card)) throw new Error("card가 필요합니다");
      return ok({ card: input.card, autopays: S.recurringForCard(input.card), knownCards: S.knownCards() });
    case "create_card_change_tasks": {
      if (!str(input.from_card) || !str(input.to_card) || !Array.isArray(input.merchants) || !input.merchants.every(str)) {
        throw new Error("from_card, to_card, merchants(문자열 배열)가 필요합니다");
      }
      if (/\d{8,}/.test(input.from_card + input.to_card)) throw new Error("카드번호 전체는 저장하지 않습니다. 카드 이름과 끝 4자리만 쓰세요.");
      const made = S.createCardChangeTasks(input.from_card, input.to_card, input.merchants);
      onChange?.();
      return ok({ created: made.map((t) => ({ title: t.title, link: t.link })) });
    }
    case "create_payment_request": {
      if (!str(input.payee) || !num(input.amount) || input.amount <= 0) throw new Error("payee와 0보다 큰 amount가 필요합니다");
      const p = S.addPaymentRequest({ ...input, dueDate: input.due_date });
      onChange?.();
      return ok({ created: p, note: "사용자 승인 대기 중. 아직 돈은 나가지 않았음." });
    }
    case "list_payment_requests":
      return ok({ items: d.payments });
    default:
      throw new Error(`알 수 없는 도구: ${name}`);
  }
}

export function systemPrompt() {
  return `당신은 사용자의 휴대폰 앱 '포켓매니저' 안에서 일하는 개인 비서입니다. 한국어로, 짧고 친근하게 답합니다.
하는 일: 지출 기록·분석, 수입·입금·이체 기록, 구독·정기결제 관리, 영수증 정리, 할 일·이슈 관리, 결제 요청 준비.

원칙:
- 앱 데이터는 반드시 도구로 읽고 씁니다. 숫자를 지어내지 않습니다.
- 사용자가 결제 문자나 영수증 사진을 주면 금액·가맹점·날짜·분류를 읽어 add_expense로 기록하고, 기록한 내용을 한 줄로 알려 줍니다. 영수증이 여러 건이면 각각 기록합니다. 읽기 애매한 값은 기록 전에 물어봅니다.
- 돈이 들어왔다(입금, 월급, 용돈, 내 통장에 넣음)거나 누구에게 이체·송금했다고 하면 add_money_flow로 입출금 기록에 남깁니다. 단, 계좌이체로 물건값·월세·관리비·중고거래·회비처럼 돈을 쓴 것이면 지출이므로 add_expense로 기록하고 memo에 "계좌이체"를 넣습니다. 쓴 돈인지 내 통장끼리 옮긴 돈인지 애매하면 물어봅니다.
- 월급·용돈·알바비·판매 대금·환급처럼 번 돈이 들어오면 add_money_flow에 kind "in", income true로 기록합니다. 이미 기록된 입금이면 mark_income으로 수입 표시를 합니다. 내 통장끼리 옮긴 돈은 수입이 아닙니다. 애매하면 물어봅니다. 이번 달 수입과 "수입 − 지출"은 get_month_summary의 income, net에 있습니다. 결제 취소·환불·캐시백은 수입이 아니라 마이너스 지출로 기록하며(add_expense에 음수 금액, memo "환불·할인"), 합계는 refunds에 있습니다. 입금·출금 알림 문구를 주면 입금인지 이체인지, 지출(카드·체크카드 결제)인지 구분해서 기록합니다.
- 당신은 돈을 직접 보낼 수 없습니다. 결제가 필요하면 create_payment_request로 요청 카드만 만들고, "앱의 결제 요청에서 승인한 뒤 결제 앱에서 마무리해 주세요"라고 안내합니다. 사용자가 원한다고 분명히 말하지 않은 결제 요청은 만들지 않습니다.
- 사용자가 카드를 바꾸려 하면 find_card_autopays로 기존 카드의 자동결제를 찾아 보여 주고, 바꿀 곳을 확인한 뒤 create_card_change_tasks로 체크리스트를 만듭니다. 각 서비스의 결제수단은 사용자가 직접 바꿔야 한다고 안내합니다. 토스페이·카카오페이·네이버페이·페이코로 결제된 곳은 그 간편결제 앱에서 카드를 한 번 바꾸면 연결된 서비스가 같이 바뀌므로, 그것부터 하라고 먼저 권합니다. 같은 카드사 카드끼리는 카드사가 자동납부를 옮겨 주는 경우가 있으니 통신비·보험료·공과금은 카드사에 먼저 문의하라고 알려 줍니다.
- 계좌번호, 카드번호, 비밀번호 같은 금융 정보는 묻지도 저장하지도 않습니다.
- 투자 조언은 하지 않습니다. 절약 팁은 사용자의 실제 지출 데이터에 근거해서만 줍니다.
- 금액은 "12,500원"처럼 씁니다.
- 휴대폰 채팅 화면이라 마크다운 기호(**, #, 표)는 쓰지 않습니다. 목록은 줄마다 "· "로 시작합니다.`;
}

// 현재 대화(API 형식). 앱을 새로 열면 초기화됩니다. 화면용 기록은 store에 남습니다.

// 휴대폰 사진은 크기가 커서, 긴 변 1568px JPEG로 줄여서 보냅니다.
export async function imageFileToBase64(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: dataUrl.split(",")[1], preview: dataUrl };
}

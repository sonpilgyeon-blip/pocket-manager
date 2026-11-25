// Gemini API로 대화합니다. (설정에서 AI를 Gemini로 골랐을 때)
// API 키는 Google AI Studio(aistudio.google.com)에서 본인 구글 계정으로 만듭니다.
import * as S from "./store.js";
import { tools, runTool, systemPrompt } from "./tools.js";

const BASE = "https://generativelanguage.googleapis.com/v1beta";
export const DEFAULT_MODEL = "gemini-flash-lite-latest"; // 빠르고 무료 사용량이 넉넉한 최신 Flash Lite
const FALLBACK_MODEL = "gemini-flash-lite-latest"; // 고른 모델이 붐비거나 느리면 자동으로 넘어갈 모델

// Claude 형식의 도구 정의를 Gemini 형식으로 바꿉니다.
const functionDeclarations = tools.map((t) => {
  const decl = { name: t.name, description: t.description };
  if (Object.keys(t.input_schema.properties || {}).length) decl.parameters = t.input_schema;
  return decl;
});

let history = []; // Gemini 형식 대화 (role: user | model)
export function resetConversation() {
  history = [];
}

const TIMEOUT_MS = 30000; // 30초 넘게 답이 없으면 멈춰 있지 않고 다른 모델로 넘어가거나 안내합니다

async function call(path, { key, body, method = "POST" }) {
  let res;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    res = await fetch(`${BASE}/${path}`, {
      method,
      headers: { "content-type": "application/json", "x-goog-api-key": key }, // 키를 주소에 넣지 않습니다
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw Object.assign(new Error("Gemini 답이 30초 넘게 오지 않았어요. 잠시 후 다시 시도해 주세요."), { retryable: true });
    throw new Error("인터넷 연결을 확인해 주세요.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw friendlyError(res.status, data);
  return data;
}

function friendlyError(status, data) {
  const msg = data?.error?.message || "";
  const reason = JSON.stringify(data?.error?.details || "");
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(msg + reason)) return new Error("Gemini API 키가 올바르지 않아요. 설정에서 확인해 주세요.");
  if (status === 403) return new Error("이 API 키로는 Gemini를 쓸 수 없어요. AI Studio에서 키를 다시 확인해 주세요.");
  if (status === 404) return new Error("선택한 Gemini 모델을 찾을 수 없어요. 설정에서 '모델 불러오기'를 눌러 다시 골라 주세요.");
  if (status === 429) return Object.assign(new Error("무료 사용량을 잠시 넘었어요. 1분쯤 뒤에 다시 시도해 주세요."), { retryable: true });
  if (status === 503) return Object.assign(new Error("지금 구글 Gemini 서버가 붐벼요. 잠시 후 다시 시도해 주세요."), { retryable: true });
  if (status >= 500) return Object.assign(new Error(`Gemini 서버 오류(${status}). 잠시 후 다시 시도해 주세요.`), { retryable: true });
  return new Error(`Gemini 요청 오류(${status}): ${msg}`);
}

// 내 키로 쓸 수 있는 Gemini 모델 목록 (설정 화면의 '모델 불러오기')
export async function listModels(key) {
  const data = await call("models?pageSize=200", { key, method: "GET" });
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/.test(m.name) && !/embedding|image|tts|audio|live/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
    .sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }));
}

export async function ask({ text, images = [], onChange, onStep }) {
  const { geminiKey, geminiModel } = S.get().settings;
  if (!geminiKey) throw new Error("설정에서 Gemini API 키를 먼저 입력해 주세요.");
  let model = geminiModel || DEFAULT_MODEL;

  const parts = images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } }));
  parts.push({ text: `[오늘: ${S.today()}]\n${text || "이 영수증을 정리해 줘."}` });
  history.push({ role: "user", parts });

  for (let turn = 0; turn < 12; turn++) {
    let data;
    try {
      data = await call(`models/${encodeURIComponent(model)}:generateContent`, {
        key: geminiKey,
        body: {
          systemInstruction: { parts: [{ text: systemPrompt() }] },
          contents: history,
          tools: [{ functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        },
      });
    } catch (e) {
      // 고른 모델이 붐비거나 느리면 한 번만 Flash Lite로 바꿔 다시 보냅니다.
      if (e.retryable && model !== FALLBACK_MODEL) {
        model = FALLBACK_MODEL;
        onStep?.("fallback");
        turn--;
        continue;
      }
      if (turn === 0) history.pop();
      throw e;
    }

    if (data.promptFeedback?.blockReason) {
      history.pop();
      return "이 요청은 처리할 수 없어요. 다르게 표현해서 다시 말씀해 주세요.";
    }
    const cand = data.candidates?.[0];
    if (!cand?.content?.parts?.length) {
      return cand?.finishReason === "SAFETY" ? "이 요청은 처리할 수 없어요." : "답을 받지 못했어요. 다시 시도해 주세요.";
    }
    // 모델이 준 내용은 그대로 다시 보냅니다(생각 서명 등 포함).
    history.push({ role: "model", parts: cand.content.parts });

    const calls = cand.content.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const reply = cand.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
      if (cand.finishReason === "MAX_TOKENS") return (reply ? reply + "\n\n" : "") + "(답이 길어서 중간에 끊겼어요.)";
      return reply || "완료했어요.";
    }

    const responses = [];
    for (const p of calls) {
      const { name, args, id } = p.functionCall;
      onStep?.(name);
      let response;
      try {
        response = { result: JSON.parse(runTool(name, args || {}, onChange)) };
      } catch (e) {
        response = { error: e.message };
      }
      responses.push({ functionResponse: id ? { id, name, response } : { name, response } });
    }
    history.push({ role: "user", parts: responses });
  }
  return "작업 단계가 너무 많아 멈췄어요. 요청을 나눠서 말씀해 주세요.";
}

// Claude API로 대화합니다. (설정에서 AI를 Claude로 골랐을 때)
import Anthropic from "https://esm.sh/@anthropic-ai/sdk";
import * as S from "./store.js";
import { tools, runTool, systemPrompt } from "./tools.js";

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

let history = [];
export function resetConversation() {
  history = [];
}

export async function ask({ text, images = [], onChange, onStep }) {
  const { apiKey, model, effort } = S.get().settings;
  if (!apiKey) throw new Error("설정에서 Claude API 키를 먼저 입력해 주세요.");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const content = [];
  for (const img of images) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  content.push({ type: "text", text: `[오늘: ${S.today()}]\n${text || "이 영수증을 정리해 줘."}` });
  history.push({ role: "user", content });

  const params = {
    model,
    max_tokens: 16000,
    system: systemPrompt(),
    tools,
    output_config: { effort },
  };
  if (FALLBACK_MODELS.has(model)) {
    params.betas = ["server-side-fallback-2026-07-01"];
    params.fallbacks = "default";
  }

  for (let turn = 0; turn < 12; turn++) {
    let response;
    try {
      response = await client.beta.messages.create({ ...params, messages: history });
    } catch (err) {
      history.pop(); // 실패한 질문은 대화에서 빼서 다시 보낼 수 있게 합니다
      throw friendlyError(err);
    }
    history.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "refusal") {
      return "이 요청은 처리할 수 없어요. 다르게 표현해서 다시 말씀해 주세요.";
    }
    if (response.stop_reason === "pause_turn") continue;

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      if (response.stop_reason === "max_tokens") return (reply ? reply + "\n\n" : "") + "(답이 길어서 중간에 끊겼어요.)";
      return reply || "완료했어요.";
    }

    const results = [];
    for (const tu of toolUses) {
      onStep?.(tu.name);
      try {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: runTool(tu.name, tu.input || {}, onChange) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `오류: ${e.message}`, is_error: true });
      }
    }
    history.push({ role: "user", content: results });
  }
  return "작업 단계가 너무 많아 멈췄어요. 요청을 나눠서 말씀해 주세요.";
}

function friendlyError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new Error("API 키가 올바르지 않아요. 설정에서 확인해 주세요.");
  if (err instanceof Anthropic.PermissionDeniedError) return new Error("이 API 키로는 선택한 모델을 쓸 수 없어요.");
  if (err instanceof Anthropic.RateLimitError) return new Error("요청이 많아요. 잠시 후 다시 시도해 주세요.");
  if (err instanceof Anthropic.BadRequestError) return new Error(`요청 오류: ${err.message}`);
  if (err instanceof Anthropic.APIConnectionError) return new Error("인터넷 연결을 확인해 주세요.");
  if (err instanceof Anthropic.APIError) return new Error(`AI 서버 오류(${err.status}). 잠시 후 다시 시도해 주세요.`);
  return err instanceof Error ? err : new Error(String(err));
}

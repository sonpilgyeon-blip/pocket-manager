// AI 비서 입구: 설정에서 고른 AI(Gemini 또는 Claude)로 연결합니다.
import * as S from "./store.js";
export { imageFileToBase64 } from "./tools.js";

const loaders = { gemini: () => import("./gemini.js"), claude: () => import("./claude.js") };
let current = null; // { name, mod }

async function provider() {
  const name = S.get().settings.provider === "claude" ? "claude" : "gemini";
  if (current?.name !== name) {
    current?.mod.resetConversation();
    current = { name, mod: await loaders[name]() };
  }
  return current.mod;
}

export async function ask(opts) {
  return (await provider()).ask(opts);
}

export async function resetConversation() {
  (await provider()).resetConversation();
}

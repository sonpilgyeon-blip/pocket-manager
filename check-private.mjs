// 깃에 올리기 전에 개인 정보가 섞이지 않았는지 검사합니다.
// git commit 할 때 자동으로 실행됩니다(.git/hooks/pre-commit). 직접 실행: node check-private.mjs
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RULES = [
  [/AIza[0-9A-Za-z_\-]{30,}/, "Gemini/구글 API 키"],
  [/sk-ant-[0-9A-Za-z_\-]{20,}/, "Claude API 키"],
  [/\bghp_[0-9A-Za-z]{30,}/, "GitHub 토큰"],
  [/[A-Za-z0-9._%+-]+@(gmail|naver|daum|hanmail|kakao)\.(com|net)/i, "개인 이메일 주소"],
  [/\b01[016789][-\s]?\d{3,4}[-\s]?\d{4}\b/, "휴대폰 번호"],
  [/\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/, "카드번호처럼 보이는 숫자"],
  [/\b\d{6}[-\s][1-4]\d{6}\b/, "주민등록번호처럼 보이는 숫자"],
];

const files = execSync("git diff --cached --name-only --diff-filter=ACM", { encoding: "utf8" })
  .split("\n").filter(Boolean).filter((f) => !/\.(png|jpg|jpeg|webp|jar|keystore)$/i.test(f) && f !== "check-private.mjs");

const problems = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  text.split("\n").forEach((line, i) => {
    for (const [re, label] of RULES) if (re.test(line)) problems.push(`${f}:${i + 1}  ${label}`);
  });
}

if (problems.length) {
  console.error("\n⛔ 개인 정보로 보이는 내용이 있어 커밋을 멈췄어요:\n  " + problems.join("\n  "));
  console.error("\n지운 뒤 다시 커밋하세요. 정말 괜찮은 내용이면: git commit --no-verify\n");
  process.exit(1);
}

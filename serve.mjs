// 컴퓨터에서 앱을 미리 보기 위한 작은 서버: node serve.mjs  → http://localhost:5173
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./web/", import.meta.url));
const devRoot = fileURLToPath(new URL("./dev/", import.meta.url)); // 컴퓨터 전용 테스트 화면 (앱에는 들어가지 않음)
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const port = Number(process.env.PORT) || 5173;

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/test" || path === "/test/") path = "/dev/phone.html";
  if (path.endsWith("/")) path += "index.html";
  const isDev = path.startsWith("/dev/");
  const base = isDev ? devRoot : root;
  const file = normalize(join(base, isDev ? path.slice(5) : path));
  if (!file.startsWith(base)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`앱: http://localhost:${port}   휴대폰 테스트 화면: http://localhost:${port}/test`));

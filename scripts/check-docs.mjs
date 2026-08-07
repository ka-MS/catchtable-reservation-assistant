// 문서 정합성 검사.
//
// 사람이 매번 기억해서 돌리던 검사를 `npm run check`로 옮긴다. CI가 PR마다
// 이 명령을 돌리므로 깨진 링크나 미등록 spec은 병합 전에 걸린다.
//
// 판정이 명확한 것만 검사한다. "수치가 최신인가" 같은 판단이 필요한 항목은
// 넣지 않는다 — 오탐이 나면 검사 전체가 무시된다.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = "docs";
const errors = [];

async function markdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const found = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  }));
  return found.flat();
}

const files = [...await markdownFiles(ROOT), "AGENTS.md", "CLAUDE.md", "README.md"];

// --- 1. 내부 링크가 실제 파일을 가리키는가 --------------------------------

const LINK = /\]\(([^)\s]+?)(?:\s+"[^"]*")?\)/g;
let linkCount = 0;

for (const file of files) {
  const markdown = await readFile(file, "utf8");
  for (const match of markdown.matchAll(LINK)) {
    const raw = match[1];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = raw.split("#")[0];
    if (target === "") continue;
    linkCount += 1;
    const resolved = path.resolve(path.dirname(file), target);
    try {
      await stat(resolved);
    } catch {
      errors.push(`${file}: 깨진 링크 -> ${raw}`);
    }
  }
}

// --- 2. spec 패키지가 카탈로그에 등록됐는가 -------------------------------
//
// `docs/specs/README.md`의 등록 규칙은 새 패키지를 만들면 카탈로그에
// 올리도록 요구한다. 누락되면 다음 작업자가 그 패키지를 못 찾는다.

const SPECS = path.join(ROOT, "specs");
const catalog = await readFile(path.join(SPECS, "README.md"), "utf8");
const packages = (await readdir(SPECS, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

for (const name of packages) {
  if (!catalog.includes(`${name}/`)) {
    errors.push(`docs/specs/README.md: 카탈로그에 없는 패키지 -> ${name}/`);
  }
}

// --- 결과 ------------------------------------------------------------------

if (errors.length > 0) {
  throw new Error(`문서 검사 실패 (${errors.length}건):\n${errors.map((e) => `- ${e}`).join("\n")}`);
}

console.log(`docs validation passed: 링크 ${linkCount}개, spec 패키지 ${packages.length}개`);

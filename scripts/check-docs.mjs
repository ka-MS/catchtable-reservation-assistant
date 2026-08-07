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

/**
 * 코드 블록과 인라인 코드를 지운다. 그 안의 링크는 **예시**이지 참조가
 * 아니다(#26). 지우지 않으면 링크 작성법을 설명하는 문서가 CI를 깨뜨린다.
 *
 * 길이를 보존하려고 같은 길이의 공백으로 치환한다 — 그래야 이 함수가
 * 링크 정규식의 오프셋에 영향을 주지 않는다.
 */
function stripCode(markdown) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1[^\n]*$/gm, blank) // 펜스
    .replace(/(`+)[^`\n]*?\1/g, blank);                                // 인라인
}

/**
 * 파일 경로가 아닌 링크를 건너뛴다.
 *
 * 스킴을 열거하지 않고 **URI 스킴 일반형**으로 판정한다(#26). `chrome:`,
 * `about:` 같은 확장 프로그램 스킴을 하나씩 추가하다 보면 빠뜨린 것이
 * 깨진 링크로 보고된다. `//host` 프로토콜 상대 경로도 같은 이유로 뺀다.
 */
function isExternal(raw) {
  return /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.startsWith("#");
}

let linkCount = 0;

for (const file of files) {
  const markdown = stripCode(await readFile(file, "utf8"));
  for (const match of markdown.matchAll(LINK)) {
    const raw = match[1];
    if (isExternal(raw)) continue;
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
//
// 이전 구현은 최상위 `docs/specs/*`만 순회하고 `catalog.includes(name + "/")`
// 로 판정해 두 가지를 놓쳤다(#26).
//
// - **중첩 패키지**(`SP-025/02` 같은 단계 패키지)가 순회 대상이 아니었다.
//   실제로 `SP-025/02`·`/03`이 미등록인 채 CI를 두 번 통과했다.
// - 부분 문자열 매칭이라 기존 항목의 접미사와 겹치는 이름이 빠져나갔다
//   (`telemetry/`가 `run-telemetry/` 때문에 통과).
//
// 지금은 카탈로그의 **링크 경로를 파싱해** 등록된 패키지 집합을 만들고
// 실제 디렉터리와 대조한다. 두 결함이 같이 해소된다.

const SPECS = path.join(ROOT, "specs");
const catalog = await readFile(path.join(SPECS, "README.md"), "utf8");

/** 카탈로그 링크가 가리키는 디렉터리 경로 집합 (`docs/specs` 기준 상대). */
const registered = new Set();
for (const match of stripCode(catalog).matchAll(LINK)) {
  const target = match[1].split("#")[0];
  if (isExternal(target) || target === "") continue;
  const dir = path.posix.dirname(path.posix.normalize(target));
  if (dir === "." || dir.startsWith("..")) continue;
  // 중첩 패키지는 상위 패키지도 등록된 것으로 본다.
  const parts = dir.split("/");
  for (let i = 1; i <= parts.length; i += 1) registered.add(parts.slice(0, i).join("/"));
}

/** `.md`를 직접 담고 있는 디렉터리가 패키지다. 깊이 제한 없이 찾는다. */
async function specPackages(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const here = entries.some((e) => e.isFile() && e.name.endsWith(".md")) && prefix !== "";
  const nested = await Promise.all(entries
    .filter((e) => e.isDirectory())
    .map((e) => specPackages(path.join(dir, e.name), prefix === "" ? e.name : `${prefix}/${e.name}`)));
  return [...(here ? [prefix] : []), ...nested.flat()];
}

const packages = (await specPackages(SPECS)).sort();

for (const name of packages) {
  if (!registered.has(name)) {
    errors.push(`docs/specs/README.md: 카탈로그에 없는 패키지 -> ${name}/`);
  }
}

// --- 결과 ------------------------------------------------------------------

if (errors.length > 0) {
  throw new Error(`문서 검사 실패 (${errors.length}건):\n${errors.map((e) => `- ${e}`).join("\n")}`);
}

console.log(`docs validation passed: 링크 ${linkCount}개, spec 패키지 ${packages.length}개`);

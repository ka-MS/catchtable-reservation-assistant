import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryName = "catchtable-reserve-" + "cl";
const forbidden = [repositoryName, `/home/developer/source/${repositoryName}`, `../${repositoryName}`];
const roots = ["README.md", "manifest.json", "package.json", "src", "tests", "docs"];
const allowed = new Set(["docs/analysis/source-migration-record.md", "docs/analysis/legacy-review.md"]);

async function filesAt(path) {
  const entries = await readdir(path, { withFileTypes: true }).catch(() => null);
  if (!entries) return [path];
  const nested = await Promise.all(entries.map((entry) => filesAt(join(path, entry.name))));
  return nested.flat();
}

const files = (await Promise.all(roots.map(filesAt))).flat();
for (const file of files) {
  if (allowed.has(file)) continue;
  const content = await readFile(file, "utf8").catch(() => "");
  if (forbidden.some((value) => content.includes(value))) {
    throw new Error(`외부 저장소 의존성 발견: ${file}`);
  }
}

console.log("independence validation passed");

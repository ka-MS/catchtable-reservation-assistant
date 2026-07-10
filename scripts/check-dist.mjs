import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "dist/manifest.json",
  "dist/background/index.js",
  "dist/content/index.js",
  "dist/sidepanel/index.js",
  "dist/sidepanel/sidepanel.html",
  "dist/sidepanel/sidepanel.css",
];

await Promise.all(requiredFiles.map((file) => access(file)));

const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest V3가 아닙니다.");
if ("content_scripts" in manifest) throw new Error("상시 Content Script 주입은 허용되지 않습니다.");

const content = await readFile("dist/content/index.js", "utf8");
if (/^\s*import\s/m.test(content)) throw new Error("Content Script 번들에 import가 남았습니다.");

console.log("dist validation passed");

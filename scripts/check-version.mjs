import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const [packageJson, packageLock, manifest] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson("manifest.json"),
]);

const versions = {
  "package.json": packageJson.version,
  "package-lock.json": packageLock.version,
  "package-lock.json packages[\"\"]": packageLock.packages?.[""]?.version,
  "manifest.json": manifest.version,
};

const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size !== 1) {
  throw new Error(
    `버전이 일치하지 않습니다:\n${Object.entries(versions)
      .map(([path, version]) => `- ${path}: ${String(version)}`)
      .join("\n")}`,
  );
}

const version = packageJson.version;
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (typeof version !== "string" || !stableVersion.test(version)) {
  throw new Error(`안정 버전 X.Y.Z 형식이 아닙니다: ${String(version)}`);
}

if (version.split(".").some((part) => Number(part) > 65_535)) {
  throw new Error(`Chrome manifest 숫자 범위를 벗어났습니다: ${version}`);
}

const expectedVersion = process.argv[2];
if (expectedVersion && version !== expectedVersion) {
  throw new Error(
    `릴리스 버전이 일치하지 않습니다: expected=${expectedVersion}, actual=${version}`,
  );
}

console.log(`version validation passed: ${version}`);

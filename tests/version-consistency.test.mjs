import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EXPECTED_VERSION = "0.4.8";
const EXPECTED_ANDROID_VERSION_CODE = 408;

async function readText(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("keeps active Voxyl version metadata aligned", async () => {
  const [
    packageJson,
    packageLock,
    androidGradle,
    workerSource,
    readme,
    docsReadme,
    architecture,
    releaseProcess,
    changelog,
  ] = await Promise.all([
    readText("package.json").then(JSON.parse),
    readText("package-lock.json").then(JSON.parse),
    readText("android/app/build.gradle"),
    readText("workers/api/src/index.ts"),
    readText("README.md"),
    readText("docs/README.md"),
    readText("ARCHITECTURE.md"),
    readText("docs/release-process.md"),
    readText("CHANGELOG.md"),
  ]);

  assert.equal(packageJson.version, EXPECTED_VERSION);
  assert.equal(packageLock.version, EXPECTED_VERSION);
  assert.equal(packageLock.packages[""].version, EXPECTED_VERSION);
  assert.match(androidGradle, /versionName "0\.4\.8"/);
  assert.match(androidGradle, new RegExp(`versionCode ${EXPECTED_ANDROID_VERSION_CODE}\\b`));
  assert.match(workerSource, /version: "0\.4\.8"/);
  assert.match(workerSource, /Voxyl\/0\.4\.8 \(\+https:\/\/v\.renbrant\.com\)/);
  assert.match(workerSource, /Voxyl\/0\.4\.8 RSS Fetcher/);
  assert.match(readme, /\*\*Voxyl 0\.4\.8 — Beta\*\*/);
  assert.match(docsReadme, /\*\*v0\.4\.8\*\* as the latest Android release/);
  assert.match(architecture, /Voxyl 0\.4\.8\r?\nversionCode 408/);
  assert.match(releaseProcess, /Voxyl v0\.4\.8\r?\nsource commit/);
  assert.ok(
    changelog.indexOf("## v0.4.8") < changelog.indexOf("## v0.4.7"),
    "v0.4.8 must be the newest changelog entry",
  );
});

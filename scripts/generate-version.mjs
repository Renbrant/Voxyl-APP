import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(
  readFileSync(resolve(projectRoot, "package.json"), "utf8")
);

function readGit(args, fallback = "unknown") {
  try {
    return execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
}

const fullCommit =
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  readGit(["rev-parse", "HEAD"]);

const branch =
  process.env.CF_PAGES_BRANCH ||
  process.env.GITHUB_REF_NAME ||
  readGit(["rev-parse", "--abbrev-ref", "HEAD"]);

const metadata = {
  app: "voxyl",
  version: packageJson.version,
  git_commit:
    fullCommit === "unknown" ? fullCommit : fullCommit.slice(0, 8),
  git_commit_full: fullCommit,
  branch,
  built_at: new Date().toISOString(),
};

const outputPath = resolve(projectRoot, "dist", "version.json");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(
  outputPath,
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8"
);

console.log(`[version] wrote ${outputPath}`);
console.log(`[version] ${metadata.branch}@${metadata.git_commit}`);

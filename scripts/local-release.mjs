import { execFileSync } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function versionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
    throw new Error(`版本必须为 major.minor.patch：${version}`);
  const parts = version.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error(`版本数字过大：${version}`);
  return parts;
}

export function compareVersions(current, previous) {
  const left = versionParts(current);
  const right = versionParts(previous);
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

export function releaseNotes(changelog, version) {
  const sections = changelog.replace(/\r\n/g, "\n").split(/^## /m).slice(1);
  const matching = sections.filter((section) => section.startsWith(`[${version}] - `));
  if (matching.length !== 1) throw new Error(`${version} 必须有且只有一节版本说明`);
  const [heading, ...body] = matching[0].split("\n");
  if (!/^\[\d+\.\d+\.\d+\] - \d{4}-\d{2}-\d{2}$/.test(heading))
    throw new Error(`${version} 版本标题必须为 ## [版本] - YYYY-MM-DD`);
  const notes = body.join("\n").trim();
  if (!/[\u3400-\u9fff]/u.test(notes)) throw new Error(`${version} 缺少中文版本说明`);
  return notes;
}

export function validateAddon({ directory, manifest, pkg, previous, changelog, changed }) {
  if (manifest.id !== directory || pkg.name !== directory)
    throw new Error(`${directory} 的目录、manifest.id、package.name 必须一致`);
  versionParts(manifest.version);
  if (manifest.version !== pkg.version) throw new Error(`${directory} 的 manifest/package 版本不一致`);
  const notes = releaseNotes(changelog, manifest.version);
  if (previous) {
    const comparison = compareVersions(manifest.version, previous.version);
    if (comparison < 0) throw new Error(`${directory} 版本不能倒退`);
    if (changed && comparison === 0) throw new Error(`${directory} 有变更，必须升级版本`);
    if (comparison === 0) return null;
  }
  return {
    id: directory,
    version: manifest.version,
    tag: `${directory}/v${manifest.version}`,
    artifact: `local/${directory}/dist/${directory}-${manifest.version}.zip`,
    notes,
  };
}

export async function createReleasePlan(base, cwd = process.cwd()) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const json = async (file) => JSON.parse(await readFile(path.join(cwd, file), "utf8"));
  const changed = git("diff", "--name-only", "-z", base, "HEAD").split("\0");
  const previousFiles = new Set(git("ls-tree", "-r", "--name-only", base).split("\n"));
  const rootPkg = "package.json";
  const previousPkg = JSON.parse(git("show", `${base}:${rootPkg}`));
  const currentPkg = await json(rootPkg);
  const dependenciesChanged = ["dependencies", "devDependencies", "pnpm"].some(
    (key) => JSON.stringify(previousPkg[key]) !== JSON.stringify(currentPkg[key]),
  );
  const sharedChanged = dependenciesChanged || changed.some((file) =>
    file.startsWith("packages/") ||
    ["pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".npmrc"].includes(file),
  );
  const releases = [];
  for (const entry of await readdir(path.join(cwd, "local"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = `local/${entry.name}`;
    const manifestPath = `${directory}/manifest.json`;
    const previous = previousFiles.has(manifestPath)
      ? JSON.parse(git("show", `${base}:${manifestPath}`)) : null;
    const release = validateAddon({
      directory: entry.name,
      manifest: await json(manifestPath),
      pkg: await json(`${directory}/package.json`),
      previous,
      changelog: await readFile(path.join(cwd, directory, "CHANGELOG.md"), "utf8"),
      changed: sharedChanged || changed.some((file) => file.startsWith(`${directory}/`)),
    });
    if (release) releases.push(release);
  }
  return { commit: git("rev-parse", "HEAD"), hostCommit: process.env.HOST_SHA, releases };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, output] = process.argv.slice(2);
  if (!base || !output) throw new Error("用法：pnpm validate:local-release <base-sha> <output.json>");
  const plan = await createReleasePlan(base);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
  const versions = plan.releases.map(({ tag }) => tag);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `releases=${JSON.stringify(versions)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `宿主提交：\`${plan.hostCommit}\`\n\n待发布：${versions.join(", ") || "无"}\n`);
  console.log(JSON.stringify(plan, null, 2));
}

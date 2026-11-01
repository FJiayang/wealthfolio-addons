import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { compareVersions, createReleasePlan, releaseNotes, validateAddon } from "./local-release.mjs";
import { publicationAction, publishReleases } from "./publish-local-releases.mjs";

const changelog = "# 版本记录\n\n## [1.1.0] - 2026-11-01\n\n- 新增导入。\n\n## [1.0.0] - 2026-10-01\n\n- 首次发布。\n";
const addon = {
  directory: "example-addon",
  manifest: { id: "example-addon", version: "1.1.0" },
  pkg: { name: "example-addon", version: "1.1.0" },
  previous: { version: "1.0.0" }, changelog, changed: true,
};

test("提取指定版本说明，不包含历史章节", () => {
  assert.equal(releaseNotes(changelog, "1.1.0"), "- 新增导入。");
  assert.throws(() => releaseNotes(changelog, "2.0.0"), /版本说明/);
  assert.throws(() => releaseNotes(changelog + changelog, "1.1.0"), /只有一节/);
  assert.throws(() => releaseNotes("## [1.1.0] - 2026-11-01\n", "1.1.0"), /中文/);
  assert.throws(() => releaseNotes(changelog.replace("2026-11-01", "2026/11/01"), "1.1.0"), /标题/);
});

test("版本递增按数字比较，拒绝不合法版本、倒退、不一致或漏升版", () => {
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(validateAddon(addon).tag, "example-addon/v1.1.0");
  assert.equal(validateAddon({ ...addon, previous: null }).version, "1.1.0");
  assert.equal(validateAddon({ ...addon, previous: { version: "1.1.0" }, changed: false }), null);
  assert.throws(() => validateAddon({ ...addon, previous: { version: "1.1.0" } }), /必须升级/);
  assert.throws(() => validateAddon({ ...addon, previous: { version: "2.0.0" } }), /倒退/);
  assert.throws(() => validateAddon({ ...addon, pkg: { ...addon.pkg, version: "1.0.0" } }), /不一致/);
  assert.throws(() => compareVersions("1.0.0-beta.1", "1.0.0"), /major.minor.patch/);
  assert.throws(() => validateAddon({ ...addon, directory: "other" }), /必须一致/);
});

test("Git 对比识别单插件、共享变更、新增插件及无插件变更", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "local-release-test-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  async function put(file, contents) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await writeFile(path.join(cwd, file), contents);
  }
  async function commit() {
    git("add", ".");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }
  async function putAddon(id, version) {
    await put(`local/${id}/manifest.json`, JSON.stringify({ id, version }));
    await put(`local/${id}/package.json`, JSON.stringify({ name: id, version }));
    await put(`local/${id}/CHANGELOG.md`, changelog);
  }
  try {
    git("init", "-q");
    await put("package.json", "{}");
    await putAddon("one", "1.0.0");
    await putAddon("two", "1.0.0");
    const base = await commit();
    await put("README.md", "documentation");
    await commit();
    assert.deepEqual((await createReleasePlan(base, cwd)).releases, []);
    await put("local/one/src.ts", "changed");
    await commit();
    await assert.rejects(createReleasePlan(base, cwd), /one.*必须升级/);
    await putAddon("one", "1.1.0");
    await commit();
    assert.deepEqual((await createReleasePlan(base, cwd)).releases.map((item) => item.id), ["one"]);
    await put("packages/import-wizard-ui/src.ts", "shared");
    await commit();
    await assert.rejects(createReleasePlan(base, cwd), /two.*必须升级/);
    await putAddon("two", "1.1.0");
    await putAddon("three", "1.1.0");
    await commit();
    assert.equal((await createReleasePlan(base, cwd)).releases.length, 3);
    await put("package.json", JSON.stringify({ devDependencies: { example: "1.0.0" } }));
    const before = git("rev-parse", "HEAD");
    await commit();
    await assert.rejects(createReleasePlan(before, cwd), /必须升级/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("失败保留 draft，重试上传再公开，正式版本不覆盖", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "local-release-publish-test-"));
  const artifact = path.join(cwd, "example.zip");
  await writeFile(artifact, "zip fixture");
  const commit = "a".repeat(40);
  const plan = { commit, hostCommit: "b".repeat(40), releases: [{ ...validateAddon(addon), artifact }] };
  let existing = null;
  const calls = [];
  let failUpload = true;
  const options = {
    async getRelease() { return existing; },
    gh(args) {
      calls.push(args.slice(0, 2).join(" "));
      if (args[1] === "create") existing = { target_commitish: commit, draft: true };
      if (args[1] === "upload" && failUpload) throw new Error("upload failed");
      if (args.includes("--draft=false")) existing.draft = false;
    },
  };
  try {
    await assert.rejects(publishReleases(plan, options), /upload failed/);
    assert.equal(existing.draft, true);
    assert.equal(calls.includes("release edit"), false);
    failUpload = false;
    await publishReleases(plan, options);
    assert.equal(existing.draft, false);
    assert.equal(calls.filter((call) => call === "release create").length, 1);
    const count = calls.length;
    await publishReleases(plan, options);
    assert.equal(calls.length, count);
    assert.throws(() => publicationAction({ target_commitish: "other" }, commit), /其他提交/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function publicationAction(existing, commit) {
  if (!existing) return "create";
  if (existing.target_commitish !== commit)
    throw new Error("已有 Release 指向其他提交，拒绝覆盖");
  return existing.draft ? "resume" : "skip";
}

export async function publishReleases(plan, { getRelease, gh }) {
  if (!/^[a-f0-9]{40}$/.test(plan.commit) || !/^[a-f0-9]{40}$/.test(plan.hostCommit))
    throw new Error("发布计划缺少插件或宿主提交 SHA");
  const temporary = await mkdtemp(path.join(tmpdir(), "local-addon-release-"));
  try {
    for (const release of plan.releases) {
      const action = publicationAction(await getRelease(release.tag), plan.commit);
      if (action === "skip") {
        console.log(`${release.tag} 已公开，跳过`);
        continue;
      }
      await readFile(release.artifact);
      const notes = `${release.notes}\n\n插件提交：\`${plan.commit}\`\n宿主提交：\`${plan.hostCommit}\`\n运行：${process.env.GITHUB_SERVER_URL}/${process.env.GH_REPO}/actions/runs/${process.env.GITHUB_RUN_ID}\n`;
      const notesFile = path.join(temporary, "notes.md");
      await writeFile(notesFile, notes);
      if (action === "create") {
        gh(["release", "create", release.tag, "--draft", "--target", plan.commit,
          "--title", `${release.id} ${release.version}`, "--notes-file", notesFile]);
      } else {
        gh(["release", "edit", release.tag, "--notes-file", notesFile]);
      }
      gh(["release", "upload", release.tag, release.artifact, "--clobber"]);
      gh(["release", "edit", release.tag, "--draft=false", "--latest=false"]);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = JSON.parse(await readFile(process.argv[2], "utf8"));
  await publishReleases(plan, {
    async getRelease(tag) {
      const response = await fetch(`${process.env.GITHUB_API_URL}/repos/${process.env.GH_REPO}/releases/tags/${encodeURIComponent(tag)}`, {
        headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json" },
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`读取 Release 失败：HTTP ${response.status}`);
      return response.json();
    },
    gh(args) { execFileSync("gh", args, { stdio: "inherit" }); },
  });
}

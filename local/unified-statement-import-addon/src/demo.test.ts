import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Activity, ActivityBulkMutationRequest } from "@wealthfolio/addon-sdk";
import { it } from "vitest";
import { parseStatement } from "./parsers";
import { cleanAmount } from "./parsers/decimal";
import { buildPreview, rowKey } from "./import/ledger";
import { mappingKey } from "./import/account-matching";
import { createSubmitter } from "./import/session";
import { account, activity } from "./test-fixtures";

// Real statements and expectations stay local; never snapshot their contents.
it.skipIf(process.env.STATEMENT_DEMO_TESTS !== "1")("本地真实流水：解析、模拟提交与重复导入", async () => {
  const directory = fileURLToPath(new URL("../../../docs/demo/", import.meta.url));
  const files = readdirSync(directory).filter((name) => /\.pdf$|\.csv$/i.test(name));
  assert(files.some((name) => /招商.*\.pdf$/i.test(name)), "缺少本地招商 PDF");
  const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  for (const name of files) {
    const path = join(directory, name);
    const bytes = new Uint8Array(readFileSync(path));
    const document = await parseStatement(bytes, name, { assets: {
      getBlob: async (path) => new Blob([readFileSync(join(pdfRoot, path.replace(/^dist\/assets\/pdf\//, "")))]),
    } });
    assert(document.rows.length > 0, "未解析出明细");
    assert(document.rows.every((row) => !row.error), "真实流水包含解析错误");
    if (/\.pdf$/i.test(name)) {
      const text = execFileSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
      const reference = [...text.matchAll(/^(\d{4}-\d{2}-\d{2})\s+([A-Z]{3})\s+([+-]?[\d,]+\.\d{2})\s+([\d,]+\.\d{2})/gm)];
      assert(reference.length > 0 && reference.length === document.rows.length, "PDF 明细笔数与独立文字提取不一致");
      document.rows.forEach(({ source }, index) => {
        assert(source.originalTime === reference[index][1], "PDF 交易日期不一致");
        assert(source.currency === reference[index][2], "PDF 币种不一致");
        assert(source.signedAmount === cleanAmount(reference[index][3]), "PDF 交易金额不一致");
        assert(source.balance === cleanAmount(reference[index][4]), "PDF 余额不一致");
        assert(source.pageNumber && source.sourceAccount && source.recordId, "PDF 缺少页码或稳定来源身份");
      });
    }
    const accounts = [account()];
    const mappings = Object.fromEntries(document.rows.map((row) => [mappingKey(row.source), "cash"]));
    const decisions = Object.fromEntries(document.rows.map((row) => [rowKey(row), {
      confirmed: true,
      ...(!row.kind || row.identityReason ? { excluded: true } : {}),
    }]));
    const stored: Activity[] = [];
    const host = {
      accounts: { getAll: async () => accounts },
      activities: { getAll: async () => [...stored], saveMany: async ({ creates = [] }: ActivityBulkMutationRequest) => {
        const created = creates.map((create, index) => activity(create, `local-demo-${stored.length + index}`));
        stored.push(...created);
        return { created, updated: [], deleted: [], createdMappings: [], errors: [] };
      } },
    };
    const reviewed = buildPreview(document.rows, accounts, stored, mappings, decisions);
    assert(reviewed.every((entry) => !["error", "review"].includes(entry.status)), "真实流水审核未通过");
    assert(reviewed.some((entry) => entry.status === "ready"), "真实流水没有可模拟导入的明细");
    const submit = createSubmitter(host);
    assert((await submit(document.rows, mappings, decisions, reviewed)).outcome === "success", "真实流水模拟保存失败");
    const repeated = buildPreview(document.rows, accounts, stored, mappings, decisions);
    assert((await submit(document.rows, mappings, decisions, repeated)).outcome === "empty", "重复导入再次写入了账目");
  }
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { FormattingProvider } from "@wealthfolio/ui";
import { account, activity } from "../test-fixtures";
import { parseStatement } from "../parsers";
import { mappingKey } from "../import/account-matching";
import { buildPreview, rowKey } from "../import/ledger";
import { pendingMutations } from "../import/session";
import { isInvestmentCash } from "../import/investments";
import { StatementFinalPreview } from "./statement-final-preview";

async function fixture() {
  const document = await parseStatement(new TextEncoder().encode([
    "记账日期,货币,交易金额,联机余额,交易摘要,对手信息",
    "2025-01-01,CNY,-100.00,900.00,基金申购,虚构基金公司",
    "2025-01-02,CNY,-20.00,880.00,日常消费,虚构商户",
    "2025-01-03,CNY,-5.00,875.00,跳过消费,虚构对方",
  ].join("\n")), "synthetic.csv", { sourceAccount: "synthetic-card" });
  const accounts = [account(), account("fund", "SECURITIES")];
  const mappings = Object.fromEntries(document.rows.map((row) => [mappingKey(row.source), "cash"]));
  const choices = { [rowKey(document.rows[0])]: { investmentTreatment: "transfer" as const, investmentAccountId: "fund" },
    [rowKey(document.rows[2])]: { excluded: true } };
  return { accounts, preview: buildPreview(document.rows, accounts, [], mappings, choices, [], { recognizeInvestments: true }) };
}

it("最终表逐条展示双边转账、普通活动和现有活动更新，排除未提交来源", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { accounts, preview } = await fixture();
  preview[0].creates![0].amount = "100.00123";
  const existing = activity(preview[1].create!, "existing");
  existing.quantity = "10";
  preview[0].updates = [{ id: existing.id, accountId: existing.accountId, activityType: existing.activityType,
    activityDate: existing.activityDate, currency: existing.currency, amount: "0.00", metadata: existing.metadata }];
  const expected = pendingMutations(preview);
  expect(expected.creates).toHaveLength(3);
  expect(expected.updates).toHaveLength(1);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FormattingProvider locale="zh-CN" timezone="Asia/Shanghai">
      <StatementFinalPreview preview={preview} accounts={accounts} activities={[existing]} />
    </FormattingProvider>));
    expect(container.textContent).toContain("新增 3 条 · 更新 1 条");
    const rows = [...container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')];
    expect(rows).toHaveLength(expected.creates.length + expected.updates.length);
    expect(rows[0].textContent).toContain("转出");
    expect(rows[0].textContent).toContain("cash");
    expect(rows[1].textContent).toContain("转入");
    expect(rows[1].textContent).toContain("fund");
    expect(rows[2].textContent).toContain("支出");
    expect(rows[3].textContent).toContain("更新");
    expect(rows[3].querySelectorAll("td")[4].textContent).toBe("0.00");
    expect(rows[3].textContent).toContain("10（保留）");
    expect(container.textContent).not.toContain("跳过消费");
    const trigger = rows[0].querySelector<HTMLElement>('[data-slot="accordion-trigger"]')!;
    await act(async () => trigger.click());
    expect(rows[0].textContent).toContain("基金申购");
    expect(rows[0].textContent).toContain("synthetic-card");
    expect(rows[0].textContent).toContain("实际提交金额：100.00123 CNY");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it("拟导入活动每页最多 50 条且可逐页查看末尾活动", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { accounts, preview } = await fixture();
  const create = preview[1].create!;
  preview[1].creates = Array.from({ length: 123 }, (_, index) => ({ ...create, comment: `synthetic-${index}` }));
  preview[0].creates = [];
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FormattingProvider locale="zh-CN"><StatementFinalPreview preview={preview} accounts={accounts} activities={[]} /></FormattingProvider>));
    expect(container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')).toHaveLength(50);
    expect(container.textContent).toContain("第 1–50 条，共 123 条");
    expect(container.textContent).toContain("synthetic-0");
    const scroller = container.querySelector<HTMLElement>('[aria-label="拟导入活动明细"]')!.parentElement!;
    scroller.scrollTop = 200;
    await act(async () => container.querySelector<HTMLElement>('[aria-label="下一页拟导入活动"]')!.click());
    expect(scroller.scrollTop).toBe(0);
    expect(container.textContent).toContain("第 51–100 条，共 123 条");
    expect(container.textContent).toContain("synthetic-50");
    await act(async () => container.querySelector<HTMLElement>('[aria-label="下一页拟导入活动"]')!.click());
    expect(container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')).toHaveLength(23);
    expect(container.textContent).toContain("synthetic-122");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="下一页拟导入活动"]')!.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});

it.skipIf(!process.env.STATEMENT_COMPOSITE_PDF)("本地 PDF 的投资流水在最终确认页逐条展示", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  const doc = await parseStatement(new Uint8Array(readFileSync(process.env.STATEMENT_COMPOSITE_PDF!)), "local.pdf", {
    sourceAccount: "local-demo-source", assets: { getBlob: async (path) => new Blob([readFileSync(join(pdfRoot, path.replace(/^dist\/assets\/pdf\//, "")))]) },
  });
  const rows = doc.rows.filter((row) => row.source.compositeBaseId && isInvestmentCash(row));
  const accounts = [account(), account("fund", "SECURITIES")];
  const mappings = Object.fromEntries(rows.map((row) => [mappingKey(row.source), "cash"]));
  const choices = Object.fromEntries(rows.map((row) => [rowKey(row), { investmentTreatment: "transfer" as const, investmentAccountId: "fund", confirmed: true }]));
  const preview = buildPreview(rows, accounts, [], mappings, choices, [], { recognizeInvestments: true });
  expect(preview.every((entry) => entry.status === "ready" && entry.creates?.length === 2)).toBe(true);
  const count = pendingMutations(preview).creates.length;
  expect(count).toBeGreaterThan(100);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<FormattingProvider locale="zh-CN"><StatementFinalPreview preview={preview} accounts={accounts} activities={[]} /></FormattingProvider>));
    expect(container.textContent).toContain(`新增 ${count} 条 · 更新 0 条`);
    expect(container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')).toHaveLength(50);
    await act(async () => container.querySelector<HTMLElement>('[aria-label="下一页拟导入活动"]')!.click());
    expect(container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')).toHaveLength(50);
    await act(async () => container.querySelector<HTMLElement>('[aria-label="下一页拟导入活动"]')!.click());
    expect(container.querySelectorAll('[aria-label="拟导入活动明细"] tbody tr')).toHaveLength(count - 100);
  } finally { await act(async () => root.unmount()); container.remove(); }
}, 30_000);

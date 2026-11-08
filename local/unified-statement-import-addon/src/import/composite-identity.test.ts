import { describe, expect, it } from "vitest";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { parseStatement, parseStatementSync } from "../parsers";
import type { StatementRow } from "../parsers/types";
import { mappingKey } from "./account-matching";
import { buildPreview, METADATA_KEY, rowKey, sourceKey, type Decisions, type ExistingActivity } from "./ledger";
import { createSubmitter } from "./session";
import type { ActivityBulkMutationRequest } from "@wealthfolio/addon-sdk";

const header = "记账日期,货币,交易金额,联机余额,交易摘要,对手信息";
const transactions = [
  "2025-01-01,CNY,100.00,100.00,朝朝宝转出,虚构理财",
  "2025-01-01,CNY,-100.00,0.00,一网通支付,虚构基金公司",
  "2025-01-01,CNY,100.00,100.00,朝朝宝转出,虚构理财",
  "2025-01-01,CNY,-100.00,0.00,一网通支付,虚构基金公司",
];
const accounts = [account(), account("wealth", "SECURITIES"), account("fund", "SECURITIES")];
const options = { recognizeInvestments: true };
async function parse(lines = transactions, name = "bank.csv", sourceAccount = "card") {
  return (await parseStatement(new TextEncoder().encode([header, ...lines].join("\n")), name, { sourceAccount })).rows;
}
function decisions(rows: StatementRow[]): Decisions {
  return Object.fromEntries(rows.map((row) => [rowKey(row), { investmentTreatment: "transfer", investmentAccountId: row.source.direction === "收入" ? "wealth" : "fund" }]));
}
function preview(rows: StatementRow[], activities: ExistingActivity[] = [], choices = decisions(rows)) {
  return buildPreview(rows, accounts, activities, Object.fromEntries(rows.map((row) => [mappingKey(row.source), "cash"])), choices, [], options);
}
function save(rows: ReturnType<typeof preview>) {
  return rows.flatMap((entry) => entry.creates ?? []).map((create, index) => ({ ...activity(create, `saved-${index}`), sourceGroupId: create.sourceGroupId }));
}

describe("复合来源身份与余额链", () => {
  it("余额连续时同内容多次出现各自生成双边转账，重新导入及改名仍去重", async () => {
    const rows = await parse();
    expect(rows.every((row) => !!row.source.compositeBaseId)).toBe(true);
    expect(new Set(rows.map((row) => sourceKey(row.source))).size).toBe(4);
    const entries = preview(rows);
    expect(entries.map((entry) => entry.status)).toEqual(["ready", "ready", "ready", "ready"]);
    expect(entries.flatMap((entry) => entry.creates ?? []).map((create) => [create.accountId, create.activityType])).toEqual([
      ["cash", "TRANSFER_IN"], ["wealth", "TRANSFER_OUT"], ["cash", "TRANSFER_OUT"], ["fund", "TRANSFER_IN"],
      ["cash", "TRANSFER_IN"], ["wealth", "TRANSFER_OUT"], ["cash", "TRANSFER_OUT"], ["fund", "TRANSFER_IN"],
    ]);
    expect(new Set(entries.map((entry) => entry.creates![0].sourceGroupId)).size).toBe(4);
    const renamed = await parse(transactions, "renamed.csv");
    expect(renamed.map((row) => row.source.recordId)).toEqual(rows.map((row) => row.source.recordId));
    expect(preview(renamed, save(entries)).map((entry) => entry.status)).toEqual(["duplicate", "duplicate", "duplicate", "duplicate"]);
  });
  it("余额链倒序同样可识别；断链、缺失余额及币种不同时不放行", async () => {
    expect((await parse([...transactions].reverse())).every((row) => !!row.source.compositeBaseId)).toBe(true);
    for (const lines of [
      [transactions[0], transactions[1].replace("0.00,一网通", "9.00,一网通"), ...transactions.slice(2)],
      [transactions[0], transactions[1].replace("0.00,一网通", ",一网通"), ...transactions.slice(2)],
      [transactions[0], transactions[1].replace("CNY", "USD"), ...transactions.slice(2)],
    ]) {
      const rows = await parse(lines);
      expect(rows[0].source.compositeBaseId).toBeUndefined();
      expect(preview(rows)[0]).toMatchObject({ status: "review", reason: expect.stringContaining("复合身份") });
    }
  });
  it("其他渠道的余额流水使用相同身份规则", async () => {
    const text = ["Date,Transaction Description,Withdrawals,Deposits,Balance",
      "01/01/2025,CREDIT,,100.00,100.00", "01/01/2025,PAYMENT,100.00,,0.00",
      "01/01/2025,CREDIT,,100.00,100.00", "01/01/2025,PAYMENT,100.00,,0.00"].join("\n");
    const rows = (await parseStatement(new TextEncoder().encode(text), "td.csv", { channel: "td", currency: "CNY", sourceAccount: "card" })).rows;
    expect(rows.every((row) => row.source.system === "td" && !!row.source.compositeBaseId)).toBe(true);
    expect(new Set(rows.map((row) => sourceKey(row.source))).size).toBe(4);
    const paymentSource = { ...rows[0].source, system: "wechat" };
    expect(sourceKey(paymentSource)).not.toBe(sourceKey({ ...paymentSource, sourceAccount: "other-card" }));
    const compositeSource = { ...paymentSource, recordId: paymentSource.compositeBaseId! };
    expect(sourceKey(compositeSource)).not.toBe(sourceKey({ ...compositeSource, sourceAccount: "other-card" }));
    const originalOrder = { ...paymentSource, recordId: "ordinary-platform-order" };
    expect(sourceKey(originalOrder)).toBe(sourceKey({ ...originalOrder, sourceAccount: "other-card" }));
  });
  it("同文件多账户流水分别验证余额链，不互相冲突", async () => {
    const text = [header + ",本方账号", `${transactions[0]},card-a`,
      "2025-01-01,CNY,20.00,20.00,其他收入,其他对方,card-b",
      `${transactions[1]},card-a`, `${transactions[2]},card-a`, `${transactions[3]},card-a`].join("\n");
    const rows = (await parseStatement(new TextEncoder().encode(text), "multi-account.csv")).rows;
    const target = rows.filter((row) => row.source.sourceAccount === "card-a");
    expect(target).toHaveLength(4);
    expect(target.every((row) => !!row.source.compositeBaseId)).toBe(true);
    expect(rows.find((row) => row.source.sourceAccount === "card-b")?.source.compositeBaseId).toBeUndefined();
  });
  it("有历史记录的不同文件要求明确处理，来源账户隔离并保留旧版记录", async () => {
    const original = await parse();
    const stored = save(preview(original));
    const revised = await parse([...transactions, "2025-01-02,CNY,1.00,1.00,普通收入,虚构对方"], "overlap.csv");
    let entries = preview(revised, stored);
    expect(entries.slice(0, 4).every((entry) => entry.identityConflict?.historicalCount === 2)).toBe(true);
    const choices = decisions(revised);
    for (const entry of entries.slice(0, 4)) choices[rowKey(entry.row)].identityNewFor = entry.identityConflict!.signature;
    entries = preview(revised, stored, choices);
    expect(entries.slice(0, 4).every((entry) => entry.status === "ready")).toBe(true);
    const otherCard = await parse(transactions, "other.csv", "other-card");
    expect(preview(otherCard, stored).every((entry) => entry.status === "ready")).toBe(true);
    const legacy = structuredClone(stored[0]);
    const metadata = legacy.metadata![METADATA_KEY] as { sources: StatementRow["source"][] };
    const source = metadata.sources[0];
    source.recordId = source.compositeBaseId!;
    delete source.compositeBaseId; delete source.compositeDocumentDigest; delete source.compositeOccurrence; delete source.statementDigest;
    expect(preview(original, [legacy])[0].identityConflict?.historicalCount).toBe(1);
  });
  it("单笔重叠文件选择新流水后重导仍能识别已保存来源", async () => {
    const rows = await parse();
    const stored = save(preview(rows));
    const single = await parse([transactions[0]], "partial.csv");
    const choices = decisions(single);
    const conflict = preview(single, stored, choices)[0];
    expect(conflict.identityConflict?.historicalCount).toBe(2);
    choices[rowKey(single[0])].identityNewFor = conflict.identityConflict!.signature;
    const added = preview(single, stored, choices);
    expect(added[0].status).toBe("ready");
    expect(added[0].row.source.compositeOccurrence).toBe(1);
    expect(preview(single, [...stored, ...save(added)])[0].status).toBe("duplicate");
  });
  it("同批不同文件的重叠多笔流水要求核对，相同文件改名仍查重", async () => {
    const original = await parse();
    const same = await parse(transactions, "copy.csv");
    expect(preview([...original, ...same]).map((entry) => entry.status)).toEqual([
      "ready", "ready", "ready", "ready", "duplicate", "duplicate", "duplicate", "duplicate",
    ]);
    const other = await parse([...transactions, "2025-01-02,CNY,1.00,1.00,普通收入,虚构对方"], "other.csv");
    expect(preview([...original, ...other]).filter((entry) => entry.identityConflict)).toHaveLength(8);
  });
  it("不同文件中的单笔相同复合来源也不静默丢失，包括旧版无摘要来源", async () => {
    const original = await parse([transactions[0]], "single.csv");
    const stored = save(preview(original));
    expect(preview(await parse([transactions[0]], "renamed.csv"), stored)[0].status).toBe("duplicate");
    const other = await parse([transactions[0], "2025-01-02,CNY,1.00,101.00,普通收入,其他对方"], "other.csv");
    expect(preview(other, stored)[0].identityConflict?.historicalCount).toBe(1);
    const legacy = structuredClone(stored[0]);
    const source = (legacy.metadata![METADATA_KEY] as { sources: StatementRow["source"][] }).sources[0];
    delete source.statementDigest;
    const choice = decisions(original);
    choice[rowKey(original[0])].confirmed = true;
    const conflict = preview(original, [legacy], choice)[0];
    expect(conflict.identityConflict?.historicalCount).toBe(1);
    choice[rowKey(original[0])].identityNewFor = conflict.identityConflict!.signature;
    const added = preview(original, [legacy], choice);
    expect(added[0].status).toBe("ready");
    expect(preview(original, [legacy, ...save(added)])[0].status).toBe("duplicate");
  });
  it("损坏的复合来源扩展信息阻断导入", async () => {
    const rows = await parse();
    const broken = structuredClone(save(preview(rows))[0]);
    const source = (broken.metadata![METADATA_KEY] as { sources: StatementRow["source"][] }).sources[0];
    source.statementDigest = "f".repeat(64);
    expect(() => preview(rows, [broken])).toThrow("已有账目的导入来源信息不完整");
  });
  it("跨渠道投资资金仅在双方候选唯一时合并来源，多候选保留独立流水", async () => {
    const lines = transactions.map((line) => line.replace("一网通支付,虚构基金公司", "基金申购,天天基金"));
    const bankRows = (await parse(lines)).filter((row) => row.source.direction === "支出");
    const payment = parseStatementSync(new TextEncoder().encode([HEADER, csvRow({ id: "payment", direction: "支出", description: "基金申购" })].join("\n")), "payment.csv").rows[0];
    payment.rowId = JSON.stringify(["payment", "CSV", 2]);
    Object.assign(payment.source, { date: bankRows[0].source.date, originalTime: bankRows[0].source.originalTime,
      datePrecision: "date", amount: "100.00", merchant: "天天基金", paymentMethod: "银行卡", fee: undefined });
    const unique = preview([bankRows[0], payment]);
    expect(unique[0].creates).toHaveLength(2);
    expect(unique[1].creates).toHaveLength(0);
    expect(unique[1].reason).toContain("不重复生成转账");
    const ambiguous = preview([...bankRows, payment]);
    expect(ambiguous.every((entry) => entry.creates?.length === 2)).toBe(true);
    expect(ambiguous.every((entry) => !entry.reason.includes("不重复生成转账"))).toBe(true);
  });
  it.each([0, 1])("只保存第 %i 腿后安全补齐另一腿，已修改时阻断", async (savedIndex) => {
    const rows = await parse();
    const entries = preview(rows);
    const created = entries[0].creates!;
    const persisted = { ...activity(created[savedIndex], "partial"), sourceGroupId: created[savedIndex].sourceGroupId };
    const existingMetadata = persisted.metadata![METADATA_KEY] as { investment: { noLink?: boolean; ignoredPeers?: string[] } };
    existingMetadata.investment.noLink = true;
    existingMetadata.investment.ignoredPeers = ["previous-peer"];
    const recovered = preview(rows, [persisted])[0];
    expect(recovered.status).toBe("ready");
    expect(recovered.creates).toHaveLength(1);
    expect(recovered.creates![0].accountId).toBe(created[1 - savedIndex].accountId);
    expect(recovered.creates![0].sourceGroupId).toBe(persisted.sourceGroupId);
    expect((recovered.creates![0].metadata as Record<string, { investment: unknown }>)[METADATA_KEY].investment)
      .toMatchObject({ noLink: true, ignoredPeers: ["previous-peer"] });
    const edited = { ...persisted, amount: "17.00" };
    expect(preview(rows, [edited])[0]).toMatchObject({ status: "review", reason: expect.stringContaining("不一致") });
  });
  it("部分保存后重试只创建缺失活动，并可再次查重", async () => {
    const rows = await parse();
    const mappings = Object.fromEntries(rows.map((row) => [mappingKey(row.source), "cash"]));
    const choices = decisions(rows);
    const stored: ExistingActivity[] = [];
    let first = true;
    const submit = createSubmitter({ accounts: { getAll: async () => accounts }, activities: {
      getAll: async () => stored,
      saveMany: async ({ creates = [] }: ActivityBulkMutationRequest) => {
        const selected = first ? creates.slice(0, 1) : creates;
        const created = selected.map((create, index) => ({ ...activity(create, `partial-${stored.length + index}`), sourceGroupId: create.sourceGroupId }));
        stored.push(...created);
        const errors = first ? [{ action: "create", message: "synthetic failure" }] : [];
        first = false;
        return { created, updated: [], deleted: [], createdMappings: [], errors };
      },
    } });
    const partial = await submit(rows, mappings, choices, preview(rows), [], options);
    expect(partial.outcome).toBe("partial");
    expect(partial.preview[0].creates).toHaveLength(1);
    const recovered = await submit(rows, mappings, choices, partial.preview, [], options);
    expect(recovered.outcome).toBe("success");
    expect(stored).toHaveLength(8);
    expect(preview(rows, stored).every((entry) => entry.status === "duplicate")).toBe(true);
  });
});

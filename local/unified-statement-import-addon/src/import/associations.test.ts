import type { Activity, ActivityBulkMutationRequest } from "@wealthfolio/addon-sdk";
import { describe, expect, it, vi } from "vitest";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { parseStatementSync } from "../parsers";
import type { StatementRow } from "../parsers/types";
import { add } from "../parsers/decimal";
import { mappingKey } from "./account-matching";
import { buildPreview, METADATA_KEY, rowKey, sourceKey, type Decisions } from "./ledger";
import { cancelSavedAssociation, savedAssociations } from "./associations";
import { createSubmitter } from "./session";

function row(system: string, id = system): StatementRow {
  const value = parseStatementSync(new TextEncoder().encode([HEADER, csvRow()].join("\n")), "synthetic.csv").rows[0];
  return { ...value, rowId: JSON.stringify(["synthetic", system, id]), kind: "expense", source: {
    ...value.source, system, recordId: id, sourceAccount: system === "cmb" ? "synthetic-bank" : "",
    amount: "10.00", date: "2025-01-01T04:00:00.000Z", originalTime: "2025-01-01 12:00:00",
    datePrecision: "datetime", direction: "支出", status: "交易成功", paymentMethod: "招商银行(1234)",
    txType: "消费", description: "合成商品", fee: undefined,
  } };
}
const pair = () => [row("alipay"), row("cmb")];
const accounts = [account(), { ...account(), id: "other", name: "其他账户" }];
const mappings = (rows: StatementRow[]) => Object.fromEntries(rows.map(({ source }) => [mappingKey(source), "cash"]));
const preview = (rows: StatementRow[], stored: Activity[] = [], decisions: Decisions = {}) => buildPreview(rows, accounts, stored, mappings(rows), decisions);
function host(initial: Activity[] = []) {
  const stored = [...initial];
  const apply = ({ creates = [], updates = [] }: ActivityBulkMutationRequest) => {
    const created = creates.map((value, i) => activity(value, `new-${stored.length + i}`));
    const updated = updates.map((value) => {
      const index = stored.findIndex(({ id }) => id === value.id);
      const current = stored[index];
      stored[index] = { ...current, ...value, metadata: { ...current.metadata, ...(value.metadata as Record<string, unknown>) } } as Activity;
      return stored[index];
    });
    stored.push(...created);
    return { created, updated, deleted: [], createdMappings: [], errors: [] };
  };
  const saveMany = vi.fn(async (request: ActivityBulkMutationRequest) => apply(request));
  const api = { accounts: { getAll: async () => accounts }, activities: { getAll: async () => [...stored], saveMany } };
  return { stored, apply, api, submit: createSubmitter(api), saveMany };
}

describe("银行与三方消费自动关联", () => {
  it("保留两条来源，只计算一次实际扣款，并允许 JD/美团/微信", () => {
    for (const system of ["alipay", "wechat", "jd", "mt"]) {
      const rows = [row(system), row("cmb")];
      const entries = preview(rows);
      expect(entries.map(({ amount }) => amount)).toEqual(["0.00", "10.00"]);
      expect(entries.map(({ row }) => row.source.amount)).toEqual(["10.00", "10.00"]);
      expect(entries[0].association).toMatchObject({ role: "payment", peerSourceKey: sourceKey(rows[1].source) });
      expect(entries[1].association).toMatchObject({ role: "bank", peerSourceKey: sourceKey(rows[0].source) });
      expect(entries.reduce((sum, entry) => add(sum, String(entry.create!.amount)), "0")).toBe("10.00");
    }
  });
  it.each([[299_999, true], [300_000, true], [300_001, false]])("时间边界 %i 毫秒", (offset, linked) => {
    const rows = pair(); rows[1].source.date = new Date(new Date(rows[0].source.date).getTime() + offset).toISOString();
    expect(Boolean(preview(rows)[0].association)).toBe(linked);
  });
  it("日期型按账单本地同日匹配，不跨日", () => {
    const rows = pair();
    rows[0].source.date = "2025-01-01T16:01:00.000Z"; rows[0].source.originalTime = "2025-01-02 00:01:00";
    Object.assign(rows[1].source, { date: "2025-01-02T04:00:00.000Z", originalTime: "2025-01-02", datePrecision: "date" });
    expect(preview(rows)[0].association).toBeDefined();
    rows[1].source.originalTime = "2025-01-03";
    expect(preview(rows)[0].association).toBeUndefined();
  });
  it("账户、币种、钱包、退款、投资和手续费不误配", () => {
    for (const change of [
      (rows: StatementRow[]) => { rows[1].source.currency = "USD"; },
      (rows: StatementRow[]) => { rows[0].source.paymentMethod = "微信零钱"; },
      (rows: StatementRow[]) => { rows[0].kind = "refund"; },
      (rows: StatementRow[]) => { rows[1].source.description = "基金申购"; },
      (rows: StatementRow[]) => { rows[1].transfer = true; },
      (rows: StatementRow[]) => { rows[0].source.fee = "1.00"; },
    ]) { const rows = pair(); change(rows); expect(preview(rows).some((entry) => entry.association)).toBe(false); }
    const rows = pair();
    expect(preview(rows, [], { [rowKey(rows[1])]: { accountId: "other" } }).some((entry) => entry.association)).toBe(false);
  });
  it("任一方多候选都不关联，不能以最近时间猜测", () => {
    for (const rows of [[...pair(), row("cmb", "second-bank")], [...pair(), row("wechat")]]) {
      const entries = preview(rows);
      expect(entries.every((entry) => !entry.association)).toBe(true);
      expect(entries.some((entry) => entry.reason.includes("多笔"))).toBe(true);
    }
  });
  it("普通零金额仍阻断", () => {
    const rows = pair(); rows[0].source.amount = "0.00";
    expect(preview(rows)[0]).toMatchObject({ status: "review", reason: "零金额记录不提交" });
  });
  it("本次取消后正常记账，并持久化双方的取消选择", () => {
    const rows = pair();
    const entries = preview(rows, [], { [rowKey(rows[0])]: { cancelledAssociations: [sourceKey(rows[1].source)] } });
    expect(entries.map(({ amount }) => amount)).toEqual(["10.00", "10.00"]);
    const stored = entries.map((entry, i) => activity(entry.create!, String(i)));
    expect(preview(rows, stored).every((entry) => !entry.association)).toBe(true);
  });
  it.each([0, 1])("先保存第 %i 条，第二次导入同一次批量事务补齐关联", async (first) => {
    const rows = pair(); const initial = activity(preview([rows[first]])[0].create!, "existing");
    initial.notes = "人工备注"; initial.metadata = { ...initial.metadata, unrelated: { keep: true } };
    const mock = host([initial]);
    const next = [rows[1 - first]];
    const result = await mock.submit(next, mappings(next), {}, preview(next, mock.stored));
    expect(result).toMatchObject({ outcome: "success", created: 1, updated: 1 });
    expect(mock.saveMany).toHaveBeenCalledTimes(1);
    expect(mock.saveMany.mock.calls[0][0].updates).toHaveLength(1);
    expect(mock.stored.reduce((sum, entry) => add(sum, String(entry.amount)), "0")).toBe("10.00");
    expect(mock.stored.find(({ id }) => id === "existing")).toMatchObject({ notes: "人工备注", metadata: { unrelated: { keep: true } } });
    expect(savedAssociations(mock.stored)[0].changed).toBe(false);
  });
  it.each([{ amount: "9.00" }, { accountId: "other" }, { activityDate: "2025-01-02T04:00:00.000Z" }])("历史人工修改不覆盖：%j", (change) => {
    const rows = pair();
    const existing = { ...activity(preview([rows[0]])[0].create!, "edited"), ...change } as Activity;
    const entries = preview([rows[1]], [existing]);
    expect(entries[0].association).toBeUndefined();
    expect(entries[0].updates).toBeUndefined();
  });
  it("取消已保存关联恢复原额，再次上传不重新关联", async () => {
    const rows = pair(); const mock = host();
    await mock.submit(rows, mappings(rows), {}, preview(rows));
    const linked = savedAssociations(mock.stored)[0];
    const updates = cancelSavedAssociation(mock.stored, linked.activity.id);
    expect(updates).toHaveLength(2);
    mock.apply({ updates });
    expect(savedAssociations(mock.stored)).toHaveLength(0);
    expect(mock.stored.map(({ amount }) => amount)).toEqual(["10.00", "10.00"]);
    expect(preview(rows, mock.stored).every((entry) => !entry.association)).toBe(true);
  });
  it("取消关联保留之后的人工金额修改；对方已删除仍可解除", () => {
    const rows = pair(); const stored = preview(rows).map((entry, i) => activity(entry.create!, String(i)));
    stored[0].amount = "7.00";
    expect(cancelSavedAssociation(stored, "0")[0].amount).toBe("7.00");
    expect(cancelSavedAssociation([stored[0]], "0")).toHaveLength(1);
  });
  it("取消关联不把原币金额写入人工修改后的币种或账户", () => {
    for (const changed of [{ currency: "USD" }, { accountId: "other" }]) {
      const rows = pair(); const stored = preview(rows).map((entry, i) => activity(entry.create!, String(i)));
      Object.assign(stored[0], changed);
      expect(cancelSavedAssociation(stored, "0")[0]).toMatchObject({ ...changed, amount: "0.00" });
    }
  });
  it("旧数据关联字段损坏时停止，不静默丢弃", () => {
    const rows = pair(); const stored = preview(rows).map((entry, i) => activity(entry.create!, String(i)));
    (stored[0].metadata![METADATA_KEY] as { association: unknown }).association = { role: "payment" };
    expect(() => preview(rows, stored)).toThrow("关联信息不完整");
  });
  it("历史金额变化会使已审核预览失效", async () => {
    const rows = pair(); const initial = activity(preview([rows[0]])[0].create!, "existing");
    const mock = host([initial]); const next = [rows[1]]; const reviewed = preview(next, mock.stored);
    mock.stored[0].amount = "9.00";
    expect((await mock.submit(next, mappings(next), {}, reviewed)).outcome).toBe("changed");
    expect(mock.saveMany).not.toHaveBeenCalled();
  });
  it("本次取消提交后，同一会话重试不重复更新取消状态", async () => {
    const rows = pair();
    const initial = activity(preview([rows[0]])[0].create!, "existing");
    const mock = host([initial]);
    const decisions = { [rowKey(rows[1])]: { cancelledAssociations: [sourceKey(rows[0].source)] } };
    const reviewed = preview([rows[1]], mock.stored, decisions);
    expect((await mock.submit([rows[1]], mappings([rows[1]]), decisions, reviewed)).outcome).toBe("success");
    const refreshed = preview([rows[1]], mock.stored, decisions);
    expect((await mock.submit([rows[1]], mappings([rows[1]]), decisions, refreshed)).outcome).toBe("empty");
    expect(mock.saveMany).toHaveBeenCalledTimes(1);
  });
  it("保存失败不归零，响应丢失后按已存关联恢复且不重复写入", async () => {
    const rows = pair(); const initial = activity(preview([rows[0]])[0].create!, "existing");
    const mock = host([initial]); const next = [rows[1]]; const reviewed = preview(next, mock.stored);
    mock.saveMany.mockRejectedValueOnce(new Error("failed"));
    expect((await mock.submit(next, mappings(next), {}, reviewed)).outcome).toBe("uncertain");
    expect(mock.stored[0].amount).toBe("10.00");
    mock.saveMany.mockImplementationOnce(async (request) => { mock.apply(request); throw new Error("lost response"); });
    const result = await mock.submit(next, mappings(next), {}, reviewed);
    expect(result.outcome).toBe("uncertain");
    expect(result.preview.every((entry) => entry.status === "duplicate")).toBe(true);
    expect((await mock.submit(next, mappings(next), {}, result.preview)).outcome).toBe("empty");
    expect(mock.saveMany).toHaveBeenCalledTimes(2);
  });
});

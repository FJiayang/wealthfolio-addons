import { describe, expect, it } from "vitest";
import type { Activity, ActivityBulkMutationRequest, ActivityCreate } from "@wealthfolio/addon-sdk";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { parseStatement, parseStatementSync } from "../parsers";
import type { StatementRow } from "../parsers/types";
import { buildPreview, rowKey, type Decisions, type ExistingActivity } from "./ledger";
import { cancelInvestmentLink, investmentNodes, investmentSignature, legKey, linkSavedInvestment } from "./investments";
import { createSubmitter } from "./session";
import { mappingKey } from "./account-matching";

const accounts = [account(), account("fund", "SECURITIES")];
const options = { recognizeInvestments: true };
function fund(id = "202601010001"): StatementRow {
  const csv = ["date,symbol,quantity,activityType,unitPrice,currency,fee,tax,amount,account,comment",
    `2026-01-03,000032,10,BUY,9.9,CNY,1,0,100,fund,合成基金；用户买入；订单号：${id}`].join("\n");
  const row = parseStatementSync(new TextEncoder().encode(csv), "synthetic-fund.csv").rows[0];
  row.rowId = "fund-" + id;
  return row;
}
function bank(id = "bank-1"): StatementRow {
  const row = parseStatementSync(new TextEncoder().encode([HEADER, csvRow()].join("\n")), "synthetic-bank.csv").rows[0];
  row.rowId = id;
  Object.assign(row.source, { system: "cmb", sourceAccount: "synthetic-card", recordId: id,
    amount: "100", currency: "CNY", originalTime: "2026-01-01", date: "2025-12-31T16:00:00Z",
    datePrecision: "date", direction: "支出", merchant: "蚂蚁基金销售有限公司", description: "基金申购",
    paymentMethod: "cash", fee: undefined });
  return row;
}
function decisions(rows: StatementRow[]): Decisions {
  return Object.fromEntries(rows.map((row) => {
    const legs = row.source.investment?.legs;
    const assets = legs ? Object.fromEntries(legs.map((leg) => [legKey(leg), { id: "asset-" + leg.code, symbol: leg.code }])) : undefined;
    return [rowKey(row), legs ? { fundAssets: assets, fundChecked: investmentSignature(legs, "fund", assets) }
      : { confirmed: true, investmentAccountId: "fund" }];
  }));
}
function preview(rows: StatementRow[], stored: ExistingActivity[] = [], changes = decisions(rows)) {
  return buildPreview(rows, accounts, stored, Object.fromEntries(rows.map((row) => [mappingKey(row.source), row.source.investment ? "fund" : "cash"])), changes, [], options);
}
function saved(create: ActivityCreate, id: string): Activity & { assetSymbol?: string } {
  return { ...activity(create, id), assetId: create.asset?.id, assetSymbol: create.asset?.symbol,
    quantity: create.quantity == null ? null : String(create.quantity), unitPrice: create.unitPrice == null ? null : String(create.unitPrice),
    fee: String(create.fee ?? "0"), tax: String(create.tax ?? "0"), sourceGroupId: create.sourceGroupId };
}
function host() {
  const stored: (Activity & { assetSymbol?: string })[] = [];
  const api = { accounts: { getAll: async () => accounts }, activities: { getAll: async () => [...stored],
    saveMany: async ({ creates = [], updates = [] }: ActivityBulkMutationRequest) => {
      const created = creates.map((create, index) => saved(create, "saved-" + (stored.length + index)));
      const updated = updates.map((update) => {
        const index = stored.findIndex((activity) => activity.id === update.id);
        stored[index] = { ...stored[index], ...update, metadata: { ...stored[index].metadata, ...(update.metadata as Record<string, unknown>) } } as Activity;
        return stored[index];
      });
      stored.push(...created);
      return { created, updated, errors: [], deleted: [], createdMappings: [] };
    } } };
  return { stored, api, submit: createSubmitter(api) };
}

describe("投资资金及基金交易", () => {
  it("默认不开启投资识别，也不生成基金活动", () => {
    const row = fund();
    expect(buildPreview([row], accounts, [], {}, {})[0]).toMatchObject({
      status: "excluded", reason: "请返回上传步骤，勾选‘识别投资交易流水’后重新读取文件。",
    });
  });
  it("银行投资资金关闭时引导开启，开启后沿用资金账户核对及转账", async () => {
    const document = await parseStatement(new TextEncoder().encode([
      "记账日期,货币,交易金额,联机余额,交易摘要,对手信息",
      "2025-01-01,CNY,-100.00,900.00,申购,虚构理财有限责任公司",
      "2025-01-02,CNY,50.00,950.00,基金快速赎回,虚构基金公司",
    ].join("\n")), "synthetic-bank.csv", { sourceAccount: "synthetic-card" });
    const rows = document.rows;
    expect(rows[0].parseStatus).toBe("softSkip");
    const mappings = Object.fromEntries(rows.map((row) => [mappingKey(row.source), "cash"]));
    expect(buildPreview(rows, accounts, [], mappings, {}).every((entry) => entry.status === "excluded" && entry.reason.includes("勾选‘识别投资交易流水’"))).toBe(true);
    expect(buildPreview(rows, accounts, [], mappings, decisions(rows), [], options).map((entry) => [entry.status, entry.create?.activityType])).toEqual([
      ["ready", "TRANSFER_OUT"], ["ready", "TRANSFER_IN"],
    ]);
    rows[0].error = "金额格式错误";
    rows[0].parseStatus = "fatal";
    expect(buildPreview([rows[0]], accounts, [], mappings, {})[0]).toMatchObject({ status: "error", reason: "金额格式错误" });
  });
  it("支付宝基金流水关闭时引导开启，手动恢复也不能作为普通收支导入", () => {
    const row = parseStatementSync(new TextEncoder().encode([HEADER, csvRow({ direction: "不计收支", description: "基金申购" })].join("\n")), "synthetic.csv").rows[0];
    const choice = { [rowKey(row)]: { excluded: false, accountId: "cash", kind: "expense" as const } };
    expect(buildPreview([row], accounts, [], {}, choice)[0]).toMatchObject({
      status: "excluded", reason: "请返回上传步骤，勾选‘识别投资交易流水’后重新读取文件。",
    });
    row.excluded = true;
    row.source.status = "交易关闭";
    expect(buildPreview([row], accounts, [], {}, choice)[0].reason).toBe("交易关闭");
  });
  it("银行资金转账双边与基金买入分别记账，手续费只计算一次", () => {
    const rows = [bank(), fund()], entries = preview(rows);
    expect(entries.every((entry) => entry.status === "ready")).toBe(true);
    const creates = entries.flatMap((entry) => entry.creates ?? []);
    expect(creates.map((create) => [create.accountId, create.activityType, create.amount])).toEqual([
      ["cash", "TRANSFER_OUT", "100.00"], ["fund", "TRANSFER_IN", "100.00"], ["fund", "BUY", "100"],
    ]);
    expect(creates[0].sourceGroupId).toBe(creates[1].sourceGroupId);
    expect(creates[2]).toMatchObject({ fee: "1", quantity: "10", unitPrice: "9.9" });
    expect(entries.every((entry) => entry.investmentLink?.peerKey)).toBe(true);
    expect(preview(rows)).toEqual(entries);
  });
  it.each([false, true])("任意顺序跨次导入并重复导入：基金先导=%s", async (fundFirst) => {
    const rows = [bank(), fund()], mock = host();
    const order = fundFirst ? [rows[1], rows[0]] : rows;
    for (const row of order) {
      const mappings = { [mappingKey(row.source)]: row.source.investment ? "fund" : "cash" };
      const reviewed = preview([row], mock.stored);
      expect((await mock.submit([row], mappings, decisions([row]), reviewed, [], options)).outcome).toBe("success");
    }
    expect(mock.stored).toHaveLength(3);
    expect(investmentNodes(mock.stored).every((node) => node.metadata.investment?.peerKey)).toBe(true);
    expect(preview(rows, mock.stored).every((entry) => entry.status === "duplicate")).toBe(true);
  });
  it("没有对侧文件仍可先导入，银行侧必须确认投资账户", () => {
    expect(preview([bank()])[0].creates).toHaveLength(2);
    expect(preview([fund()])[0].creates).toHaveLength(1);
    const row = bank(), choice = decisions([row]);
    choice[rowKey(row)].investmentAccountId = "";
    expect(preview([row], [], choice)[0].status).toBe("review");
  });
  it.each([false, true])("银行和支付渠道的同一投资扣款仅生成一组转账，支付先导=%s", async (paymentFirst) => {
    const bankRow = bank(), payment = bank("payment-1");
    Object.assign(payment.source, { system: "alipay", sourceAccount: undefined, paymentMethod: "招商银行(1234)" });
    const rows = paymentFirst ? [payment, bankRow] : [bankRow, payment];
    expect(preview(rows).flatMap((entry) => entry.creates ?? [])).toHaveLength(2);
    const mock = host();
    for (const row of rows) {
      expect((await mock.submit([row], { [mappingKey(row.source)]: "cash" }, decisions([row]), preview([row], mock.stored), [], options)).outcome).toBe("success");
    }
    expect(mock.stored).toHaveLength(2);
    expect(preview(rows, mock.stored).every((entry) => entry.status === "duplicate")).toBe(true);
  });
  it("同批基金订单冲突不能被重复标识掩盖", () => {
    const rows = [fund(), fund()];
    rows[1].source.investment!.legs[0].quantity = "11";
    expect(preview(rows).every((entry) => entry.status === "error")).toBe(true);
  });
  it("资金转账的投资账户侧被人工修改后不自动关联", () => {
    const row = bank(), stored = preview([row])[0].creates!.map((create, index) => saved(create, String(index)));
    stored[1].accountId = "other";
    expect(preview([fund()], stored)[0].investmentLink?.peerKey).toBeUndefined();
  });
  it("已保存资金允许人工关联旧基金活动，不自动改动历史金额", () => {
    const row = fund(), legacy = saved(preview([row])[0].create!, "legacy-manual");
    delete legacy.metadata; legacy.notes = "Ant Fund order:" + row.source.recordId;
    const stored = preview([bank()])[0].creates!.map((create, index) => saved(create, String(index)));
    stored.push(legacy);
    const nodes = investmentNodes(stored), funding = nodes.find((node) => node.metadata.investment?.role === "funding")!;
    const trade = nodes.find((node) => node.legacy)!;
    expect(preview([bank()], stored)[0].investmentLink?.peerKey).toBeUndefined();
    const updates = linkSavedInvestment(stored, funding.key, trade.key);
    expect(updates).toHaveLength(3);
    expect(updates.every((update) => update.amount === undefined && update.quantity === undefined)).toBe(true);
  });
  it("相同金额多候选、不同机构和人工改动都不自动关联", () => {
    const rows = [bank(), fund(), fund("202601010002")];
    expect(preview(rows).every((entry) => !entry.investmentLink?.peerKey)).toBe(true);
    rows.pop(); rows[0].source.merchant = "上海天天基金销售有限公司";
    expect(preview(rows).every((entry) => !entry.investmentLink?.peerKey)).toBe(true);
    rows[0].source.merchant = "蚂蚁基金";
    const existing = saved(preview([rows[1]])[0].create!, "modified");
    existing.quantity = "11";
    expect(preview([rows[0]], [existing])[0].investmentLink?.peerKey).toBeUndefined();
  });
  it("确认时间窗口包含第7天，不包含第8天", () => {
    const rows = [bank(), fund()];
    rows[1].source.investment!.legs[0].date = "2026-01-08"; rows[1].source.date = "2026-01-08T00:00:00Z";
    expect(preview(rows)[0].investmentLink?.peerKey).toBeTruthy();
    rows[1].source.investment!.legs[0].date = "2026-01-09"; rows[1].source.date = "2026-01-09T00:00:00Z";
    expect(preview(rows)[0].investmentLink?.peerKey).toBeUndefined();
  });
  it("赎回先产生投资账户现金，再转回银行卡", () => {
    const rows = [bank(), fund()];
    Object.assign(rows[0].source, { direction: "收入", originalTime: "2026-01-04", date: "2026-01-03T16:00:00Z" });
    Object.assign(rows[1].source.investment!.legs[0], { activityType: "SELL", amount: "100", unitPrice: "10.1" });
    const entries = preview(rows);
    expect(entries.flatMap((entry) => entry.creates ?? []).map((create) => create.activityType)).toEqual(["TRANSFER_IN", "TRANSFER_OUT", "SELL"]);
    expect(entries[0].investmentLink?.peerKey).toBeTruthy();
  });
  it("转换同订单保留双边，不关联银行卡", () => {
    const rows = [bank(), fund()];
    const transaction = rows[1].source.investment!;
    transaction.purpose = "基金转换";
    transaction.legs.push({ ...transaction.legs[0], code: "000033", activityType: "SELL", unitPrice: "10.1" });
    const entries = preview(rows);
    expect(entries[1].creates).toHaveLength(2);
    expect(entries[0].investmentLink?.peerKey).toBeUndefined();
  });
  it("历史旧基金活动只补来源，不修改经济字段", () => {
    const row = fund();
    const legacy = saved(preview([row])[0].create!, "legacy");
    delete legacy.metadata; legacy.notes = "Ant Fund order:" + row.source.recordId;
    const entry = preview([row], [legacy])[0];
    expect(entry.creates).toHaveLength(0);
    expect(entry.updates).toHaveLength(1);
    expect(entry.updates![0]).not.toHaveProperty("amount");
    expect(entry.updates![0]).not.toHaveProperty("quantity");
  });
  it("旧基金金额被修改时不认作新订单再次创建", () => {
    const row = fund(), legacy = saved(preview([row])[0].create!, "legacy-edited");
    delete legacy.metadata; legacy.notes = "Ant Fund order:" + row.source.recordId; legacy.amount = "101";
    expect(preview([row], [legacy])[0]).toMatchObject({ status: "review", creates: [] });
  });
  it("实际 SDK 的 date/comment 字段也能跨次匹配", () => {
    const row = fund(), trade = saved(preview([row])[0].create!, "sdk");
    const details = { ...trade, date: trade.activityDate, comment: trade.notes, activityDate: undefined, notes: undefined };
    expect(preview([bank()], [details])[0].investmentLink?.peerKey).toBeTruthy();
  });
  it("取消只移除业务关联，保留转账和买卖，并防止再次自动关联", () => {
    const rows = [bank(), fund()], stored = preview(rows).flatMap((entry) => entry.creates ?? []).map((create, index) => saved(create, String(index)));
    const node = investmentNodes(stored)[0];
    const updates = cancelInvestmentLink(stored, node.key);
    expect(updates).toHaveLength(3);
    for (const update of updates) {
      expect(update).not.toHaveProperty("amount");
      const current = stored.find((activity) => activity.id === update.id)!;
      current.metadata = { ...current.metadata, ...(update.metadata as Record<string, unknown>) };
    }
    expect(preview(rows, stored).every((entry) => !entry.investmentLink?.peerKey)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { parseStatement } from "./index";

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n"));
describe("新增银行的参考导出格式", () => {
  it("微信完成退款类型可带商户前缀，不把缺失退款去向推断成零钱", async () => {
    const document = await parseStatement(csv([
      ["交易时间", "交易类型", "收/支", "金额(元)", "当前状态", "支付方式", "交易单号"],
      ["2025-01-01 12:00:00", "虚构商户-退款", "收入", "￥10.00", "已全额退款", "/", "synthetic-refund"],
    ]), "synthetic.csv");
    expect(document.rows[0]).toMatchObject({ kind: "refund", source: { paymentMethod: "", amount: "10.00" } });
    expect(document.rows[0].reviewReason).toBeUndefined();
  });
  it("民生信用卡 MMDD 日期跨年、负数消费和退款", async () => {
    const document = await parseStatement(csv([
      ["交易日", "记账日", "卡号末四位", "授权码", "摘要", "金额"],
      ["1231", "20250101", "0001", "000000", "合成消费", "-12.34"],
      ["0102", "20250103", "0001", "000000", "退款", "12.34"],
    ]), "synthetic.csv", { channel: "cmbc" });
    expect(document.rows.map((row) => [row.kind, row.source.amount, row.source.currency])).toEqual([["expense", "12.34", "CNY"], ["refund", "12.34", "CNY"]]);
    expect(document.rows[0].source.date).toBe("2024-12-31T04:00:00.000Z");
    expect(document.rows.every((row) => !row.error && row.source.sourceAccount === "0001")).toBe(true);
  });
  it("汇丰借记 DMY 日期、千位分隔和来源账户", async () => {
    const document = await parseStatement(csv([
      ["Date", "Description", "Billing amount", "Billing currency", "Balance", "Balance currency"],
      ["09/04/2025", "SYNTHETIC SHOP", "-1,234.56", "HKD", "9,000.00", "HKD"],
    ]), "synthetic.csv", { channel: "hsbchk", sourceAccount: "synthetic-hsbc" });
    expect(document.rows[0]).toMatchObject({ kind: "expense", source: { date: "2025-04-09T04:00:00.000Z", amount: "1234.56", currency: "HKD", balance: "9000.00" } });
  });
  it("汇丰信用卡负金额消费，未入账状态提示复核", async () => {
    const document = await parseStatement(csv([
      ["Transaction date", "Post date", "Description", "Billing amount", "Billing currency", "Transaction status", "Merchant name", "Credit / Debit"],
      ["09/04/2025", "10/04/2025", "SYNTHETIC", "-10.00", "USD", "PENDING", "SHOP", "DEBIT"],
    ]), "synthetic.csv", { sourceAccount: "synthetic-card" });
    expect(document.rows[0]).toMatchObject({ kind: "expense", source: { amount: "10.00", currency: "USD" } });
    expect(document.rows[0].reviewReason).toContain("尚未入账");
  });
  it.each([false, true])("BMO 信用卡=%s，缺少币种不可默认为 CAD", async (credit) => {
    const bytes = csv([
      ["Following data is valid as of synthetic export"],
      credit ? ["Item #", "Card #", "Transaction Date", "Posting Date", "Transaction Amount", "Description"] : ["First Bank Card", "Transaction Type", "Date Posted", "Transaction Amount", "Description"],
      credit ? ["1", "'0000000000000001'", "20250102", "20250103", "12.34", "SYNTHETIC SHOP"] : ["'0000000000000001'", "DEBIT", "20250102", "-12.34", "SYNTHETIC SHOP"],
    ]);
    await expect(parseStatement(bytes, "synthetic.csv", { channel: "bmo" })).rejects.toThrow("缺少币种");
    const document = await parseStatement(bytes, "synthetic.csv", { currency: "USD" });
    expect(document.rows[0]).toMatchObject({ kind: "expense", source: { amount: "12.34", currency: "USD", sourceAccount: "0000000000000001", compositeIdentity: true } });
    expect(document.rows[0].error).toBeUndefined();
  });
  it("TD 无表头必须选渠道和币种，按 MDY 处理，收入支出列不混淆", async () => {
    const bytes = csv([["05/01/2025", "SYNTHETIC SHOP", "10.00", "", "90.00"], ["05/02/2025", "SYNTHETIC INCOME", "", "20.00", "110.00"]]);
    await expect(parseStatement(bytes, "synthetic.csv", { currency: "CAD" })).rejects.toThrow("未识别");
    await expect(parseStatement(bytes, "synthetic.csv", { channel: "td" })).rejects.toThrow("缺少币种");
    const document = await parseStatement(bytes, "synthetic.csv", { channel: "td", currency: "CAD", sourceAccount: "synthetic-td" });
    expect(document.rows.map((row) => [row.kind, row.source.amount])).toEqual([["expense", "10.00"], ["income", "20.00"]]);
    expect(document.rows[0].source.date).toBe("2025-05-01T04:00:00.000Z");
  });
  it("文件已提供币种时直接读取，上传选项不能覆盖原币种", async () => {
    const bytes = csv([
      ["Item #", "Card #", "Transaction Date", "Posting Date", "Transaction Amount", "Description", "Currency"],
      ["1", "0000000000000001", "20250101", "20250102", "10.00", "SYNTHETIC SHOP", "USD"],
    ]);
    for (const currency of [undefined, "CAD"])
      expect((await parseStatement(bytes, "synthetic.csv", { currency })).rows[0].source.currency).toBe("USD");
  });
  it("银行申购、基金销售机构默认跳过，不能确认成消费", async () => {
    const document = await parseStatement(csv([
      ["记账日期", "货币", "交易金额", "联机余额", "交易摘要", "对手信息"],
      ["2025-01-01", "CNY", "-10.00", "90.00", "申购", "虚构理财有限责任公司"],
      ["2025-01-02", "CNY", "-10.00", "80.00", "支付", "虚构基金销售公司"],
    ]), "synthetic.csv", { sourceAccount: "synthetic-account" });
    for (const row of document.rows) {
      expect(row.parseStatus).toBe("softSkip");
      expect(row.unsupportedReason).toContain("投资导入");
    }
  });
  it("掩码账户保留完整尾号，不截断成前四位", async () => {
    const document = await parseStatement(csv([
      ["账号：0000••••0001"],
      ["记账日期", "货币", "交易金额", "联机余额", "交易摘要", "对手信息"],
      ["2025-01-01", "CNY", "-10.00", "90.00", "消费", "虚构商户"],
    ]), "synthetic.csv");
    expect(document.rows[0].source.sourceAccount).toBe("0000••••0001");
    expect(document.rows[0].identityReason).toBeUndefined();
  });
});

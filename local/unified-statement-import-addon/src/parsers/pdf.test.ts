import { describe, expect, it, vi } from "vitest";
import { extractPdfTables, openPdf, PdfPasswordError, type PdfPage, type PdfWord } from "./pdf";
import { getStatementParser } from "./index";
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: load }));

function word(text: string, x: number, y: number): PdfWord { return { text, x, y, width: Math.min(70, text.length * 5) }; }
function page(title: string, headers: string[], rows: string[][], number = 1): PdfPage {
  return { number, words: [word(title, 20, 20), word("账号：0000000000000001", 20, 40),
    ...headers.map((text, i) => word(text, 20 + i * 90, 80)),
    ...rows.flatMap((row, r) => row.map((text, c) => word(text, 20 + c * 90, 140 + r * 30))) ] };
}
const cmbHeaders = ["记账日期", "货币", "交易金额", "联机余额", "交易摘要", "对手信息"];
describe("本地 PDF 坐标解析", () => {
  it("金额含千位分隔、重复表头和页码定位", () => {
    const tables = extractPdfTables([
      page("招商银行交易流水", cmbHeaders, [["2025-01-01", "CNY", "-1,234.56", "9,000.00", "消费", "虚构商户"]]),
      page("招商银行交易流水", cmbHeaders, [["2025-01-02", "USD", "100.00", "9,100.00", "收入", "虚构对方"]], 2),
    ]);
    const rows = getStatementParser("cmb").parse(tables[0].records, "synthetic.pdf");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "expense", source: { amount: "1234.56", balance: "9000.00", pageNumber: 1 } });
    expect(rows[1]).toMatchObject({ kind: "income", source: { currency: "USD", pageNumber: 2 } });
    expect(rows.every((row) => !row.error && !!row.source.pageLineNumber)).toBe(true);
  });
  it("同行分段与换行商户名称不丢失", () => {
    const input = page("招商银行交易流水", cmbHeaders, [["2025-01-01", "CNY", "-10.00", "90.00", "消费", "虚构"]]);
    input.words.push(word("商户", 470, 153));
    const rows = getStatementParser("cmb").parse(extractPdfTables([input])[0].records, "synthetic.pdf");
    expect(rows[0].source.merchant).toBe("虚构商户");
  });
  it("跨页续行跳过双语表头，保留起始页和原始行", () => {
    const first = page("招商银行交易流水", cmbHeaders, [["2025-01-01", "CNY", "-10.00", "90.00", "消费", "虚构"]]);
    first.words.push(word("1/2", 500, 800));
    const second = page("招商银行交易流水", cmbHeaders, [], 2);
    second.words.push(word("Date", 20, 95), word("Transaction Amount", 200, 110), word("商户", 470, 140));
    const rows = getStatementParser("cmb").parse(extractPdfTables([first, second])[0].records, "synthetic.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toMatchObject({ merchant: "虚构商户", amount: "10.00", pageNumber: 1 });
    expect(rows[0].error).toBeUndefined();
  });
  it("换行表头按同一列重建，不把表头碎片作为明细", () => {
    const input = page("招商银行交易流水", cmbHeaders, [["2025-01-01", "CNY", "-10.00", "90.00", "消费", "虚构商户"]]);
    input.words = input.words.filter((word) => word.text !== "交易金额");
    input.words.push(word("交易", 200, 80), word("金额", 205, 92));
    const rows = getStatementParser("cmb").parse(extractPdfTables([input])[0].records, "synthetic.pdf");
    expect(rows[0].source.amount).toBe("10.00");
  });
  it.each([
    { channel: "cmbc", title: "民生银行个人账户对账单", headers: ["凭证类型", "凭证号码", "交易时间", "摘要", "交易金额", "账户余额", "现转标志", "交易渠道", "交易机构", "对方户名/账号", "对方行名"], row: ["", "", "2025/01/01 12:00:00", "消费", "-10.00", "90.00", "转", "网银", "虚构支行", "虚构商户/0001", "虚构银行"] },
    { channel: "icbc", title: "中国工商银行借记账户历史明细", headers: ["交易日期", "帐号", "储种", "序号", "币种", "钞汇", "摘要", "地区", "收入/支出金额", "余额", "对方户名", "对方帐号", "渠道"], row: ["2025-01-01 12:00:00", "0000000000000001", "活期", "1", "CNY", "钞", "消费", "虚构地区", "-10.00", "90.00", "虚构商户", "0002", "网银"] },
    { channel: "boc", title: "中国银行交易流水明细清单", headers: ["记账日期", "记账时间", "币别", "金额", "余额", "交易名称", "渠道", "网点名称", "附言", "对方账户名", "对方卡号/账号", "对方开户行"], row: ["2025-01-01", "12:00:00", "CNY", "-10.00", "90.00", "消费", "网银", "虚构支行", "合成备注", "虚构商户", "0002", "虚构银行"] },
    { channel: "webank", title: "微众银行交易流水", headers: ["记账日期", "对方户名", "对方账号", "借贷标志", "摘要", "备注", "币种", "金额", "余额"], row: ["2025-01-01", "虚构商户", "0002", "借", "消费", "合成备注", "CNY", "-10.00", "90.00"] },
  ])("$channel 原生 PDF 列映射", ({ channel, title, headers, row }) => {
    const tables = extractPdfTables([page(title, headers, [row])], channel);
    const rows = getStatementParser(channel).parse(tables[0].records, "synthetic.pdf");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "expense", source: { amount: "10.00", currency: "CNY", balance: "90.00" } });
    expect(rows[0].error).toBeUndefined();
  });
  it("中国银行信用卡按币种分区和收入支出列解析", () => {
    const input = page("中国银行信用卡对账单", ["交易日", "入账日", "交易描述", "存入", "支出"], [["2025-01-01", "2025-01-02", "虚构消费", "", "10.00"]]);
    input.words.push(word("人民币账户交易明细", 20, 60));
    const rows = getStatementParser("boc").parse(extractPdfTables([input])[0].records, "synthetic.pdf");
    expect(rows[0]).toMatchObject({ kind: "expense", source: { amount: "10.00", currency: "CNY" } });
    expect(rows[0].error).toBeUndefined();
  });
  it("缺页表头、错渠道和未知格式不能静默少导入", () => {
    const first = page("招商银行交易流水", cmbHeaders, [["2025-01-01", "CNY", "-10.00", "90.00", "消费", "虚构商户"]]);
    expect(() => extractPdfTables([first], "boc")).toThrow("未识别");
    expect(() => extractPdfTables([{ number: 1, words: [word("未知银行", 20, 20)] }])).toThrow("未识别");
    expect(() => extractPdfTables([first, { number: 2, words: [word("2025-01-02", 20, 140)] }])).toThrow("第 2 页");
    const differentAccount = page("招商银行交易流水", cmbHeaders, [["2025-01-02", "CNY", "-10.00", "80.00", "消费", "虚构商户"]], 2);
    differentAccount.words[1].text = "账号：0000000000000002";
    expect(() => extractPdfTables([first, differentAccount])).toThrow("不同来源账户");
  });
  it("缺失或错误密码提示重输，并销毁加载任务", async () => {
    const destroy = vi.fn();
    load.mockReturnValueOnce({ promise: Promise.reject(Object.assign(new Error("password"), { name: "PasswordException" })), destroy });
    await expect(openPdf(new Uint8Array([1]), { password: "synthetic-secret" })).rejects.toBeInstanceOf(PdfPasswordError);
    expect(destroy).toHaveBeenCalledOnce();
    expect(load.mock.calls.at(-1)![0]).toMatchObject({ password: "synthetic-secret", useWorkerFetch: false, isEvalSupported: false });
  });
});

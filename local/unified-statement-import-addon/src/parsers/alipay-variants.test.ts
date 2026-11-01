import { describe, expect, it } from "vitest";
import { parseStatementSync as parseStatement } from "./index";
import { sourcesConflict } from "../import/ledger";
import { csvRow, HEADER } from "../test-fixtures";

const parse = (text: string) => parseStatement(new TextEncoder().encode(text), "synthetic.csv");
const webHeader = "交易创建时间,交易对方,商品名称,金额（元）,收/支,交易状态,交易号";

describe("支付宝导出变体", () => {
  it("网页账单允许缺少商品、对方和单号，但不伪造身份", () => {
    const document = parse("支付宝交易记录明细查询\n交易创建时间,金额（元）,收/支,交易状态,\n2025-01-01 12:00:00,12.30,支出,交易成功,\n----------------\n汇总说明");
    expect(document.parserId).toBe("alipay");
    expect(document.rows).toHaveLength(1);
    expect(document.rows[0].source).toMatchObject({ variantId: "alipay-web-csv", recordId: "", amount: "12.30", lineNumber: 3 });
    expect(document.rows[0].error).toBeUndefined();
  });

  it("电子回单共享支付宝身份，跳过重复表头并在页脚停止", () => {
    const document = parse(`支付宝支付科技有限公司  电子客户回单\n${HEADER}\n${csvRow()}\n${HEADER}\n${csvRow({ id: "second" })}\n共 2 笔记录\n说明`);
    expect(document.rows).toHaveLength(2);
    expect(document.rows[0].source).toMatchObject({ system: "alipay", variantId: "alipay-receipt-csv" });
    expect(document.rows[1].source.lineNumber).toBe(5);
  });

  it("不同变体缺少可选字段不构成冲突，经济字段和共同提供的明细变化仍阻断", () => {
    const original = parse(`${HEADER}\n${csvRow()}`).rows[0].source;
    const document = parse(`${webHeader}\n${original.originalTime},${original.merchant},${original.description},${original.amount},${original.direction},${original.status},${original.recordId}`);
    const web = document.rows[0].source;
    expect(sourcesConflict(original, web)).toBe(false);
    expect(sourcesConflict(original, { ...web, amount: "99.00" })).toBe(true);
    expect(sourcesConflict(original, { ...web, description: "不同商品" })).toBe(true);
    expect(sourcesConflict({ ...original, variantId: undefined }, original)).toBe(false);
  });

  it("已关闭状态不可恢复，字段格式错误仍保留行错误", () => {
    const rows = parse(`${HEADER}\n${csvRow({ status: "已关闭" })}\n${csvRow({ amount: "bad" })}`).rows;
    expect(rows[0].excluded).toBe(true);
    expect(rows[1].error).toBeTruthy();
  });
});

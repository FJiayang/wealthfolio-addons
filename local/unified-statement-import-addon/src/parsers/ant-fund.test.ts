import { describe, expect, it } from "vitest";
import { parseStatement, parseStatementSync } from "./index";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const header = "date,symbol,instrumentType,quantity,activityType,unitPrice,currency,fee,tax,amount,subtype,account,comment";
const buy = "2026-01-03,000032,EQUITY,10,BUY,9.9,CNY,1,0,100,,fund,合成基金；用户跨TA转换；订单号：202601010001";
const sell = "2026-01-03,000033,EQUITY,10,SELL,10.1,CNY,1,0,100,,fund,合成基金B；用户跨TA转换；订单号：202601010001";
describe("蚂蚁基金统一解析", () => {
  it("同一订单的转换双边保留在一个来源中，精确保留金额与费用", () => {
    const document = parseStatementSync(new TextEncoder().encode([header, buy, sell].join("\n")), "synthetic.csv");
    expect(document.parserId).toBe("ant-fund");
    expect(document.rows).toHaveLength(1);
    expect(document.rows[0].source.investment?.legs.map((leg) => [leg.activityType, leg.code, leg.amount, leg.fee])).toEqual([
      ["BUY", "000032", "100", "1"], ["SELL", "000033", "100", "1"],
    ]);
  });
  it("没有订单号、未知活动类型及币种不明确时不能提交", () => {
    const document = parseStatementSync(new TextEncoder().encode([header,
      buy.replace("订单号：202601010001", "缺少订单号").replace("BUY", "OTHER"),
      sell.replace("CNY", "USD").replace("202601010001", "202601010002"),
    ].join("\n")), "synthetic.csv");
    expect(document.rows[0].identityReason).toContain("订单号");
    expect(document.rows.every((row) => row.error)).toBe(true);
  });
  it("PDF 复用原解析器，保留原页、申请日期及需要补齐的分红", async () => {
    const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    const document = await parseStatement(new Uint8Array(readFileSync(new URL("../ant-fund/fixtures/statement.pdf", import.meta.url))), "synthetic.pdf", {
      channel: "ant-fund", assets: { getBlob: async (path) => new Blob([readFileSync(join(pdfRoot, path.replace(/^dist\/assets\/pdf\//, "")))]) },
    });
    expect(document.rows).toHaveLength(3);
    expect(document.rows[0].source.investment?.applicationDate).toBe("2026-10-01");
    expect(document.rows[0].source.pageNumber).toBe(2);
    expect(document.rows[1].source.investment?.legs[0].amount).toBe("");
  });
});

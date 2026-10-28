import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStatement } from "./index";
import { decodeStatement, normalizeAmount, parseCsv, parseShanghaiDate } from "./csv";
import { csvRow, demoFixture, HEADER } from "../test-fixtures";

const parse = (body: string) => parseStatement(new TextEncoder().encode(body), "fictional.csv");

describe("支付宝解析", () => {
  it("按表头读取脱敏的 DEMO 结构，不采用说明区笔数", () => {
    const rows = parse(demoFixture());
    expect(rows).toHaveLength(52);
    expect(rows.filter((row) => row.source.direction === "支出")).toHaveLength(26);
    expect(rows.filter((row) => row.source.direction === "收入")).toHaveLength(4);
    expect(rows.filter((row) => row.source.direction === "不计收支")).toHaveLength(22);
    expect(rows.filter((row) => row.excluded)).toHaveLength(2);
    expect(rows[0].source).toMatchObject({
      lineNumber: 5,
      accountHint: "fictional-account",
      amount: "12.30",
      date: "2025-12-31T06:23:00.000Z",
    });
  });
  it("正确处理 BOM、引号、逗号、换行和订单号制表符", () => {
    const rows = parse(
      `\uFEFF${HEADER}\r\n${csvRow({ id: "long-000000000000000001\t", description: '第一行,"引号"\n第二行' })}\r\n${csvRow({ id: "second" })}`,
    );
    expect(rows[0].source.description).toBe('第一行,"引号"\n第二行');
    expect(rows[0].source.recordId).toBe("long-000000000000000001");
    expect(rows[1].source.lineNumber).toBe(4);
  });
  it("严格解码 UTF-8 与 GB18030，拒绝损坏文件", () => {
    expect(decodeStatement(new TextEncoder().encode("中文"))).toBe("中文");
    expect(decodeStatement(Uint8Array.from([0xb2, 0xe2, 0xca, 0xd4]))).toBe("测试");
    expect(() => decodeStatement(Uint8Array.from([0x81]))).toThrow("解码");
  });
  it("金额不经过浮点数，日期采用上海时区并校验真实日期", () => {
    expect(normalizeAmount("00012345678901234567890.1")).toBe("12345678901234567890.10");
    expect(normalizeAmount("0")).toBe("0.00");
    for (const invalid of ["-1", "1.234", "NaN", "1e3", "1,000", ""])
      expect(() => normalizeAmount(invalid)).toThrow();
    expect(parseShanghaiDate("2025/1/1 00:01")).toBe("2024-12-31T16:01:00.000Z");
    for (const invalid of ["2025/2/29 12:00", "2025/1/1 25:00", "2025-13-01 12:00", "2025-01-01"])
      expect(() => parseShanghaiDate(invalid)).toThrow();
  });
  it("关闭交易排除，未知及组合付款待确认，明确退款独立处理", () => {
    const rows = parse(
      [
        HEADER,
        csvRow({ status: "交易关闭" }),
        csvRow({ status: "处理中" }),
        csvRow({ method: "信用卡&红包" }),
        csvRow({ direction: "不计收支" }),
        csvRow({ status: "退款成功", direction: "不计收支" }),
      ].join("\n"),
    );
    expect(rows[0].excluded).toBe(true);
    for (const row of rows.slice(1, 4)) expect(row.reviewReason).toBeTruthy();
    expect(rows[4].kind).toBe("refund");
    expect(rows[4].reviewReason).toBeUndefined();
  });
  it("拒绝缺列、重复列、坏引号，报告坏金额和不一致行", () => {
    expect(() => parse("交易时间,金额\n2025/1/1,1")).toThrow("必需列");
    expect(() => parse(`${HEADER},备注\n${csvRow()},`)).toThrow("重复列");
    expect(() => parseCsv('a,"未闭合')).toThrow("未闭合");
    expect(() => parseCsv('a,"b"c')).toThrow("引号");
    expect(parse(`${HEADER}\n${csvRow({ amount: "1.234" })}`)[0].error).toBeTruthy();
    expect(parse(`${HEADER}\n${csvRow()},多余列`)[0].error).toBeTruthy();
  });
  it.skipIf(!process.env.STATEMENT_DEMO_PATH)("只读验收用户 DEMO，不记录账单内容", () => {
    const rows = parseStatement(readFileSync(process.env.STATEMENT_DEMO_PATH!), "DEMO.csv");
    expect(rows.length).toBe(52);
    expect(
      ["支出", "收入", "不计收支"].map(
        (direction) => rows.filter((row) => row.source.direction === direction).length,
      ),
    ).toEqual([26, 4, 22]);
    expect(rows.filter((row) => row.excluded).length).toBe(2);
  });
});

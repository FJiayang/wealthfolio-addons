import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getStatementParser, parseStatementSync as parseStatement, statementParsers } from "./index";
import { decodeStatement, normalizeAmount, parseCsv, parseShanghaiDate } from "./csv";
import { csvRow, demoFixture, HEADER } from "../test-fixtures";

const parse = (body: string) => parseStatement(new TextEncoder().encode(body), "fictional.csv").rows;

describe("支付宝解析", () => {
  it("文档返回渠道身份，格式和界面提示由解析器注册表提供", () => {
    const document = parseStatement(new TextEncoder().encode(`${HEADER}\n${csvRow()}`), "fixture.csv");
    expect(document.parserId).toBe("alipay");
    expect(getStatementParser(document.parserId)).toMatchObject({ formats: ["csv"], recordIdLabel: "支付宝订单号" });
    expect(statementParsers.some((parser) => parser.id === "wechat")).toBe(true);
    expect(() => getStatementParser("missing")).toThrow("未注册");
  });

  it("按表头读取脱敏的 DEMO 结构，不采用说明区笔数", () => {
    const rows = parse(demoFixture());
    expect(rows).toHaveLength(52);
    expect(rows.filter((row) => row.source.direction === "支出")).toHaveLength(26);
    expect(rows.filter((row) => row.source.direction === "收入")).toHaveLength(4);
    expect(rows.filter((row) => row.source.direction === "不计收支")).toHaveLength(22);
    expect(rows.filter((row) => row.excluded)).toHaveLength(2);
    expect(rows.filter((row) => row.defaultExcluded)).toHaveLength(20);
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
  it.each(["交易成功", "支付成功", "代付成功", "解冻成功", "芝麻免押下单成功"])("精确识别成功状态 %s，收支性质独立于支付方式", (status) => {
    for (const [direction, kind] of [["支出", "expense"], ["收入", "income"]]) {
      for (const method of ["医保支付", "代付", "信用卡&红包", "因公付", "企业码", "优惠积分立减"]) {
        const [row] = parse(`${HEADER}\n${csvRow({ status: ` ${status} `, direction, method })}`);
        expect(row.kind).toBe(kind);
        expect(row.reviewReason).toBeUndefined();
      }
    }
  });
  it.each(["处理中", "未知业务成功", "交易成功待确认", "部分支付成功", "", "交易 成功"])("未知状态 %j 保留收支性质并要求状态核对", (status) => {
    const [row] = parse(`${HEADER}\n${csvRow({ status })}`);
    expect(row.kind).toBe("expense");
    expect(row.reviewReason).toBe("交易状态需要确认");
  });
  it("退款状态保留原有规则，支出方向冲突仍需核对", () => {
    for (const direction of ["收入", "不计收支"]) {
      const [row] = parse(`${HEADER}\n${csvRow({ status: "退款成功", direction })}`);
      expect(row.kind).toBe("refund");
      expect(row.reviewReason).toBeUndefined();
    }
    const [conflict] = parse(`${HEADER}\n${csvRow({ status: "退款成功" })}`);
    expect(conflict.kind).toBe("expense");
    expect(conflict.reviewReason).toBeTruthy();
  });
  it("关闭交易排除，组合支付不额外确认，未知性质待补齐，明确退款独立处理", () => {
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
    expect(rows[1].reviewReason).toBeTruthy();
    expect(rows[1].kind).toBe("expense");
    expect(rows[2].kind).toBe("expense");
    expect(rows[2].reviewReason).toBeUndefined();
    expect(rows[3].kind).toBeUndefined();
    expect(rows[3].reviewReason).toBeUndefined();
    expect(rows[4].kind).toBe("refund");
    expect(rows[4].reviewReason).toBeUndefined();
    expect(rows[3].defaultExcluded).toBe(true);
    expect(rows[4].defaultExcluded).toBe(false);
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
    const rows = parseStatement(readFileSync(process.env.STATEMENT_DEMO_PATH!), "DEMO.csv").rows;
    expect(rows.length).toBe(52);
    expect(
      ["支出", "收入", "不计收支"].map(
        (direction) => rows.filter((row) => row.source.direction === direction).length,
      ),
    ).toEqual([26, 4, 22]);
    expect(rows.filter((row) => row.excluded).length).toBe(2);
    expect(rows.filter((row) => row.defaultExcluded).length).toBe(20);
  });
});

import { describe, expect, it } from "vitest";
import { utils, write } from "xlsx";
import golden from "./__golden__/channels.json";
import { parseStatement } from "./index";
import { readTables } from "./reader";
import { add, compare } from "./decimal";
import { statementDate } from "./profiles";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { buildPreview, rowKey } from "../import/ledger";
import { mappingKey } from "../import/account-matching";

const csv = (rows: string[][]) =>
  new TextEncoder().encode(
    rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\r\n"),
  );
function fixture(index: number) {
  const g = golden[index];
  return g.title ? [[g.title], g.header, g.row] : [g.header, g.row];
}

describe("P0 读取与身份", () => {
  it("金额精确处理大数、多位小数和负数", () => {
    expect(add("99999999999999999999.99", "0.01")).toBe("100000000000000000000.00");
    expect(add("0.0001", "-0.0002")).toBe("-0.0001");
    expect(compare("1.01", "1.001")).toBe(1);
    expect(() => add("1e3", "1")).toThrow();
  });
  it("异步入口保留旧支付宝行为、物理行号、四态行和跨文件来源", async () => {
    const rows = [
      HEADER,
      csvRow(),
      csvRow({ id: "closed", status: "交易关闭" }),
      csvRow({ id: "neutral", direction: "不计收支" }),
      csvRow({ id: "bad", amount: "x" }),
    ].join("\n");
    const document = await parseStatement(new TextEncoder().encode(rows), "a.csv");
    expect(document.rows.map((row) => row.parseStatus)).toEqual([
      "ok",
      "hardSkip",
      "softSkip",
      "fatal",
    ]);
    const again = await parseStatement(new TextEncoder().encode(rows), "b.csv");
    expect(document.rows[0].rowId).not.toBe(again.rows[0].rowId);
    expect(document.rows[0].source.recordId).toBe(again.rows[0].source.recordId);
  });
  it("支持分号及UTF16，坏引号不能被静默丢弃", () => {
    expect(
      readTables(new TextEncoder().encode("日期;金额\n2025-01-01;12.30"))[0].records[1].cells,
    ).toEqual(["2025-01-01", "12.30"]);
    const value = "日期\t金额\n2025-01-01\t12.30";
    const bytes = new Uint8Array(2 + value.length * 2);
    bytes.set([255, 254]);
    for (let i = 0; i < value.length; i++) {
      bytes[2 + i * 2] = value.charCodeAt(i) & 255;
      bytes[3 + i * 2] = value.charCodeAt(i) >> 8;
    }
    expect(readTables(bytes)[0].records[1].cells).toHaveLength(2);
    expect(() => readTables(new TextEncoder().encode('日期,金额\n"bad'))).toThrow();
  });
});

describe("P1–P4 渠道 golden", () => {
  for (const [index, g] of golden.entries()) {
    it(`${g.channel} 变体 ${index} CSV 语义、身份及重复入账`, async () => {
      const document = await parseStatement(csv(fixture(index)), "synthetic.csv", {
        channel: g.channel,
        sourceAccount: "synthetic-source",
      });
      const row = document.rows[0];
      expect(row.error).toBeUndefined();
      expect(row.kind).toBe(g.kind);
      expect(row.source.amount).toBe(g.amount);
      expect(row.source.date).toBe(
        g.date ??
          (g.row.some((value) => value.includes("12:30:00") || value === "123000")
            ? "2025-01-01T04:30:00.000Z"
            : "2025-01-01T04:00:00.000Z"),
      );
      expect(row.source.recordId).toBeTruthy();
      const mappings = { [mappingKey(row.source)]: "cash" };
      const decisions = { [rowKey(row)]: { confirmed: true, excluded: false } };
      const preview = buildPreview([row], [account()], [], mappings, decisions);
      expect(preview[0].status).toBe("ready");
      expect(
        buildPreview([row], [account()], [activity(preview[0].create!)], mappings, decisions)[0]
          .status,
      ).toBe("duplicate");
    });
  }
  it.each(["xlsx", "biff8"] as const)(
    "Excel %s 与CSV产生相同经济数据，保留超长文本单号",
    async (bookType) => {
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, utils.aoa_to_sheet(fixture(0)), "微信明细");
      const bytes = write(workbook, { type: "array", bookType });
      const document = await parseStatement(new Uint8Array(bytes), "synthetic.xls");
      expect(document.rows[0].source).toMatchObject({
        recordId: "00001234567890123456789",
        amount: "1234.56",
        sheetName: "微信明细",
        lineNumber: 2,
      });
      expect(document.rows[0].error).toBeUndefined();
    },
  );
  it.each(["xlsx", "biff8"] as const)(
    "Excel %s 日期序列值超过15位仍保留交易时间、金额和文本单号",
    async (bookType) => {
      const rows = fixture(0).map((row) => [...row]) as (string | number)[][];
      rows[1][0] = 46020 + 28872 / 86400;
      rows[1][5] = 1234.56;
      const sheet = utils.aoa_to_sheet(rows);
      sheet.A2.z = "yyyy-mm-dd hh:mm:ss";
      sheet.F2.z = "0.00";
      const workbook = utils.book_new();
      utils.book_append_sheet(workbook, sheet, "微信明细");
      const bytes = new Uint8Array(write(workbook, { type: "array", bookType }));
      const row = (await parseStatement(bytes, "synthetic.xls")).rows[0];
      expect(row.error).toBeUndefined();
      expect(row.parseStatus).toBe("ok");
      expect(row.source).toMatchObject({
        date: "2025-12-29T00:01:12.000Z",
        amount: "1234.56",
        recordId: "00001234567890123456789",
      });
    },
  );
  it("Excel数值长单号阻断，多个工作表保留独立决策身份", async () => {
    const workbook = utils.book_new();
    const rows = fixture(0).map((row) => [...row]) as (string | number)[][];
    rows[1][8] = Number("123456789012345678");
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows), "不安全");
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(fixture(0)), "安全");
    const bytes = new Uint8Array(write(workbook, { type: "array", bookType: "xlsx" }));
    const document = await parseStatement(bytes, "synthetic.xlsx");
    expect(document.rows[0].error).toContain("精度");
    expect(new Set(document.rows.map(rowKey)).size).toBe(2);
    expect((await parseStatement(bytes, "synthetic.xlsx", { sheets: ["安全"] })).rows).toHaveLength(
      1,
    );
  });
  it("微信中性和手续费行可见跳过，不能恢复为普通收支", async () => {
    const rows = fixture(0);
    rows[1] = [...rows[1]];
    rows[1][1] = "零钱提现";
    rows[1][4] = "/";
    rows[1][10] = "服务费0.50";
    const document = await parseStatement(csv(rows), "wx.csv");
    const row = document.rows[0];
    expect(row.parseStatus).toBe("softSkip");
    expect(row.source.fee).toBe("0.50");
    expect(
      buildPreview(
        [row],
        [account()],
        [],
        {},
        { [rowKey(row)]: { excluded: false, confirmed: true, accountId: "cash", kind: "income" } },
      )[0].status,
    ).toBe("review");
  });
  it("银行来源账户隔离，缺失身份和同文件完全相同复合流水不自动放行", async () => {
    const a = await parseStatement(csv(fixture(1)), "bank.csv", { sourceAccount: "bank-a" });
    const b = await parseStatement(csv(fixture(1)), "bank.csv", { sourceAccount: "bank-b" });
    const row = a.rows[0];
    const mappings = { [mappingKey(row.source)]: "cash", [mappingKey(b.rows[0].source)]: "cash" };
    expect(
      buildPreview([row, b.rows[0]], [account()], [], mappings, {}).map((entry) => entry.status),
    ).toEqual(["ready", "ready"]);
    const missing = await parseStatement(csv(fixture(1)), "bank.csv");
    expect(buildPreview(missing.rows, [account()], [], mappings, {})[0].status).toBe("review");
    const repeated = await parseStatement(csv([...fixture(1), golden[1].row]), "bank.csv", {
      sourceAccount: "bank-a",
    });
    expect(
      buildPreview(repeated.rows, [account()], [], mappings, {}).every(
        (entry) => entry.status === "review",
      ),
    ).toBe(true);
  });
  it("同流水号资金方向改变必须冲突，不能因绝对金额相同误判为重复", async () => {
    const debit = fixture(9);
    const credit = fixture(9);
    credit[1] = [...credit[1]];
    credit[1][3] = "+12.30";
    const a = (await parseStatement(csv(debit), "a.csv", { sourceAccount: "bank-a" })).rows[0];
    const b = (await parseStatement(csv(credit), "b.csv", { sourceAccount: "bank-a" })).rows[0];
    expect(
      buildPreview([a, b], [account()], [], { [mappingKey(a.source)]: "cash" }, {}).every(
        (entry) => entry.status === "error",
      ),
    ).toBe(true);
  });
  it("微信完成退款按退款入账，零服务费不制造 FEE 或额外确认", async () => {
    const values = fixture(0);
    values[1] = [...values[1]];
    values[1][4] = "收入";
    values[1][7] = "已退款";
    values[1][10] = "服务费0.00";
    const row = (await parseStatement(csv(values), "refund.csv")).rows[0];
    const preview = buildPreview([row], [account()], [], { [mappingKey(row.source)]: "cash" }, {});
    expect(row.kind).toBe("refund");
    expect(preview[0].status).toBe("ready");
    expect(preview[0].creates).toHaveLength(1);
    expect(preview[0].create?.subtype).toBe("REFUND");
  });
  it("无法提取的手续费及基金记录不能仅通过已核对放行", async () => {
    for (const [type, remark, expectedStatus] of [
      ["商户消费", "服务费待确认", "review"],
      ["购买理财通", "", "excluded"],
    ]) {
      const values = fixture(0);
      values[1] = [...values[1]];
      values[1][1] = type;
      values[1][10] = remark;
      const row = (await parseStatement(csv(values), "unsupported.csv")).rows[0];
      expect(
        buildPreview(
          [row],
          [account()],
          [],
          {},
          { [rowKey(row)]: { excluded: false, confirmed: true, accountId: "cash" } },
        )[0].status,
      ).toBe(expectedStatus);
    }
  });
  it("源统计差异只提示，金额合计不受用户跳过影响", async () => {
    const values = fixture(0);
    values[1] = [...values[1]];
    values[1][5] = "12.30";
    const document = await parseStatement(
      csv([["共1笔记录"], ["支出合计：15.00"], ...values]),
      "totals.csv",
    );
    expect(document.summaries?.[0]).toMatchObject({ expense: "12.30", declaredExpense: "15.00" });
    expect(document.warnings?.some((warning) => warning.includes("合计不一致"))).toBe(true);
    const row = document.rows[0];
    expect(
      buildPreview(document.rows, [account()], [], { [mappingKey(row.source)]: "cash" }, {})[0]
        .status,
    ).toBe("ready");
    buildPreview(document.rows, [account()], [], {}, { [rowKey(row)]: { excluded: true } });
    expect(document.summaries?.[0].expense).toBe("12.30");
  });
  it("京东分单位必须明确选择，不能猜测整数金额的口径", async () => {
    const values = fixture(14);
    values[1] = [...values[1]];
    values[1][3] = "1860";
    expect((await parseStatement(csv(values), "jd.csv")).rows[0].source.amount).toBe("1860.00");
    expect(
      (await parseStatement(csv(values), "jd.csv", { variantId: "jd-cents" })).rows[0].source
        .amount,
    ).toBe("18.60");
    values[1][3] = "18.60";
    expect(
      (await parseStatement(csv(values), "jd.csv", { variantId: "jd-cents" })).rows[0].error,
    ).toContain("整数");
  });
  it("银行日期、冲正和可选列重排", async () => {
    expect(() => statementDate("12/31", "", "")).toThrow("年月");
    expect(() => statementDate("2025-02-29", "", "")).toThrow();
    const g = golden[1];
    const document = await parseStatement(
      csv([
        ["交易金额", "记账日期", "货币", "联机余额"],
        ["-12.30", "2025-01-01", "人民币", "100"],
      ]),
      "bank.csv",
      { channel: g.channel, sourceAccount: "bank-a" },
    );
    expect(document.rows[0]).toMatchObject({ kind: "expense", source: { amount: "12.30" } });
    const cib = fixture(13);
    cib[cib.length - 1] = [...cib[cib.length - 1]];
    cib[cib.length - 1][2] = "-12.30";
    expect(
      (await parseStatement(csv(cib), "cib.csv", { sourceAccount: "bank-a" })).rows[0].kind,
    ).toBe("income");
  });
});

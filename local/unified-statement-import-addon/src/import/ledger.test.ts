import { describe, expect, it } from "vitest";
import { parseStatement } from "../parsers";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { buildPreview, eligibleAccounts, METADATA_KEY, restoreMappings } from "./ledger";

const rows = (...lines: string[]) =>
  parseStatement(new TextEncoder().encode([HEADER, ...lines].join("\n")), "fictional.csv").rows;
const cash = account();
const mapping = { 账户余额: "cash" };

describe("预览、来源和重复检测", () => {
  it("推断与保存映射共用预览入口，逐行人工选择及清空优先", () => {
    const method = "招商银行信用卡(1234)";
    const parsed = rows(csvRow({ method }));
    const accounts = [{ ...account("card", "CREDIT_CARD"), name: "招商银行信用卡", accountNumber: "1234" }, cash];
    expect(buildPreview(parsed, accounts, [], {}, {})[0]).toMatchObject({ status: "ready", accountId: "card" });
    expect(buildPreview(parsed, accounts, [], { [method]: "cash" }, {})[0].accountId).toBe("cash");
    expect(buildPreview(parsed, accounts, [], { [method]: "card" }, { 2: { accountId: "cash" } })[0].accountId).toBe("cash");
    expect(buildPreview(parsed, accounts, [], {}, { 2: { accountId: "" } })[0].status).toBe("review");
    for (const overrides of [{ status: "处理中" }, { method: `${method}&红包` }, { direction: "不计收支" }]) {
      expect(buildPreview(rows(csvRow({ method, ...overrides })), accounts, [], {}, {})[0].status).toBe("review");
    }
  });

  it("创建备注及完整来源，精度和原始金额不受人工确认影响", () => {
    const parsed = rows(csvRow({ method: "信用卡&红包" }));
    const preview = buildPreview(
      parsed,
      [cash],
      [],
      {},
      { 2: { kind: "expense", accountId: "cash", amount: "10.01", confirmed: true } },
    );
    expect(preview[0].status).toBe("ready");
    expect(preview[0].create).toMatchObject({
      amount: "10.01",
      comment: expect.stringContaining("fictional-order-1"),
      metadata: {
        [METADATA_KEY]: {
          version: 1,
          sources: [
            expect.objectContaining({
              amount: "12.30",
              paymentMethod: "信用卡&红包",
              lineNumber: 2,
            }),
          ],
          booking: { amount: "10.01" },
        },
      },
    });
  });
  it("检测同批、跨文件和跨账户重复；重新映射不新增", () => {
    const parsed = rows(csvRow(), csvRow());
    const first = buildPreview(parsed, [cash], [], mapping, {});
    expect(first.map((row) => row.status)).toEqual(["ready", "duplicate"]);
    const stored = activity(first[0].create!);
    const renamed = parsed.map((row) => ({
      ...row,
      source: { ...row.source, fileName: "another.csv", lineNumber: row.source.lineNumber + 10 },
    }));
    expect(
      buildPreview(renamed, [cash, account("other")], [stored], { 账户余额: "other" }, {}).map(
        (row) => row.status,
      ),
    ).toEqual(["duplicate", "duplicate"]);
    stored.notes = "用户改过备注";
    stored.amount = "20.00";
    expect(buildPreview(parsed, [cash], [stored], mapping, {})[0].status).toBe("duplicate");
    expect(stored.notes).toBe("用户改过备注");
  });
  it("同日同额不同订单都可提交，备注区分核心指纹", () => {
    const preview = buildPreview(
      rows(csvRow(), csvRow({ id: "different-order" })),
      [cash],
      [],
      mapping,
      {},
    );
    expect(preview.map((entry) => entry.status)).toEqual(["ready", "ready"]);
    expect(preview[0].create!.comment).not.toBe(preview[1].create!.comment);
  });
  it("同一来源内容冲突全部阻止；已有多重关联需人工核对", () => {
    const parsed = rows(csvRow());
    const stored = activity(buildPreview(parsed, [cash], [], mapping, {})[0].create!);
    expect(
      buildPreview(rows(csvRow({ amount: "20" })), [cash], [stored], mapping, {})[0].status,
    ).toBe("error");
    expect(
      buildPreview(rows(csvRow(), csvRow({ amount: "20" })), [cash], [], mapping, {}).every(
        (row) => row.status === "error",
      ),
    ).toBe(true);
    expect(
      buildPreview(parsed, [cash], [stored, { ...stored, id: "another" }], mapping, {})[0].status,
    ).toBe("review");
  });
  it("缺号、未知状态、未映射或已归档账户不能就绪", () => {
    expect(buildPreview(rows(csvRow({ id: "" })), [cash], [], mapping, {})[0].status).toBe(
      "review",
    );
    expect(buildPreview(rows(csvRow({ status: "未知" })), [cash], [], mapping, {})[0].status).toBe(
      "review",
    );
    expect(buildPreview(rows(csvRow()), [cash], [], {}, {})[0].status).toBe("review");
    expect(
      buildPreview(rows(csvRow()), [{ ...cash, isArchived: true }], [], mapping, {})[0].status,
    ).toBe("review");
  });
  it("识别收入、退款；信用卡普通收入待确认；关闭交易不能强行恢复", () => {
    const parsed = rows(
      csvRow({ direction: "收入", id: "income" }),
      csvRow({ direction: "不计收支", status: "退款成功", id: "refund" }),
      csvRow({ status: "交易关闭", id: "closed" }),
    );
    const preview = buildPreview(parsed, [cash], [], mapping, { 4: { confirmed: true } });
    expect(preview[0].create!.activityType).toBe("DEPOSIT");
    expect(preview[1].create).toMatchObject({ activityType: "CREDIT", subtype: "REFUND" });
    expect(preview[2].status).toBe("excluded");
    expect(
      buildPreview(parsed, [account("card", "CREDIT_CARD")], [], { 账户余额: "card" }, {})[0]
        .status,
    ).toBe("review");
  });
  it("恢复映射只保留可用现金／信用卡账户，拒绝损坏配置", () => {
    const all = [
      cash,
      { ...account("archived"), isArchived: true },
      account("card", "CREDIT_CARD"),
      account("investment", "SECURITIES"),
      { ...account("holdings"), trackingMode: "HOLDINGS" as const },
    ];
    expect(eligibleAccounts(all).map((item) => item.id)).toEqual(["cash", "card"]);
    expect(
      restoreMappings(
        JSON.stringify({ a: "cash", b: "missing", c: "archived", d: "card", e: "investment" }),
        all,
      ),
    ).toEqual({ a: "cash", d: "card" });
    expect(restoreMappings(null, all)).toEqual({});
    expect(() => restoreMappings("[]", all)).toThrow();
  });
  it("未知版本或损坏来源不静默跳过", () => {
    const parsed = rows(csvRow());
    const stored = activity(buildPreview(parsed, [cash], [], mapping, {})[0].create!);
    stored.metadata = { [METADATA_KEY]: { version: 2, sources: [] } };
    expect(() => buildPreview(parsed, [cash], [stored], mapping, {})).toThrow("不兼容");
  });
});

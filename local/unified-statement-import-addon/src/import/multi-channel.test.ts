import { describe, expect, it, vi } from "vitest";
import type {
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
  InternalTransferPairResponse,
} from "@wealthfolio/addon-sdk";
import { parseStatementSync } from "../parsers";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { buildPreview, rowKey, sourceKey, type ExistingActivity } from "./ledger";
import { mappingKey, resolveAccount } from "./account-matching";
import { applyRules, restoreRules, type ImportRule } from "./rules";
import { createSubmitter } from "./session";
import { linkConfirmedTransfer, transferEntries, transferCandidates } from "./transfers";

function row() {
  return parseStatementSync(new TextEncoder().encode(`${HEADER}\n${csvRow()}`), "fixture.csv")
    .rows[0];
}
const rule = (changes: Partial<ImportRule> = {}): ImportRule => ({
  id: "rule",
  name: "合成规则",
  enabled: true,
  priority: 0,
  matchMode: "all",
  conditions: [],
  ignore: false,
  accountId: "cash",
  ...changes,
});

describe("P0 映射隔离与兼容", () => {
  it("归一化映射按渠道及来源账户隔离，旧映射只允许支付宝回退", () => {
    const source = row().source;
    const scoped = { [mappingKey(source)]: "cash" };
    expect(resolveAccount(source.paymentMethod, [account()], scoped, source).accountId).toBe(
      "cash",
    );
    expect(
      resolveAccount(source.paymentMethod, [account()], scoped, { ...source, system: "wechat" })
        .accountId,
    ).toBe("");
    expect(
      resolveAccount(source.paymentMethod, [account()], scoped, {
        ...source,
        sourceAccount: "another",
      }).accountId,
    ).toBe("");
    expect(
      resolveAccount(
        source.paymentMethod,
        [account()],
        { [source.paymentMethod]: "cash" },
        { ...source, system: "wechat" },
      ).accountId,
    ).toBe("");
  });
  it("两个文件相同行号的决定互不污染，重映射不改变来源身份", () => {
    const a = { ...row(), rowId: JSON.stringify(["a", "CSV", 2]) };
    const b = {
      ...row(),
      rowId: JSON.stringify(["b", "CSV", 2]),
      source: { ...row().source, recordId: "another" },
    };
    const preview = buildPreview(
      [a, b],
      [account()],
      [],
      {},
      { [rowKey(a)]: { accountId: "cash" } },
    );
    expect(preview.map((entry) => entry.status)).toEqual(["ready", "review"]);
    expect(sourceKey(a.source)).toBe(sourceKey({ ...a.source, sourceAccount: "other-alipay" }));
  });
});

describe("P3a 规则", () => {
  it("高优先级及同级后者覆盖，保存映射和逐行修改优先", () => {
    const r = row();
    const rules = [
      rule({ id: "high", priority: 10, accountId: "high" }),
      rule({ id: "low", priority: 0, accountId: "low" }),
      rule({ id: "last", priority: 10, accountId: "last" }),
    ];
    expect(applyRules(r.source, rules).accountId).toBe("last");
    const accounts = [account(), account("last"), account("saved"), account("manual")];
    expect(buildPreview([r], accounts, [], {}, {}, rules)[0].accountId).toBe("last");
    expect(
      buildPreview([r], accounts, [], { [mappingKey(r.source)]: "saved" }, {}, rules)[0].accountId,
    ).toBe("saved");
    expect(
      buildPreview(
        [r],
        accounts,
        [],
        { [mappingKey(r.source)]: "saved" },
        { [rowKey(r)]: { accountId: "manual" } },
        rules,
      )[0].accountId,
    ).toBe("manual");
  });
  it("忽略默认可恢复，禁用规则无效果，失效账户不会放行", () => {
    const r = row();
    const ignore = rule({ ignore: true, accountId: undefined });
    expect(buildPreview([r], [account()], [], {}, {}, [ignore])[0].status).toBe("excluded");
    expect(
      buildPreview(
        [r],
        [account()],
        [],
        {},
        { [rowKey(r)]: { excluded: false, accountId: "cash" } },
        [ignore],
      )[0].status,
    ).toBe("ready");
    expect(applyRules(r.source, [rule({ enabled: false })]).matched).toEqual([]);
    expect(buildPreview([r], [], [], {}, {}, [rule()])[0].status).toBe("review");
  });
  it("AND/ANY、关键词OR、银行别名、金额区间及上海跨夜时间", () => {
    const source = {
      ...row().source,
      paymentMethod: "招行信用卡(1234)",
      date: "2025-01-01T16:30:00.000Z",
      amount: "100000000000000000.001",
    };
    const match = rule({
      conditions: [{ field: "paymentMethod", operator: "contains", value: "农行,招商银行" }],
      minAmount: "100000000000000000",
      maxAmount: "100000000000000000.01",
      timeRange: "23:00-01:00",
    });
    expect(applyRules(source, [match]).matched).toHaveLength(1);
    expect(applyRules(source, [{ ...match, timeRange: "12:00-13:00" }]).matched).toHaveLength(0);
    const impossible = {
      field: "merchant" as const,
      operator: "equals" as const,
      value: "不会命中",
    };
    expect(
      applyRules(source, [{ ...match, conditions: [...match.conditions, impossible] }]).matched,
    ).toHaveLength(0);
    expect(
      applyRules(source, [
        { ...match, matchMode: "any", conditions: [...match.conditions, impossible] },
      ]).matched,
    ).toHaveLength(1);
  });
  it("拒绝损坏配置、无动作、重复ID和非法时间，不静默忽略", () => {
    for (const value of [
      "{}",
      "[{}]",
      JSON.stringify([rule(), rule()]),
      JSON.stringify([rule({ timeRange: "25:00-26:00" })]),
      JSON.stringify([rule({ accountId: undefined })]),
    ])
      expect(() => restoreRules(value)).toThrow();
  });
});

describe("P3b 手续费分步恢复", () => {
  function fixture() {
    const r = row();
    r.source.fee = "0.50";
    const decisions = {
      [rowKey(r)]: {
        accountId: "cash",
        amount: "11.80",
        feeAmount: "0.50",
        feeAccountId: "fee",
        feeConfirmed: true,
        confirmed: true,
      },
    };
    return { r, decisions, accounts: [account(), account("fee")] };
  }
  it("主流水与费用各自保存来源，一部分成功后只补缺失部分", () => {
    const { r, decisions, accounts } = fixture();
    const preview = buildPreview([r], accounts, [], {}, decisions)[0];
    expect(
      preview.creates?.map((create) => [create.activityType, create.amount, create.accountId]),
    ).toEqual([
      ["WITHDRAWAL", "11.80", "cash"],
      ["FEE", "0.50", "fee"],
    ]);
    const main = activity(preview.creates![0], "main");
    const fee = activity(preview.creates![1], "fee");
    expect(
      buildPreview([r], accounts, [main], {}, decisions)[0].creates?.map(
        (create) => create.activityType,
      ),
    ).toEqual(["FEE"]);
    expect(
      buildPreview([r], accounts, [fee], {}, decisions)[0].creates?.map(
        (create) => create.activityType,
      ),
    ).toEqual(["WITHDRAWAL"]);
    expect(buildPreview([r], accounts, [main, fee], {}, decisions)[0].status).toBe("duplicate");
  });
  it("费用未确认或账户缺失不能保存", () => {
    const { r, decisions, accounts } = fixture();
    expect(
      buildPreview(
        [r],
        accounts,
        [],
        {},
        { [rowKey(r)]: { ...decisions[rowKey(r)], feeConfirmed: false } },
      )[0].status,
    ).toBe("review");
    expect(buildPreview([r], [account()], [], {}, decisions)[0].status).toBe("review");
  });
  it("保存响应丢失先重读，恢复后不重复保存任何组成部分", async () => {
    const { r, decisions, accounts } = fixture();
    const stored: ExistingActivity[] = [];
    const saveMany = vi.fn(
      async ({
        creates = [],
      }: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult> => {
        stored.push(...creates.map((create, index) => activity(create, String(index))));
        throw new Error("lost response");
      },
    );
    const host = {
      accounts: { getAll: async () => accounts },
      activities: { getAll: async () => stored, saveMany },
    };
    const submit = createSubmitter(host);
    const result = await submit([r], {}, decisions, buildPreview([r], accounts, [], {}, decisions));
    expect(result.outcome).toBe("uncertain");
    expect(result.preview[0].status).toBe("duplicate");
    expect((await submit([r], {}, decisions, result.preview)).outcome).toBe("empty");
    expect(saveMany).toHaveBeenCalledTimes(1);
  });
});

describe("P3b 转账关联恢复", () => {
  it("购汇候选严格限制来源账户、摘要、币种和时间窗，随手记使用关联 ID", () => {
    const source = {
      ...row().source,
      system: "cib",
      sourceAccount: "bank",
      txType: "购汇",
      currency: "CNY",
      date: "2025-01-01T04:00:00.000Z",
    };
    const out = {
      id: "out",
      kind: "transferOut",
      accountId: "cash",
      amount: "100.00",
      source,
      sourceKey: "out",
    };
    const incoming = {
      ...out,
      id: "in",
      kind: "transferIn",
      sourceKey: "in",
      source: { ...source, currency: "USD", date: "2025-01-01T04:03:00.000Z" },
    };
    expect(transferCandidates([out, incoming], "out").map((entry) => entry.id)).toEqual(["in"]);
    for (const change of [
      { sourceAccount: "other" },
      { txType: "结汇" },
      { currency: "CNY" },
      { date: "2025-01-01T04:03:01.000Z" },
    ])
      expect(
        transferCandidates(
          [out, { ...incoming, source: { ...incoming.source, ...change } }],
          "out",
        ),
      ).toEqual([]);
    const a = { ...out, source: { ...source, system: "feidee", relatedId: "related-1" } };
    const b = {
      ...incoming,
      source: { ...incoming.source, system: "feidee", relatedId: "related-1" },
    };
    expect(transferCandidates([a, b], "out")).toHaveLength(1);
  });
  it("配对候选读取宿主当前金额、账户和类型，保留用户对原记录的修改", () => {
    const r = row();
    const preview = buildPreview(
      [r],
      [account()],
      [],
      {},
      { [rowKey(r)]: { accountId: "cash", kind: "transferOut", confirmed: true } },
    );
    const saved = activity(preview[0].create!);
    expect(transferEntries([{ ...saved, amount: "999.00", accountId: "manual" }])[0]).toMatchObject(
      { amount: "999.00", accountId: "manual" },
    );
    expect(transferEntries([{ ...saved, activityTypeOverride: "WITHDRAWAL" }])).toEqual([]);
    expect(saved.metadata?.unifiedStatementImport).toMatchObject({
      booking: { amount: "12.30", accountId: "cash" },
    });
  });
  const pair = {
    transferOut: { id: "out" },
    transferIn: { id: "in" },
  } as InternalTransferPairResponse;
  it("已配对不重复调用；新配对响应丢失后从宿主确认成功", async () => {
    let linked = false;
    const host = {
      getTransferPair: vi.fn(async () => (linked ? pair : null)),
      linkTransfer: vi.fn(async () => {
        linked = true;
        throw new Error("lost");
      }),
    };
    await linkConfirmedTransfer(host, "out", "in");
    await linkConfirmedTransfer(host, "out", "in");
    expect(host.linkTransfer).toHaveBeenCalledTimes(1);
  });
  it("已有其他配对时不写入，未确认失败不自动重试", async () => {
    const blocked = {
      getTransferPair: vi.fn(
        async () => ({ ...pair, transferOut: { id: "other" } }) as InternalTransferPairResponse,
      ),
      linkTransfer: vi.fn(),
    };
    await expect(linkConfirmedTransfer(blocked, "out", "in")).rejects.toThrow("已关联");
    expect(blocked.linkTransfer).not.toHaveBeenCalled();
    const failed = {
      getTransferPair: vi.fn(async () => null),
      linkTransfer: vi.fn(async () => {
        throw new Error("failed");
      }),
    };
    await expect(linkConfirmedTransfer(failed, "out", "in")).rejects.toThrow("未确认");
    expect(failed.linkTransfer).toHaveBeenCalledTimes(1);
  });
});

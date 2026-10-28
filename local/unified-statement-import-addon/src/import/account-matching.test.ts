import { describe, expect, it } from "vitest";
import { account } from "../test-fixtures";
import { inferAccount, normalizeInstrument, resolveAccount } from "./account-matching";

const card = { ...account("card", "CREDIT_CARD"), name: "招商银行信用卡", accountNumber: "622200001234" };

describe("账户推断", () => {
  it.each([
    ["招商银行信用卡（１２３４）", "招商银行信用卡", "1234"],
    ["招商银行信用卡 1234", "招商银行信用卡", "1234"],
    ["招商银行信用卡****1234", "招商银行信用卡", "1234"],
    ["招商银行信用卡(****1234)", "招商银行信用卡", "1234"],
    ["招商银行信用卡尾号1234", "招商银行信用卡", "1234"],
    ["６２２２００００１２３４", "", "1234"],
    ["ＡＢＣ · 银行-_账户", "abc银行账户", undefined],
    ["我的2024年账户", "我的2024年账户", undefined],
    ["我的2024", "我的2024", undefined],
  ])("归一化 %s，先提取尾号且不修改原值", (input, base, suffix) => {
    expect(normalizeInstrument(input!)).toEqual({ base, suffix });
  });

  it("尾号和类型一致唯一时自动预填，金额日期不参与账户推断", () => {
    const result = inferAccount("招商银行信用卡(1234)", [card, { ...card, id: "other", accountNumber: "5678" }]);
    expect(result.accountId).toBe("card");
    expect(result.candidates).toEqual([expect.objectContaining({
      accountId: "card", confidence: "high", score: 200,
      reasons: ["卡尾号一致", "账户名称完全一致", "账户类型一致"],
    })]);
  });

  it("双向前缀不同权重，唯一高置信可以与弱候选共存", () => {
    const result = inferAccount("招商银行信用卡(1234)", [
      { ...card, name: "招商银行", accountNumber: undefined },
      { ...card, id: "weak", name: "招商银行信用卡主卡", accountNumber: undefined },
    ]);
    expect(result.accountId).toBe("card");
    expect(result.candidates.map(({ confidence, score }) => [confidence, score])).toEqual([
      ["high", 64], ["medium", 47],
    ]);
  });

  it("多个高置信无论分差多大都不预填", () => {
    const result = inferAccount("招商银行信用卡(1234)", [card, { ...card, id: "second", name: "招商银行", accountNumber: undefined }]);
    expect(result.candidates.map((candidate) => candidate.confidence)).toEqual(["high", "high"]);
    expect(result.accountId).toBeUndefined();
  });

  it("短前缀、包含和泛化名称只推荐，不自动填入", () => {
    for (const [method, name] of [["招行信用卡", "招行"], ["信用卡", "招商银行信用卡"], ["信用卡", "信用卡"], ["账户余额", "账户余额"]]) {
      const result = inferAccount(method, [{ ...account("candidate", method === "账户余额" ? "CASH" : "CREDIT_CARD"), name }]);
      expect(result.candidates[0].confidence).toBe("medium");
      expect(result.accountId).toBeUndefined();
    }
  });

  it("非泛化名称完全一致可预填，尾号单独匹配没有类型仅低置信", () => {
    expect(inferAccount("日常钱包", [{ ...account(), name: "日常钱包" }]).accountId).toBe("cash");
    expect(inferAccount("其他银行 (1234)", [card])).toMatchObject({ candidates: [{ confidence: "low" }] });
    expect(inferAccount("其他银行 (1234)", [card]).accountId).toBeUndefined();
  });

  it("账户名和账号的尾号冲突不能自动预填", () => {
    const result = inferAccount("招商银行信用卡", [{ ...card, name: "招商银行信用卡(5678)" }]);
    expect(result.accountId).toBeUndefined();
    expect(result.candidates[0].reasons).toContain("账户名与账号尾号不一致");
  });

  it("过滤尾号、账户类型冲突和所有不可用账户", () => {
    const unavailable = [
      { ...card, isActive: false }, { ...card, isArchived: true }, { ...card, currency: "USD" },
      { ...card, trackingMode: "HOLDINGS" as const }, { ...card, accountType: "SECURITIES" as const },
      { ...card, accountNumber: "5678" }, { ...card, accountType: "CASH" as const },
    ];
    expect(inferAccount("招商银行信用卡(1234)", unavailable).candidates).toEqual([]);
    for (const method of ["储蓄卡", "借记卡", "账户余额", "余额", "零钱", "余额宝"]) {
      expect(inferAccount(method, [{ ...card, name: method }]).candidates).toEqual([]);
    }
    for (const method of ["信用卡", "贷记卡", "花呗", "白条", "分付"]) {
      expect(inferAccount(method, [{ ...account(), name: method }]).candidates).toEqual([]);
    }
    expect(inferAccount("", [card]).candidates).toEqual([]);
    expect(inferAccount("账户", [{ ...account(), name: "账户余额" }]).candidates[0].reasons).not.toContain("账户类型一致");
  });

  it("显式映射优先且不受推断类型约束；清空和失效映射不被推断覆盖", () => {
    const accounts = [card, account()];
    const method = "招商银行信用卡";
    expect(resolveAccount(method, accounts, {}).accountId).toBe("card");
    expect(resolveAccount(method, accounts, { [method]: "cash" })).toMatchObject({ accountId: "cash", origin: "saved" });
    expect(resolveAccount(method, accounts, { [method]: "" }).accountId).toBe("");
    expect(resolveAccount(method, accounts, { [method]: "missing" }).accountId).toBe("");
  });
});

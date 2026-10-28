import type { Account, Activity, ActivityCreate } from "@wealthfolio/addon-sdk";

export const HEADER =
  "交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注";

export function csvRow(
  overrides: Partial<
    Record<"direction" | "amount" | "method" | "status" | "id" | "date" | "description", string>
  > = {},
): string {
  const {
    direction = "支出",
    amount = "12.30",
    method = "账户余额",
    status = "交易成功",
    id = "fictional-order-1",
    date = "2025/12/31 14:23",
    description = "测试商品",
  } = overrides;
  return [
    date,
    "餐饮美食",
    "虚构商户",
    "/",
    description,
    direction,
    amount,
    method,
    status,
    id,
    "fictional-merchant-order",
    "",
  ]
    .map((cell) => `"${cell.replaceAll('"', '""')}"`)
    .join(",");
}

export function demoFixture(): string {
  const rows = Array.from({ length: 52 }, (_, index) =>
    csvRow({
      id: `fictional-order-${index}`,
      direction: index < 26 ? "支出" : index < 30 ? "收入" : "不计收支",
      status: index >= 50 ? "交易关闭" : "交易成功",
    }),
  );
  return ["支付宝账户：fictional-account", "共1778笔记录", "", HEADER, ...rows].join("\r\n");
}

export function account(id = "cash", accountType: Account["accountType"] = "CASH"): Account {
  return {
    id,
    accountType,
    name: id,
    currency: "CNY",
    balance: 0,
    isActive: true,
    isArchived: false,
    isDefault: false,
    trackingMode: "TRANSACTIONS",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function activity(create: ActivityCreate, id = "stored-1"): Activity {
  return {
    id,
    accountId: create.accountId,
    activityType: create.activityType,
    subtype: create.subtype ?? undefined,
    activityDate: String(create.activityDate),
    currency: create.currency ?? "CNY",
    status: "POSTED",
    amount: String(create.amount),
    notes: create.comment ?? undefined,
    metadata: create.metadata as Record<string, unknown>,
    isUserModified: false,
    needsReview: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

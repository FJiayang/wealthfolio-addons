import type { Account, Activity, ActivityCreate } from "@wealthfolio/addon-sdk";
import { normalizeAmount } from "../parsers/csv";
import type { EntryKind, StatementRow, StatementSource } from "../parsers/types";
import { getStatementParser } from "../parsers";
import { eligibleAccounts, resolveAccount, type Mappings } from "./account-matching";
export { eligibleAccounts } from "./account-matching";
export type { Mappings } from "./account-matching";

export const METADATA_KEY = "unifiedStatementImport";
export const MAPPING_KEY = "payment-account-mappings-v1";
export type ExistingActivity = Pick<Activity, "id" | "metadata">;
export interface RowDecision {
  accountId?: string;
  kind?: EntryKind;
  amount?: string;
  confirmed?: boolean;
  excluded?: boolean;
}
export type Decisions = Record<number, RowDecision>;
export type PreviewStatus = "ready" | "duplicate" | "excluded" | "review" | "error";
export interface PreviewRow {
  row: StatementRow;
  accountId: string;
  kind?: EntryKind;
  amount: string;
  status: PreviewStatus;
  reason: string;
  create?: ActivityCreate;
}

export function restoreMappings(value: string | null, accounts: Account[]): Mappings {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("账户映射配置格式不正确，请重置映射。");
  const eligible = new Set(eligibleAccounts(accounts).map((account) => account.id));
  return Object.fromEntries(
    Object.entries(parsed).filter(([, id]) => typeof id === "string" && eligible.has(id)),
  );
}

export function sourceKey(source: Pick<StatementSource, "system" | "recordId">): string {
  return JSON.stringify([source.system, source.recordId]);
}

export function sourceFingerprint(source: StatementSource): string {
  return JSON.stringify([
    source.date,
    source.amount,
    source.currency,
    source.direction,
    source.paymentMethod,
    source.status,
    source.merchantOrderId,
    source.merchant,
    source.description,
  ]);
}

function readSources(activity: ExistingActivity): StatementSource[] {
  const metadata = activity.metadata?.[METADATA_KEY];
  if (metadata === undefined) return [];
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("version" in metadata) ||
    metadata.version !== 1 ||
    !("sources" in metadata) ||
    !Array.isArray(metadata.sources)
  )
    throw new Error("已有账目包含不兼容的导入来源信息，已停止检测；请先检查该插件版本。");
  const sources: StatementSource[] = [];
  for (const source of metadata.sources) {
    if (
      !source ||
      typeof source !== "object" ||
      [
        "system",
        "recordId",
        "date",
        "amount",
        "currency",
        "direction",
        "paymentMethod",
        "status",
        "merchantOrderId",
        "merchant",
        "description",
      ].some((key) => typeof source[key] !== "string")
    )
      throw new Error("已有账目的导入来源信息不完整，已停止检测。");
    sources.push(source as StatementSource);
  }
  return sources;
}

export function buildPreview(
  rows: StatementRow[],
  accounts: Account[],
  activities: ExistingActivity[],
  mappings: Mappings,
  decisions: Decisions,
): PreviewRow[] {
  const accountsById = new Map(eligibleAccounts(accounts).map((account) => [account.id, account]));
  const existing = new Map<string, { id: string; source: StatementSource }[]>();
  for (const activity of activities) {
    for (const source of readSources(activity)) {
      const key = sourceKey(source);
      existing.set(key, [...(existing.get(key) ?? []), { id: activity.id, source }]);
    }
  }
  const batch = new Map<string, Set<string>>();
  for (const { source } of rows) {
    if (source.recordId) {
      const key = sourceKey(source);
      const fingerprints = batch.get(key) ?? new Set<string>();
      fingerprints.add(sourceFingerprint(source));
      batch.set(key, fingerprints);
    }
  }
  const seen = new Set<string>();
  const resolvedAccounts = new Map(
    [...new Set(rows.map(({ source }) => source.paymentMethod))].map((method) => [
      method, resolveAccount(method, accounts, mappings).accountId,
    ]),
  );
  return rows.map((row) => {
    const { source } = row;
    const decision = decisions[source.lineNumber] ?? {};
    const accountId = decision.accountId ?? resolvedAccounts.get(source.paymentMethod) ?? "";
    const kind = decision.kind ?? row.kind;
    let amount = decision.amount ?? source.amount;
    const result = (
      status: PreviewStatus,
      reason: string,
      create?: ActivityCreate,
    ): PreviewRow => ({ row, accountId, kind, amount, status, reason, create });
    if (row.excluded || decision.excluded)
      return result("excluded", row.excluded ? "交易关闭" : "用户排除");
    if (row.error) return result("error", row.error);
    if (!source.recordId) return result("review", "缺少交易订单号，请排除并核实原始账单");
    const key = sourceKey(source);
    const matches = existing.get(key) ?? [];
    if (new Set(matches.map(({ id }) => id)).size > 1)
      return result("review", "同一订单已关联多笔账目，请先核对");
    if (
      (batch.get(key)?.size ?? 0) > 1 ||
      matches.some(({ source: stored }) => sourceFingerprint(stored) !== sourceFingerprint(source))
    )
      return result("error", "来源订单内容冲突，不会覆盖已有账目");
    if (matches.length) return result("duplicate", "此订单已经导入，保留现有账目");
    if (seen.has(key)) return result("duplicate", "本批次已有相同订单");
    // Only claim a batch key when a row can actually be submitted.
    if (row.reviewReason && !decision.confirmed) return result("review", row.reviewReason);
    if (!kind) return result("review", "请选择收入、支出或退款");
    const account = accountsById.get(accountId);
    if (!account) return result("review", "请选择可用的 CNY 现金或信用卡账户");
    if (kind === "income" && account.accountType === "CREDIT_CARD")
      return result("review", "普通收入须选择现金账户；还款暂不支持");
    try {
      amount = normalizeAmount(amount);
    } catch {
      return result("error", "确认金额格式不正确");
    }
    if (amount === "0.00") return result("review", "零金额记录不提交");
    seen.add(key);
    const create: ActivityCreate = {
      accountId,
      activityType: kind === "expense" ? "WITHDRAWAL" : kind === "income" ? "DEPOSIT" : "CREDIT",
      ...(kind === "refund" ? { subtype: "REFUND" } : {}),
      activityDate: source.date,
      amount,
      currency: source.currency,
      status: "POSTED",
      comment: [
        source.merchant,
        source.description,
        source.remark,
        `${getStatementParser(source.system).recordIdLabel}：${source.recordId}`,
      ]
        .filter(Boolean)
        .join(" · "),
      metadata: {
        [METADATA_KEY]: {
          version: 1,
          sources: [source],
          booking: { kind, amount, accountId, confirmed: Boolean(decision.confirmed) },
        },
      },
    };
    return result("ready", "已就绪", create);
  });
}

export function previewSignature(preview: PreviewRow[]): string {
  return JSON.stringify(
    preview.map(({ row, accountId, status, reason, create }) => [
      row.source.lineNumber,
      accountId,
      status,
      reason,
      create,
    ]),
  );
}

import type { Account, Activity, ActivityCreate, ActivityUpdate, AssetResolutionInput } from "@wealthfolio/addon-sdk";
import type { DraftLeg } from "../ant-fund/import-model";
import { addFundingCounterpart, applyInvestmentLinks, fundPreview, investmentCashKind, isInvestmentCash, type ImportOptions, type InvestmentLink } from "./investments";
import { applyAssociations, type Association } from "./associations";
import { normalizeAmount } from "../parsers/csv";
import {
  entryActivityTypes,
  type EntryKind,
  type StatementRow,
  type StatementSource,
} from "../parsers/types";
import { getStatementParser } from "../parsers";
import { decimal, compare } from "../parsers/decimal";
import { applyRules, type ImportRule } from "./rules";
import { resolveAccount, type Mappings } from "./account-matching";
export type { Mappings } from "./account-matching";

export const METADATA_KEY = "unifiedStatementImport";
export const MAPPING_KEY = "payment-account-mappings-v1";
export const MAPPING_V2_KEY = "payment-account-mappings-v2";
export type ExistingActivity = Pick<Activity, "id" | "metadata"> &
  Partial<
    Pick<
      Activity,
      "accountId" | "activityType" | "activityTypeOverride" | "amount" | "currency" | "activityDate" |
      "assetId" | "quantity" | "unitPrice" | "fee" | "tax" | "notes" | "sourceGroupId"
    >
  > & { assetSymbol?: string; comment?: string | null; subtype?: string | null; date?: string | Date };
export function activityDate(activity: ExistingActivity): string {
  return activity.activityDate ?? (activity.date instanceof Date ? activity.date.toISOString() : activity.date ?? "");
}
export interface RowDecision {
  fundLegs?: DraftLeg[];
  fundAssets?: Record<string, AssetResolutionInput>;
  fundChecked?: string;
  fundError?: string;
  investmentAccountId?: string;
  investmentPeerKey?: string;
  noInvestmentLink?: boolean;
  cancelledAssociations?: string[];
  feeConfirmed?: boolean;
  feeAccountId?: string;
  feeAmount?: string;
  accountId?: string;
  kind?: EntryKind;
  amount?: string;
  confirmed?: boolean;
  excluded?: boolean;
}
export type Decisions = Record<string, RowDecision>;
export const rowKey = (row: StatementRow): string => row.rowId ?? String(row.source.lineNumber);
export type PreviewStatus = "ready" | "duplicate" | "excluded" | "review" | "error";
export interface PreviewRow {
  investmentLink?: InvestmentLink;
  association?: Association;
  updates?: ActivityUpdate[];
  row: StatementRow;
  accountId: string;
  kind?: EntryKind;
  amount: string;
  status: PreviewStatus;
  reason: string;
  create?: ActivityCreate;
  creates?: ActivityCreate[];
  existingIds?: string[];
}

export function restoreMappings(value: string | null, accounts: Account[]): Mappings {
  if (!value) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("账户映射配置格式不正确，请重置映射。");
  const available = new Set(accounts.map((account) => account.id));
  return Object.fromEntries(
    Object.entries(parsed).filter(([, id]) => typeof id === "string" && available.has(id)),
  );
}

export function sourceKey(
  source: Pick<StatementSource, "system" | "recordId" | "sourceAccount">,
): string {
  return JSON.stringify(
    source.sourceAccount && !["alipay", "wechat", "jd", "mt", "ant-fund"].includes(source.system)
      ? [source.system, source.sourceAccount, source.recordId]
      : [source.system, source.recordId],
  );
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
    source.fee,
    source.balance,
    source.peerAccount,
    source.signedAmount,
  ]);
}

export function sourcesConflict(left: StatementSource, right: StatementSource): boolean {
  if (left.investment && right.investment) {
    const content = (source: StatementSource) => JSON.stringify(source.investment!.legs
      .map((leg) => [leg.activityType, leg.code, leg.date, decimal(leg.amount || "0"), decimal(leg.quantity || "0"), decimal(leg.fee || "0"), decimal(leg.tax || "0")])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    return content(left) !== content(right);
  }
  if (
    left.variantId === right.variantId ||
    (!left.variantId && right.variantId === "alipay-detail-csv") ||
    (!right.variantId && left.variantId === "alipay-detail-csv")
  )
    return sourceFingerprint(left) !== sourceFingerprint(right);
  const fields = [
    "date",
    "amount",
    "currency",
    "direction",
    "paymentMethod",
    "status",
    "merchantOrderId",
    "merchant",
    "description",
    "fee",
    "signedAmount",
  ] as const;
  return fields.some((field) =>
    Boolean(left[field] && right[field] && left[field] !== right[field]),
  );
}

export function readSources(activity: ExistingActivity): StatementSource[] {
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
      ].some((key) => typeof source[key] !== "string") ||
      [
        "variantId",
        "sourceAccount",
        "sheetName",
        "balance",
        "peerAccount",
        "txType",
        "relatedId",
        "fee",
        "datePrecision",
        "signedAmount",
        "transactionAmount",
        "transactionCurrency",
      ].some((key) => source[key] !== undefined && typeof source[key] !== "string") ||
      ["pageNumber", "pageLineNumber"].some((key) => source[key] !== undefined && (!Number.isInteger(source[key]) || Number(source[key]) < 1)) ||
      (source.compositeIdentity !== undefined && typeof source.compositeIdentity !== "boolean")
    )
      throw new Error("已有账目的导入来源信息不完整，已停止检测。");
    if (source.investment !== undefined) {
      const investment = source.investment;
      if (!investment || typeof investment.orderId !== "string" || typeof investment.purpose !== "string" ||
        !Array.isArray(investment.legs) || investment.legs.some((leg: Record<string, unknown>) =>
          !leg || ["code", "date", "activityType", "amount", "quantity", "fee"].some((field) => typeof leg[field] !== "string")))
        throw new Error("已有基金来源信息不完整，已停止检测。");
    }
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
  rules: ImportRule[] = [],
  options: ImportOptions = {},
): PreviewRow[] {
  rows = rows.map((row) => options.recognizeInvestments && isInvestmentCash(row) && !row.error && !row.excluded
    ? { ...row, unsupportedReason: undefined, defaultExcluded: false, parseStatus: "ok" as const,
      transfer: true, reviewReason: undefined,
      kind: investmentCashKind(row) }
    : row);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const existing = new Map<string, { id: string; source: StatementSource; component: string }[]>();
  for (const activity of activities) {
    for (const source of readSources(activity)) {
      const key = sourceKey(source);
      const metadata = activity.metadata?.[METADATA_KEY] as { booking?: { component?: string } };
      const component = metadata.booking?.component ?? "main";
      if (!["main", "fee", "counterpart"].includes(component) && !/^trade:(BUY|SELL|DIVIDEND):\d{6}$/.test(component))
        throw new Error("已有账目的导入组成部分不兼容。");
      existing.set(key, [...(existing.get(key) ?? []), { id: activity.id, source, component }]);
    }
  }
  const batch = new Map<string, StatementSource[]>();
  for (const { source } of rows) {
    if (source.recordId) {
      const key = sourceKey(source);
      batch.set(key, [...(batch.get(key) ?? []), source]);
    }
  }
  const seen = new Set<string>();
  const preview = rows.map((row) => {
    const { source } = row;
    const decision = decisions[rowKey(row)] ?? {};
    const rule = row.error
      ? { accountId: undefined, ignored: false, matched: [] }
      : applyRules(source, rules);
    const accountId =
      decision.accountId ??
      resolveAccount(source.paymentMethod, accounts, mappings, source, rule.accountId).accountId;
    const kind = decision.kind ?? row.kind;
    let amount = decision.amount ?? source.amount;
    const result = (
      status: PreviewStatus,
      reason: string,
      create?: ActivityCreate,
    ): PreviewRow => ({ row, accountId, kind, amount, status, reason, create });
    const hardSkip = row.parseStatus === "hardSkip" || row.excluded;
    if (hardSkip || decision.excluded)
      return result("excluded", hardSkip ? source.status || "交易关闭" : "用户排除");
    if (
      (row.parseStatus ? row.parseStatus === "softSkip" : row.defaultExcluded) &&
      decision.excluded !== false
    )
      return result("excluded", row.skipReason ?? "不计收支，默认跳过个人记账");
    if (rule.ignored && decision.excluded !== false)
      return result("excluded", `规则忽略：${rule.matched.join("、")}`);
    if (source.investment) {
      if (!options.recognizeInvestments) return result("excluded", "投资识别未开启");
      if (batch.get(sourceKey(source))?.some((other) => sourcesConflict(source, other)))
        return result("error", "同批基金订单来源内容冲突，请核对");
      if (seen.has(sourceKey(source))) return result("duplicate", "本批次已有相同基金订单");
      const investment = fundPreview(row, accountId, accounts, activities, decision);
      if (investment.status === "ready") seen.add(sourceKey(source));
      return investment;
    }
    if (row.parseStatus === "fatal" || row.error)
      return result("error", row.error ?? "来源行格式错误，请修正原文件或明确跳过");
    if (row.unsupportedReason) return result("review", row.unsupportedReason);
    if (row.identityReason) return result("review", row.identityReason);
    if (!source.recordId) return result("review", "缺少交易订单号，请排除并核实原始账单");
    const key = sourceKey(source);
    const matches = existing.get(key) ?? [];
    if (
      ["main", "fee"].some(
        (component) =>
          new Set(matches.filter((match) => match.component === component).map(({ id }) => id))
            .size > 1,
      )
    )
      return result("review", "同一订单已关联多笔账目，请先核对");
    if (
      batch.get(key)?.some((other) => sourcesConflict(other, source)) ||
      matches.some(({ source: stored }) => sourcesConflict(stored, source))
    )
      return result("error", "来源订单内容冲突，不会覆盖已有账目");
    if (
      source.compositeIdentity &&
      rows.some(
        (other) =>
          other !== row &&
          sourceKey(other.source) === key &&
          (other.rowId ? JSON.parse(other.rowId)[0] : other.source.fileName) ===
            (row.rowId ? JSON.parse(row.rowId)[0] : source.fileName),
      )
    )
      return result("review", "复合身份存在多笔相同流水，请补充稳定参考号或跳过");
    const hasMain = matches.some((match) => match.component === "main");
    const hasFee = matches.some((match) => match.component === "fee");
    const hasSourceFee = source.fee !== undefined && compare(source.fee, "0") > 0;
    if (hasMain && options.recognizeInvestments && isInvestmentCash(row) &&
      !matches.some((match) => match.component === "counterpart"))
      return result("review", "已有投资资金转账缺少对侧，请先核对历史流水");
    if (hasMain && (!hasSourceFee || hasFee))
      return {
        ...result("duplicate", "此订单已经导入，保留现有账目"),
        existingIds: matches.map((match) => match.id),
      };
    if (seen.has(key)) return result("duplicate", "本批次已有相同订单");
    // Only claim a batch key when a row can actually be submitted.
    if (!kind) return result("review", "请选择收入、支出或退款");
    const account = accountsById.get(accountId);
    if (!account) return result("review", "请选择账户");
    try {
      amount = source.system === "alipay" ? normalizeAmount(amount) : decimal(amount);
      if (compare(amount, "0") < 0) throw new Error("确认金额不能为负数");
    } catch {
      return result("error", "确认金额格式不正确");
    }
    if (amount === "0.00") return result("review", "零金额记录不提交");
    if (row.reviewReason && !decision.confirmed) return result("review", row.reviewReason);
    if (
      (row.transfer || kind === "transferIn" || kind === "transferOut") &&
      (!decision.confirmed || !["transferIn", "transferOut"].includes(kind))
    )
      return result("review", "请确认转账方向及实际账户，不得作为普通收支导入");
    if (hasSourceFee && (!decision.feeConfirmed || !accountsById.has(decision.feeAccountId ?? "")))
      return result("review", "请确认主流水金额、手续费金额及实际扣费账户");
    const create: ActivityCreate = {
      accountId,
      activityType: entryActivityTypes[kind],
      ...(kind === "refund" ? { subtype: "REFUND" } : {}),
      activityDate: source.date,
      amount,
      currency: source.currency,
      status: "POSTED",
      comment: [
        source.merchant,
        source.description,
        source.remark,
        source.category.trim() && getStatementParser(source.system).categoryLabel
          ? `${getStatementParser(source.system).categoryLabel}：${source.category.trim()}`
          : "",
        `${getStatementParser(source.system).recordIdLabel}：${source.recordId}`,
      ]
        .filter(Boolean)
        .join(" · "),
      metadata: {
        [METADATA_KEY]: {
          version: 1,
          sources: [source],
          booking: {
            kind,
            amount,
            accountId,
            component: "main",
            confirmed: Boolean(decision.confirmed),
          },
        },
      },
    };
    const creates = hasMain ? [] : [create];
    if (hasSourceFee && !hasFee) {
      let fee: string;
      try {
        fee = decimal(decision.feeAmount ?? source.fee!);
      } catch {
        return result("error", "手续费金额格式不正确");
      }
      if (compare(fee, "0") <= 0) return result("error", "手续费必须大于零");
      creates.push({
        ...create,
        accountId: decision.feeAccountId!,
        activityType: "FEE",
        subtype: undefined,
        amount: fee,
        comment: `${create.comment} · 手续费`,
        metadata: {
          [METADATA_KEY]: {
            version: 1,
            sources: [source],
            booking: { component: "fee", amount: fee, accountId: decision.feeAccountId },
          },
        },
      });
    }
    seen.add(key);
    return {
      ...result("ready", "已就绪", creates[0]),
      creates,
      existingIds: matches.map((match) => match.id),
    };
  });
  if (options.recognizeInvestments) {
    for (const entry of preview)
      if (isInvestmentCash(entry.row)) addFundingCounterpart(entry, decisions[rowKey(entry.row)] ?? {}, accounts);
    return applyInvestmentLinks(applyAssociations(preview, activities, decisions), activities, decisions);
  }
  return applyAssociations(preview, activities, decisions);
}

export function previewSignature(preview: PreviewRow[]): string {
  return JSON.stringify(
    preview.map(({ row, accountId, status, reason, create, creates, updates }) => [
      rowKey(row),
      accountId,
      status,
      reason,
      create,
      creates,
      updates,
    ]),
  );
}

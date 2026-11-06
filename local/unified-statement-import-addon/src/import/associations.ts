import type { ActivityCreate, ActivityUpdate } from "@wealthfolio/addon-sdk";
import { profiles } from "../parsers/profiles";
import { compare, decimal } from "../parsers/decimal";
import type { StatementSource } from "../parsers/types";
import { METADATA_KEY, activityDate, readSources, rowKey, sourceKey, type Decisions, type ExistingActivity, type PreviewRow } from "./ledger";

export interface Association {
  peerSourceKey: string;
  role: "payment" | "bank";
  originalAmount: string;
}
interface ImportMetadata {
  version: 1;
  sources: StatementSource[];
  booking: { component: string; kind?: string; amount: string; accountId: string; confirmed?: boolean };
  association?: Association;
  cancelledAssociations?: string[];
}
interface Node {
  key: string;
  source: StatementSource;
  metadata: ImportMetadata;
  accountId: string;
  amount: string;
  activity?: ExistingActivity;
  create?: ActivityCreate;
  entry?: PreviewRow;
}
const paymentSystems = new Set(["alipay", "wechat", "jd", "mt"]);

function metadata(activity: Pick<ExistingActivity, "metadata">): ImportMetadata {
  const value = activity.metadata?.[METADATA_KEY] as ImportMetadata;
  const association = value?.association;
  if (association !== undefined && (!association || typeof association.peerSourceKey !== "string" || !["payment", "bank"].includes(association.role) || typeof association.originalAmount !== "string" || compare(association.originalAmount, "0") <= 0))
    throw new Error("已有账目的关联信息不完整，请核对后再导入。");
  if (value?.cancelledAssociations !== undefined && (!Array.isArray(value.cancelledAssociations) || value.cancelledAssociations.some((key) => typeof key !== "string")))
    throw new Error("已有账目的取消关联信息不完整，请核对后再导入。");
  return value;
}

function update(activity: ExistingActivity, value: ImportMetadata, amount = String(activity.amount)): ActivityUpdate {
  if (!activity.accountId || !activity.activityType || !activityDate(activity) || !activity.currency)
    throw new Error("已有账目缺少更新所需的账户、日期或币种，请刷新核对。");
  return { id: activity.id, accountId: activity.accountId, activityType: activity.activityType,
    activityDate: activityDate(activity), currency: activity.currency, amount,
    metadata: { [METADATA_KEY]: value } };
}

function unchanged(activity: ExistingActivity, source: StatementSource, value: ImportMetadata) {
  return value?.booking?.component === "main" && value.booking.kind === "expense" &&
    activity.accountId === value.booking.accountId &&
    (activity.activityTypeOverride ?? activity.activityType) === "WITHDRAWAL" &&
    activity.currency === source.currency && activity.amount != null &&
    compare(String(activity.amount), value.booking.amount) === 0 &&
    new Date(activityDate(activity)).getTime() === new Date(source.date).getTime();
}

function eligible(node: Node) {
  const source = node.source;
  if (compare(node.amount, "0") <= 0) return false;
  if (node.entry && !["ready", "duplicate"].includes(node.entry.status)) return false;
  if (node.metadata.booking.kind !== "expense" || (source.fee && compare(source.fee, "0") > 0) ||
    /转账|还款|充值|提现|退款|退货|理财|基金|证券|申购|赎回|TRANSFER|REFUND|REVERSAL/i.test(`${source.txType ?? ""} ${source.description} ${source.status}`)) return false;
  if (paymentSystems.has(source.system))
    return /银行|信用卡|储蓄卡|借记卡|贷记卡|HSBC|BMO|\bTD\b|VISA|MASTERCARD/i.test(source.paymentMethod) &&
      !/余额|零钱|花呗|白条|信用购|亲属卡/.test(source.paymentMethod);
  return profiles.some((profile) => profile.bank && profile.channel === source.system);
}

function statementDay(source: StatementSource) {
  const match = /^(\d{4})[-/]?(\d{2})[-/]?(\d{2})/.exec(source.originalTime);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  // Domestic timestamp exports use Shanghai time; foreign date-only exports retain a date above.
  return new Date(new Date(source.date).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

function matches(payment: Node, bank: Node) {
  if (payment.accountId !== bank.accountId || payment.source.currency !== bank.source.currency ||
    compare(payment.amount, bank.amount) !== 0 || payment.metadata.cancelledAssociations?.includes(bank.key) ||
    bank.metadata.cancelledAssociations?.includes(payment.key)) return false;
  if (payment.source.datePrecision === "date" || bank.source.datePrecision === "date")
    return statementDay(payment.source) === statementDay(bank.source);
  return Math.abs(new Date(payment.source.date).getTime() - new Date(bank.source.date).getTime()) <= 300_000;
}

export function applyAssociations(preview: PreviewRow[], activities: ExistingActivity[], decisions: Decisions): PreviewRow[] {
  if (!preview.length) return preview;
  const entries = new Map(preview.map((entry) => [sourceKey(entry.row.source), entry]));
  const nodes = new Map<string, Node>();
  const collisions = new Set<string>();
  const updates = new Map<string, ActivityUpdate>();
  const add = (node: Node) => {
    if (nodes.has(node.key)) collisions.add(node.key);
    else nodes.set(node.key, node);
  };
  for (const activity of activities) {
    const sources = readSources(activity);
    if (sources.length !== 1) continue;
    const value = metadata(activity);
    if (!unchanged(activity, sources[0], value)) continue;
    const key = sourceKey(sources[0]);
    add({ key, source: sources[0], metadata: structuredClone(value), accountId: activity.accountId!,
      amount: value.association?.originalAmount ?? value.booking.amount, activity, entry: entries.get(key) });
  }
  for (const entry of preview) {
    const create = entry.creates?.find((create) => (create.metadata as Record<string, ImportMetadata>)?.[METADATA_KEY]?.booking.component === "main") ?? entry.create;
    if (entry.status !== "ready" || !create || entry.row.transfer || entry.row.unsupportedReason) continue;
    const value = (create.metadata as Record<string, ImportMetadata>)[METADATA_KEY];
    if (value.booking.component !== "main") continue;
    const key = sourceKey(entry.row.source);
    if (nodes.get(key)?.activity) continue;
    add({ key, source: entry.row.source, metadata: structuredClone(value), accountId: entry.accountId, amount: entry.amount, create, entry });
  }
  for (const key of collisions) nodes.delete(key);
  const write = (node: Node) => {
    if (node.create) {
      node.create.amount = node.metadata.booking.amount;
      node.create.metadata = { [METADATA_KEY]: node.metadata };
      node.entry!.amount = node.metadata.booking.amount;
    } else if (node.activity) updates.set(node.activity.id, update(node.activity, node.metadata, node.metadata.booking.amount));
  };
  const cancel = (node: Node, peerKey: string) => {
    if (node.metadata.cancelledAssociations?.includes(peerKey) && node.metadata.association?.peerSourceKey !== peerKey) return;
    node.metadata.cancelledAssociations = [...new Set([...(node.metadata.cancelledAssociations ?? []), peerKey])];
    if (node.metadata.association?.peerSourceKey === peerKey) {
      node.metadata.booking.amount = node.metadata.association.originalAmount;
      delete node.metadata.association;
    }
    write(node);
  };
  for (const node of nodes.values()) {
    for (const peerKey of node.entry ? decisions[rowKey(node.entry.row)]?.cancelledAssociations ?? [] : []) {
      cancel(node, peerKey);
      const peer = nodes.get(peerKey);
      if (peer) cancel(peer, node.key);
    }
  }
  const decorate = (node: Node) => {
    if (!node.entry || !node.metadata.association) return;
    node.entry.association = node.metadata.association;
    node.entry.amount = node.metadata.booking.amount;
    const peer = nodes.get(node.metadata.association.peerSourceKey);
    if (!peer || peer.metadata.association?.peerSourceKey !== node.key) {
      node.entry.reason = "关联流水已修改或不存在，请在已关联记录中核对";
      return;
    }
    node.entry.reason = node.metadata.association.role === "payment" ? "已自动关联银行扣款，此条记账金额为零，原始金额保留" : "已自动关联三方支付明细，保留实际扣款";
  };
  const candidates = [...nodes.values()].filter((node) => !node.metadata.association && eligible(node));
  const payments = candidates.filter((node) => paymentSystems.has(node.source.system));
  const banks = candidates.filter((node) => !paymentSystems.has(node.source.system));
  const amountKey = (node: Node) => JSON.stringify([node.accountId, node.source.currency, decimal(node.amount)]);
  const banksByAmount = new Map<string, Node[]>();
  for (const bank of banks) banksByAmount.set(amountKey(bank), [...(banksByAmount.get(amountKey(bank)) ?? []), bank]);
  const choices = new Map(payments.map((payment) => [payment.key, (banksByAmount.get(amountKey(payment)) ?? []).filter((bank) => matches(payment, bank))]));
  const uses = new Map<string, number>();
  for (const peers of choices.values()) for (const bank of peers) uses.set(bank.key, (uses.get(bank.key) ?? 0) + 1);
  for (const payment of payments) {
    const peers = choices.get(payment.key)!;
    if (peers.length !== 1) {
      if (peers.length && payment.entry) payment.entry.reason += "；存在多笔同额银行流水，未自动关联";
      continue;
    }
    const bank = peers[0];
    if (!payment.entry && !bank.entry) continue;
    if (uses.get(bank.key) !== 1) {
      if (bank.entry) bank.entry.reason += "；存在多笔同额三方流水，未自动关联";
      continue;
    }
    payment.metadata.association = { peerSourceKey: bank.key, role: "payment", originalAmount: payment.amount };
    bank.metadata.association = { peerSourceKey: payment.key, role: "bank", originalAmount: bank.amount };
    payment.metadata.booking.amount = "0.00";
    write(payment); write(bank);
  }
  for (const node of nodes.values()) decorate(node);
  if (updates.size) {
    preview[0].updates = [...updates.values()];
    if (!preview.some((entry) => entry.status === "ready") && preview[0].status === "duplicate") {
      preview[0].status = "ready";
      preview[0].reason = "更新已保存流水的关联关系";
    }
  }
  return preview;
}

export function savedAssociations(activities: ExistingActivity[]) {
  const sourcesById = new Map(activities.map((activity) => [activity.id, readSources(activity)]));
  const bySource = new Map<string, ExistingActivity>();
  for (const activity of activities)
    for (const source of sourcesById.get(activity.id)!) bySource.set(sourceKey(source), activity);
  return activities.flatMap((activity) => {
    const sources = sourcesById.get(activity.id)!;
    if (!sources.length) return [];
    const value = metadata(activity);
    if (value.association?.role !== "payment") return [];
    const peer = bySource.get(value.association.peerSourceKey);
    return [{ activity, source: sources[0], association: value.association, peer,
      changed: !unchanged(activity, sources[0], value) || !peer || metadata(peer).association?.peerSourceKey !== sourceKey(sources[0]) || !unchanged(peer, sourcesById.get(peer.id)![0], metadata(peer)) }];
  });
}

export function cancelSavedAssociation(activities: ExistingActivity[], paymentId: string): ActivityUpdate[] {
  const payment = activities.find((activity) => activity.id === paymentId);
  if (!payment) throw new Error("关联记录已不存在，请刷新核对。");
  const value = metadata(payment);
  if (!value.association || value.association.role !== "payment") throw new Error("此关联已变化，请刷新核对。");
  const paymentKey = sourceKey(readSources(payment)[0]);
  const bankKey = value.association.peerSourceKey;
  const bank = activities.find((activity) => readSources(activity).some((source) => sourceKey(source) === bankKey));
  return [payment, ...(bank ? [bank] : [])].map((activity) => {
    const next = structuredClone(metadata(activity));
    const association = next.association;
    if (!association || association.peerSourceKey !== (activity.id === paymentId ? bankKey : paymentKey))
      throw new Error("双方关联不一致，请核对来源记录。");
    const amount = association.role === "payment" && unchanged(activity, readSources(activity)[0], next) && compare(String(activity.amount), "0") === 0
      ? association.originalAmount : decimal(String(activity.amount));
    next.booking.amount = amount;
    next.cancelledAssociations = [...new Set([...(next.cancelledAssociations ?? []), association.peerSourceKey])];
    delete next.association;
    return update(activity, next, amount);
  });
}

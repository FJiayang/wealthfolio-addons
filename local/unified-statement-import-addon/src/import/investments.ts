import type { Account, ActivityCreate, ActivityUpdate, AssetResolutionInput } from "@wealthfolio/addon-sdk";
import type { DraftLeg } from "../ant-fund/import-model";
import { toImportRequest, unitPrice } from "../ant-fund/import-model";
import { compare } from "../parsers/decimal";
import type { StatementRow, StatementSource } from "../parsers/types";
import { METADATA_KEY, activityDate, readSources, rowKey, sourceKey, sourcesConflict, type Decisions, type ExistingActivity, type PreviewRow, type RowDecision } from "./ledger";

export interface ImportOptions { recognizeInvestments?: boolean }
export interface InvestmentLink {
  role: "trade" | "funding";
  investmentAccountId: string;
  peerKey?: string;
  ignoredPeers?: string[];
  noLink?: boolean;
}
interface Value {
  version: 1;
  sources: StatementSource[];
  booking: { component: string; kind: string; amount: string; accountId: string; quantity?: string; fee?: string; tax?: string; date?: string; asset?: AssetResolutionInput; unitPrice?: string };
  investment?: InvestmentLink;
}
export const legKey = (leg: DraftLeg) => `${leg.activityType}:${leg.code}`;
const value = (activity: { metadata?: unknown }): Value => (activity.metadata as Record<string, Value>)[METADATA_KEY];
const day = (date: string) => date.slice(0, 10).replaceAll("/", "-");
const isBank = (source: StatementSource) => !["alipay", "wechat", "jd", "mt", "ant-fund"].includes(source.system);

export function investmentInstitution(source: StatementSource): string | undefined {
  const text = source.system === "ant-fund" ? "蚂蚁基金" : `${source.merchant} ${source.description} ${source.txType ?? ""}`;
  if (/蚂蚁.*基金|支付宝基金/.test(text)) return "ant-fund";
  if (/天天基金/.test(text)) return "tiantian";
  if (/招银理财/.test(text)) return "cmb-wealth";
  return undefined;
}
export function isInvestmentCash(row: StatementRow): boolean {
  return !row.source.investment && (/基金|理财|证券|申购|赎回/.test(`${row.source.txType ?? ""} ${row.source.description} ${row.source.merchant}`) ||
    (row.source.system === "cmb" && /朝朝宝/.test(row.source.description)));
}
export type InvestmentTreatment = "transfer" | "income" | "expense";
export function investmentTreatment(row: StatementRow, decision: RowDecision): InvestmentTreatment | undefined {
  if (decision.investmentTreatment) return decision.investmentTreatment;
  const text = `${row.source.txType ?? ""} ${row.source.description}`;
  if (/收益|分红|利息|管理费|手续费|服务费|税费|费用/.test(text)) return undefined;
  if (row.source.system === "cmb" && /^朝朝宝\s*转[入出]$/.test(row.source.description.trim())) return "transfer";
  return /申购|赎回|买入|卖出/.test(text) ? "transfer" : undefined;
}
export function investmentCashKind(row: StatementRow): "transferIn" | "transferOut" | undefined {
  if (row.kind === "income" || row.kind === "transferIn" || row.source.direction === "收入") return "transferIn";
  if (row.kind === "expense" || row.kind === "transferOut" || row.source.direction === "支出") return "transferOut";
  const text = `${row.source.txType ?? ""} ${row.source.description}`;
  if (row.source.system === "cmb" && /^朝朝宝\s*转出$/.test(row.source.description.trim())) return "transferIn";
  if (row.source.system === "cmb" && /^朝朝宝\s*转入$/.test(row.source.description.trim())) return "transferOut";
  if (/赎回|卖出/.test(text)) return "transferIn";
  if (/申购|买入|购买/.test(text)) return "transferOut";
  return undefined;
}
export function investmentSignature(legs: DraftLeg[], accountId: string, assets: RowDecision["fundAssets"]) {
  return JSON.stringify([accountId, legs, assets]);
}
export function fundRequest(row: StatementRow, legs: DraftLeg[], accountId: string) {
  return toImportRequest([{ source: { line: row.source.lineNumber, pages: [], cells: [row.source.recordId] },
    legs, excluded: false }], accountId, row.source.fileName).rows.map(({ activity }) => activity);
}
function sameTrade(activity: ExistingActivity, leg: DraftLeg, accountId: string, currency: string) {
  return activity.accountId === accountId && (activity.activityTypeOverride ?? activity.activityType) === leg.activityType &&
    activity.currency === currency && day(activityDate(activity)) === leg.date &&
    activity.amount != null && compare(String(activity.amount), leg.amount) === 0 &&
    activity.quantity != null && compare(String(activity.quantity), leg.quantity) === 0 &&
    compare(String(activity.fee ?? "0"), leg.fee) === 0 && compare(String(activity.tax ?? "0"), leg.tax ?? "0") === 0;
}
export function legacyOrder(activity: ExistingActivity) {
  return /(?:Ant Fund order\s*[:：]|订单号\s*[:：])\s*(\d+)/i.exec(activity.notes ?? activity.comment ?? "")?.[1];
}

export function fundPreview(row: StatementRow, accountId: string, accounts: Account[], activities: ExistingActivity[], decision: RowDecision): PreviewRow {
  const transaction = row.source.investment!;
  const legs = decision.fundLegs ?? transaction.legs;
  const result = (status: PreviewRow["status"], reason: string, creates: ActivityCreate[] = [], updates: ActivityUpdate[] = []): PreviewRow =>
    ({ row, accountId, kind: "investment", amount: legs[0]?.amount || "0", status, reason, creates, create: creates[0], updates });
  if (decision.excluded || row.excluded) return result("excluded", "用户排除");
  if (row.error || row.identityReason || !transaction.orderId) return result("error", row.error ?? row.identityReason ?? "基金订单号缺失");
  const account = accounts.find((account) => account.id === accountId);
  if (!account || account.accountType !== "SECURITIES" || account.trackingMode !== "TRANSACTIONS" || account.currency !== "CNY")
    return result("review", "请选择使用交易流水跟踪的人民币投资账户");
  try { fundRequest(row, legs, accountId); }
  catch { return result("review", "请补齐基金方向、代码、确认日期、最终金额、份额及费用；分红须提供实际再投资金额"); }
  if (new Set(legs.map(legKey)).size !== legs.length) return result("error", "同一基金订单存在相同代码及方向的多笔明细，请核对完整来源");
  const creates: ActivityCreate[] = [], updates: ActivityUpdate[] = [];
  for (const leg of legs) {
    const component = `trade:${legKey(leg)}`;
    const stored = activities.filter((activity) => readSources(activity).some((source) => sourceKey(source) === sourceKey(row.source)) && value(activity).booking.component === component);
    if (stored.length > 1) return result("error", "基金订单已对应多笔活动，请核对");
    if (stored.some((activity) => readSources(activity).some((source) => sourceKey(source) === sourceKey(row.source) && sourcesConflict(source, row.source))))
      return result("error", "基金订单来源内容冲突，不覆盖已有交易");
    if (stored.length) continue;
    const legacy = activities.filter((activity) => !activity.metadata?.[METADATA_KEY] && legacyOrder(activity) === transaction.orderId &&
      sameTrade(activity, leg, accountId, "CNY") &&
      (activity.assetId === decision.fundAssets?.[legKey(leg)]?.id || activity.assetSymbol === leg.code));
    if (!legacy.length && activities.some((activity) => !activity.metadata?.[METADATA_KEY] &&
      legacyOrder(activity) === transaction.orderId && (activity.activityTypeOverride ?? activity.activityType) === leg.activityType))
      return result("review", "旧基金订单的账户、资产或经济字段与来源不一致，请人工核对或跳过；不会重复创建");
    if (legacy.length > 1) return result("review", "发现多笔旧基金交易，请先核对历史重复");
    const asset = decision.fundAssets?.[legKey(leg)];
    const booking: Value["booking"] = { component, kind: "investment", amount: leg.amount, accountId,
      quantity: leg.quantity, fee: leg.fee, tax: leg.tax ?? "0", date: leg.date + "T00:00:00Z", unitPrice: unitPrice(leg), asset };
    const metadata: Value = { version: 1, sources: [row.source], booking,
      investment: { role: "trade", investmentAccountId: accountId, noLink: decision.noInvestmentLink } };
    if (legacy.length) {
      updates.push({ id: legacy[0].id, accountId, activityType: leg.activityType, activityDate: activityDate(legacy[0]),
        currency: "CNY", metadata: { [METADATA_KEY]: metadata } });
      continue;
    }
    if (!asset || decision.fundChecked !== investmentSignature(legs, accountId, decision.fundAssets))
      return result("review", decision.fundError || "请完成基金资产识别并核对");
    creates.push({ accountId, activityType: leg.activityType,
      subtype: leg.subtype ?? (leg.activityType === "DIVIDEND" ? "DRIP" : undefined),
      activityDate: booking.date!, asset, quantity: leg.quantity, unitPrice: booking.unitPrice,
      amount: leg.amount, fee: leg.fee, tax: leg.tax ?? "0", currency: "CNY", status: "POSTED",
      comment: `${leg.name} · Ant Fund order:${transaction.orderId} · ${legKey(leg)}`,
      metadata: { [METADATA_KEY]: metadata } });
  }
  return result(creates.length || updates.length ? "ready" : "duplicate",
    creates.length ? "投资交易已就绪；未匹配资金侧时可先导入" : updates.length ? "认领旧基金交易来源，不修改金额或份额" : "基金订单已导入，保留现有交易", creates, updates);
}

export function addFundingCounterpart(entry: PreviewRow, decision: RowDecision, accounts: Account[]) {
  if (entry.status !== "ready" || !entry.create) return;
  const investmentAccount = accounts.find((account) => account.id === decision.investmentAccountId);
  if (!investmentAccount || investmentAccount.accountType !== "SECURITIES" || investmentAccount.trackingMode !== "TRANSACTIONS" ||
    investmentAccount.id === entry.accountId || investmentAccount.currency !== entry.row.source.currency) {
    entry.status = "review"; entry.reason = "请确认资金转账对应的投资账户"; delete entry.create; entry.creates = []; return;
  }
  const main = entry.create;
  const link: InvestmentLink = { role: "funding", investmentAccountId: investmentAccount.id, noLink: decision.noInvestmentLink };
  const group = `unified-investment:${sourceKey(entry.row.source)}`;
  main.sourceGroupId = group;
  main.metadata = { flow: { is_external: false }, [METADATA_KEY]: { ...value(main), investment: link } };
  const peerType = main.activityType === "TRANSFER_OUT" ? "TRANSFER_IN" : "TRANSFER_OUT";
  const peer: ActivityCreate = { ...main, accountId: investmentAccount.id, activityType: peerType,
    comment: `${main.comment} · 投资账户资金转账`,
    metadata: { flow: { is_external: false }, [METADATA_KEY]: { ...value(main),
      booking: { ...value(main).booking, component: "counterpart", accountId: investmentAccount.id,
        kind: peerType === "TRANSFER_IN" ? "transferIn" : "transferOut" } } } };
  entry.creates = [main, peer, ...(entry.creates ?? []).filter((create) => create !== main)];
  entry.reason = "资金转账已就绪；未匹配基金交易时可先导入";
}

export interface InvestmentNode {
  key: string;
  source: StatementSource;
  metadata: Value;
  activity?: ExistingActivity;
  create?: ActivityCreate;
  entry?: PreviewRow;
  legacy?: boolean;
  changed?: boolean;
}
function unchanged(node: InvestmentNode): boolean {
  if (node.changed) return false;
  const activity = node.activity;
  if (!activity) return true;
  const booking = node.metadata.booking;
  return activity.accountId === booking.accountId && activity.amount != null && compare(String(activity.amount), booking.amount) === 0 &&
    day(activityDate(activity)) === day(booking.date ?? node.source.date) &&
    activity.currency === node.source.currency &&
    (activity.activityTypeOverride ?? activity.activityType) === (booking.kind === "investment" ? booking.component.split(":")[1] : booking.kind === "transferIn" ? "TRANSFER_IN" : "TRANSFER_OUT") &&
    (booking.kind !== "investment" || (activity.quantity != null && compare(String(activity.quantity), booking.quantity!) === 0 &&
      compare(String(activity.fee ?? "0"), booking.fee ?? "0") === 0 &&
      compare(String(activity.tax ?? "0"), booking.tax ?? "0") === 0 &&
      (booking.unitPrice === undefined || (activity.unitPrice != null && compare(String(activity.unitPrice), booking.unitPrice) === 0)) &&
      (booking.asset?.id ? activity.assetId === booking.asset.id : activity.assetSymbol === booking.component.split(":")[2])));
}
export function investmentNodes(activities: ExistingActivity[], preview: PreviewRow[] = []): InvestmentNode[] {
  const nodes: InvestmentNode[] = [];
  for (const activity of activities) {
    const sources = readSources(activity);
    if (!sources.length) {
      const orderId = legacyOrder(activity);
      if (!orderId || !["BUY", "SELL"].includes(activity.activityType ?? "") || !/^\d{6}$/.test(activity.assetSymbol ?? "") ||
        !activity.accountId || activity.currency !== "CNY" || !activity.amount || !activity.quantity) continue;
      const leg: DraftLeg = { activityType: activity.activityType as DraftLeg["activityType"], code: activity.assetSymbol!,
        name: activity.assetSymbol!, date: day(activityDate(activity)), amount: String(activity.amount), quantity: String(activity.quantity),
        fee: String(activity.fee ?? "0"), tax: String(activity.tax ?? "0"), unitPrice: activity.unitPrice == null ? undefined : String(activity.unitPrice) };
      const conversion = activities.filter((peer) => legacyOrder(peer) === orderId).length > 1;
      const source: StatementSource = { system: "ant-fund", recordId: orderId, merchantOrderId: orderId,
        accountHint: "", fileName: "已保存基金交易（待人工确认来源）", lineNumber: 0,
        originalTime: leg.date, date: activityDate(activity), amount: leg.amount, currency: "CNY", paymentMethod: "",
        status: "已保存", direction: "投资", category: "", merchant: "蚂蚁基金", description: "历史基金交易", remark: "",
        investment: { orderId, purpose: conversion ? "基金转换" : "历史基金交易", legs: [leg] } };
      const component = `trade:${legKey(leg)}`;
      const metadata: Value = { version: 1, sources: [source], booking: { component, kind: "investment",
        accountId: activity.accountId, amount: leg.amount, quantity: leg.quantity, fee: leg.fee, tax: leg.tax,
        unitPrice: leg.unitPrice, date: activityDate(activity), asset: { id: activity.assetId, symbol: leg.code } },
        investment: { role: "trade", investmentAccountId: activity.accountId } };
      nodes.push({ key: JSON.stringify([sourceKey(source), component]), source, metadata, activity, legacy: true });
      continue;
    }
    const metadata = value(activity);
    if (!metadata.investment || metadata.booking.component === "counterpart") continue;
    if (!["trade", "funding"].includes(metadata.investment.role) || typeof metadata.investment.investmentAccountId !== "string")
      throw new Error("投资关联来源不完整，请核对已有活动");
    nodes.push({ key: JSON.stringify([sourceKey(sources[0]), metadata.booking.component]), source: sources[0], metadata: structuredClone(metadata), activity,
      entry: preview.find((entry) => sources.some((source) => sourceKey(source) === sourceKey(entry.row.source))) });
    if (metadata.investment.role === "funding") {
      const counterpart = activities.find((peer) => readSources(peer).some((source) => sourceKey(source) === sourceKey(sources[0])) &&
        value(peer).booking.component === "counterpart");
      nodes[nodes.length - 1].changed = !counterpart ||
        counterpart.accountId !== metadata.investment.investmentAccountId || counterpart.currency !== activity.currency ||
        counterpart.amount == null || activity.amount == null || compare(String(counterpart.amount), String(activity.amount)) !== 0 ||
        !activity.sourceGroupId || counterpart.sourceGroupId !== activity.sourceGroupId ||
        (counterpart.activityTypeOverride ?? counterpart.activityType) !== (metadata.booking.kind === "transferOut" ? "TRANSFER_IN" : "TRANSFER_OUT");
    }
  }
  for (const entry of preview) for (const create of entry.creates ?? []) {
    const metadata = value(create);
    if (!metadata?.investment || metadata.booking.component === "counterpart") continue;
    nodes.push({ key: JSON.stringify([sourceKey(entry.row.source), metadata.booking.component]), source: entry.row.source,
      metadata: structuredClone(metadata), create, entry });
  }
  return nodes;
}
function ordinaryTrade(node: InvestmentNode) {
  const transaction = node.source.investment;
  return node.metadata.investment?.role === "trade" && transaction?.legs.length === 1 &&
    !/转换|调仓/.test(transaction.purpose) && ["BUY", "SELL"].includes(node.metadata.booking.component.split(":")[1]);
}
export function investmentCandidates(node: InvestmentNode, nodes: InvestmentNode[], strict = true) {
  const link = node.metadata.investment!;
  return nodes.filter((peer) => {
    const other = peer.metadata.investment!;
    if (peer.key === node.key || other.role === link.role || other.noLink || other.peerKey ||
      link.ignoredPeers?.includes(peer.key) || other.ignoredPeers?.includes(node.key) || !unchanged(node) || !unchanged(peer) ||
      link.investmentAccountId !== other.investmentAccountId || node.source.currency !== peer.source.currency ||
      compare(node.metadata.booking.amount, peer.metadata.booking.amount) !== 0) return false;
    const trade = link.role === "trade" ? node : peer;
    const funding = link.role === "funding" ? node : peer;
    if (!ordinaryTrade(trade)) return false;
    const buy = trade.metadata.booking.component.split(":")[1] === "BUY";
    if ((funding.metadata.booking.kind === "transferOut") !== buy) return false;
    if (!strict) return true;
    if (node.legacy || peer.legacy || !investmentInstitution(funding.source) ||
      investmentInstitution(funding.source) !== investmentInstitution(trade.source)) return false;
    const tradeDay = trade.source.investment?.applicationDate ?? day(trade.metadata.booking.date ?? trade.source.date);
    const delta = (new Date(tradeDay).getTime() - new Date(day(funding.source.originalTime || funding.source.date)).getTime()) / 86_400_000;
    return trade.source.investment?.applicationDate && buy ? delta === 0 : buy ? delta >= 0 && delta <= 7 : delta <= 0 && delta >= -7;
  });
}

function patch(node: InvestmentNode): ActivityUpdate {
  const activity = node.activity!;
  return { id: activity.id, accountId: activity.accountId!, activityType: activity.activityType!,
    activityDate: activityDate(activity), currency: activity.currency!, metadata: { [METADATA_KEY]: node.metadata } };
}
export function applyInvestmentLinks(preview: PreviewRow[], activities: ExistingActivity[], decisions: Decisions): PreviewRow[] {
  if (!preview.length) return preview;
  const updates = new Map<string, ActivityUpdate>(preview.flatMap((entry) => entry.updates ?? []).map((update) => [update.id, update]));
  const projected = activities.map((activity) => updates.has(activity.id)
    ? { ...activity, metadata: { ...activity.metadata, ...(updates.get(activity.id)!.metadata as Record<string, unknown>) } } : activity);
  let nodes = investmentNodes(projected, preview);
  const write = (node: InvestmentNode) => {
    if (node.create) node.create.metadata = { ...(node.create.metadata as Record<string, unknown>), [METADATA_KEY]: node.metadata };
    else if (node.activity) updates.set(node.activity.id, patch(node));
    if (node.metadata.investment?.role === "funding") {
      const key = sourceKey(node.source);
      for (const entry of preview) for (const create of entry.creates ?? []) {
        if (value(create)?.booking.component === "counterpart" && value(create).sources.some((source) => sourceKey(source) === key))
          Object.assign(value(create), { investment: structuredClone(node.metadata.investment), sources: node.metadata.sources });
      }
      for (const activity of projected) {
        const sources = readSources(activity);
        if (sources.some((source) => sourceKey(source) === key) && value(activity).booking.component === "counterpart")
          updates.set(activity.id, patch({ ...node, activity, metadata: { ...value(activity),
            sources: node.metadata.sources, investment: node.metadata.investment } }));
      }
    }
  };
  // Bank and payment exports can describe the same funding event.
  const funding = nodes.filter((node) => node.metadata.investment?.role === "funding");
  const evidenceChoices = new Map(funding.map((node) => [node.key, funding.filter((peer) => {
    if (peer.key === node.key || isBank(peer.source) === isBank(node.source) || !unchanged(node) || !unchanged(peer) ||
      node.metadata.booking.accountId !== peer.metadata.booking.accountId ||
      node.metadata.booking.kind !== peer.metadata.booking.kind ||
      node.metadata.investment!.investmentAccountId !== peer.metadata.investment!.investmentAccountId ||
      node.source.currency !== peer.source.currency || compare(node.metadata.booking.amount, peer.metadata.booking.amount) !== 0 ||
      !investmentInstitution(node.source) || investmentInstitution(node.source) !== investmentInstitution(peer.source)) return false;
    return node.source.datePrecision === "date" || peer.source.datePrecision === "date"
      ? day(node.source.originalTime) === day(peer.source.originalTime)
      : Math.abs(new Date(node.source.date).getTime() - new Date(peer.source.date).getTime()) <= 300_000;
  })]));
  const removed = new Set<string>();
  for (const node of funding) {
    const peers = evidenceChoices.get(node.key)!;
    if (removed.has(node.key) || peers.length !== 1 || evidenceChoices.get(peers[0].key)?.length !== 1) continue;
    const peer = peers[0];
    if (node.activity && peer.activity) continue;
    const primary = node.activity ? node : peer.activity ? peer : isBank(node.source) ? node : peer;
    const extra = primary === node ? peer : node;
    if (!extra.entry || !extra.create || extra.metadata.investment?.peerKey) continue;
    primary.metadata.sources.push(...extra.metadata.sources);
    write(primary);
    extra.entry.creates = (extra.entry.creates ?? []).filter((create) => !value(create).investment);
    extra.entry.create = extra.entry.creates[0];
    extra.entry.reason = "已补充同一投资资金的来源凭据，不重复生成转账";
    removed.add(extra.key);
  }
  nodes = nodes.filter((node) => !removed.has(node.key));
  const choices = new Map(nodes.filter((node) => !node.metadata.investment!.peerKey && !node.metadata.investment!.noLink)
    .map((node) => [node.key, investmentCandidates(node, nodes)]));
  for (const node of nodes) {
    const decision = node.entry ? decisions[rowKey(node.entry.row)] : undefined;
    if (node.metadata.investment!.peerKey || node.metadata.investment!.noLink) continue;
    const candidates = decision?.investmentPeerKey
      ? investmentCandidates(node, nodes, false).filter((peer) => peer.key === decision.investmentPeerKey)
      : choices.get(node.key) ?? [];
    if (candidates.length !== 1) continue;
    const peer = candidates[0];
    if (!decision?.investmentPeerKey && choices.get(peer.key)?.length !== 1) continue;
    if (!node.entry && !peer.entry) continue;
    if (peer.metadata.investment!.peerKey) continue;
    node.metadata.investment!.peerKey = peer.key; peer.metadata.investment!.peerKey = node.key;
    write(node); write(peer);
  }
  for (const entry of preview) {
    const node = nodes.find((node) => node.entry === entry || readSources(node.activity ?? { id: "", metadata: undefined }).some((source) => sourceKey(source) === sourceKey(entry.row.source)));
    if (!node) continue;
    entry.investmentLink = node.metadata.investment;
    if (node.metadata.investment?.peerKey) entry.reason += "；已关联投资资金与买卖";
    else if (!node.metadata.investment?.noLink) entry.reason += "；资金与买卖待关联";
  }
  if (updates.size) {
    for (const entry of preview) entry.updates = [];
    preview[0].updates = [...updates.values()];
    if (!preview.some((entry) => entry.status === "ready") && preview[0].status === "duplicate") {
      preview[0].status = "ready"; preview[0].reason = "更新投资来源及关联关系";
    }
  }
  return preview;
}

export function cancelInvestmentLink(activities: ExistingActivity[], key: string): ActivityUpdate[] {
  const nodes = investmentNodes(activities);
  const node = nodes.find((node) => node.key === key);
  if (!node?.metadata.investment?.peerKey) throw new Error("投资关联已经变化，请刷新核对");
  const peer = nodes.find((peer) => peer.key === node.metadata.investment!.peerKey);
  if (!peer || peer.metadata.investment?.peerKey !== key) throw new Error("投资关联另一侧缺失或已修改，请先核对");
  const updates: ActivityUpdate[] = [];
  for (const current of [node, peer]) {
    const link = current.metadata.investment!;
    link.ignoredPeers = [...new Set([...(link.ignoredPeers ?? []), link.peerKey!])];
    delete link.peerKey;
    updates.push(patch(current));
    if (link.role === "funding") for (const activity of activities) {
      if (readSources(activity).some((source) => sourceKey(source) === sourceKey(current.source)) && value(activity).booking.component === "counterpart")
        updates.push(patch({ ...current, activity, metadata: { ...value(activity), investment: link } }));
    }
  }
  return updates;
}

export function linkSavedInvestment(activities: ExistingActivity[], key: string, peerKey: string): ActivityUpdate[] {
  const nodes = investmentNodes(activities);
  const node = nodes.find((node) => node.key === key);
  const peer = node && investmentCandidates(node, nodes, false).find((peer) => peer.key === peerKey);
  if (!node || !peer || node.metadata.investment?.peerKey || node.metadata.investment?.noLink)
    throw new Error("候选金额、账户、状态或关联已变化，请刷新核对");
  const updates: ActivityUpdate[] = [];
  for (const current of [node, peer]) {
    current.metadata.investment!.peerKey = current === node ? peer.key : node.key;
    updates.push(patch(current));
    if (current.metadata.investment!.role === "funding") for (const activity of activities) {
      if (readSources(activity).some((source) => sourceKey(source) === sourceKey(current.source)) && value(activity).booking.component === "counterpart")
        updates.push(patch({ ...current, activity, metadata: { ...value(activity), investment: current.metadata.investment } }));
    }
  }
  return updates;
}

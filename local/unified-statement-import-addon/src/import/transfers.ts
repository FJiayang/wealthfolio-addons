import type { Activity, InternalTransferPairResponse } from "@wealthfolio/addon-sdk";
import { activityDate, readSources, sourceKey, type ExistingActivity } from "./ledger";

export interface TransferHost {
  getTransferPair(id: string): Promise<InternalTransferPairResponse | null>;
  linkTransfer(a: string, b: string): Promise<[Activity, Activity]>;
}
export async function linkConfirmedTransfer(
  host: TransferHost,
  outId: string,
  inId: string,
): Promise<void> {
  if (outId === inId) throw new Error("不能将同一条流水配对。");
  const samePair = (pair: InternalTransferPairResponse | null) =>
    pair?.transferOut.id === outId && pair.transferIn.id === inId;
  const [outPair, inPair] = await Promise.all([
    host.getTransferPair(outId),
    host.getTransferPair(inId),
  ]);
  if (samePair(outPair) && samePair(inPair)) return;
  if (outPair || inPair) throw new Error("至少一条流水已关联其他转账，请刷新核对。");
  try {
    await host.linkTransfer(outId, inId);
  } catch {
    const [out, incoming] = await Promise.all([
      host.getTransferPair(outId),
      host.getTransferPair(inId),
    ]);
    if (samePair(out) && samePair(incoming)) return;
    throw new Error("关联未确认成功，已重读结果；请刷新核对后再重试，不会重新创建流水。");
  }
}

export function transferEntries(activities: ExistingActivity[]) {
  return activities.flatMap((activity) => {
    const metadata = activity.metadata?.unifiedStatementImport as
      | { booking?: { kind?: string; amount?: string; accountId?: string; component?: string } }
      | undefined;
    const booking = metadata?.booking;
    const effectiveType = activity.activityTypeOverride ?? activity.activityType;
    const kind = effectiveType
      ? effectiveType === "TRANSFER_IN"
        ? "transferIn"
        : effectiveType === "TRANSFER_OUT"
          ? "transferOut"
          : undefined
      : booking?.kind;
    if (
      !booking ||
      !["transferIn", "transferOut"].includes(kind ?? "") ||
      booking.component === "fee"
    )
      return [];
    const source = readSources(activity)[0];
    return source
      ? [
          {
            id: activity.id,
            kind: kind!,
            accountId: activity.accountId ?? booking.accountId ?? "",
            amount: activity.amount ?? booking.amount ?? source.amount,
            source: {
              ...source,
              date: activityDate(activity) || source.date,
              currency: activity.currency ?? source.currency,
            },
            sourceKey: sourceKey(source),
          },
        ]
      : [];
  });
}

export function transferCandidates(entries: ReturnType<typeof transferEntries>, outId: string) {
  const outgoing = entries.find((entry) => entry.id === outId && entry.kind === "transferOut");
  if (!outgoing) return [];
  return entries.filter((incoming) => {
    if (incoming.kind !== "transferIn") return false;
    const a = outgoing.source,
      b = incoming.source;
    if (
      a.system === "feidee" &&
      b.system === "feidee" &&
      a.relatedId &&
      a.relatedId === b.relatedId
    )
      return true;
    return (
      a.system === "cib" &&
      b.system === "cib" &&
      a.sourceAccount &&
      a.sourceAccount === b.sourceAccount &&
      a.txType === b.txType &&
      /^(购汇|结汇)$/.test(a.txType ?? "") &&
      a.currency !== b.currency &&
      Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) <= 180000
    );
  });
}

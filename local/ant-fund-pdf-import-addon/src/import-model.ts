import Decimal from "decimal.js";
import type {
  ActivityImport,
  SymbolSearchResult,
  ImportActivitiesResult,
} from "@wealthfolio/addon-sdk";
import { compact, StatementError, type StatementRow } from "./statement";

export interface DraftLeg {
  activityType: "BUY" | "SELL" | "DIVIDEND";
  code: string;
  name: string;
  date: string;
  amount: string;
  quantity: string;
  fee: string;
}
export interface DraftRow {
  source: StatementRow;
  legs: DraftLeg[];
  excluded: boolean;
}
export type FundBinding = Pick<
  ActivityImport,
  | "symbol"
  | "assetId"
  | "symbolName"
  | "exchangeMic"
  | "quoteCcy"
  | "instrumentType"
  | "quoteMode"
  | "providerId"
  | "providerSymbol"
>;

function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

export function confirmationDate(value: string) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})(?:\d{2}:\d{2})?$/.exec(compact(value));
  if (!match) return "";
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return isCalendarDate(date) ? date : "";
}

function field(value: string) {
  const clean = compact(value);
  return clean === "/" ? "" : clean;
}

export function createDrafts(rows: StatementRow[]): DraftRow[] {
  return rows.map((source) => {
    const c = source.cells.map(compact);
    const type = c[2];
    let activityType: DraftLeg["activityType"] | undefined;
    if (["用户买入", "定投买入"].includes(type)) activityType = "BUY";
    if (["用户卖出", "定投卖出"].includes(type)) activityType = "SELL";
    if (type === "机构分红") activityType = "DIVIDEND";
    if (["调仓", "用户跨TA转换"].includes(type)) {
      if (field(c[6]) && new Decimal(field(c[6])).gt(0) && !field(c[7])) activityType = "BUY";
      else if (
        field(c[7]) &&
        new Decimal(field(c[7])).gt(0) &&
        (!field(c[6]) || new Decimal(field(c[6])).isZero())
      )
        activityType = "SELL";
    }
    const leg: DraftLeg = {
      activityType: activityType ?? "BUY",
      code: c[5],
      name: c[3],
      date: c[11] ? confirmationDate(c[11]) : "",
      amount:
        type === "机构分红" && field(c[8]) && new Decimal(field(c[8])).isZero() ? "" : field(c[8]),
      quantity: field(c[9]),
      fee: field(c[10]),
    };
    return { source, excluded: false, legs: activityType ? [leg] : [] };
  });
}

function decimal(value: string) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new StatementError("number");
  return new Decimal(value);
}

export function unitPrice(leg: DraftLeg) {
  const amount = decimal(leg.amount),
    quantity = decimal(leg.quantity),
    fee = decimal(leg.fee);
  if (!amount.gt(0) || !quantity.gt(0)) throw new StatementError("amount");
  const gross =
    leg.activityType === "BUY"
      ? amount.minus(fee)
      : leg.activityType === "SELL"
        ? amount.plus(fee)
        : amount;
  if (!gross.gt(0) || (leg.activityType === "DIVIDEND" && !fee.isZero()))
    throw new StatementError("amount");
  return gross.div(quantity).toDecimalPlaces(12).toString();
}

export function requiresExistingAsset(result: SymbolSearchResult) {
  return !result.existingAssetId && !(result.canonicalExchangeMic || result.exchangeMic)?.trim();
}

export function bindingFromSearch(result: SymbolSearchResult): FundBinding {
  if (requiresExistingAsset(result)) throw new StatementError("createAsset");
  return {
    assetId: result.existingAssetId,
    symbol: result.canonicalSymbol || result.symbol,
    symbolName: result.longName || result.shortName,
    exchangeMic: result.canonicalExchangeMic || result.exchangeMic,
    quoteCcy: result.currency,
    instrumentType: "EQUITY",
    quoteMode: result.isExisting ? undefined : "MARKET",
    providerId: result.providerId,
    providerSymbol: result.providerSymbol,
  };
}

export function toActivities(
  drafts: DraftRow[],
  bindings: Record<string, FundBinding>,
  accountId: string,
): ActivityImport[] {
  if (!accountId) throw new StatementError("pending");
  const rows: ActivityImport[] = [];
  for (const draft of drafts) {
    if (draft.excluded) continue;
    if (!draft.legs.length) throw new StatementError("pending", String(draft.source.line));
    for (const [index, leg] of draft.legs.entries()) {
      const binding = bindings[leg.code];
      if (!binding?.symbol && !binding?.assetId)
        throw new StatementError("asset", String(draft.source.line));
      if (!isCalendarDate(leg.date)) throw new StatementError("date", String(draft.source.line));
      rows.push({
        ...binding,
        accountId,
        currency: "CNY",
        activityType: leg.activityType,
        subtype: leg.activityType === "DIVIDEND" ? "DRIP" : undefined,
        date: `${leg.date}T00:00:00Z`,
        quantity: leg.quantity,
        amount: leg.amount,
        fee: leg.fee,
        unitPrice: unitPrice(leg),
        isValid: true,
        isDraft: false,
        forceImport: false,
        lineNumber: draft.source.line * 2 + index,
        comment: `Ant Fund order:${compact(draft.source.cells[0])}`,
      });
    }
  }
  if (!rows.length) throw new StatementError("empty");
  return rows;
}

export function isDuplicate(row: ActivityImport) {
  return !!(
    row.duplicateOfId ||
    row.duplicateOfLineNumber != null ||
    row.warnings?._duplicate?.length
  );
}

export function sourceRowNumber(lineNumber: number) {
  return Math.floor(lineNumber / 2);
}
export function hasErrors(row: ActivityImport) {
  return (
    (!row.isValid && !isDuplicate(row)) ||
    Object.values(row.errors ?? {}).some((errors) => errors.length > 0)
  );
}
export function rowsToImport(rows: ActivityImport[]) {
  if (rows.some(hasErrors)) throw new StatementError("validation");
  return rows
    .filter((row) => !isDuplicate(row) || row.forceImport)
    .map((row) => ({ ...row, isValid: true }));
}

export function reconcileResult(submitted: ActivityImport[], result: ImportActivitiesResult) {
  // Only returned, explicitly failed rows are retryable; uncertain responses must be checked again.
  return result.activities
    .filter((row) => hasErrors(row))
    .map((row) => ({ ...submitted.find((input) => input.lineNumber === row.lineNumber), ...row }));
}

import Decimal from "decimal.js";
import type { OpenActivityImportRequest } from "@wealthfolio/addon-sdk";
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

export function toImportRequest(
  drafts: DraftRow[],
  accountId: string,
  sourceLabel: string,
): OpenActivityImportRequest {
  if (!accountId) throw new StatementError("pending");
  if (!drafts.some((draft) => !draft.excluded)) throw new StatementError("empty");
  return {
    sourceLabel,
    accountId,
    rows: drafts.flatMap((draft) => {
      if (!draft.excluded && !draft.legs.length)
        throw new StatementError("pending", String(draft.source.line));
      return (draft.legs.length ? draft.legs : [undefined]).map((leg) => {
        if (leg && !draft.excluded && !isCalendarDate(leg.date))
          throw new StatementError("date", String(draft.source.line));
        const price = leg && !draft.excluded ? unitPrice(leg) : undefined;
        return {
          sourceLine: draft.source.line,
          rawRow: draft.source.cells,
          excluded: draft.excluded,
          activity: {
            accountId,
            currency: "CNY",
            activityType: leg?.activityType ?? "BUY",
            symbol: leg?.code,
            symbolName: leg?.name,
            date: leg?.date ? leg.date + "T00:00:00Z" : "",
            amount: leg?.amount,
            quantity: leg?.quantity,
            fee: leg?.fee,
            unitPrice: price,
            subtype: leg?.activityType === "DIVIDEND" ? "DRIP" : undefined,
            instrumentType: "EQUITY",
            isDraft: true,
            isValid: false,
            comment: "Ant Fund order:" + compact(draft.source.cells[0]),
          },
        };
      });
    }),
  };
}

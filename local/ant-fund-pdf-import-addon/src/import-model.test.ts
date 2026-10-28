import { describe, expect, it } from "vitest";
import {
  confirmationDate,
  createDrafts,
  toImportRequest,
  unitPrice,
  type DraftLeg,
  type DraftRow,
} from "./import-model";
const leg: DraftLeg = {
  activityType: "BUY",
  code: "000032",
  name: "Test A",
  date: "2026-10-02",
  amount: "10000",
  quantity: "100",
  fee: "4",
};
const draft: DraftRow = {
  source: {
    line: 1,
    pages: [2],
    cells: [
      "20261001000000000000000001",
      "",
      "用户买入",
      "Test A",
      "",
      "000032",
      "10000",
      "/",
      "10000",
      "100",
      "4",
      "2026/10/02 00:00",
    ],
  },
  legs: [leg],
  excluded: false,
};

describe("PDF draft handoff", () => {
  it("preserves final cash and charges each fee once without binding assets", () => {
    expect(unitPrice(leg)).toBe("99.96");
    expect(unitPrice({ ...leg, activityType: "SELL" })).toBe("100.04");
    const request = toImportRequest([draft], "account", "statement.pdf");
    expect(request.rows[0].activity).toMatchObject({
      accountId: "account",
      amount: "10000",
      fee: "4",
      quantity: "100",
      unitPrice: "99.96",
      symbol: "000032",
      date: "2026-10-02T00:00:00Z",
      isDraft: true,
      isValid: false,
    });
    expect(request.rows[0].activity.assetId).toBeUndefined();
    expect(request.rows[0]).toMatchObject({
      sourceLine: 1,
      rawRow: draft.source.cells,
      excluded: false,
    });
  });
  it("rejects missing account, incomplete transactions and invalid dates", () => {
    expect(() => toImportRequest([draft], "", "pdf")).toThrow("pending");
    expect(() => toImportRequest([{ ...draft, legs: [] }], "account", "pdf")).toThrow("pending");
    expect(() =>
      toImportRequest([{ ...draft, legs: [{ ...leg, date: "2026-02-30" }] }], "account", "pdf"),
    ).toThrow("date");
    expect(confirmationDate("2026/10/0\n2 00:00")).toBe("2026-10-02");
    expect(confirmationDate("2026/02/30 00:00")).toBe("");
  });
  it("retains incomplete excluded source rows", () => {
    const request = toImportRequest(
      [draft, { ...draft, excluded: true, legs: [] }],
      "account",
      "pdf",
    );
    expect(request.rows).toHaveLength(2);
    expect(request.rows[1].excluded).toBe(true);
    expect(() => toImportRequest([{ ...draft, excluded: true }], "account", "pdf")).toThrow(
      "empty",
    );
  });
  it("requires actual dividend value and maps a completed dividend as DRIP", () => {
    const dividend: DraftLeg = {
      ...leg,
      activityType: "DIVIDEND",
      quantity: "0.44",
      fee: "0",
      amount: "",
    };
    expect(() => unitPrice(dividend)).toThrow();
    const request = toImportRequest(
      [{ ...draft, legs: [{ ...dividend, amount: "0.88" }] }],
      "account",
      "pdf",
    );
    expect(request.rows[0].activity).toMatchObject({
      activityType: "DIVIDEND",
      subtype: "DRIP",
      unitPrice: "2",
    });
    expect(() => unitPrice({ ...dividend, amount: "1", fee: "1" })).toThrow("amount");
  });
  it("preserves both legs and source identity for split conversions", () => {
    const request = toImportRequest(
      [{ ...draft, legs: [{ ...leg, activityType: "SELL" }, leg] }],
      "account",
      "pdf",
    );
    expect(request.rows).toHaveLength(2);
    expect(request.rows.map((row) => row.activity.activityType)).toEqual(["SELL", "BUY"]);
    expect(request.rows[0].sourceLine).toBe(request.rows[1].sourceLine);
    expect(request.rows[0].activity.comment).toBe(request.rows[1].activity.comment);
    const moved = toImportRequest(
      [{ ...draft, source: { ...draft.source, line: 99, pages: [4] } }],
      "account",
      "pdf",
    );
    expect(moved.rows[0].activity.comment).toBe(request.rows[0].activity.comment);
  });
  it("keeps missing confirmation dates editable without dropping records", () => {
    const source = {
      ...draft.source,
      cells: draft.source.cells.map((cell, i) => (i === 11 ? "" : cell)),
    };
    const drafts = createDrafts([draft.source, source]);
    expect(drafts).toHaveLength(2);
    expect(drafts[1].legs[0].date).toBe("");
    expect(() => toImportRequest(drafts, "account", "pdf")).toThrow("date");
    drafts[1].excluded = true;
    expect(toImportRequest(drafts, "account", "pdf").rows).toHaveLength(2);
  });
  it("does not guess both sides of ambiguous conversions", () => {
    const source = { ...draft.source, cells: [...draft.source.cells] };
    source.cells[2] = "用户转换";
    expect(createDrafts([source])[0].legs).toEqual([]);
  });
  it("rejects invalid decimal amounts and fee boundaries", () => {
    expect(() => unitPrice({ ...leg, fee: "10000" })).toThrow("amount");
    expect(() => unitPrice({ ...leg, quantity: "0" })).toThrow("amount");
    expect(() => unitPrice({ ...leg, amount: "1e4" })).toThrow("number");
  });
});

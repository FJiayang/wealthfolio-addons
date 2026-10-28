import { describe, expect, it } from "vitest";
import {
  bindingFromSearch,
  confirmationDate,
  createDrafts,
  hasErrors,
  reconcileResult,
  rowsToImport,
  toActivities,
  unitPrice,
  type DraftLeg,
  type DraftRow,
} from "./import-model";
import type {
  ActivityImport,
  ImportActivitiesResult,
  SymbolSearchResult,
} from "@wealthfolio/addon-sdk";

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
const bindings = {
  "000032": {
    assetId: "fund-id",
    symbol: "000032",
    exchangeMic: "XTEST",
    quoteCcy: "CNY",
    instrumentType: "EQUITY",
    providerId: "test",
    providerSymbol: "provider-code",
  },
};
const row = toActivities([draft], bindings, "account")[0];

describe("financial mapping", () => {
  it("uses final cash and accounts for each fee once", () => {
    expect(unitPrice(leg)).toBe("99.96");
    expect(unitPrice({ ...leg, activityType: "SELL" })).toBe("100.04");
    expect(toActivities([draft], bindings, "account")[0]).toMatchObject({
      amount: "10000",
      fee: "4",
      quantity: "100",
      unitPrice: "99.96",
      date: "2026-10-02T00:00:00Z",
      ...bindings["000032"],
    });
    expect(() => unitPrice({ ...leg, fee: "10000" })).toThrow("amount");
    expect(() => unitPrice({ ...leg, quantity: "0" })).toThrow("amount");
    expect(() => unitPrice({ ...leg, amount: "1e4" })).toThrow("number");
  });
  it("requires actual dividend value and maps a completed dividend as one DRIP", () => {
    const dividend = {
      ...leg,
      activityType: "DIVIDEND" as const,
      quantity: "0.44",
      fee: "0",
      amount: "",
    };
    expect(() => unitPrice(dividend)).toThrow();
    const rows = toActivities(
      [{ ...draft, legs: [{ ...dividend, amount: "0.88" }] }],
      bindings,
      "account",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ activityType: "DIVIDEND", subtype: "DRIP", unitPrice: "2" });
  });
  it("maps conversion and rebalancing directions without merging matching order IDs", () => {
    const buy = { ...draft.source, cells: [...draft.source.cells] };
    buy.cells[2] = "调仓";
    const sell = { ...buy, line: 2, cells: [...buy.cells] };
    sell.cells[6] = "0.00";
    sell.cells[7] = "100";
    expect(createDrafts([buy, sell]).map((row) => row.legs[0].activityType)).toEqual([
      "BUY",
      "SELL",
    ]);
    const conversion = { ...buy, cells: [...buy.cells] };
    conversion.cells[2] = "用户转换";
    expect(createDrafts([conversion])[0].legs).toEqual([]);
    expect(() => toActivities([{ ...draft, legs: [] }], bindings, "account")).toThrow("pending");
    expect(
      toActivities(
        [{ ...draft, legs: [{ ...leg, activityType: "SELL" }, leg] }],
        bindings,
        "account",
      ),
    ).toHaveLength(2);
  });
  it("preserves identity, distinguishes different orders, and omits variable source locations from comments", () => {
    const moved = { ...draft, source: { ...draft.source, pages: [4] } };
    expect(toActivities([moved], bindings, "account")[0].comment).toBe(row.comment);
    const other = {
      ...draft,
      source: {
        ...draft.source,
        cells: ["20261001000000000000000002", ...draft.source.cells.slice(1)],
      },
    };
    expect(toActivities([other], bindings, "account")[0].comment).not.toBe(row.comment);
    const search = {
      symbol: "raw",
      canonicalSymbol: "canonical",
      canonicalExchangeMic: "XTEST",
      currency: "CNY",
      providerId: "test",
      providerSymbol: "native",
      longName: "Test A",
    } as SymbolSearchResult;
    expect(bindingFromSearch(search)).toMatchObject({
      symbol: "canonical",
      exchangeMic: "XTEST",
      providerSymbol: "native",
    });
    expect(
      bindingFromSearch({ ...search, isExisting: true, existingAssetId: "manual-fund" }),
    ).toMatchObject({ assetId: "manual-fund", quoteMode: undefined });
  });
  it("requires account, binding, valid date, and explicit exclusion of incomplete rows", () => {
    expect(() => toActivities([draft], {}, "account")).toThrow("asset");
    expect(() => toActivities([draft], bindings, "")).toThrow("pending");
    expect(confirmationDate("2026/10/0\n2 00:00")).toBe("2026-10-02");
    expect(() => confirmationDate("2026/02/30 00:00")).toThrow("date");
    expect(
      toActivities([draft, { ...draft, excluded: true, legs: [] }], bindings, "account"),
    ).toHaveLength(1);
  });
});

describe("import safety", () => {
  it("blocks validation errors and skips duplicates unless explicitly overridden", () => {
    const duplicate: ActivityImport = { ...row, duplicateOfId: "existing", isValid: false };
    expect(rowsToImport([row, duplicate])).toHaveLength(1);
    expect(rowsToImport([{ ...duplicate, forceImport: true }])[0].isValid).toBe(true);
    expect(() =>
      rowsToImport([{ ...duplicate, errors: { amount: ["invalid"] }, forceImport: true }]),
    ).toThrow("validation");
    expect(hasErrors({ ...row, isValid: false })).toBe(true);
  });
  it("only offers explicitly failed returned rows for another validation", () => {
    const failed = { ...row, lineNumber: 4, isValid: false, errors: { amount: ["write failed"] } };
    const result = {
      activities: [{ ...row, id: "saved" }, failed],
      importRunId: "run",
      summary: {
        imported: 1,
        skipped: 1,
        total: 2,
        duplicates: 0,
        assetsCreated: 0,
        success: false,
      },
    } satisfies ImportActivitiesResult;
    expect(reconcileResult([row, failed], result)).toEqual([failed]);
    expect(reconcileResult([row], { ...result, activities: [] })).toEqual([]);
  });
});

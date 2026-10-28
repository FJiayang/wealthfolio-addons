// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormattingProvider, DirectionProvider } from "@wealthfolio/ui";
import type { ActivityImport, AddonContext } from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AntFundImportPage } from "./import-page";
import { parseStatement, type StatementRow } from "./statement";

vi.mock("./statement", async (original) => ({
  ...(await original<typeof import("./statement")>()),
  parseStatement: vi.fn(),
}));
const rows: StatementRow[] = [
  [
    "20261001000000000000000001",
    "2026/10/01 09:00",
    "用户买入",
    "Synthetic Fund A",
    "",
    "000032",
    "100",
    "/",
    "100",
    "100",
    "0",
    "2026/10/02 00:00",
  ],
  [
    "20261002000000000000000002",
    "",
    "机构分红",
    "Synthetic Fund A",
    "",
    "000032",
    "0",
    "/",
    "0",
    "0.44",
    "0",
    "2026/10/03 00:00",
  ],
  [
    "20261003000000000000000003",
    "2026/10/03 10:00",
    "用户卖出",
    "Synthetic Fund C",
    "",
    "017811",
    "0",
    "10",
    "99",
    "10",
    "1",
    "2026/10/04 00:00",
  ],
].map((cells, index) => ({ cells, line: index + 1, pages: [2] }));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(parseStatement).mockResolvedValue(rows);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function context() {
  const checkImport = vi.fn(async (rows: ActivityImport[]) =>
    rows.map((row) => ({
      ...row,
      isValid: true,
      errors: {},
      ...(row.lineNumber === 2
        ? { duplicateOfId: "existing", warnings: { _duplicate: ["Synthetic duplicate"] } }
        : {}),
    })),
  );
  const importRows = vi.fn(async (rows: ActivityImport[]) => ({
    activities: rows,
    importRunId: "synthetic-run",
    summary: {
      total: rows.length,
      imported: rows.length,
      skipped: 0,
      duplicates: 0,
      assetsCreated: 0,
      success: true,
    },
  }));
  const ctx = {
    api: {
      accounts: {
        getAll: vi.fn(async () => [
          {
            id: "cny",
            name: "Test CNY",
            currency: "CNY",
            accountType: "SECURITIES",
            trackingMode: "TRANSACTIONS",
            isActive: true,
            isArchived: false,
          },
        ]),
      },
      market: {
        searchTicker: vi.fn(async (code: string) => [
          {
            symbol: `FUND:${code}`,
            canonicalSymbol: `FUND:${code}`,
            longName: `New OTC ${code}`,
            isExisting: false,
            currency: "CNY",
          },
          {
            symbol: code,
            canonicalSymbol: code,
            longName: `Synthetic Fund ${code}`,
            isExisting: true,
            existingAssetId: `asset-${code}`,
            currency: "CNY",
          },
        ]),
      },
      activities: { checkImport, import: importRows },
    },
  } as unknown as AddonContext;
  return { ctx, checkImport, importRows };
}
async function click(name: string, scope: ParentNode = document) {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === name || button.getAttribute("aria-label") === name,
  );
  expect(button, name).toBeTruthy();
  await act(async () => button!.click());
}
async function select(label: string, option: string) {
  const trigger =
    document.querySelector<HTMLElement>(`[aria-label="${label}"]`) ??
    document.getElementById(label);
  expect(trigger).toBeTruthy();
  await act(async () => trigger!.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
    item.textContent?.includes(option),
  );
  expect(item, option).toBeTruthy();
  await act(async () => item!.click());
}
function currentStep() {
  return container.querySelector('[aria-current="step"]')?.textContent;
}
async function mount(ctx: AddonContext, rtl = false) {
  await act(async () =>
    root.render(
      <DirectionProvider direction={rtl ? "rtl" : "ltr"}>
        <FormattingProvider locale="en-US" uiLocale="en">
          <AntFundImportPage ctx={ctx} />
        </FormattingProvider>
      </DirectionProvider>,
    ),
  );
}
async function upload() {
  await select("ant-account", "Test CNY");
  const file = new File(["synthetic"], "synthetic.pdf", { type: "application/pdf" });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
async function bindFunds() {
  for (const code of ["000032", "017811"]) {
    const row = [...container.querySelectorAll("tbody tr")].find((row) =>
      row.textContent?.includes(code),
    )!;
    await click("Search", row);
    await click("Search", document.querySelector('[role="dialog"]')!);
    const results = document.querySelector('table[aria-label="Fund search results"]')!;
    const buttons = results.querySelectorAll<HTMLButtonElement>("button");
    expect(buttons[0].disabled).toBe(true);
    await act(async () => buttons[1].click());
  }
}
async function fillDividend(save = true) {
  await click("Edit Source record #2");
  const dialog = document.querySelector('[role="dialog"]')!;
  const label = [...dialog.querySelectorAll("label")].find((label) =>
    label.textContent?.includes("Final cash amount"),
  )!;
  const input = label.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0.88");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(save ? "Save changes" : "Cancel", dialog);
}

describe("staged PDF import UI", () => {
  it("uses the shared wizard, tables and themed status badges instead of native disclosure forms", async () => {
    const { ctx, importRows } = context();
    await mount(ctx, true);
    expect(currentStep()).toContain("Statement PDF");
    await upload();
    expect(currentStep()).toContain("Identify funds");
    expect(container.querySelector('table[aria-label="Identify funds"]')).toBeTruthy();
    expect(container.querySelectorAll("details, summary")).toHaveLength(0);
    await bindFunds();
    await click("Preview and confirm");
    expect(currentStep()).toContain("Preview and confirm");
    const table = container.querySelector('table[aria-label="Review transactions"]')!;
    expect(table.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(table.querySelector('[data-processing-status="pending"]')?.className).toContain(
      "bg-warning-subtle",
    );
    expect(table.querySelector('[data-processing-status="ready"]')?.className).toContain(
      "bg-success-subtle",
    );
    expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(container.querySelector('[data-page-content="true"]')).toBeTruthy();
    expect(importRows).not.toHaveBeenCalled();
  });
  it("keeps edits in a dialog, cancels without mutating rows, and requires validation before importing", async () => {
    const { ctx, checkImport, importRows } = context();
    await mount(ctx);
    await upload();
    await bindFunds();
    await click("Preview and confirm");
    await fillDividend(false);
    expect(
      container.querySelector(
        'table[aria-label="Review transactions"] [data-processing-status="pending"]',
      ),
    ).toBeTruthy();
    await fillDividend();
    expect(
      container.querySelector(
        'table[aria-label="Review transactions"] [data-processing-status="pending"]',
      ),
    ).toBeNull();
    expect(importRows).not.toHaveBeenCalled();
    await click("Validate and check duplicates");
    expect(checkImport).toHaveBeenCalledTimes(1);
    await click("Confirm and import");
    expect(importRows).toHaveBeenCalledTimes(1);
    const submitted = importRows.mock.calls[0][0];
    expect(submitted).toHaveLength(2);
    expect(submitted.find((row) => row.activityType === "DIVIDEND")).toMatchObject({
      amount: "0.88",
      unitPrice: "2",
      assetId: "asset-000032",
    });
    expect(submitted.some((row) => row.lineNumber === 2)).toBe(false);
    expect(currentStep()).toContain("Import result");
    expect(container.textContent).toContain("synthetic-run");
  });

  it("filters incomplete rows and invalidates the checked payload after an edit", async () => {
    const { ctx, checkImport, importRows } = context();
    await mount(ctx);
    await upload();
    await bindFunds();
    await click("Preview and confirm");
    await select("Filter by status", "Needs input");
    expect(
      container.querySelectorAll('table[aria-label="Review transactions"] tbody tr'),
    ).toHaveLength(1);
    await fillDividend();
    await select("Filter by status", "All records");
    await click("Validate and check duplicates");
    await fillDividend();
    const confirm = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Confirm and import",
    )!;
    expect(confirm.disabled).toBe(true);
    expect(checkImport).toHaveBeenCalledTimes(1);
    expect(importRows).not.toHaveBeenCalled();
  });

  it("shows a failed import and rechecks only failed activities without resubmitting successes", async () => {
    const { ctx, checkImport, importRows } = context();
    importRows.mockImplementationOnce(async (submitted) => ({
      activities: submitted.map((row, index) =>
        index === 0
          ? { ...row, isValid: false, errors: { amount: ["Synthetic write failure"] } }
          : row,
      ),
      importRunId: "partial-run",
      summary: {
        total: submitted.length,
        imported: submitted.length - 1,
        skipped: 1,
        duplicates: 0,
        assetsCreated: 0,
        success: false,
      },
    }));
    await mount(ctx);
    await upload();
    await bindFunds();
    await click("Preview and confirm");
    await fillDividend();
    await click("Validate and check duplicates");
    await click("Confirm and import");
    expect(container.textContent).toContain("Synthetic write failure");
    await click("Recheck failed rows only");
    expect(checkImport.mock.calls[1][0].map((row) => row.lineNumber)).toEqual([4]);
    expect(
      container.querySelectorAll('table[aria-label="Review transactions"] tbody tr'),
    ).toHaveLength(1);
    await click("Confirm and import");
    expect(importRows.mock.calls[1][0].map((row) => row.lineNumber)).toEqual([4]);
  });
});

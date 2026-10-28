// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormattingProvider, DirectionProvider } from "@wealthfolio/ui";
import type { AddonContext } from "@wealthfolio/addon-sdk";
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
  Reflect.deleteProperty(Element.prototype, "animate");
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
  const file = new File(["synthetic"], "synthetic.pdf", { type: "application/pdf" });
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}
function context() {
  const openImport = vi.fn(async () => {});
  const setLeaveGuard = vi.fn(async () => {});
  const ctx = {
    router: { setLeaveGuard },
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
      activities: { openImport },
    },
  } as unknown as AddonContext;
  return { ctx, openImport, setLeaveGuard };
}
describe("PDF preparation UI", () => {
  it("hands drafts to the host instead of searching or importing directly", async () => {
    const { ctx, openImport, setLeaveGuard } = context();
    vi.mocked(parseStatement).mockResolvedValue([rows[0]]);
    await mount(ctx, true);
    await upload();
    await select("人民币投资账户", "Test CNY");
    expect(setLeaveGuard).toHaveBeenCalledWith(true);
    await click("下一步");
    expect(openImport).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLabel: "synthetic.pdf",
        accountId: "cny",
        rows: [
          expect.objectContaining({
            sourceLine: 1,
            activity: expect.objectContaining({ symbol: "000032", amount: "100" }),
          }),
        ],
      }),
    );
  });
  it("keeps the statement when cancellation is dismissed", async () => {
    const { ctx, openImport } = context();
    vi.mocked(parseStatement).mockResolvedValue([rows[0]]);
    await mount(ctx);
    await upload();
    await click("取消");
    await click("继续编辑", document.querySelector('[role="alertdialog"]')!);
    expect(container.textContent).toContain("在此修正原始交易");
    expect(openImport).not.toHaveBeenCalled();
  });
  it("retains preparation after a failed handoff and allows retry", async () => {
    const { ctx, openImport } = context();
    vi.mocked(parseStatement).mockResolvedValue([rows[0]]);
    openImport.mockRejectedValueOnce(new Error("failed"));
    await mount(ctx);
    await upload();
    await select("人民币投资账户", "Test CNY");
    await click("下一步");
    expect(container.textContent).toContain("操作失败");
    await click("下一步");
    expect(openImport).toHaveBeenCalledTimes(2);
  });
});

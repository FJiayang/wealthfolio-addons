// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AddonContext, Activity, ActivityBulkMutationRequest } from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatementImportPage } from "./statement-import-page";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { MAPPING_KEY } from "../import/ledger";
import { FormattingProvider, useLocalizationSettings } from "@wealthfolio/ui";
import { translations } from "../i18n";

vi.mock("@wealthfolio/addon-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wealthfolio/addon-sdk")>()),
  useAddonTranslation: () => {
    const { uiLocale } = useLocalizationSettings();
    return {
      language: uiLocale,
      t: (key: string, options: Record<string, unknown> = {}) => {
        const value = translations[uiLocale]?.[key] ?? translations.en[key] ?? key;
        return String(value).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(options[name] ?? ""),
        );
      },
    };
  },
}));

let container: HTMLDivElement;
let root: Root;
async function renderPage(
  ctx: AddonContext,
  locale = "zh-CN",
  uiLocale = "zh",
  timezone = "Asia/Shanghai",
  currencyFormattingRegions = {},
) {
  await act(async () =>
    root.render(
      <FormattingProvider
        locale={locale}
        uiLocale={uiLocale}
        timezone={timezone}
        currencyFormattingRegions={currencyFormattingRegions}
      >
        <StatementImportPage ctx={ctx} />
      </FormattingProvider>,
    ),
  );
}
beforeEach(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function context(saved = JSON.stringify({ 账户余额: "cash" })) {
  const stored: Activity[] = [];
  const storage = {
    get: vi.fn(async () => saved),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  const saveMany = vi.fn(async ({ creates = [] }: ActivityBulkMutationRequest) => {
    const created = creates.map((create, index) => activity(create, `ui-${index}`));
    stored.push(...created);
    return { created, updated: [], deleted: [], createdMappings: [], errors: [] };
  });
  const ctx = {
    router: { setLeaveGuard: vi.fn(async () => {}) },
    api: {
      accounts: { getAll: vi.fn(async () => [account()]) },
      activities: { getAll: vi.fn(async () => [...stored]), saveMany },
      storage,
    },
  } as unknown as AddonContext;
  return { ctx, storage, saveMany, stored };
}

async function click(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(text),
  );
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}

async function upload(lines = [csvRow(), csvRow({ id: "pending", direction: "不计收支" })]) {
  const input = container.querySelector('input[type="file"]')!;
  const file = new File([[HEADER, ...lines].join("\n")], "synthetic.csv");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("shared statement wizard", () => {
  it("preserves uploaded rows across language and region changes and submits only after confirmation", async () => {
    const { ctx, stored, saveMany } = context();
    await renderPage(ctx);
    await upload([csvRow({ amount: "1234.56" })]);
    await click("保存映射并预览");
    await renderPage(ctx, "de-DE", "en", "America/New_York");
    expect(container.querySelector("h1")!.textContent).toBe("Statement import");
    await click("Confirm import");
    expect(saveMany).not.toHaveBeenCalled();
    await click("Import ready rows only: 1");
    expect(stored[0].amount).toBe("1234.56");
    expect(stored[0].metadata!.unifiedStatementImport).toMatchObject({
      sources: [{ amount: "1234.56", originalTime: "2025/12/31 14:23" }],
    });
    expect(container.textContent).toContain("Added: 1.");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    await renderPage(ctx, "zh-TW", "zh-Hant", "Asia/Taipei");
    expect(container.querySelector("h1")!.textContent).toBe("帳單匯入");
    expect(container.textContent).toContain("已新增 1 筆");
  });
  it("shows CSV error line numbers in the selected language", async () => {
    const { ctx } = context();
    await renderPage(ctx, "en-US", "en");
    await upload(['bad"quote']);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "Invalid CSV quoting on line 2.",
    );
  });
  it("uses the existing account selector and persists mappings before review", async () => {
    const { ctx, storage } = context("{}");
    await renderPage(ctx);
    await upload();
    const trigger = container.querySelector<HTMLElement>('[aria-label="账户映射：账户余额"]')!;
    expect(trigger.textContent).toContain("请选择");
    await act(async () => trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes("cash"),
    )!;
    await act(async () => option.click());
    await click("保存映射并预览");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, JSON.stringify({ 账户余额: "cash" }));
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
  });
  it("asks before discarding a preview, and dismissal preserves the statement", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload();
    await click("保存映射并预览");
    await click("结束 / 取消本次导入");
    expect(document.querySelector('[role="alertdialog"]')).toBeTruthy();
    await click("继续编辑");
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
    await click("结束 / 取消本次导入");
    const discard = Array.from(
      document.querySelector('[role="alertdialog"]')!.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("取消本次导入"))!;
    await act(async () => discard.click());
    expect(container.querySelector('input[type="file"]')).toBeTruthy();
    expect(saveMany).not.toHaveBeenCalled();
    expect(ctx.router.setLeaveGuard).toHaveBeenLastCalledWith(false);
  });
  it("imports ready rows once, hides result steps, and detects the next upload as duplicate", async () => {
    const { ctx, saveMany, stored } = context();
    await renderPage(ctx);
    await upload();
    await click("保存映射并预览");
    await click("提交确认");
    await click("确认仅导入已就绪 1 笔");
    expect(stored).toHaveLength(1);
    expect(container.textContent).toContain("已新增 1 笔");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    await click("开始新导入");
    await upload();
    await click("保存映射并预览");
    const confirm = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("提交确认"),
    )!;
    expect(confirm.disabled).toBe(true);
    expect(saveMany).toHaveBeenCalledTimes(1);
  });
  it("does not report an unknown write response as success", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload();
    await click("保存映射并预览");
    await click("提交确认");
    saveMany.mockRejectedValueOnce(new Error("lost response"));
    await click("确认仅导入已就绪 1 笔");
    expect(container.textContent).toContain("结果待核对");
    expect(container.textContent).not.toContain("导入完成");
    await click("返回预览");
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
  });
  it("blocks unavailable mappings and supports reset under RTL and dark theme", async () => {
    document.documentElement.dir = "rtl";
    document.documentElement.classList.add("dark");
    try {
      const { ctx, storage } = context('{"账户余额":"missing"}');
      await renderPage(ctx);
      await upload();
      await click("保存映射并预览");
      const next = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("提交确认"),
      )!;
      expect(next.disabled).toBe(true);
      await click("返回账户映射");
      await click("重置映射");
      expect(storage.delete).toHaveBeenCalledWith(MAPPING_KEY);
    } finally {
      document.documentElement.dir = "ltr";
      document.documentElement.classList.remove("dark");
    }
  });
});

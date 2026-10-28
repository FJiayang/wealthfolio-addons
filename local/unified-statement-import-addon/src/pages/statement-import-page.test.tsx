// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  Account,
  AddonContext,
  Activity,
  ActivityBulkMutationRequest,
} from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatementImportPage } from "./statement-import-page";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { MAPPING_KEY } from "../import/ledger";
import { FormattingProvider } from "@wealthfolio/ui";
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
  document.documentElement.dir = "ltr";
});

function context(saved = JSON.stringify({ 账户余额: "cash" }), accounts: Account[] = [account()]) {
  const stored: Activity[] = [];
  const storage = {
    get: vi.fn(async () => saved),
    set: vi.fn(async (_key: string, value: string) => {
      saved = value;
    }),
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
      accounts: { getAll: vi.fn(async () => accounts) },
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
  it("余额宝持仓账户按名称预填并可提交，来源仍以 CNY 入账", async () => {
    const wallet = { ...account("yuebao"), name: "余额宝", trackingMode: "HOLDINGS" as const };
    const { ctx, storage, stored } = context("{}", [wallet]);
    await renderPage(ctx);
    await upload([csvRow({ method: "余额宝" })]);
    expect(container.querySelector('[aria-label="账户映射：余额宝"]')!.textContent).toContain(
      "余额宝",
    );
    expect(container.textContent).toContain("自动识别");
    await click("保存映射并预览");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, JSON.stringify({ 余额宝: "yuebao" }));
    await click("提交确认");
    await click("确认仅导入已就绪 1 笔");
    expect(stored[0]).toMatchObject({
      accountId: "yuebao",
      activityType: "WITHDRAWAL",
      currency: "CNY",
      amount: "12.30",
    });
  });

  it("无名称候选时可从宿主返回的全部账户手动选择", async () => {
    const accounts = [
      { ...account("usd"), name: "美元账户", currency: "USD" },
      {
        ...account("securities", "SECURITIES"),
        name: "投资账户",
        trackingMode: "HOLDINGS" as const,
      },
      { ...account("crypto", "CRYPTOCURRENCY"), name: "数字资产" },
      { ...account("inactive"), name: "停用账户", isActive: false },
      { ...account("archived"), name: "归档账户", isArchived: true },
      account("card", "CREDIT_CARD"),
    ];
    const { ctx, stored } = context("{}", accounts);
    await renderPage(ctx);
    await upload([csvRow({ method: "无法识别的付款方式" })]);
    expect(container.querySelector('[aria-label="推荐账户"]')).toBeNull();
    const trigger = container.querySelector<HTMLElement>(
      '[aria-label="账户映射：无法识别的付款方式"]',
    )!;
    await act(async () => trigger.click());
    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    for (const account of accounts)
      expect(options.some((option) => option.textContent?.includes(account.name))).toBe(true);
    await act(async () =>
      options.find((option) => option.textContent?.includes("投资账户"))!.click(),
    );
    await click("保存映射并预览");
    await click("提交确认");
    await click("确认仅导入已就绪 1 笔");
    expect(stored[0].accountId).toBe("securities");
  });

  it("预填唯一高置信账户，展示理由，确认后保存并在下次上传复用", async () => {
    const method = "招商银行信用卡(1234)";
    const card = {
      ...account("card", "CREDIT_CARD"),
      name: "招商银行信用卡",
      accountNumber: "1234",
    };
    const { ctx, storage, saveMany } = context("{}", [card]);
    await renderPage(ctx);
    await upload([csvRow({ method })]);
    expect(container.querySelector(`[aria-label="账户映射：${method}"]`)!.textContent).toContain(
      card.name,
    );
    expect(container.textContent).toContain("自动识别");
    expect(container.querySelector('[aria-label="推荐账户"]')!.textContent).toContain("卡尾号一致");
    expect(storage.set).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
    await renderPage(ctx, "en-US", "en");
    expect(container.textContent).toContain("自动识别");
    expect(container.textContent).toContain("卡尾号一致");
    await renderPage(ctx, "zh-TW", "zh-Hant");
    expect(container.textContent).toContain("自动识别");
    expect(container.textContent).toContain("卡尾号一致");
    await renderPage(ctx);
    await click("保存映射并预览");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, JSON.stringify({ [method]: "card" }));
    await click("提交确认");
    await click("确认仅导入已就绪 1 笔");
    await click("开始新导入");
    await upload([csvRow({ method })]);
    expect(container.textContent).toContain("已保存");
    await click("保存映射并预览");
    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(
      Array.from(container.querySelectorAll("dl > div"))
        .find((item) => item.querySelector("dt")?.textContent === "重复")!
        .querySelector("dd")!.textContent,
    ).toBe("1");
  });

  it("多个高置信候选不自动选择，候选之外的人工选择仍可使用", async () => {
    document.documentElement.dir = "rtl";
    const method = "招商银行信用卡";
    const card = { ...account("card", "CREDIT_CARD"), name: method };
    const { ctx } = context("{}", [card, { ...card, id: "second" }, account()]);
    await renderPage(ctx);
    await upload([csvRow({ method })]);
    const trigger = container.querySelector<HTMLElement>(`[aria-label="账户映射：${method}"]`)!;
    expect(trigger.textContent).toContain("请选择");
    expect(container.querySelectorAll('[aria-label="推荐账户"] li')).toHaveLength(2);
    await act(async () => trigger.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes("cash"),
    )!;
    await act(async () => option.click());
    expect(trigger.textContent).toContain("cash");
    expect(container.textContent).toContain("人工选择");
  });

  it("手动清空后刷新和保存不会重新填回", async () => {
    const method = "日常钱包";
    const wallet = { ...account(), name: method };
    const { ctx, storage } = context("{}", [wallet]);
    await renderPage(ctx);
    await upload([csvRow({ method })]);
    const trigger = container.querySelector<HTMLElement>(`[aria-label="账户映射：${method}"]`)!;
    await act(async () => trigger.click());
    const clear = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent === "请选择",
    )!;
    await act(async () => clear.click());
    await click("刷新核对");
    expect(trigger.textContent).toContain("请选择");
    await click("保存映射并预览");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, "{}");
  });

  it("保存映射优先于自动推断，账户已不存在时刷新清除有效选择", async () => {
    const method = "日常钱包";
    const wallet = { ...account(), name: method };
    const { ctx } = context(JSON.stringify({ [method]: "manual" }), [wallet, account("manual")]);
    await renderPage(ctx);
    await upload([csvRow({ method })]);
    expect(container.querySelector(`[aria-label="账户映射：${method}"]`)!.textContent).toContain(
      "manual",
    );
    expect(container.textContent).toContain("已保存");
    vi.mocked(ctx.api.accounts.getAll).mockResolvedValue([wallet]);
    await click("刷新核对");
    expect(container.querySelector(`[aria-label="账户映射：${method}"]`)!.textContent).toContain(
      "请选择",
    );
    await click("保存映射并预览");
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("提交确认"),
      )!.disabled,
    ).toBe(true);
  });

  it("切换宿主语言后保持中文及已上传数据，仅在确认后保存", async () => {
    const { ctx, stored, saveMany } = context();
    await renderPage(ctx);
    await upload([csvRow({ amount: "1234.56" })]);
    await click("保存映射并预览");
    await renderPage(ctx, "de-DE", "en", "America/New_York");
    expect(container.querySelector("h1")!.textContent).toBe("账单导入");
    await click("提交确认");
    expect(saveMany).not.toHaveBeenCalled();
    await click("确认仅导入已就绪 1 笔");
    expect(stored[0].amount).toBe("1234.56");
    expect(stored[0].metadata!.unifiedStatementImport).toMatchObject({
      sources: [{ amount: "1234.56", originalTime: "2025/12/31 14:23" }],
    });
    expect(container.textContent).toContain("已新增 1 笔");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    await renderPage(ctx, "zh-TW", "zh-Hant", "Asia/Taipei");
    expect(container.querySelector("h1")!.textContent).toBe("账单导入");
    expect(container.textContent).toContain("已新增 1 笔");
  });
  it("宿主使用英文时仍显示中文错误及物理行号", async () => {
    const { ctx } = context();
    await renderPage(ctx, "en-US", "en");
    await upload(['bad"quote']);
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "第 2 行 CSV 引号格式不正确。",
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

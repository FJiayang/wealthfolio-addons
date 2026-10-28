// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AddonContext, Activity, ActivityBulkMutationRequest } from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatementImportPage } from "./statement-import-page";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { MAPPING_KEY } from "../import/ledger";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
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

function currentStep() {
  return container.querySelector('[aria-label="导入进度"] [aria-current="step"]')?.textContent;
}

describe("界面流程", () => {
  it("五种处理状态使用主题语义色，统计卡片与表格标记一致且保留文字和图标", async () => {
    const { ctx } = context();
    await act(async () => root.render(<StatementImportPage ctx={ctx} />));
    await upload([
      csvRow(),
      csvRow(),
      csvRow({ id: "closed", status: "交易关闭" }),
      csvRow({ id: "pending", direction: "不计收支" }),
      csvRow({ id: "invalid", amount: "invalid" }),
    ]);
    await click("保存映射并预览");
    const expected = {
      ready: "success",
      duplicate: "info",
      excluded: "muted",
      review: "warning",
      error: "destructive",
    };
    const table = container.querySelector('table[aria-label="账单预览"]')!;
    for (const [status, tone] of Object.entries(expected)) {
      const summary = container.querySelector(`[data-processing-status="${status}"]`)!;
      const badge = table.querySelector(`[data-processing-status="${status}"]`)!;
      const background = tone === "muted" ? "bg-muted/30" : `bg-${tone}-subtle`;
      expect(summary.classList.contains(background)).toBe(true);
      expect(badge.classList.contains(background)).toBe(true);
      expect(badge.textContent?.trim()).not.toBe("");
      expect(badge.querySelector("svg")).toBeTruthy();
    }
  });
  it("通过宿主样式的账户选择器设置映射并保存", async () => {
    const { ctx, storage } = context("{}");
    await act(async () => root.render(<StatementImportPage ctx={ctx} />));
    expect(currentStep()).toContain("上传");
    await upload();
    expect(currentStep()).toContain("映射");
    const trigger = container.querySelector<HTMLElement>('[aria-label="账户映射：账户余额"]');
    expect(trigger).toBeTruthy();
    expect(trigger!.textContent).toContain("请选择");
    expect(trigger!.textContent).not.toContain("__none__");
    await act(async () => trigger!.click());
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (item) => item.textContent?.includes("cash"),
    );
    expect(option).toBeTruthy();
    await act(async () => option!.click());
    expect(trigger!.textContent).toContain("cash · 现金");
    await click("保存映射并预览");
    expect(currentStep()).toContain("预览确认");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, JSON.stringify({ 账户余额: "cash" }));
    expect(container.textContent).toContain("确认仅导入已就绪 1 笔");
    const table = container.querySelector('table[aria-label="账单预览"]')!;
    expect(Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent)).toEqual([
      "#",
      "交易时间",
      "交易对方",
      "商品说明",
      "来源分类",
      "收/支",
      "付款方式",
      "交易状态",
      "订单号",
      "原金额",
      "记账性质",
      "确认金额",
      "目标账户",
      "处理状态",
      "操作",
    ]);
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.querySelector("tbody tr")!.children).toHaveLength(15);
  });
  it("上传、恢复映射、预览后取消，不产生账目写入", async () => {
    const { ctx, storage, saveMany } = context();
    await act(async () => root.render(<StatementImportPage ctx={ctx} />));
    await upload();
    expect(container.textContent).toContain("已读取 2 条明细");
    await click("保存映射并预览");
    expect(storage.set).toHaveBeenCalledWith(MAPPING_KEY, JSON.stringify({ 账户余额: "cash" }));
    expect(container.textContent).toContain("确认仅导入已就绪 1 笔");
    await click("结束 / 取消本次导入");
    expect(container.textContent).toContain("上传支付宝交易明细");
    expect(currentStep()).toContain("上传");
    expect(saveMany).not.toHaveBeenCalled();
  });
  it("确认后只提交就绪行，再次上传显示重复；重复按钮禁用", async () => {
    const { ctx, saveMany, stored } = context();
    await act(async () => root.render(<StatementImportPage ctx={ctx} />));
    await upload();
    await click("保存映射并预览");
    await click("确认仅导入已就绪 1 笔");
    expect(stored).toHaveLength(1);
    expect(container.textContent).toContain("已新增 1 笔");
    expect(currentStep()).toContain("导入结果");
    expect(
      container.querySelectorAll('[aria-label="导入进度"] [aria-current="step"]'),
    ).toHaveLength(1);
    const completed = Array.from(container.querySelectorAll('[aria-label="导入进度"] li')).slice(
      0,
      3,
    );
    expect(completed.every((item) => item.textContent?.includes("已完成"))).toBe(true);
    const submit = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("确认仅导入"),
    );
    expect(submit!.disabled).toBe(true);
    await click("结束 / 取消本次导入");
    await upload();
    await click("保存映射并预览");
    expect(container.textContent).toContain("此订单已经导入");
    expect(saveMany).toHaveBeenCalledTimes(1);
  });
  it("结果中继续处理记录时返回预览；提交失败不会进入结果步骤", async () => {
    const { ctx, saveMany } = context();
    await act(async () => root.render(<StatementImportPage ctx={ctx} />));
    await upload();
    await click("保存映射并预览");
    saveMany.mockRejectedValueOnce(new Error("test failure"));
    await click("确认仅导入已就绪 1 笔");
    expect(currentStep()).toContain("预览确认");
    await click("确认仅导入已就绪 1 笔");
    expect(currentStep()).toContain("导入结果");
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="第 3 行排除"]')!.click(),
    );
    expect(currentStep()).toContain("预览确认");
  });
  it("失效映射阻止提交，支持重置并保持 RTL 与深色主题环境", async () => {
    document.documentElement.dir = "rtl";
    document.documentElement.classList.add("dark");
    try {
      const { ctx, storage } = context('{"账户余额":"missing"}');
      await act(async () => root.render(<StatementImportPage ctx={ctx} />));
      await upload();
      await click("保存映射并预览");
      expect(container.textContent).toContain("确认仅导入已就绪 0 笔");
      await click("返回账户映射");
      await click("重置映射");
      expect(storage.delete).toHaveBeenCalledWith(MAPPING_KEY);
    } finally {
      document.documentElement.dir = "ltr";
      document.documentElement.classList.remove("dark");
    }
  });
});

// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  Account,
  AddonContext,
  Activity,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
} from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StatementImportPage } from "./statement-import-page";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { MAPPING_KEY, MAPPING_V2_KEY } from "../import/ledger";
import { mappingKey } from "../import/account-matching";
import { RULES_KEY } from "../import/rules";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseStatement } from "../parsers";
import { buildPreview } from "../import/ledger";
import { StatementInvestmentFunding } from "./statement-investments";
const scoped = (method: string) => mappingKey({ system: "alipay", accountHint: "", paymentMethod: method });
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
  const values = new Map<string, string>(saved ? [[MAPPING_KEY, saved]] : []);
  const storage = {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (_key: string, value: string) => {
      saved = value;
      values.set(_key, value);
    }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  };
  const saveMany = vi.fn(async ({ creates = [] }: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult> => {
    const created = creates.map((create, index) => activity(create, `ui-${index}`));
    stored.push(...created);
    return { created, updated: [], deleted: [], createdMappings: [], errors: [] };
  });
  const ctx = {
    router: { setLeaveGuard: vi.fn(async () => {}) },
    api: {
      accounts: { getAll: vi.fn(async () => accounts) },
      activities: { getAll: vi.fn(async () => [...stored]), saveMany,
        checkImport: vi.fn(async (rows: import("@wealthfolio/addon-sdk").ActivityImport[]) => rows.map((row) => ({
          ...row, isValid: true, quoteMode: "MANUAL", assetId: "synthetic-fund-asset",
        }))),
      },
      market: { searchTicker: vi.fn(async () => []) },
      navigation: { navigate: vi.fn(async () => {}) },
      toast: { success: vi.fn() },
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

async function upload(lines = [csvRow()], advance = true) {
  if (!container.querySelector('input[type="file"]')) {
    await act(async () => container.querySelector<HTMLElement>('[aria-label="流水格式"]')!.click());
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find((option) => option.textContent?.includes("CSV"))!
        .click(),
    );
  }
  const input = container.querySelector('input[type="file"]')!;
  const file = new File([[HEADER, ...lines].join("\n")], "synthetic.csv");
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  if (advance && !container.querySelector('[role="alert"]')) await click("补齐映射");
}

async function chooseKind(direction: string, kind: string) {
  await act(async () =>
    container.querySelector<HTMLElement>(`[aria-label="性质映射：支付宝 · ${direction}"]`)!.click(),
  );
  await act(async () =>
    [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find((option) => option.textContent === kind)!.click(),
  );
}

async function expandInvestmentDetails() {
  for (const trigger of [...container.querySelectorAll<HTMLElement>('[aria-label^="查看流水明细："]')])
    if (trigger.getAttribute("aria-expanded") !== "true") await act(async () => trigger.click());
  for (const trigger of [...container.querySelectorAll<HTMLElement>('[aria-label^="展开流水："]')])
    if (trigger.getAttribute("aria-expanded") !== "true") await act(async () => trigger.click());
}

describe("shared statement wizard", () => {
  it.skipIf(!process.env.STATEMENT_CMB_PDF)("本地招商 PDF 在投资映射页展示资金方向与账户", async () => {
    const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
    const document = await parseStatement(new Uint8Array(readFileSync(process.env.STATEMENT_CMB_PDF!)), "local-cmb.pdf", {
      sourceAccount: "local-demo-source", assets: {
        getBlob: async (path) => new Blob([readFileSync(join(pdfRoot, path.replace(/^dist\/assets\/pdf\//, "")))]),
      },
    });
    const accounts = [account(), account("fund", "SECURITIES")];
    const mappings = Object.fromEntries(document.rows.map((row) => [mappingKey(row.source), "cash"]));
    const preview = buildPreview(document.rows, accounts, [], mappings, {}, [], { recognizeInvestments: true });
    const target = preview.find((entry) => /朝朝宝\s*转出/.test(entry.row.source.description));
    expect(Boolean(target)).toBe(true);
    const { ctx } = context("", accounts);
    await act(async () => root.render(<FormattingProvider locale="zh-CN" uiLocale="zh" timezone="Asia/Shanghai">
      <StatementInvestmentFunding ctx={ctx} preview={preview} decisions={{}} accounts={accounts} activities={[]} busy={false} onChange={vi.fn()} mode="mapping" />
    </FormattingProvider>));
    const label = `local-cmb.pdf 第 ${target!.row.source.lineNumber} 行`;
    const find = (prefix: string) => [...container.querySelectorAll<HTMLElement>("[aria-label]")]
      .find((element) => prefix === "展开流水"
        ? element.getAttribute("aria-label")?.startsWith(`${prefix}：${label}，`)
        : element.getAttribute("aria-label") === `${prefix}：${label}`);
    for (const trigger of [...container.querySelectorAll<HTMLElement>('[aria-label^="查看流水明细："]')])
      await act(async () => trigger.click());
    expect(find("展开流水")?.textContent).toContain("朝朝宝转出");
    await act(async () => find("展开流水")!.click());
    expect(find("处理方式")?.textContent).toBe("投资资金转账");
    expect(find("转出账户")?.textContent).toBe("请选择");
    expect(find("转入账户")?.textContent).toContain("cash");
  }, 30_000);
  it("默认关闭投资识别，不调用资产接口；开启后在同一向导校验和保存基金", async () => {
    const { ctx, saveMany } = context("", [account(), account("fund", "SECURITIES")]);
    await renderPage(ctx);
    expect(ctx.api.activities.checkImport).not.toHaveBeenCalled();
    expect(ctx.api.market.searchTicker).not.toHaveBeenCalled();
    const toggle = container.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-label")).toBe("识别投资交易流水");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector('label[for="recognize-investments"]')?.textContent).toBe("识别投资交易流水");
    await act(async () => container.querySelector<HTMLLabelElement>('label[for="recognize-investments"]')!.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await act(async () => container.querySelector<HTMLElement>('[aria-label="流水格式"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("蚂蚁基金"))!.click());
    const file = new File(["date,symbol,quantity,activityType,unitPrice,currency,fee,amount,account,comment\n2026-01-03,000032,10,BUY,9.9,CNY,1,100,fund,合成基金；用户买入；订单号：202601010001"], "synthetic-fund.csv");
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(toggle.hasAttribute("data-disabled")).toBe(true);
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    await click("补齐映射");
    await click("保存映射并预览");
    expect(container.textContent).toContain("识别并核对基金资产");
    await click("识别并校验基金资产");
    expect(ctx.api.activities.checkImport).toHaveBeenCalledOnce();
    await click("提交确认");
    await click("提交确认");
    await click("导入 1 笔");
    expect(saveMany.mock.calls[0][0].creates?.[0]).toMatchObject({
      accountId: "fund", activityType: "BUY", amount: "100", quantity: "10", fee: "1",
      asset: { id: "synthetic-fund-asset" },
    });
    expect(ctx.api.navigation.navigate).not.toHaveBeenCalled();
  });
  it("同组资金可批量选择投资账户并逐笔覆盖，双向流水独立确认", async () => {
    const { ctx, saveMany } = context("", [{ ...account(), name: "招商银行" }, account("fund", "SECURITIES"), account("other-fund", "SECURITIES")]);
    await renderPage(ctx);
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    await act(async () => container.querySelector<HTMLElement>('[aria-label="流水格式"]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("招商银行"))!.click());
    const file = new File([
      "账号：synthetic-card\n记账日期,货币,交易金额,联机余额,交易摘要,交易对方,备注\n" +
      "2026-01-01,人民币,-100.00,900.00,基金申购第一笔,合成基金公司,\n" +
      "2026-01-02,人民币,50.00,950.00,基金赎回第二笔,合成基金公司,\n" +
      "2026-01-03,人民币,-200.00,750.00,基金申购第三笔,另一基金公司,",
    ], "synthetic-bank.csv");
    const input = container.querySelector('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
      expect(container.textContent).toContain("synthetic-bank.csv");
    });
    await click("补齐映射");
    const fundingChoices = () => [...container.querySelectorAll<HTMLElement>('[aria-label^="批量投资账户："]')];
    const confirmations = () => [...container.querySelectorAll<HTMLElement>('[role="checkbox"][aria-label^="核对资金流水："]')];
    async function choose(selector: string, index: number, target: string) {
      const trigger = [...container.querySelectorAll<HTMLElement>(selector)][index];
      expect(trigger).toBeTruthy();
      await act(async () => trigger.click());
      await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')]
        .find((option) => option.textContent === target)!.click());
    }
    expect(fundingChoices()).toHaveLength(2);
    const detailGroups = [...container.querySelectorAll<HTMLElement>('[aria-label^="查看流水明细："]')];
    expect(detailGroups.every((trigger) => trigger.getAttribute("aria-expanded") === "false")).toBe(true);
    await expandInvestmentDetails();
    expect(confirmations()).toHaveLength(3);
    expect(container.querySelectorAll('[aria-label^="账户映射："]')).toHaveLength(1);
    expect(container.querySelectorAll('[aria-label^="转出账户："]')).toHaveLength(3);
    expect(container.querySelectorAll('[aria-label^="转入账户："]')).toHaveLength(3);
    expect(container.textContent).toContain("基金申购第一笔");
    expect(container.textContent).toContain("基金赎回第二笔");
    expect(container.querySelector<HTMLButtonElement>('button')?.tagName).toBe("BUTTON");
    await choose('[aria-label^="批量投资账户："]', 0, "fund");
    await choose('[aria-label^="批量投资账户："]', 1, "other-fund");
    await click("批量核对本组资金流水");
    expect(confirmations().map((checkbox) => checkbox.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    await act(async () => confirmations()[2].click());
    expect(confirmations().map((checkbox) => checkbox.getAttribute("aria-checked"))).toEqual(["true", "true", "true"]);
    await choose('[aria-label^="资金方向："]', 0, "资金账户转入（赎回）");
    expect(confirmations().map((checkbox) => checkbox.getAttribute("aria-checked"))).toEqual(["false", "true", "true"]);
    await choose('[aria-label^="资金方向："]', 0, "资金账户转出（申购）");
    await act(async () => confirmations()[0].click());
    // The redemption's outgoing account is the investment side; override only that row.
    await choose('[aria-label^="转出账户："]', 1, "other-fund");
    expect(confirmations().map((checkbox) => checkbox.getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
    await act(async () => confirmations()[1].click());
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 3 笔");
    expect(saveMany).toHaveBeenCalledOnce();
    expect(saveMany.mock.calls[0][0].creates?.map((create) => [create.accountId, create.activityType, create.amount])).toEqual([
      ["cash", "TRANSFER_OUT", "100.00"], ["fund", "TRANSFER_IN", "100.00"],
      ["cash", "TRANSFER_IN", "50.00"], ["other-fund", "TRANSFER_OUT", "50.00"],
      ["cash", "TRANSFER_OUT", "200.00"], ["other-fund", "TRANSFER_IN", "200.00"],
    ]);
  });
  it("疑似基金收益先选择处理方式，异常状态仍须单独核对", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    await upload([csvRow({ description: "基金现金分红", direction: "收入", status: "处理中" })]);
    await expandInvestmentDetails();
    expect(container.textContent).toContain("交易状态需要确认");
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("保存映射并预览"))!;
    expect(next.disabled).toBe(true);
    expect(container.querySelector<HTMLElement>('[aria-label^="处理方式："]')!.textContent).toBe("请选择");
    await act(async () => container.querySelector<HTMLElement>('[aria-label^="处理方式："]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')]
      .find((option) => option.textContent === "普通收入")!.click());
    expect(next.disabled).toBe(false);
    await click("保存映射并预览");
    await expandInvestmentDetails();
    expect(container.textContent).toContain("交易状态需要确认");
    expect(saveMany).not.toHaveBeenCalled();
  });
  it("同组疑似流水可批量选择处理方式并逐笔修改", async () => {
    const { ctx } = context();
    await renderPage(ctx);
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    await upload([
      csvRow({ id: "synthetic-income-1", description: "基金现金分红", direction: "收入" }),
      csvRow({ id: "synthetic-income-2", description: "基金利息", direction: "收入" }),
    ]);
    await expandInvestmentDetails();
    const rows = () => [...container.querySelectorAll<HTMLElement>('[aria-label^="处理方式："]')];
    expect(rows().map((row) => row.textContent)).toEqual(["请选择", "请选择"]);
    await act(async () => container.querySelector<HTMLElement>('[aria-label^="批量处理方式："]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')]
      .find((option) => option.textContent === "普通收入")!.click());
    expect(rows().map((row) => row.textContent)).toEqual(["普通收入", "普通收入"]);
    await act(async () => rows()[1].click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')]
      .find((option) => option.textContent === "普通支出")!.click());
    expect(rows().map((row) => row.textContent)).toEqual(["普通收入", "普通支出"]);
  });
  it("批量映射前可折叠查看流水明细，批量选择后更新流向并保留逐笔编辑", async () => {
    const { ctx } = context(undefined, [account(), account("fund", "SECURITIES")]);
    await renderPage(ctx);
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')!.click());
    await upload([
      csvRow({ id: "synthetic-buy", description: "基金申购", direction: "支出", amount: "100.00" }),
      csvRow({ id: "synthetic-sell", description: "基金赎回", direction: "收入", amount: "50.00" }),
    ]);
    const group = container.querySelector<HTMLElement>('[aria-label^="查看流水明细："]')!;
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll('[aria-label^="展开流水："]')).toHaveLength(0);
    await act(async () => group.click());
    const summaries = () => [...container.querySelectorAll<HTMLElement>('[aria-label^="展开流水："]')];
    expect(summaries()).toHaveLength(2);
    expect(summaries()[0].textContent).toContain("基金申购");
    expect(summaries()[0].textContent).toContain("100.00");
    expect(summaries()[0].textContent).toContain("原始收支：支出");
    expect(summaries()[0].querySelector('[aria-label="资金流向：cash 转出，未选择 转入"] svg')).not.toBeNull();
    expect(summaries()[1].querySelector('[aria-label="资金流向：未选择 转出，cash 转入"] svg')).not.toBeNull();
    expect(summaries()[0].querySelector('[aria-label^="资金流向："] svg')?.getAttribute("class")).toContain("rtl:rotate-180");
    expect(summaries()[0].textContent).not.toContain("→");
    expect(container.querySelector('[aria-label^="处理方式："]')).toBeNull();
    await act(async () => container.querySelector<HTMLElement>('[aria-label^="批量投资账户："]')!.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')]
      .find((option) => option.textContent === "fund")!.click());
    expect(summaries()[0].querySelector('[aria-label="资金流向：cash 转出，fund 转入"] svg')).not.toBeNull();
    expect(summaries()[1].querySelector('[aria-label="资金流向：fund 转出，cash 转入"] svg')).not.toBeNull();
    await act(async () => summaries()[0].click());
    expect(container.querySelector('[aria-label^="处理方式："]')).not.toBeNull();
    const editor = container.querySelector('[aria-label^="处理方式："]')!.closest('[data-slot="accordion-content"]')!;
    expect(editor.querySelector('svg[class*="sm:hidden"]')).not.toBeNull();
    expect(editor.querySelector('svg[class*="sm:block"]')?.getAttribute("class")).toContain("rtl:rotate-180");
    await act(async () => group.click());
    expect(group.getAttribute("aria-expanded")).toBe("false");
    await act(async () => group.click());
    expect(summaries()[0].querySelector('[aria-label="资金流向：cash 转出，fund 转入"] svg')).not.toBeNull();
  });
  it("同一来源的等价付款方式只配置一次，其他卡尾号独立配置", async () => {
    const { ctx, stored } = context("", [account()]);
    await renderPage(ctx);
    await upload([
      csvRow({ id: "card-a-1", method: "招商银行信用卡（１２３４）" }),
      csvRow({ id: "card-a-2", method: "招行信用卡****1234" }),
      csvRow({ id: "card-b", method: "招商银行信用卡(5678)" }),
    ]);
    const choices = [...container.querySelectorAll<HTMLElement>('[aria-label^="账户映射："]')];
    expect(choices).toHaveLength(2);
    const details = container.querySelector('[aria-label="流水明细：招商银行信用卡（１２３４）"]')!;
    expect(details.querySelectorAll("tbody tr")).toHaveLength(2);
    for (const choice of choices) {
      await act(async () => choice.click());
      await act(async () => [...document.querySelectorAll<HTMLElement>('[data-slot="select-content"][data-open] [role="option"]')].find((option) => option.textContent?.startsWith("cash"))!.click());
    }
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 3 笔");
    expect(stored).toHaveLength(3);
    expect(stored.every((activity) => activity.accountId === "cash")).toBe(true);
  });
  it.each(["ltr", "rtl"])("%s 同类未知性质只选择一次，空值单独分组且显示全部流水", async (direction) => {
    document.documentElement.dir = direction;
    const { ctx, stored } = context();
    await renderPage(ctx);
    await upload([
      ...Array.from({ length: 6 }, (_, index) => csvRow({ id: `unknown-${index}`, direction: "未知", description: `关联商品-${index}` })),
      csvRow({ id: "blank", direction: "" }),
    ]);
    expect(container.textContent).toContain("需要补齐 · 2 类记账性质 / 7 笔流水");
    expect(container.querySelectorAll('[aria-label^="性质映射："]')).toHaveLength(2);
    const table = container.querySelector('[aria-label="流水明细：性质：支付宝 · 未知"]')!;
    expect(table.closest('[data-slot="accordion-item"]')?.querySelector('[data-slot="accordion-trigger"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(6);
    for (const heading of ["来源行", "交易时间", "原始收支", "记账性质", "交易对方", "商品说明", "金额", "付款方式", "交易状态"])
      expect(table.textContent).toContain(heading);
    for (let index = 0; index < 6; index++) expect(table.textContent).toContain(`关联商品-${index}`);
    await chooseKind("未知", "支出");
    expect(container.querySelectorAll('[aria-label^="性质映射："]')).toHaveLength(1);
    await chooseKind("未提供收支", "收入");
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 7 笔");
    expect(stored.map((entry) => entry.activityType)).toEqual([
      ...Array(6).fill("WITHDRAWAL"), "DEPOSIT",
    ]);
  });

  it("医保和代付成功直接识别支出，已知性质不被未知分组覆盖", async () => {
    const { ctx, stored } = context();
    await renderPage(ctx);
    await upload([
      csvRow({ id: "medical", status: "支付成功", description: "医保支付(不含自费)" }),
      csvRow({ id: "proxy", status: "代付成功", description: "代付" }),
      csvRow({ id: "income", direction: "收入" }),
      csvRow({ id: "unknown", direction: "未知" }),
    ]);
    expect(container.textContent).not.toContain("异常状态待核对");
    expect(container.querySelectorAll('[aria-label^="性质映射："]')).toHaveLength(1);
    await chooseKind("未知", "支出");
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 4 笔");
    expect(stored.map((entry) => entry.activityType)).toEqual(["WITHDRAWAL", "WITHDRAWAL", "DEPOSIT", "WITHDRAWAL"]);
  });

  it.each(["ltr", "rtl"])("%s 异常状态保留性质，完整显示明细并在审核后放行", async (direction) => {
    document.documentElement.dir = direction;
    const { ctx, stored } = context();
    await renderPage(ctx);
    await upload(Array.from({ length: 6 }, (_, index) => csvRow({
      id: `review-${index}`, status: "未知业务成功", description: `异常商品-${index}`,
    })));
    expect(container.querySelector('[aria-label^="性质映射："]')).toBeNull();
    expect(container.textContent).toContain("异常状态待核对 · 1 类 / 6 笔流水");
    const table = container.querySelector('[aria-label="流水明细：异常状态：支付宝 · 未知业务成功"]')!;
    expect(table.closest('[data-slot="accordion-item"]')?.querySelector('[data-slot="accordion-trigger"]')?.getAttribute("aria-expanded")).toBe("true");
    const records = [...table.querySelectorAll("tbody tr")];
    expect(records).toHaveLength(6);
    records.forEach((row, index) => {
      expect(row.textContent).toContain(`异常商品-${index}`);
      expect(row.textContent).toContain("未知业务成功");
      expect(row.textContent).toContain("支出");
      expect(row.textContent).toContain("账户余额");
    });
    await click("保存映射并预览");
    const submit = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("提交确认"))!;
    expect(submit.disabled).toBe(true);
    await act(async () => container.querySelector<HTMLElement>('[aria-label="选择全部行"]')!.click());
    await click("标记已核对");
    expect(submit.disabled).toBe(false);
    await click("提交确认");
    await click("导入 6 笔");
    expect(stored).toHaveLength(6);
  });

  it("分组跳过与恢复作用于全部关联行，新上传不继承分组选择", async () => {
    const { ctx } = context();
    await renderPage(ctx);
    const unknown = [csvRow({ id: "one", direction: "未知" }), csvRow({ id: "two", direction: "未知" })];
    await upload([csvRow(), ...unknown]);
    await act(async () => container.querySelector<HTMLElement>('[aria-label="选择性质分组 支付宝 · 未知"]')!.click());
    await click("跳过");
    expect(container.querySelector('[aria-label^="性质映射："]')).toBeNull();
    await click("保存映射并预览");
    await act(async () => container.querySelector<HTMLElement>('[aria-label="选择全部行"]')!.click());
    await click("取消跳过");
    await click("返回账户映射");
    expect(container.textContent).toContain("需要补齐 · 1 类记账性质 / 2 笔流水");
    await chooseKind("未知", "支出");
    await click("上一步");
    await click("移除文件");
    const discard = [...document.querySelector('[role="alertdialog"]')!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("取消本次导入"))!;
    await act(async () => discard.click());
    await upload(unknown);
    expect(container.textContent).toContain("需要补齐 · 1 类记账性质 / 2 笔流水");
  });

  it("分组补齐保留审核页逐行修改的性质和账户，并保留金额", async () => {
    // Give the virtualized grid a viewport in happy-dom so its editors mount.
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
    const width = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1200);
    try {
      const { ctx, stored } = context(undefined, [account(), account("manual")]);
      await renderPage(ctx);
      await upload([
        csvRow(),
        csvRow({ id: "manual", direction: "不计收支", amount: "15" }),
        csvRow({ id: "group", direction: "不计收支", amount: "20" }),
      ]);
      await click("保存映射并预览");
      await act(async () => container.querySelector<HTMLElement>('[aria-label="选择全部行"]')!.click());
      await click("取消跳过");
      for (const [column, label] of [["kind", "收入"], ["accountId", "manual"]]) {
        const cells = container.querySelectorAll<HTMLElement>(`[role="gridcell"][data-column-id="${column}"]`);
        expect(cells.length).toBeGreaterThanOrEqual(3);
        await act(async () => cells[1].firstElementChild!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
        await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')]
          .find((option) => option.textContent?.includes(label))!.click());
      }
      await click("返回账户映射");
      expect(container.textContent).toContain("需要补齐 · 1 类记账性质 / 1 笔流水");
      await chooseKind("不计收支", "支出");
      await click("保存映射并预览");
      await click("提交确认");
      await click("导入 3 笔");
      expect(stored[1]).toMatchObject({ activityType: "DEPOSIT", accountId: "manual", amount: "15.00" });
      expect(stored[2]).toMatchObject({ activityType: "WITHDRAWAL", accountId: "cash", amount: "20.00" });
    } finally {
      height.mockRestore();
      width.mockRestore();
    }
  });

  it("映射完成仍明确提示人工核对，并说明表格编辑入口", async () => {
    const { ctx } = context(JSON.stringify({ "信用卡&红包": "cash" }));
    await renderPage(ctx);
    await upload([csvRow({ method: "信用卡&红包", status: "处理中" })]);
    expect(container.textContent).toContain("仍需人工核对");
    expect(container.textContent).toContain("映射完成后仍需核对交易");
    await click("保存映射并预览");
    expect(container.textContent).toContain("还有 1 笔记录需要处理");
    expect(container.textContent).toContain("F2 或 Enter");
    expect(container.textContent).toContain("勾选行首复选框");
    expect(container.textContent).toContain("错误不能通过核对放行");
  });
  it.each(["ltr", "rtl"])("%s 缺失付款方式在映射项下展示全部六笔关联流水", async (direction) => {
    document.documentElement.dir = direction;
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload([
      ...Array.from({ length: 6 }, (_, index) => csvRow({
        id: `income-${index}`,
        method: "",
        direction: index === 5 ? "不计收支" : "收入",
        description: `待判断收款来源-${index}`,
      })),
      csvRow({ id: "other", method: "账户余额", description: "其他账户交易" }),
    ]);
    const table = container.querySelector('[aria-label="流水明细：未提供付款方式"]')!;
    expect(table).toBeTruthy();
    expect(table.closest('[data-slot="accordion-item"]')?.querySelector('[data-slot="accordion-trigger"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(6);
    for (let index = 0; index < 6; index++) expect(table.textContent).toContain(`待判断收款来源-${index}`);
    expect(table.textContent).not.toContain("其他账户交易");
    for (const heading of ["交易时间", "记账性质", "交易对方", "商品说明", "金额", "处理状态"]) expect(table.textContent).toContain(heading);
    expect(table.textContent).toContain("虚构商户");
    expect(table.textContent).toContain("收入");
    expect(table.textContent).toContain("CNY");
    expect(table.textContent).toContain("默认跳过个人记账");
    const trigger = container.querySelector<HTMLElement>('[aria-label="账户映射："]')!;
    await act(async () => trigger.click());
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("cash"))!.click());
    expect(container.querySelector('[aria-label="流水明细：未提供付款方式"]')!.querySelectorAll("tbody tr")).toHaveLength(6);
    expect(saveMany).not.toHaveBeenCalled();
  });
  it("先选择格式，解析后留在上传页，下一步进入映射且不写账目", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    await upload([csvRow()], false);
    expect(container.querySelector('[aria-current="step"]')?.getAttribute("aria-label")).toContain(
      "上传",
    );
    expect(container.textContent).toContain("文件预览");
    await click("补齐映射");
    expect(container.textContent).toContain("已映射 / 已跳过");
    expect(saveMany).not.toHaveBeenCalled();
  });

  it("缺失记账性质阻断映射，选中问题记录后可从顶部跳过", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload([csvRow(), csvRow({ id: "pending", direction: "未知" })]);
    const next = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("保存映射并预览"),
    )!;
    expect(next.disabled).toBe(true);
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="选择性质分组 支付宝 · 未知"]')!.click(),
    );
    const toolbar = container.querySelector('[aria-label="映射批量操作"]')!;
    await act(async () =>
      [...toolbar.querySelectorAll("button")]
        .find((button) => button.textContent === "跳过")!
        .click(),
    );
    expect(next.disabled).toBe(false);
    await click("保存映射并预览");
    expect(container.querySelector('[aria-label="第 3 行确认"]')).toBeNull();
    expect(saveMany).not.toHaveBeenCalled();
  });
  it("不计收支默认跳过不阻塞映射，顶部恢复后重新要求性质与账户", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload([csvRow(), csvRow({ id: "company", direction: "不计收支", method: "因公付" })]);
    const next = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("保存映射并预览"),
      )!;
    expect(next().disabled).toBe(false);
    expect(container.textContent).not.toContain("需要补齐 · 1 类记账性质");
    await act(async () =>
      container.querySelector<HTMLElement>('[aria-label="选择付款方式 因公付"]')!.click(),
    );
    await click("取消跳过");
    expect(next().disabled).toBe(true);
    expect(container.textContent).toContain("需要补齐 · 1 类记账性质 / 1 笔流水");
    expect(container.textContent).toContain("请补齐账户映射");
    expect(saveMany).not.toHaveBeenCalled();
    await click("上一步");
    await click("补齐映射");
    expect(next().disabled).toBe(true);
    await click("上一步");
    await click("移除文件");
    const discard = [...document.querySelector('[role="alertdialog"]')!.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("取消本次导入"))!;
    await act(async () => discard.click());
    await upload([csvRow(), csvRow({ id: "replacement", direction: "不计收支", method: "因公付" })]);
    expect(next().disabled).toBe(false);
    expect(container.querySelector('[aria-label="映射批量操作"]')).toBeNull();
  });
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
    expect(storage.set).toHaveBeenCalledWith(MAPPING_V2_KEY, JSON.stringify({ [scoped("余额宝")]: "yuebao" }));
    await click("提交确认");
    await click("导入 1 笔");
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
    await click("导入 1 笔");
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
    expect(storage.set).toHaveBeenCalledWith(MAPPING_V2_KEY, JSON.stringify({ [scoped(method)]: "card" }));
    await click("提交确认");
    await click("导入 1 笔");
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
    expect(container.querySelector(`[aria-label="账户映射：${method}"]`)!.textContent).toContain(
      "cash",
    );
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
    expect(container.querySelector(`[aria-label="账户映射：${method}"]`)!.textContent).toContain(
      "请选择",
    );
    await click("保存映射并预览");
    expect(storage.set).not.toHaveBeenCalled();
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
    expect(
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("保存映射并预览"),
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
    await click("导入 1 笔");
    expect(stored[0].amount).toBe("1234.56");
    expect(stored[0].metadata!.unifiedStatementImport).toMatchObject({
      sources: [{ amount: "1234.56", originalTime: "2025/12/31 14:23" }],
    });
    expect(container.textContent).toContain("已新增 1 笔");
    expect(ctx.api.navigation.navigate).toHaveBeenCalledWith("/activities?tab=spending");
    expect(ctx.api.toast.success).toHaveBeenCalledWith("导入成功，分类由系统后台处理");
    expect(ctx.router.setLeaveGuard).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    await renderPage(ctx, "zh-TW", "zh-Hant", "Asia/Taipei");
    expect(container.querySelector("h1")!.textContent).toBe("账单导入");
    expect(container.textContent).toContain("已新增 1 笔");
  });
  it("导航失败保留成功结果，查看收支重试不会再次保存账目", async () => {
    const { ctx, saveMany, stored } = context();
    vi.mocked(ctx.api.navigation.navigate).mockRejectedValueOnce(new Error("navigation failed"));
    await renderPage(ctx);
    await upload();
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 1 笔");
    expect(container.textContent).toContain("导入完成");
    expect(container.textContent).toContain("无法打开收支页");
    expect(container.textContent).not.toContain("提交或结果核对失败");
    await click("查看收支");
    expect(ctx.api.navigation.navigate).toHaveBeenCalledTimes(2);
    expect(saveMany).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
    expect(container.textContent).not.toContain("无法打开收支页");
  });
  it("提交前账户变化返回预览，不保存或自动跳转", async () => {
    const { ctx, saveMany } = context();
    await renderPage(ctx);
    await upload();
    await click("保存映射并预览");
    await click("提交确认");
    vi.mocked(ctx.api.accounts.getAll).mockResolvedValue([]);
    await click("导入 1 笔");
    expect(container.textContent).toContain("预览已刷新");
    expect(saveMany).not.toHaveBeenCalled();
    expect(ctx.api.navigation.navigate).not.toHaveBeenCalled();
  });
  it("部分保存停留结果页，不自动跳转", async () => {
    const { ctx, saveMany } = context();
    saveMany.mockImplementationOnce(async ({ creates = [] }) => ({
      created: [activity(creates[0])], updated: [], deleted: [], createdMappings: [],
      errors: [{ action: "create", message: "部分失败" }],
    }));
    await renderPage(ctx);
    await upload([csvRow(), csvRow({ id: "second" })]);
    await click("保存映射并预览");
    await click("提交确认");
    await click("导入 2 笔");
    expect(ctx.api.navigation.navigate).not.toHaveBeenCalled();
    expect(ctx.api.toast.success).not.toHaveBeenCalled();
    expect(container.textContent).toContain("保存未完整完成");
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
    expect(storage.set).toHaveBeenCalledWith(MAPPING_V2_KEY, JSON.stringify({ [scoped("账户余额")]: "cash" }));
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
    await click("导入 1 笔");
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
    await click("导入 1 笔");
    expect(container.textContent).toContain("结果待核对");
    expect(ctx.api.navigation.navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("导入完成");
    await click("返回预览");
    expect(container.querySelector('[role="grid"]')).toBeTruthy();
  });
  it("映射升级持久化后重开可恢复，重置同时清除新旧键", async () => {
    const { ctx, storage } = context();
    await renderPage(ctx); await upload(); await click("保存映射并预览");
    expect(await storage.get(MAPPING_V2_KEY)).toBe(JSON.stringify({ [scoped("账户余额")]: "cash" }));
    expect(await storage.get(MAPPING_KEY)).toBeNull();
    await act(async () => root.unmount()); root = createRoot(container);
    await renderPage(ctx); await upload([csvRow({ id: "new-file" })]);
    expect(container.textContent).toContain("已保存");
    await click("重置映射");
    expect(await storage.get(MAPPING_V2_KEY)).toBeNull();
    expect(await storage.get(MAPPING_KEY)).toBeNull();
  });
  it("映射写入失败不删除旧配置，不进入审核或保存账目", async () => {
    const { ctx, storage, saveMany } = context();
    await renderPage(ctx); await upload();
    storage.set.mockRejectedValueOnce(new Error("storage unavailable"));
    await click("保存映射并预览");
    expect(container.textContent).toContain("账户映射保存失败");
    expect(await storage.get(MAPPING_KEY)).not.toBeNull();
    expect(storage.delete).not.toHaveBeenCalled();
    expect(saveMany).not.toHaveBeenCalled();
  });
  it("追加同名文件的相同行号不会继承前一文件的逐行性质", async () => {
    const { ctx, stored } = context();
    await renderPage(ctx); await upload([csvRow({ id: "first-file", direction: "未知" })]);
    await chooseKind("未知", "支出"); await click("上一步");
    await upload([csvRow({ id: "second-file", direction: "未知" })]);
    expect(container.textContent).toContain("1 类记账性质 / 1 笔流水");
    await chooseKind("未知", "收入"); await click("保存映射并预览");
    await click("提交确认"); await click("导入 2 笔");
    expect(stored.map((entry) => entry.activityType)).toEqual(["WITHDRAWAL", "DEPOSIT"]);
  });
  it("保存映射不将规则结果冻结为保存映射，也不改回推断账户", async () => {
    const { ctx, storage, stored } = context("{}", [account(), account("manual")]);
    await storage.set(RULES_KEY, JSON.stringify([{ id: "rule", name: "合成规则", enabled: true, priority: 0, matchMode: "all", conditions: [], accountId: "manual", ignore: false }]));
    await renderPage(ctx); await upload();
    expect(container.textContent).toContain("规则匹配");
    await click("保存映射并预览");
    expect(await storage.get(MAPPING_V2_KEY)).toBe("{}");
    await click("提交确认"); await click("导入 1 笔");
    expect(stored[0].accountId).toBe("manual");
  });
  it("blocks unavailable mappings and supports reset under RTL and dark theme", async () => {
    document.documentElement.dir = "rtl";
    document.documentElement.classList.add("dark");
    try {
      const { ctx, storage } = context('{"账户余额":"missing"}');
      await renderPage(ctx);
      await upload();
      const next = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("保存映射并预览"),
      )!;
      expect(next.disabled).toBe(true);
      await click("重置映射");
      expect(storage.delete).toHaveBeenCalledWith(MAPPING_KEY);
    } finally {
      document.documentElement.dir = "ltr";
      document.documentElement.classList.remove("dark");
    }
  });
});

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../../wealthfolio/package.json", import.meta.url));
const { test, expect } = require("@playwright/test");
const base = process.env.WF_E2E_BASE_URL || "http://localhost:1420";
const local = new URL("../local/", import.meta.url);

async function choose(frame, label, option) {
  await frame.getByRole("combobox", { name: label, exact: true }).click();
  await frame.getByRole("option", { name: option, exact: true }).click();
}

for (const direction of ["ltr", "rtl"]) {
  test(`two local import workflows, preview, bulk actions and themes (${direction})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await (
      await page.request.post(`${base}/api/v1/profiles/get_profile_state`, { data: {} })
    ).json();
    const unlocked = await page.request.post(`${base}/api/v1/profiles/unlock_profile`, {
      data: { profileId: state.profiles[0].id },
    });
    expect(unlocked.ok()).toBe(true);
    const headers = { "x-wf-profile-scope": (await unlocked.json()).scopeId };
    for (const [path, data] of [
      [
        "settings",
        {
          onboardingCompleted: true,
          language: "en",
          syncEnabled: false,
          autoUpdateCheckEnabled: false,
        },
      ],
      ["spending/settings", { enabled: true, accountIds: [] }],
    ])
      expect((await page.request.put(`${base}/api/v1/${path}`, { headers, data })).ok()).toBe(true);
    for (const id of ["unified-statement-import-addon", "ant-fund-pdf-import-addon"]) {
      const root = new URL(`${id}/`, local);
      const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8"));
      const response = await page.request.post(`${base}/api/v1/addons/install-zip`, {
        headers,
        data: {
          zipDataB64: readFileSync(new URL(`dist/${id}-${manifest.version}.zip`, root)).toString(
            "base64",
          ),
          enableAfterInstall: true,
        },
      });
      expect(response.ok(), await response.text()).toBe(true);
    }
    const accountName = `测试资金 ${direction}`;
    const cashResponse = await page.request.post(`${base}/api/v1/accounts`, {
      headers,
      data: {
        name: accountName,
        accountType: "CASH",
        currency: "CNY",
        isDefault: false,
        isActive: true,
        isArchived: false,
        trackingMode: "TRANSACTIONS",
      },
    });
    expect(cashResponse.ok()).toBe(true);
    const cashAccount = await cashResponse.json();
    expect((await page.request.put(`${base}/api/v1/spending/settings`, {
      headers, data: { enabled: true, accountIds: [cashAccount.id] },
    })).ok()).toBe(true);
    const taxonomyResponse = await page.request.get(`${base}/api/v1/taxonomies/spending_categories`, { headers });
    expect(taxonomyResponse.ok()).toBe(true);
    const category = (await taxonomyResponse.json()).categories.find((item) => item.key === "food");
    expect(category).toBeTruthy();
    const ruleResponse = await page.request.post(`${base}/api/v1/spending/rules`, {
      headers,
      data: {
        name: `支付宝来源分类 ${direction}`,
        pattern: "支付宝分类：餐饮美食",
        matchType: "contains",
        taxonomyId: "spending_categories",
        categoryId: category.id,
        activityType: "WITHDRAWAL",
        priority: 100,
        isGlobal: false,
        accountId: cashAccount.id,
      },
    });
    expect(ruleResponse.ok()).toBe(true);

    await page.goto(`${base}/addons/unified-statement-import-addon?dir=${direction}`);
    const frame = page.frameLocator("iframe");
    await expect(frame.getByRole("combobox", { name: "流水格式" })).toBeVisible();
    await expect(frame.locator('input[type="file"]')).toHaveCount(0);
    await choose(frame, "流水格式", "支付宝 CSV");
    const csv = readFileSync(
      new URL("unified-statement-import-addon/src/fixtures/alipay-synthetic.csv", local),
      "utf8",
    ).split(/\r?\n/);
    const header = csv.find((line) => line.startsWith("交易时间,"));
    const records = csv.filter((line) => line.startsWith("2025/"));
    const text = [header, records[0], records[3]]
      .join("\n")
      .replaceAll("synthetic-order-", `e2e-${direction}-`)
      .replaceAll("账户余额", accountName)
      .replaceAll("虚构信用卡(0000)&红包", `虚构信用卡(0000)&红包${direction}`);
    await frame
      .locator('input[type="file"]')
      .setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(text) });
    await expect(frame.getByText(/文件预览.*2.*行/)).toBeVisible();
    await frame.getByRole("tab", { name: "原始文件", exact: true }).click();
    await expect(frame.locator("pre")).toContainText("交易订单号");
    await frame.getByRole("button", { name: "补齐映射", exact: true }).click();
    await expect(frame.getByRole("button", { name: "保存映射并预览" })).toBeDisabled();
    await frame.locator("summary").filter({ hasText: "已映射 / 已跳过" }).click();
    await expect(
      frame.getByRole("combobox", { name: `账户映射：${accountName}`, exact: true }),
    ).toContainText(accountName);
    await expect(frame.getByText("自动识别", { exact: true })).toBeAttached();
    await choose(
      frame,
      `账户映射：虚构信用卡(0000)&红包${direction}`,
      `${accountName} · 现金 · CNY`,
    );
    await expect(frame.getByText("映射完成后仍需核对交易", { exact: true })).toBeVisible();
    await frame.getByRole("button", { name: "保存映射并预览" }).click();
    await expect(frame.getByRole("button", { name: "提交确认", exact: true })).toBeDisabled();
    const pendingRow = frame.getByRole("row").filter({ hasText: "组合付款" });
    for (const column of ["kind", "amount", "accountId"])
      await expect(pendingRow.locator(`[data-column-id="${column}"] [data-cell-state="warning"]`)).toBeVisible();
    await expect(frame.getByText(/双击“记账性质”/)).toBeVisible();
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "标记已核对", exact: true }).click();
    await expect(pendingRow.locator('[data-cell-state="warning"]')).toHaveCount(0);
    await expect(frame.getByRole("button", { name: "提交确认", exact: true })).toBeEnabled();
    const amountCell = frame
      .getByRole("row")
      .filter({ hasText: "组合付款" })
      .locator('[data-column-id="amount"]');
    await amountCell.getByRole("button").click();
    await expect(amountCell.getByRole("button")).toBeFocused();
    await amountCell.getByRole("button").press("F2");
    await expect(amountCell.locator("input")).toBeVisible();
    await amountCell.locator("input").fill("29.50");
    await amountCell.locator("input").press("Enter");
    await expect(amountCell.locator('[data-cell-state="warning"]')).toBeVisible();
    await expect(frame.getByRole("button", { name: "提交确认", exact: true })).toBeDisabled();
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "标记已核对", exact: true }).click();
    await amountCell.getByRole("button").click();
    await expect(amountCell.getByRole("button")).toBeFocused();
    await amountCell.getByRole("button").dblclick({ delay: 100 });
    await expect(amountCell.locator("input")).toBeVisible();
    await amountCell.locator("input").press("Escape");
    // Supply synthetic clipboard input without touching the system clipboard.
    await frame.getByRole("grid").evaluate(() => {
      Object.defineProperty(navigator.clipboard, "readText", {
        configurable: true,
        value: async () => "28.25",
      });
    });
    await frame.getByRole("button", { name: "显示列", exact: true }).click();
    await frame.getByRole("button", { name: "显示列", exact: true }).click();
    await amountCell.getByRole("button").click();
    await expect(amountCell.getByRole("button")).toBeFocused();
    await amountCell.getByRole("button").press("Control+v");
    await expect(amountCell).toContainText("28.25");
    await expect(frame.getByRole("button", { name: "提交确认", exact: true })).toBeDisabled();
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "标记已核对", exact: true }).click();
    // Filtering must preserve source identities for skip/restore.
    await choose(frame, "筛选状态", "待导入");
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "跳过", exact: true }).click();
    await choose(frame, "筛选状态", "排除");
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "取消跳过", exact: true }).click();
    await choose(frame, "筛选状态", "待确认");
    await frame.getByRole("checkbox", { name: "选择行 3", exact: true }).check();
    await frame.getByRole("button", { name: "标记已核对", exact: true }).click();
    await choose(frame, "筛选状态", "请选择");
    await frame
      .getByRole("columnheader", { name: /确认金额/ })
      .getByRole("button")
      .click();
    await expect(frame.getByRole("menuitem", { name: /Hide column/ })).toBeVisible();
    await frame.getByRole("menuitem", { name: /Hide column/ }).click();
    await expect(frame.getByRole("columnheader", { name: /确认金额/ })).toHaveCount(0);
    await frame.getByRole("button", { name: "显示列", exact: true }).click();
    await frame.getByRole("checkbox", { name: "确认金额", exact: true }).check();
    await frame.getByRole("button", { name: "显示列", exact: true }).click();
    await frame
      .getByRole("columnheader", { name: /确认金额/ })
      .getByRole("button")
      .click();
    await frame.getByRole("menuitem", { name: "Pin to left", exact: true }).click();
    await frame
      .getByRole("columnheader", { name: /确认金额/ })
      .getByRole("button")
      .click();
    await frame.getByRole("menuitem", { name: "Unpin from left", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`statement-${direction}-light.png`) });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: info.outputPath(`statement-${direction}-dark.png`) });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await frame.getByRole("button", { name: "提交确认", exact: true }).click();
    await frame.getByRole("button", { name: /导入.*2.*笔/ }).click();
    await expect(page).toHaveURL(/\/activities\?tab=spending$/);
    await expect(page.getByRole("button", { name: "Spending", exact: true })).toHaveAttribute("aria-current", "page");
    const savedResponse = await page.request.post(`${base}/api/v1/activities/search`, {
      headers,
      data: { page: 0, pageSize: 100, filters: {} },
    });
    expect(savedResponse.ok()).toBe(true);
    const saved = (await savedResponse.json()).data.filter(
      (activity) => activity.accountName === accountName,
    );
    expect(saved).toHaveLength(2);
    for (const activity of saved) {
      expect(activity.comment ?? activity.notes).toContain("支付宝分类：餐饮美食");
      await expect.poll(async () => {
        const response = await page.request.get(`${base}/api/v1/spending/activities/${activity.id}/assignments`, { headers });
        expect(response.ok()).toBe(true);
        return (await response.json()).map((assignment) => assignment.categoryId);
      }, { timeout: 20_000 }).toContain(category.id);
    }
    expect(saved.map((activity) => Number(activity.amount)).sort((a, b) => a - b)).toEqual([
      12.3, 28.25,
    ]);

    const investmentName = `测试投资 ${direction}`;
    expect(
      (
        await page.request.post(`${base}/api/v1/accounts`, {
          headers,
          data: {
            name: investmentName,
            accountType: "SECURITIES",
            currency: "CNY",
            isDefault: false,
            isActive: true,
            isArchived: false,
            trackingMode: "TRANSACTIONS",
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto(`${base}/addons/ant-fund-pdf-import-addon?dir=${direction}`);
    await choose(frame, "流水格式", "蚂蚁基金交易明细 PDF");
    await frame
      .locator('input[type="file"]')
      .setInputFiles(
        fileURLToPath(new URL("ant-fund-pdf-import-addon/src/fixtures/statement.pdf", local)),
      );
    await expect(frame.getByText(/文件预览 ·/)).toBeVisible({ timeout: 30_000 });
    await frame.getByRole("tab", { name: "原始文件", exact: true }).click();
    await expect(frame.getByRole("img", { name: "PDF 第 1 页" })).toBeVisible({ timeout: 30_000 });
    await frame.getByRole("button", { name: "下一步", exact: true }).click();
    await choose(frame, "人民币投资账户", investmentName);
    // All fixture rows needing manual completion are explicitly skipped in mapping.
    const pending = frame.locator("details").filter({ hasText: /需要补齐.*笔/ });
    for (const checkbox of await pending.getByRole("checkbox").all()) await checkbox.check();
    if (await frame.getByRole("toolbar", { name: "映射批量操作" }).count())
      await frame.getByRole("button", { name: "跳过", exact: true }).click();
    await frame.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(frame.getByRole("grid")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`fund-${direction}-light.png`) });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: info.outputPath(`fund-${direction}-dark.png`) });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
    await frame.getByRole("button", { name: "下一步", exact: true }).click();
    await expect(page).toHaveURL(/\/import\?addonImport=1/);
    await expect(page.locator("[data-import-wizard]")).toBeVisible();
  });
}

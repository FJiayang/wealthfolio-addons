import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

// Reuse the linked host's existing browser-test runtime, without changing its sources or .env.
const hostRoot = resolve(
  dirname(realpathSync(fileURLToPath(import.meta.resolve("@wealthfolio/addon-sdk")))),
  "../../..",
);
const { chromium, expect } = createRequire(join(hostRoot, "package.json"))("@playwright/test");
const root = new URL("../", import.meta.url);
const installation = await mkdtemp(join(tmpdir(), "wealthfolio-statement-browser-"));
const reviewDirectory = process.env.STATEMENT_SCREENSHOT_DIR;
if (reviewDirectory) await mkdir(reviewDirectory, { recursive: true });
async function captureReview(page, name, anchor) {
  if (!reviewDirectory) return;
  const frame = page.frameLocator("iframe");
  const mobile = page.viewportSize().width < 600;
  await expect.poll(() => frame.locator(".statement-import").evaluate((element) => element.getBoundingClientRect().width))
    [mobile ? "toBeLessThan" : "toBeGreaterThan"](mobile ? 600 : 900);
  await page.mouse.move(0, 0);
  for (const surface of page.frames()) await surface.evaluate(async () => {
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  if (anchor) await anchor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(reviewDirectory, name + ".png"), animations: "disabled" });
}
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(join(hostRoot, "target/debug/wealthfolio-server"), [], {
  cwd: installation,
  env: {
    ...process.env,
    WF_LISTEN_ADDR: `127.0.0.1:${port}`,
    WF_DB_PATH: join(installation, "app.db"),
    WF_DATA_DIR: installation,
    WF_ADDONS_DIR: join(installation, "addons"),
    WF_STATIC_DIR: join(hostRoot, "dist"),
    WF_SECRET_KEY: randomBytes(32).toString("base64"),
    WF_DB_REQUIRE_ENCRYPTION: "false",
    WF_AUTH_REQUIRED: "false",
    WF_AUTH_PASSWORD_HASH: "",
    WF_MCP_ENABLED: "false",
    WEALTHFOLIO_E2E: "1",
    WEALTHFOLIO_FIXTURE_DIR: join(hostRoot, "e2e/fixtures/quotes"),
    RUST_LOG: "error",
  },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; ; i++) {
    assert(server.exitCode === null, "隔离宿主启动失败，请先编译宿主 web server");
    const ready = await fetch(`${origin}/api/v1/healthz`)
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) break;
    assert(i < 100, "等待隔离宿主超时");
    await setTimeout(300);
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ baseURL: origin });
  context.on("page", (page) =>
    page.on("pageerror", (error) => console.error("Isolated browser error:", error.message)),
  );
  let scope;
  async function command(path, data, method = "POST") {
    const response = await context.request.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: scope ? { "x-wf-profile-scope": scope } : {},
    });
    assert(response.ok(), `隔离宿主接口 ${path} 返回 ${response.status()}`);
    return response.json();
  }
  const state = await command("/profiles/get_profile_state", {});
  const grant = await command("/profiles/unlock_profile", { profileId: state.profiles[0].id });
  scope = grant.scopeId;
  await command(
    "/settings",
    {
      onboardingCompleted: true,
      baseCurrency: "CNY",
      language: "en",
      syncEnabled: false,
      autoUpdateCheckEnabled: false,
    },
    "PUT",
  );
  const accounts = [];
  for (const name of ["微信零钱", "招商银行"])
    accounts.push(
      await command("/accounts", {
        name,
        accountType: "CASH",
        currency: "CNY",
        isDefault: false,
        isActive: true,
        isArchived: false,
        trackingMode: "TRANSACTIONS",
      }),
    );
  await command(
    "/spending/settings",
    { enabled: true, accountIds: accounts.map((account) => account.id) },
    "PUT",
  );
  const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  await command("/addons/install-zip", {
    zipDataB64: (
      await readFile(new URL(`dist/${manifest.id}-${manifest.version}.zip`, root))
    ).toString("base64"),
    enableAfterInstall: true,
  });
  const golden = JSON.parse(
    await readFile(new URL("src/parsers/__golden__/channels.json", root), "utf8"),
  );
  const csv = (rows) =>
    Buffer.from(
      rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n"),
    );
  for (const [index, channel, width, direction] of [
    [0, "微信支付", 1440, "ltr"],
    [1, "招商银行", 390, "rtl"],
  ]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/addons/${manifest.id}?dir=${direction}`);
    const frame = page.frameLocator("iframe");
    await frame.locator('[aria-label="流水格式"]').click();
    await frame.getByRole("option", { name: new RegExp(channel) }).click();
    if (index === 1)
      await frame.getByRole("textbox", { name: "来源账户标识" }).fill("synthetic-bank-source");
    await frame.locator('input[type="file"]').setInputFiles({
      name: "synthetic.csv",
      mimeType: "text/csv",
      buffer: csv([golden[index].header, golden[index].row]),
    });
    await frame.getByRole("button", { name: "补齐映射", exact: true }).click();
    await frame.getByRole("button", { name: "保存映射并预览", exact: true }).click();
    await expect(frame.locator('[data-processing-status="ready"]')).toHaveCount(1);
    await frame.locator('[role="grid"]').scrollIntoViewIfNeeded();
    await expect(frame.locator('[role="grid"]')).toBeVisible();
    await page.screenshot({ path: join(installation, `review-${direction}.png`) });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.screenshot({ path: join(installation, `review-dark-${direction}.png`) });
    await frame.getByRole("button", { name: "提交确认", exact: true }).click();
    await frame.getByRole("button", { name: "导入 1 笔", exact: true }).click();
    await expect(page).toHaveURL(/activities\?tab=spending/);
    await page.close();
  }
  const saved = (
    await command("/activities/search", { page: 0, pageSize: 1000, filters: {}, searchKeyword: "" })
  ).data;
  assert.equal(saved.length, 2);
  assert(saved.every((activity) => activity.metadata?.unifiedStatementImport?.version === 1));
  assert.deepEqual(
    saved.map((activity) => activity.currency),
    ["CNY", "CNY"],
  );
  const page = await context.newPage();
  await page.goto(`${origin}/addons/${manifest.id}`);
  const frame = page.frameLocator("iframe");
  await frame.locator('[aria-label="流水格式"]').click();
  await frame.getByRole("option", { name: /微信支付/ }).click();
  await frame.locator('input[type="file"]').setInputFiles({
    name: "again.csv",
    mimeType: "text/csv",
    buffer: csv([golden[0].header, golden[0].row]),
  });
  await frame.getByRole("button", { name: "补齐映射", exact: true }).click();
  await frame.getByRole("button", { name: "保存映射并预览", exact: true }).click();
  await expect(frame.locator('[data-processing-status="duplicate"]')).toHaveCount(1);
  await page.close();
  const source = saved[0].metadata.unifiedStatementImport.sources[0];
  const outSource = {
    ...source,
    recordId: "synthetic-transfer-out",
    fileName: "transfer-out.csv",
    amount: "10.50",
    fee: "0.50",
  };
  const inSource = {
    ...source,
    recordId: "synthetic-transfer-in",
    fileName: "transfer-in.csv",
    amount: "10.00",
  };
  const create = (accountId, activityType, amount, source, component, kind) => ({
    accountId,
    activityType,
    amount,
    currency: "CNY",
    activityDate: "2025-01-02T04:00:00.000Z",
    status: "POSTED",
    comment: `${source.recordId}-${component}`,
    metadata: JSON.stringify({
      unifiedStatementImport: {
        version: 1,
        sources: [source],
        booking: { kind, component, accountId, amount, confirmed: true },
      },
    }),
  });
  const transferSave = await command("/activities/bulk", {
    creates: [
      create(accounts[0].id, "TRANSFER_OUT", "10.00", outSource, "main", "transferOut"),
      create(accounts[1].id, "TRANSFER_IN", "10.00", inSource, "main", "transferIn"),
      create(accounts[0].id, "FEE", "0.50", outSource, "fee", undefined),
    ],
  });
  assert.equal(transferSave.errors.length, 0);
  assert.equal(transferSave.created.length, 3);
  const out = transferSave.created.find((activity) => activity.activityType === "TRANSFER_OUT");
  const incoming = transferSave.created.find((activity) => activity.activityType === "TRANSFER_IN");
  assert.equal(await command(`/activities/${out.id}/transfer-pair`, undefined, "GET"), null);
  const transferPage = await context.newPage();
  await transferPage.setViewportSize({ width: 1440, height: 1000 });
  await transferPage.goto(`${origin}/addons/${manifest.id}`);
  const transferFrame = transferPage.frameLocator("iframe");
  await transferFrame.getByText("已保存转账配对", { exact: true }).click();
  await transferFrame.locator('[aria-label="已保存转出流水"]').click();
  await transferFrame.getByRole("option", { name: /transfer-out.csv/ }).click();
  await transferFrame.locator('[aria-label="已保存转入流水"]').click();
  await transferFrame.getByRole("option", { name: /transfer-in.csv/ }).click();
  await transferFrame.getByRole("button", { name: "确认关联这两条流水", exact: true }).scrollIntoViewIfNeeded();
  await captureReview(transferPage, "12-transfer-expanded");
  await transferFrame.getByRole("button", { name: "确认关联这两条流水", exact: true }).click();
  await expect(
    transferFrame.getByText("转账已关联，实际配对状态由宿主维护。", { exact: true }),
  ).toBeVisible();
  const pair = await command(`/activities/${out.id}/transfer-pair`, undefined, "GET");
  assert.equal(pair.transferIn.id, incoming.id);
  assert.equal(pair.transferOut.id, out.id);
  assert.equal(
    pair.transferOut.metadata.unifiedStatementImport.sources[0].recordId,
    outSource.recordId,
  );
  assert.equal(pair.transferOut.metadata.unifiedStatementImport.booking.component, "main");
  const all = (
    await command("/activities/search", { page: 0, pageSize: 1000, filters: {}, searchKeyword: "" })
  ).data;
  assert.equal(all.length, 5);
  assert.equal(
    all.find((activity) => activity.activityType === "FEE").metadata.unifiedStatementImport.booking
      .component,
    "fee",
  );
  const investmentAccount = await command("/accounts", {
    name: "合成基金投资账户", accountType: "SECURITIES", currency: "CNY",
    isDefault: false, isActive: true, isArchived: false, trackingMode: "TRANSACTIONS",
  });
  const fundCsv = Buffer.from([
    "date,symbol,quantity,activityType,unitPrice,currency,fee,amount,account,comment",
    "2026-01-03,000032,10,BUY,9.9,CNY,1,100,合成基金投资账户,合成基金；用户买入；订单号：202601010001",
  ].join("\n"));
  const fundPage = await context.newPage();
  await fundPage.setViewportSize({ width: 1440, height: 1000 });
  await fundPage.goto(`${origin}/addons/${manifest.id}`);
  const fundFrame = fundPage.frameLocator("iframe");
  await fundFrame.getByRole("checkbox", { name: "识别投资交易流水", exact: true }).check();
  await fundFrame.locator('[aria-label="流水格式"]').click();
  await fundFrame.getByRole("option", { name: /蚂蚁基金/ }).click();
  await fundFrame.locator('input[type="file"]').setInputFiles({ name: "synthetic-fund.csv", mimeType: "text/csv", buffer: fundCsv });
  await expect(fundFrame.getByRole("tab", { name: "原始文件", exact: true })).toBeVisible();
  await expect(fundFrame.getByRole("button", { name: "补齐映射", exact: true })).toBeEnabled();
  await captureReview(fundPage, "01-upload");
  await fundFrame.getByRole("button", { name: "补齐映射", exact: true }).click();
  await fundFrame.locator("summary").filter({ hasText: "已映射 / 已跳过" }).click();
  await captureReview(fundPage, "02-mapping");
  await fundFrame.getByRole("button", { name: "保存映射并预览", exact: true }).click();
  await fundFrame.getByRole("button", { name: "标为手动资产", exact: true }).click();
  await fundFrame.getByRole("button", { name: "识别并校验基金资产", exact: true }).click();
  await expect(fundFrame.getByText("基金资产已就绪", { exact: true })).toBeVisible();
  await captureReview(fundPage, "03-assets");
  await fundPage.screenshot({ path: join(installation, "fund-assets-light.png") });
  await fundPage.evaluate(() => document.documentElement.classList.add("dark"));
  await fundPage.screenshot({ path: join(installation, "fund-assets-dark.png") });
  await fundPage.setViewportSize({ width: 390, height: 900 });
  await captureReview(fundPage, "09-assets-mobile");
  await fundPage.screenshot({ path: join(installation, "fund-assets-mobile.png") });
  await fundPage.evaluate(() => document.documentElement.classList.remove("dark"));
  await fundFrame.getByRole("button", { name: "提交确认", exact: true }).click();
  await fundPage.setViewportSize({ width: 1440, height: 1000 });
  await captureReview(fundPage, "04-review");
  await fundFrame.getByRole("button", { name: "提交确认", exact: true }).click();
  await captureReview(fundPage, "05-confirm");
  await fundPage.evaluate(() => document.documentElement.classList.add("dark"));
  await captureReview(fundPage, "13-confirm-dark");
  await fundPage.evaluate(() => document.documentElement.classList.remove("dark"));
  await fundFrame.getByRole("button", { name: "导入 1 笔", exact: true }).click();
  await expect(fundFrame.getByText("导入完成", { exact: true })).toBeVisible();
  await captureReview(fundPage, "06-result");
  await fundPage.close();

  const bankPage = await context.newPage();
  await bankPage.setViewportSize({ width: 1440, height: 1000 });
  await bankPage.goto(`${origin}/addons/${manifest.id}`);
  const bankFrame = bankPage.frameLocator("iframe");
  await bankFrame.getByRole("checkbox", { name: "识别投资交易流水", exact: true }).check();
  await bankFrame.locator('[aria-label="流水格式"]').click();
  await bankFrame.getByRole("option", { name: /招商银行/ }).click();
  await bankFrame.getByRole("textbox", { name: "来源账户标识" }).fill("synthetic-investment-card");
  await bankFrame.locator('input[type="file"]').setInputFiles({
    name: "synthetic-investment-bank.csv", mimeType: "text/csv",
    buffer: csv([golden[1].header, ["2026-01-01", "人民币", "-100.00", "900.00", "申购", "蚂蚁基金销售有限公司", ""]]),
  });
  await bankFrame.getByRole("button", { name: "补齐映射", exact: true }).click();
  await bankFrame.getByRole("combobox", { name: "资金对应的投资账户", exact: true }).click();
  await bankFrame.getByRole("option", { name: investmentAccount.name, exact: true }).click();
  await bankFrame.getByRole("checkbox", { name: "已核对资金方向、最终金额及投资账户", exact: true }).check();
  await captureReview(bankPage, "07-funding-mapping");
  await bankFrame.getByRole("button", { name: "保存映射并预览", exact: true }).click();
  await expect(bankFrame.getByText(/已关联投资资金与买卖/).first()).toBeVisible();
  const layout = await bankFrame.locator('[data-slot="grid-row"]').first().evaluate((row) => {
    const rowRect = row.getBoundingClientRect();
    const centers = ["line", "kind", "amount", "accountId", "processing", "source-date", "source-merchant"].map((column) => {
      const cell = row.querySelector(`[data-column-id="${column}"]`);
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { column, center: rect.y + rect.height / 2 };
      }
      throw new Error(`未找到单元格文字：${column}`);
    });
    return { centers, rowCenter: rowRect.y + rowRect.height / 2, rowHeight: rowRect.height };
  });
  const { centers } = layout;
  assert(Math.max(...centers.map((cell) => cell.center)) - Math.min(...centers.map((cell) => cell.center)) <= 2,
    `审核单元格文字未垂直对齐：${JSON.stringify(centers)}`);
  assert(centers.every((cell) => Math.abs(cell.center - layout.rowCenter) <= 2),
    `审核文字未居中于整行：${JSON.stringify(layout)}`);
  console.log("Cell alignment:", JSON.stringify({ rowHeight: layout.rowHeight,
    offsets: centers.map((cell) => ({ column: cell.column, pixels: cell.center - layout.rowCenter })) }));
  assert(!(await bankFrame.locator(".statement-import").innerText()).includes("composite:"), "内部查重编号不应出现在审核界面");
  await bankFrame.locator('[role="grid"]').screenshot({
    path: join(reviewDirectory || installation, "15-cells-aligned.png"), animations: "disabled",
  });
  await captureReview(bankPage, "08-funding-review");
  await bankFrame.getByRole("button", { name: /源文件统计与跳过原因/ }).click();
  await bankFrame.getByRole("table", { name: /原始金额统计/ }).scrollIntoViewIfNeeded();
  await captureReview(bankPage, "11-reconciliation-expanded", bankFrame.getByRole("table", { name: /原始金额统计/ }));
  await bankPage.setViewportSize({ width: 390, height: 1100 });
  await captureReview(bankPage, "14-reconciliation-mobile", bankFrame.getByRole("table", { name: /原始金额统计/ }));
  await bankFrame.getByRole("button", { name: /源文件统计与跳过原因/ }).click();
  await bankPage.setViewportSize({ width: 1440, height: 1000 });
  await bankPage.setViewportSize({ width: 390, height: 900 });
  await captureReview(bankPage, "10-funding-mobile");
  await bankPage.setViewportSize({ width: 1440, height: 1000 });
  await bankFrame.getByRole("button", { name: "提交确认", exact: true }).click();
  await bankFrame.getByRole("button", { name: "导入 1 笔", exact: true }).click();
  await expect(bankFrame.getByText("活动已保存，转账请核对配对状态", { exact: true })).toBeVisible();
  const investments = (await command("/activities/search", {
    page: 0, pageSize: 1000, filters: {}, searchKeyword: "",
  })).data.filter((row) => row.metadata?.unifiedStatementImport?.investment);
  assert.equal(investments.length, 3);
  const bankOut = investments.find((row) => row.activityType === "TRANSFER_OUT");
  const fundBuy = investments.find((row) => row.activityType === "BUY");
  assert.equal(fundBuy.accountId, investmentAccount.id);
  assert.equal(fundBuy.amount, "100");
  assert.equal(fundBuy.fee, "1");
  assert(investments.every((row) => row.metadata.unifiedStatementImport.investment.peerKey));
  assert((await command(`/activities/${bankOut.id}/transfer-pair`, undefined, "GET"))?.transferIn);
  await bankFrame.getByText("已保存投资资金与买卖关联", { exact: true }).click();
  await bankFrame.getByRole("button", { name: "取消已保存投资关联", exact: true }).click();
  await expect(bankFrame.getByRole("button", { name: "确认关联已保存投资交易", exact: true })).toBeVisible();
  assert.equal((await command("/activities/search", { page: 0, pageSize: 1000, filters: {}, searchKeyword: "" })).data.length, 8);
  await bankPage.close();
  console.log(
    "PASS: isolated host, desktop/mobile, RTL, themes, duplicate import, fees, transfer pairing, fund asset validation, cross-session investment matching and cancellation",
  );
  console.log(`Screenshots: ${installation}`);
} catch (error) {
  for (const context of browser?.contexts() ?? [])
    for (const page of context.pages()) {
      console.error("Isolated test page:", page.url());
      console.error((await page.locator("body").innerText()).slice(0, 1500));
      await page.screenshot({ path: join(installation, "failure.png") });
    }
  console.error(`Isolated diagnostics: ${installation}`);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

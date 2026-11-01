import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
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
  await transferPage.goto(`${origin}/addons/${manifest.id}`);
  const transferFrame = transferPage.frameLocator("iframe");
  await transferFrame.getByText("已保存转账配对", { exact: true }).click();
  await transferFrame.locator('[aria-label="已保存转出流水"]').click();
  await transferFrame.getByRole("option", { name: /transfer-out.csv/ }).click();
  await transferFrame.locator('[aria-label="已保存转入流水"]').click();
  await transferFrame.getByRole("option", { name: /transfer-in.csv/ }).click();
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
  console.log(
    "PASS: isolated host, desktop/mobile, RTL, theme, two-channel persistence, duplicate import, fee persistence and transfer pairing",
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

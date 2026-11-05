// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormattingProvider } from "@wealthfolio/ui";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as parsers from "../parsers";
import { buildPreview } from "../import/ledger";
import { mappingKey } from "../import/account-matching";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { StatementAssociations } from "./statement-associations";
import { StatementImportPage } from "./statement-import-page";
let element: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  element = document.createElement("div"); document.body.append(element);
  root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); vi.restoreAllMocks(); });
const encode = (text: string) => new TextEncoder().encode(text);
const bankText = "记账日期,货币,交易金额,联机余额,交易摘要,对手信息\n2025-12-31 14:23:00,CNY,-12.30,100.00,消费,虚构商户";
async function pair() {
  const payment = await parsers.parseStatement(encode([HEADER, csvRow({ method: "招商银行(1234)" })].join("\n")), "synthetic-payment.csv");
  const bank = await parsers.parseStatement(encode(bankText), "synthetic-bank.csv", { sourceAccount: "synthetic-bank" });
  const rows = [...payment.rows, ...bank.rows];
  const mappings = Object.fromEntries(rows.map(({ source }) => [mappingKey(source), "cash"]));
  return buildPreview(rows, [account()], [], mappings, {});
}
async function render(children: React.ReactNode) {
  await act(async () => root.render(<FormattingProvider locale="zh-CN" timezone="Asia/Shanghai">{children}</FormattingProvider>));
}
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
it("自动关联显示金额处理说明，取消本次关联不要求再次确认", async () => {
  const preview = await pair(); const cancel = vi.fn();
  await render(<StatementAssociations preview={preview} activities={[]} disabled={false} onCancelPreview={cancel} onCancelSaved={vi.fn()} />);
  expect(element.textContent).toContain("已自动关联 1 笔");
  expect(element.textContent).toContain("三方记录金额为零");
  await click("取消本次关联");
  expect(cancel).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
});
it("无需上传也能查看并取消已保存关联", async () => {
  const preview = await pair(); const cancel = vi.fn();
  const stored = preview.map((entry, index) => activity(entry.create!, `saved-${index}`));
  await render(<StatementAssociations preview={[]} activities={stored} disabled={false} onCancelPreview={vi.fn()} onCancelSaved={cancel} />);
  await click("已关联记录"); await click("取消关联");
  expect(cancel).toHaveBeenCalledWith("saved-0");
});
it("密码错误可在当前文件重试，成功后清空输入且不写入插件存储", async () => {
  const document = await parsers.parseStatement(encode(bankText), "synthetic-bank.csv");
  document.fileName = "synthetic-encrypted.pdf"; document.sheets = ["PDF"];
  const parse = vi.spyOn(parsers, "parseStatement").mockRejectedValueOnce(new Error("PDF 密码不正确"))
    .mockResolvedValueOnce(document);
  const storage = { get: vi.fn(async () => null), set: vi.fn(), delete: vi.fn() };
  const ctx = { router: { setLeaveGuard: vi.fn() }, api: { accounts: { getAll: async () => [account()] }, activities: { getAll: async () => [] }, storage } } as unknown as AddonContext;
  await render(<StatementImportPage ctx={ctx} />);
  await act(async () => element.querySelector<HTMLElement>('[aria-label="流水格式"]')!.click());
  await act(async () => [...window.document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent?.includes("招商银行"))!.click());
  const input = element.querySelector<HTMLInputElement>('input[type="password"]')!;
  const setPassword = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await setPassword("synthetic-wrong");
  const upload = element.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(upload, "files", { configurable: true, value: [new File(["%PDF-synthetic"], "synthetic-encrypted.pdf")] });
  await act(async () => upload.dispatchEvent(new Event("change", { bubbles: true })));
  expect(element.textContent).toContain("密码不正确");
  await setPassword("synthetic-correct"); await click("重新读取当前文件");
  expect(parse.mock.calls[0][2]?.password).toBe("synthetic-wrong");
  expect(parse.mock.calls[1][2]?.password).toBe("synthetic-correct");
  expect(input.value).toBe("");
  expect(storage.set).not.toHaveBeenCalled();
});

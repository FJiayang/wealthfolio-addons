// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { FormattingProvider } from "@wealthfolio/ui";
import { StatementReconciliation } from "./statement-reconciliation";
import { parseStatementSync } from "../parsers";
import { buildPreview, rowKey } from "../import/ledger";
import { account, csvRow, HEADER } from "../test-fixtures";

it("统计使用可访问的宿主折叠面板，展开后按文件、金额和跳过原因分组", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const statement = parseStatementSync(new TextEncoder().encode([HEADER,
    csvRow({ id: "synthetic-1" }), csvRow({ id: "synthetic-2" }),
  ].join("\n")), "合成账单.csv");
  statement.fileId = "synthetic-file";
  statement.fileName = "合成账单.csv";
  statement.declaredCount = 2;
  statement.rows[1].parseStatus = "softSkip";
  statement.summaries = [{ sheet: "CSV", currency: "CNY", income: "10.00", expense: "20.00", declaredIncome: "10.00", declaredExpense: "21.00" }];
  statement.warnings = ["源声明支出与原始解析合计不一致，请核对。"];
  const preview = buildPreview(statement.rows, [account()], [], { 账户余额: "cash" },
    { [rowKey(statement.rows[1])]: { excluded: true } });
  try {
    await act(async () => root.render(<FormattingProvider locale="zh-CN" uiLocale="zh" timezone="Asia/Shanghai">
      <StatementReconciliation documents={[statement]} preview={preview} />
    </FormattingProvider>));
    const trigger = container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    await act(async () => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelectorAll("details")).toHaveLength(0);
    for (const text of ["源声明笔数", "解析行数", "本次已选", "待导入", "默认跳过", "跳过原因", "用户排除", "重复检测范围"])
      expect(container.textContent).toContain(text);
    expect(container.textContent).not.toContain("不可恢复排除");
    const table = container.querySelector('[aria-label="合成账单.csv 原始金额统计"]')!;
    expect(table.textContent).toContain("源声明支出");
    expect(table.textContent).toContain("21.00");
    expect(container.textContent).toContain(statement.warnings[0]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

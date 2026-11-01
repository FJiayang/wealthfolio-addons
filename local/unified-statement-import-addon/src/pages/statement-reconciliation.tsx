import { useAmountFormatting, useNumberFormatting } from "@wealthfolio/ui";
import type { StatementDocument } from "../parsers/types";
import { rowKey, type PreviewRow } from "../import/ledger";

export function StatementReconciliation({
  documents,
  preview,
}: {
  documents: StatementDocument[];
  preview: PreviewRow[];
}) {
  const { formatDecimal } = useNumberFormatting();
  const { formatAmount } = useAmountFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  if (!documents.length) return null;
  return (
    <details className="space-y-3 rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">源文件统计与跳过原因</summary>
      {documents.map((document) => {
        const ids = new Set(document.rows.map(rowKey));
        const entries = preview.filter((entry) => ids.has(rowKey(entry.row)));
        const reasons = new Map<string, number>();
        for (const entry of entries.filter((entry) => entry.status === "excluded"))
          reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
        return (
          <div key={document.fileId} className="space-y-2 border-t pt-2">
            <p>
              {document.fileName}：源声明{" "}
              {document.declaredCount === undefined ? "未提供" : n(document.declaredCount)} 笔／解析{" "}
              {n(document.rows.length)} 行／本次已选 {n(entries.length)} 行／待导入{" "}
              {n(entries.filter((entry) => entry.status === "ready").length)} 行
            </p>
            <p>
              默认跳过 {n(document.rows.filter((row) => row.parseStatus === "softSkip").length)}{" "}
              行；不可恢复排除{" "}
              {n(document.rows.filter((row) => row.parseStatus === "hardSkip").length)} 行；格式错误{" "}
              {n(document.rows.filter((row) => row.parseStatus === "fatal").length)} 行。
            </p>
            {document.summaries?.map((summary) => (
              <p
                key={`${summary.sheet}-${summary.currency}`}
                className="text-muted-foreground text-sm"
              >
                {summary.sheet} · {summary.currency}：原始收入{" "}
                {formatAmount(summary.income, summary.currency)}／支出{" "}
                {formatAmount(summary.expense, summary.currency)}
                {summary.declaredIncome !== undefined
                  ? `；源声明收入 ${formatAmount(summary.declaredIncome, summary.currency)}`
                  : ""}
                {summary.declaredExpense !== undefined
                  ? `；源声明支出 ${formatAmount(summary.declaredExpense, summary.currency)}`
                  : ""}
              </p>
            ))}
            {[...reasons].map(([reason, count]) => (
              <p key={reason} className="text-muted-foreground text-sm">
                {reason}：{n(count)} 行
              </p>
            ))}
            {document.warnings?.map((warning) => (
              <p key={warning} className="text-sm">
                {warning}
              </p>
            ))}
          </div>
        );
      })}
    </details>
  );
}

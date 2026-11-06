import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  AlertFeedback, Badge, Icons, Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  useAmountFormatting, useNumberFormatting,
} from "@wealthfolio/ui";
import type { StatementDocument } from "../parsers/types";
import { rowKey, type PreviewRow } from "../import/ledger";

// Layout follows the host import confirmation and parse-settings sections.
export function StatementReconciliation({ documents, preview }: {
  documents: StatementDocument[];
  preview: PreviewRow[];
}) {
  const { formatDecimal } = useNumberFormatting();
  const { formatAmount } = useAmountFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  if (!documents.length) return null;
  return (
    <Accordion className="bg-muted/20 rounded-lg border">
      <AccordionItem value="source-reconciliation" className="border-0">
        <AccordionTrigger className="hover:bg-muted/40 rounded-lg px-4 py-3 hover:no-underline">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Icons.FileText className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm">源文件统计与跳过原因</span>
            <Badge variant="secondary" className="font-normal">{n(documents.length)} 个文件</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 border-t px-4 pt-4">
          {documents.map((document) => {
            const ids = new Set(document.rows.map(rowKey));
            const entries = preview.filter((entry) => ids.has(rowKey(entry.row)));
            const reasons = new Map<string, number>();
            for (const entry of entries.filter((entry) => entry.status === "excluded"))
              reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
            const statistics = [
              { label: "源声明笔数", value: document.declaredCount === undefined ? "未提供" : n(document.declaredCount) },
              { label: "解析行数", value: n(document.rows.length) },
              { label: "本次已选", value: n(entries.length) },
              { label: "待导入", value: n(entries.filter((entry) => entry.status === "ready").length) },
            ];
            const skipped = [
              { label: "默认跳过", count: document.rows.filter((row) => row.parseStatus === "softSkip").length },
              { label: "不可恢复排除", count: document.rows.filter((row) => row.parseStatus === "hardSkip").length },
              { label: "格式错误", count: document.rows.filter((row) => row.parseStatus === "fatal").length },
            ].filter(({ count }) => count > 0);
            return <section key={document.fileId} className="bg-background overflow-hidden rounded-lg border" aria-label={document.fileName}>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                <span className="min-w-0 truncate text-sm font-medium" title={document.fileName}>{document.fileName}</span>
                <Badge variant="outline" className="font-normal">{document.fileName?.split(".").at(-1)?.toUpperCase()}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 p-4 sm:grid-cols-4">
                {statistics.map(({ label, value }) => <div key={label} className="space-y-1">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </div>)}
              </dl>
              {skipped.length > 0 && <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                {skipped.map(({ label, count }) => <Badge key={label} variant={label === "格式错误" ? "destructive-subtle" : "secondary"}>
                  {label}<span className="ms-1.5 tabular-nums">{n(count)}</span>
                </Badge>)}
              </div>}
              {document.parserId !== "ant-fund" && !!document.summaries?.length && <div className="border-t">
                <Table aria-label={`${document.fileName} 原始金额统计`} className="min-w-max">
                  <TableHeader><TableRow>
                    <TableHead>工作表</TableHead><TableHead>币种</TableHead>
                    <TableHead className="text-end">原始收入</TableHead><TableHead className="text-end">原始支出</TableHead>
                    <TableHead className="text-end">源声明收入</TableHead><TableHead className="text-end">源声明支出</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{document.summaries!.map((summary) => <TableRow key={`${summary.sheet}-${summary.currency}`}>
                    <TableCell>{summary.sheet}</TableCell><TableCell>{summary.currency}</TableCell>
                    {[summary.income, summary.expense, summary.declaredIncome, summary.declaredExpense].map((amount, index) =>
                      <TableCell key={index} className="text-end whitespace-nowrap tabular-nums">
                        {amount === undefined ? "未提供" : formatAmount(amount, summary.currency)}
                      </TableCell>)}
                  </TableRow>)}</TableBody>
                </Table>
              </div>}
              {reasons.size > 0 && <div className="space-y-3 border-t p-4">
                <h4 className="text-muted-foreground text-xs font-medium tracking-wider">跳过原因</h4>
                <div className="flex flex-wrap gap-2">{[...reasons].map(([reason, count]) =>
                  <div key={reason} className="bg-muted/50 flex items-center gap-2 rounded-full px-3 py-1.5">
                    <Icons.XCircle className="text-muted-foreground size-4 shrink-0" />
                    <span className="text-muted-foreground text-sm">{reason}</span>
                    <span className="bg-background text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">{n(count)}</span>
                  </div>)}
                </div>
              </div>}
              {!!document.warnings?.length && <div className="border-t p-4">
                <AlertFeedback variant="warning" title="源文件统计需要核对">
                  <ul className="list-disc space-y-1 ps-4">{document.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
                </AlertFeedback>
              </div>}
            </section>;
          })}
          <div className="bg-muted/50 flex items-start gap-2 rounded-md p-3 text-sm">
            <Icons.Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">重复检测范围</p>
              <p className="text-muted-foreground text-xs leading-relaxed">覆盖可读取的非归档账户。若相关账户已归档，请先在主程序取消归档再导入。</p>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

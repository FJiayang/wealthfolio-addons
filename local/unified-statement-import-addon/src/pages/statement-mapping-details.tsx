import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Badge,
  useAmountFormatting,
  useDateFormatting,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { ImportTypeBadge } from "@wealthfolio/import-wizard-ui";
import { rowKey, type PreviewRow } from "../import/ledger";
import { entryActivityTypes } from "../parsers/types";
import { kinds, labels, statusAppearance } from "./statement-presentation";
export function StatementMappingDetails({
  entries,
  label,
  open = true,
  accounts,
}: {
  entries: PreviewRow[];
  label: string;
  open?: boolean;
  accounts: { value: string; label: string }[];
}) {
  const { formatAmount } = useAmountFormatting();
  const { formatDateTime, formatDate } = useDateFormatting();
  const { formatDecimal } = useNumberFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  return (
    <Accordion keepMounted defaultValue={open ? ["details"] : []} className="min-w-0 sm:col-span-2">
      <AccordionItem value="details" className="border-0">
      <AccordionTrigger className="py-1 text-sm hover:no-underline">关联流水明细</AccordionTrigger>
      <AccordionContent className="p-0">
      <div className="mt-3 max-h-80 overflow-auto rounded-lg border">
        <Table
          aria-label={`流水明细：${label}`}
          containerClassName="overflow-visible"
          className="min-w-max"
        >
          <TableHeader className="bg-card sticky top-0 z-10">
            <TableRow>
              {[
                "来源行",
                "交易时间",
                "原始收支",
                "记账性质",
                "交易对方",
                "商品说明",
                "金额",
                "付款方式",
                "交易状态",
                "处理状态",
                "目标账户",
                "来源文件",
                "工作表",
              ].map((heading) => (
                <TableHead key={heading} className={heading === "金额" ? "text-end" : "text-start"}>
                  {heading}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const source = entry.row.source;
              const appearance = statusAppearance[entry.status];
              const StatusIcon = appearance.icon;
              return (
                <TableRow key={rowKey(entry.row)}>
                  <TableCell>{n(source.lineNumber)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {source.date
                      ? source.datePrecision === "date"
                        ? formatDate(source.date)
                        : formatDateTime(source.date, { dateStyle: "short", timeStyle: "short" })
                      : source.originalTime}
                  </TableCell>
                  <TableCell>{source.direction || "未提供收支"}</TableCell>
                  <TableCell>
                    {entry.kind ? (
                      <ImportTypeBadge type={entryActivityTypes[entry.kind]}>
                        {kinds[entry.kind]}
                      </ImportTypeBadge>
                    ) : (
                      source.direction
                    )}
                  </TableCell>
                  <TableCell className="max-w-64 break-words whitespace-normal">
                    {source.merchant}
                  </TableCell>
                  <TableCell className="max-w-80 break-words whitespace-normal">
                    {source.description}
                  </TableCell>
                  <TableCell className="text-end whitespace-nowrap tabular-nums">
                    {entry.row.error
                      ? entry.amount
                      : formatAmount(entry.amount, source.currency, false)}{" "}
                    {source.currency}
                  </TableCell>
                  <TableCell>{source.paymentMethod || "未提供付款方式"}</TableCell>
                  <TableCell>{source.status || "未提供交易状态"}</TableCell>
                  <TableCell>
                    <Badge variant={appearance.variant}>
                      <StatusIcon className="me-1 size-3" />
                      {labels[entry.status]}
                    </Badge>
                    <span className="text-muted-foreground ms-2 text-xs">{entry.reason}</span>
                  </TableCell>
                  <TableCell>
                    {accounts.find((account) => account.value === entry.accountId)?.label ??
                      "未选择"}
                  </TableCell>
                  <TableCell>{source.fileName}</TableCell>
                  <TableCell>{source.sheetName ?? ""}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

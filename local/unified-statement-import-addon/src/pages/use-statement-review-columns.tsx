import { useMemo, useCallback } from "react";
import {
  Badge,
  Icons,
  useAmountFormatting,
  useDateFormatting,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { ImportTypeBadge } from "@wealthfolio/import-wizard-ui";
import type { PreviewRow } from "../import/ledger";
import { entryActivityTypes, type EntryKind } from "../parsers/types";
import { kinds, labels, statementReference, statusAppearance } from "./statement-presentation";
export function useStatementReviewColumns({
  locked,
  accountOptions,
}: {
  locked(entry: PreviewRow): boolean;
  accountOptions: { value: string; label: string }[];
}) {
  const { formatAmount } = useAmountFormatting();
  const { formatDateTime, formatDate } = useDateFormatting();
  const { formatDecimal } = useNumberFormatting();
  const n = useCallback(
    (value: number) => formatDecimal(value, { maximumFractionDigits: 0 }),
    [formatDecimal],
  );
  return useMemo(
    () => [
      {
        id: "line",
        accessorKey: "line",
        header: (): string => "#",
        size: 120,
        meta: { readOnly: true, label: "来源行" },
        cell: ({ row }: { row: { original: PreviewRow & { line: number } } }) => (
          <span className="flex h-full items-center gap-1 text-sm" title={row.original.reason}>
            {n(row.original.line)}
            {(row.original.status === "review" || row.original.status === "error") && (
              <Badge variant={statusAppearance[row.original.status].variant} className="px-1">
                <Icons.AlertCircle className="size-3" aria-label={labels[row.original.status]} />
              </Badge>
            )}
          </span>
        ),
      },
      {
        id: "kind",
        accessorKey: "kind",
        header: "记账性质",
        size: 150,
        meta: {
          readOnly: (entry: PreviewRow) => locked(entry) || !!entry.row.investmentCandidate,
          cell: {
            variant: "select" as const,
            options: Object.entries(kinds).filter(([value]) => value !== "investment").map(([value, label]) => ({ value, label })),
            valueRenderer: (value: string) => (
              <ImportTypeBadge type={entryActivityTypes[value as EntryKind]}>
                {kinds[value as EntryKind]}
              </ImportTypeBadge>
            ),
          },
        },
      },
      {
        id: "amount",
        accessorKey: "amount",
        header: "确认金额",
        size: 150,
        meta: {
          readOnly: locked,
          cell: {
            variant: "number" as const,
            valueType: "string" as const,
            min: 0,
            valueRenderer: (value: string | number | null, entry: unknown) =>
              formatAmount(value ?? "", (entry as PreviewRow).row.source.currency, false),
          },
        },
      },
      {
        id: "accountId",
        accessorKey: "accountId",
        header: "目标账户",
        size: 240,
        meta: { readOnly: locked, cell: { variant: "select" as const, options: accountOptions } },
      },
      {
        id: "processing",
        header: (): string => "处理状态",
        size: 320,
        meta: { readOnly: true, label: "处理状态" },
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const entry = row.original;
          const appearance = statusAppearance[entry.status];
          const Icon = appearance.icon;
          return (
            <div className="flex h-full min-w-0 items-center gap-2 text-sm" title={entry.reason}>
              <Badge
                className="shrink-0"
                variant={appearance.variant}
                data-processing-status={entry.status}
              >
                <Icon className="me-1 size-3" />
                {labels[entry.status]}
              </Badge>
              <span className="truncate">{entry.reason}</span>
            </div>
          );
        },
      },
      ...(
        [
          "date",
          "merchant",
          "description",
          "category",
          "direction",
          "paymentMethod",
          "status",
          "recordId",
          "amount",
        ] as const
      ).map((key, index) => ({
        id: "source-" + key,
        header: (): string | undefined =>
          [
            "交易时间",
            "交易对方",
            "商品说明",
            "来源分类",
            "收/支",
            "付款方式",
            "交易状态",
            "订单号",
            "原金额",
          ][index],
        accessorFn: (entry: PreviewRow) => key === "recordId" ? statementReference(entry.row.source) : entry.row.source[key],
        cell: ({ row }: { row: { original: PreviewRow } }) => {
          const source = row.original.row.source;
          const value = key === "recordId" ? statementReference(source) : source[key];
          return (
            <div
              className="flex h-full min-w-0 items-center text-sm"
              title={key === "date" ? source.originalTime : String(value)}
            >
              <span className="truncate">{key === "date" && value
                ? source.datePrecision === "date" ? formatDate(value) : formatDateTime(value, { dateStyle: "short", timeStyle: "short" })
                : key === "amount"
                  ? formatAmount(value, source.currency, false)
                  : value}</span>
            </div>
          );
        },
        size: key === "description" || key === "recordId" ? 220 : 160,
        meta: {
          readOnly: true,
          label: [
            "交易时间",
            "交易对方",
            "商品说明",
            "来源分类",
            "收/支",
            "付款方式",
            "交易状态",
            "订单号",
            "原金额",
          ][index],
        },
      })),
      {
        id: "source-file",
        header: "来源文件",
        accessorFn: (entry: PreviewRow) => entry.row.source.fileName,
        size: 200,
        meta: { readOnly: true },
      },
      {
        id: "source-sheet",
        header: "工作表",
        accessorFn: (entry: PreviewRow) => entry.row.source.sheetName ?? "",
        size: 120,
        meta: { readOnly: true },
      },
    ],
    [locked, accountOptions, formatAmount, formatDateTime, formatDate, n],
  );
}

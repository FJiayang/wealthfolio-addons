import { useEffect, useMemo, useRef, useState } from "react";
import type { Account, ActivityCreate, ActivityUpdate } from "@wealthfolio/addon-sdk";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger, Badge, Button, Icons,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  useAmountFormatting, useDateFormatting, useNumberFormatting,
} from "@wealthfolio/ui";
import { ImportTypeBadge } from "@wealthfolio/import-wizard-ui";
import type { StatementSource } from "../parsers/types";
import { METADATA_KEY, readSources, type ExistingActivity, type PreviewRow } from "../import/ledger";
import { pendingMutations } from "../import/session";
import { statementReference } from "./statement-presentation";

const activityNames: Record<string, string> = {
  BUY: "基金申购", SELL: "基金赎回", DIVIDEND: "分红再投资", DEPOSIT: "收入", WITHDRAWAL: "支出",
  CREDIT: "支出退款", TRANSFER_IN: "转入", TRANSFER_OUT: "转出", FEE: "手续费", TAX: "税费",
};
const pageSize = 50;
type PendingActivity = { action: "create" | "update"; activity: ActivityCreate | ActivityUpdate; existing?: ExistingActivity; sources: StatementSource[] };

function sourcesFrom(metadata: ActivityCreate["metadata"]): StatementSource[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !(METADATA_KEY in metadata)) return [];
  return readSources({ id: "preview", metadata: metadata as Record<string, unknown> });
}

export function StatementFinalPreview({ preview, accounts, activities }: {
  preview: PreviewRow[]; accounts: Account[]; activities: ExistingActivity[];
}) {
  const { formatAmount } = useAmountFormatting();
  const { formatDate, formatDateTime } = useDateFormatting();
  const { formatDecimal } = useNumberFormatting();
  const [page, setPage] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const data = useMemo(() => {
    const { creates, updates } = pendingMutations(preview);
    const createSources = new Map(preview.flatMap((entry) =>
      (entry.creates ?? (entry.create ? [entry.create] : [])).map((create) => [create, entry.row.source] as const)));
    const currentById = new Map(activities.map((activity) => [activity.id, activity]));
    const created: PendingActivity[] = creates.map((activity) => {
      const sources = sourcesFrom(activity.metadata);
      return { action: "create", activity, sources: sources.length ? sources : [createSources.get(activity)!].filter(Boolean) };
    });
    const updated: PendingActivity[] = updates.map((activity) => {
      const existing = currentById.get(activity.id);
      const sources = sourcesFrom(activity.metadata);
      return { action: "update", activity, existing, sources: sources.length ? sources : sourcesFrom(existing?.metadata) };
    });
    return { rows: [...created, ...updated], creates: creates.length, updates: updates.length };
  }, [preview, activities]);
  const totalPages = Math.max(1, Math.ceil(data.rows.length / pageSize));
  useEffect(() => setPage((current) => Math.min(current, totalPages - 1)), [totalPages]);
  useEffect(() => { if (tableRef.current?.parentElement) tableRef.current.parentElement.scrollTop = 0; }, [page]);
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  const accountName = (id: string) => accounts.find((account) => account.id === id)?.name ?? id;
  const visible = data.rows.slice(page * pageSize, (page + 1) * pageSize);

  function field(row: PendingActivity, key: keyof ActivityCreate, current?: unknown, render: (value: string | number) => string = String) {
    const value = row.activity[key];
    if (row.action === "update" && value === undefined)
      return current == null ? "保留原值" : `${render(current as string | number)}（保留）`;
    if (value === null) return row.action === "update" ? "清空" : "—";
    return value === undefined || value === "" ? "—" : render(value as string | number);
  }

  return <section className="space-y-3" aria-label="最终拟导入活动">
    <div className="flex flex-wrap items-center gap-2">
      <h4 className="text-sm font-medium">拟导入活动明细</h4>
      <Badge variant="secondary">新增 {n(data.creates)} 条 · 更新 {n(data.updates)} 条</Badge>
    </div>
    <p className="text-muted-foreground text-sm">每行对应一次实际新增或更新；转账的转出和转入分别展示。修改请返回审核交易。</p>
    <div className="overflow-hidden rounded-lg border">
      <Table ref={tableRef} aria-label="拟导入活动明细" className="min-w-max" containerClassName="max-h-[32rem] overflow-auto">
        <TableHeader className="bg-card sticky top-0 z-10"><TableRow>
          {["操作", "活动类型", "交易时间", "账户", "金额", "币种", "资产", "数量", "单价", "手续费", "税费", "状态及其他", "备注", "来源明细"].map((label) =>
            <TableHead key={label} className="whitespace-nowrap">{label}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{visible.map((row, index) => {
          const item = row.activity;
          const currency = item.currency ?? row.existing?.currency ?? "";
          const asset = item.asset ?? item.symbol;
          const assetText = asset ? [asset.name, asset.symbol, asset.exchangeMic, asset.id,
            asset.kind, asset.instrumentType, asset.quoteMode, asset.quoteCcy, asset.providerId, asset.providerSymbol].filter(Boolean).join(" · ") : "";
          const existingAsset = [row.existing?.assetSymbol, row.existing?.assetId].filter(Boolean).join(" · ");
          const assetDisplay = row.action === "update" && item.asset === undefined && item.symbol === undefined
            ? existingAsset ? `${existingAsset}（保留）` : "保留原值" : assetText || (asset && row.action === "update" ? "清空" : "—");
          const sourceDateOnly = row.sources.length > 0 && row.sources.every((source) => source.datePrecision === "date");
          const date = String(item.activityDate);
          const exactDate = item.activityDate instanceof Date ? item.activityDate.toISOString() : item.activityDate;
          const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
            ? item.metadata[METADATA_KEY] as { association?: { role?: string }; investment?: { role?: string; peerKey?: string; noLink?: boolean } } | undefined : undefined;
          const previousMetadata = row.existing?.metadata?.[METADATA_KEY] as typeof metadata;
          const relationship = metadata?.association
            ? `消费关联：${metadata.association.role === "bank" ? "银行扣款" : "第三方支付"}`
            : metadata?.investment ? `投资${metadata.investment.role === "funding" ? "资金" : "交易"}：${metadata.investment.peerKey ? "已关联" : metadata.investment.noLink ? "无需关联" : "待关联"}`
              : row.action === "update" && item.metadata === undefined ? "关联信息保留原值"
                : row.action === "update" && metadata ? previousMetadata?.association ? "将移除消费关联" : "来源或关联信息将更新" : "";
          const sourceLabel = row.sources.map((source) => `${source.fileName || "未提供文件名"} · 第 ${n(source.lineNumber)} 行`).join("；") || "未提供来源";
          const group = item.sourceGroupId ?? row.existing?.sourceGroupId;
          const detail = [item.subtype ? `子类型：${item.subtype}` : "", item.status ? `状态：${item.status}` : "",
            item.fxRate != null ? `汇率：${item.fxRate}` : "", item.needsReview !== undefined ? `需要审核：${item.needsReview ? "是" : "否"}` : ""].filter(Boolean).join("；") || (row.action === "update" ? "其他字段保留原值" : "—");
          return <TableRow key={`${row.action}-${page * pageSize + index}`}>
            <TableCell><Badge variant="secondary">{row.action === "create" ? "新增" : "更新"}</Badge></TableCell>
            <TableCell><ImportTypeBadge type={item.activityType}>{activityNames[item.activityType] ?? item.activityType}</ImportTypeBadge></TableCell>
            <TableCell className="whitespace-nowrap">{sourceDateOnly ? formatDate(date) : formatDateTime(date, { dateStyle: "short", timeStyle: "short" })}</TableCell>
            <TableCell className="max-w-52 whitespace-normal break-words">{accountName(item.accountId)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">{field(row, "amount", row.existing?.amount, (value) => formatAmount(value, currency, false))}</TableCell>
            <TableCell>{currency || "—"}</TableCell>
            <TableCell className="max-w-56 whitespace-normal break-words">{assetDisplay}</TableCell>
            <TableCell className="whitespace-nowrap text-end">{field(row, "quantity", row.existing?.quantity)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">{field(row, "unitPrice", row.existing?.unitPrice)}</TableCell>
            <TableCell className="whitespace-nowrap text-end">{field(row, "fee", row.existing?.fee, (value) => formatAmount(value, currency, false))}</TableCell>
            <TableCell className="whitespace-nowrap text-end">{field(row, "tax", row.existing?.tax, (value) => formatAmount(value, currency, false))}</TableCell>
            <TableCell className="max-w-64 whitespace-normal break-words">{detail}</TableCell>
            <TableCell className="max-w-80 whitespace-normal break-words [overflow-wrap:anywhere]">{field(row, "comment", row.existing?.comment ?? row.existing?.notes)}</TableCell>
            <TableCell className="min-w-64 max-w-96 whitespace-normal break-words [overflow-wrap:anywhere]">
              <Accordion className="w-full"><AccordionItem value="source" className="border-0">
                <AccordionTrigger className="py-1 text-start text-sm hover:no-underline">{sourceLabel}</AccordionTrigger>
                <AccordionContent className="space-y-2 p-0">{row.sources.map((source, sourceIndex) => <div key={sourceIndex} className="space-y-1 text-xs">
                  <p>来源编号：{statementReference(source) || "未提供"}</p>
                  <p>原始时间：{source.originalTime || "未提供"}；原始收支：{source.direction || "未提供"}；原金额：{formatAmount(source.amount, source.currency, false)}</p>
                  <p>交易对方：{source.merchant || "未提供"}；交易说明：{source.description || "未提供"}</p>
                  <p>付款方式：{source.paymentMethod || "未提供"}；交易状态：{source.status || "未提供"}</p>
                  {source.sourceAccount && <p>来源账户：{source.sourceAccount}</p>}
                  {source.sheetName && <p>工作表：{source.sheetName}{source.pageNumber ? `；第 ${n(source.pageNumber)} 页` : ""}</p>}
                  {source.balance && <p>来源余额：{formatAmount(source.balance, source.currency, false)}</p>}
                  {source.peerAccount && <p>对方账户：{source.peerAccount}</p>}{source.txType && <p>交易类型：{source.txType}</p>}
                  {source.relatedId && <p>关联编号：{source.relatedId}</p>}{source.merchantOrderId && <p>商户订单号：{source.merchantOrderId}</p>}
                  {source.fee && <p>来源手续费：{formatAmount(source.fee, source.currency, false)}</p>}
                  {source.transactionAmount && <p>原币金额：{formatAmount(source.transactionAmount, source.transactionCurrency || source.currency, false)}</p>}
                  {source.category && <p>来源分类：{source.category}</p>}{source.remark && <p>原始备注：{source.remark}</p>}
                </div>)}{group && <p className="text-muted-foreground text-xs">活动分组：{group}{row.action === "update" && item.sourceGroupId === undefined ? "（保留）" : ""}</p>}
                  <p className="text-muted-foreground text-xs">实际提交时间：{exactDate}</p>
                  <p className="text-muted-foreground text-xs">实际提交金额：{field(row, "amount", row.existing?.amount)} {currency}</p>
                  <p className="text-muted-foreground text-xs">实际提交手续费：{field(row, "fee", row.existing?.fee)}；税费：{field(row, "tax", row.existing?.tax)}</p>
                  {relationship && <p className="text-muted-foreground text-xs">{relationship}</p>}
                  {row.action === "update" && <p className="text-muted-foreground text-xs">现有活动：{(item as ActivityUpdate).id}；未列出的字段保留原值。</p>}
                </AccordionContent>
              </AccordionItem></Accordion>
            </TableCell>
          </TableRow>;
        })}{!visible.length && <TableRow><TableCell colSpan={14} className="text-muted-foreground text-center">没有拟提交的活动</TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    {data.rows.length > pageSize && <div className="flex flex-col gap-3 px-2 py-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-muted-foreground text-center text-sm sm:text-start">第 {n(page * pageSize + 1)}–{n(Math.min((page + 1) * pageSize, data.rows.length))} 条，共 {n(data.rows.length)} 条</p>
      <div className="flex items-center justify-center gap-2"><span className="text-muted-foreground text-sm">第 {n(page + 1)} / {n(totalPages)} 页</span>
        <Button variant="outline" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" aria-label="上一页拟导入活动" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><Icons.ChevronLeft className="h-4 w-4 rtl:rotate-180" /></Button>
        <Button variant="outline" size="icon" className="h-9 w-9 sm:h-8 sm:w-8" aria-label="下一页拟导入活动" disabled={page >= totalPages - 1} onClick={() => setPage((value) => value + 1)}><Icons.ChevronRight className="h-4 w-4 rtl:rotate-180" /></Button>
      </div>
    </div>}
  </section>;
}

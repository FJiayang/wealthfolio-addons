import { AlertFeedback, Button, Collapsible, CollapsibleTrigger, CollapsibleContent, useAmountFormatting } from "@wealthfolio/ui";
import { savedAssociations } from "../import/associations";
import { sourceKey, type ExistingActivity, type PreviewRow } from "../import/ledger";

export function StatementAssociations({ preview, activities, disabled, onCancelPreview, onCancelSaved }: {
  preview: PreviewRow[]; activities: ExistingActivity[]; disabled: boolean;
  onCancelPreview(entry: PreviewRow, peerKey: string): void;
  onCancelSaved(id: string): void;
}) {
  const { formatAmount } = useAmountFormatting();
  const pending = new Map<string, PreviewRow>();
  for (const entry of preview) if (entry.association && entry.status === "ready")
    pending.set(JSON.stringify([sourceKey(entry.row.source), entry.association.peerSourceKey].sort()), entry);
  let saved: ReturnType<typeof savedAssociations>;
  try { saved = savedAssociations(activities); }
  catch (error) { return <AlertFeedback variant="error" title="关联信息无法读取">{error instanceof Error ? error.message : "请刷新核对"}</AlertFeedback>; }
  if (!pending.size && !saved.length) return null;
  return <div className="space-y-3">
    {pending.size > 0 && <AlertFeedback variant="success" title={`已自动关联 ${pending.size} 笔银行与三方流水`}>
      <p>银行记录实际扣款，三方记录金额为零，保留原始金额和交易明细。</p>
      {[...pending.values()].map((entry) => <div key={sourceKey(entry.row.source)} className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span>{entry.row.source.originalTime} · {entry.row.source.merchant || entry.row.source.description} · {formatAmount(entry.association!.originalAmount, entry.row.source.currency, false)}</span>
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => onCancelPreview(entry, entry.association!.peerSourceKey)}>取消本次关联</Button>
      </div>)}
    </AlertFeedback>}
    {saved.length > 0 && <Collapsible>
      <CollapsibleTrigger render={<Button variant="outline" />}>已关联记录（{saved.length}）</CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        {saved.map(({ activity, source, association, changed }) => <div key={activity.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div><p>{source.originalTime} · {source.merchant || source.description} · {formatAmount(association.originalAmount, source.currency, false)}</p><p className="text-muted-foreground text-sm">三方记账金额：{formatAmount(activity.amount ?? "", source.currency, false)}{changed ? "；关联记录已修改或缺失，请核对" : "；银行保留实际扣款"}</p></div>
          <Button variant="outline" disabled={disabled} onClick={() => onCancelSaved(activity.id)}>取消关联</Button>
        </div>)}
      </CollapsibleContent>
    </Collapsible>}
  </div>;
}

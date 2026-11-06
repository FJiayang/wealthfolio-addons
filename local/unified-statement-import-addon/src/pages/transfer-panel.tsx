import { useEffect, useState } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
  AlertFeedback,
  Badge,
  Button,
  Icons,
  Label,
  useAmountFormatting,
  useDateFormatting,
  useNumberFormatting,
} from "@wealthfolio/ui";
import { ImportTypeBadge } from "@wealthfolio/import-wizard-ui";
import { linkConfirmedTransfer, transferCandidates, transferEntries } from "../import/transfers";
import type { ExistingActivity } from "../import/ledger";
import { ImportSelect } from "./import-select";

export function TransferPanel({
  ctx,
  activities,
  onRefresh,
  disabled,
  accounts,
}: {
  ctx: AddonContext;
  activities: ExistingActivity[];
  onRefresh(): Promise<void>;
  disabled: boolean;
  accounts: { value: string; label: string }[];
}) {
  const [outId, setOutId] = useState("");
  const [inId, setInId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paired, setPaired] = useState<Record<string, boolean>>({});
  const { formatAmount } = useAmountFormatting();
  const { formatDateTime } = useDateFormatting();
  const { formatDecimal } = useNumberFormatting();
  const n = (value: number) => formatDecimal(value, { maximumFractionDigits: 0 });
  let entries: ReturnType<typeof transferEntries> = [];
  let readError = false;
  try {
    entries = transferEntries(activities);
  } catch {
    readError = true;
  }
  useEffect(() => {
    let active = true;
    if (readError) return;
    const transfers = transferEntries(activities);
    if (!transfers.length) return;
    setPaired({});
    void Promise.all(
      transfers.map(
        async (entry) =>
          [entry.id, !!(await ctx.api.activities.getTransferPair(entry.id))] as const,
      ),
    )
      .then((states) => {
        if (active) setPaired(Object.fromEntries(states));
      })
      .catch(() => {
        if (active) {
          setError(true);
          setMessage("读取转账配对状态失败，请刷新核对。");
        }
      });
    return () => {
      active = false;
    };
  }, [ctx, activities, readError]);
  if (readError)
    return (
      <AlertFeedback variant="error" title="转账来源无法读取">
        请先检查已有账目的来源信息。
      </AlertFeedback>
    );
  if (!entries.length) return null;
  const pending = entries.filter((entry) => paired[entry.id] === false);
  const candidates = transferCandidates(pending, outId);
  async function link() {
    setBusy(true);
    setMessage("");
    setError(false);
    try {
      await linkConfirmedTransfer(ctx.api.activities, outId, inId);
      await onRefresh();
      setMessage("转账已关联，实际配对状态由宿主维护。");
    } catch (error) {
      setError(true);
      setMessage(error instanceof Error ? error.message : "转账核对失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }
  const options = (kind: string) =>
    pending
      .filter((entry) => entry.kind === kind)
      .map((entry) => ({
        value: entry.id,
        label: `${entry.source.fileName} · ${n(entry.source.lineNumber)} · ${formatDateTime(entry.source.date)} · ${formatAmount(entry.amount, entry.source.currency)} · ${accounts.find((account) => account.value === entry.accountId)?.label ?? "账户不可用"}${candidates.some((candidate) => candidate.id === entry.id) ? " · 配对候选" : ""}`,
      }));
  return (
    <Accordion className="bg-muted/20 rounded-lg border">
      <AccordionItem value="saved-transfers" className="border-0">
        <AccordionTrigger className="hover:bg-muted/40 rounded-lg px-4 py-3 hover:no-underline">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <Icons.ArrowLeftRight className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm">已保存转账配对</span>
            {pending.length > 0 && <Badge variant="warning-subtle" className="font-normal">待配对 {n(pending.length)}</Badge>}
            {entries.some((entry) => paired[entry.id] === true) && <Badge variant="success-subtle" className="font-normal">
              已配对 {n(entries.filter((entry) => paired[entry.id] === true).length)}
            </Badge>}
            {entries.some((entry) => paired[entry.id] === undefined) && <Badge variant="secondary" className="font-normal">状态待核对</Badge>}
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-4 border-t px-4 pt-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            选择已保存的转出和转入流水，核对后建立配对。每条来源独立保留，不补建或重复扣减资金。
          </p>
          {pending.length === 0 && !entries.some((entry) => paired[entry.id] === undefined) && !error && (
            <div className="bg-muted/50 flex items-center gap-2 rounded-md p-3 text-sm">
              <Icons.CheckCircle className="text-success size-4 shrink-0" />所有转账均已完成配对
            </div>
          )}
          {pending.length > 0 && <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-sm">转出流水</Label>
                <ImportSelect
                  label="已保存转出流水"
                  value={outId}
                  options={options("transferOut")}
                  onChange={(id) => {
                    setOutId(id);
                    const matched = transferCandidates(pending, id);
                    setInId(matched.length === 1 ? matched[0].id : "");
                  }}
                  disabled={disabled || busy}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm">转入流水</Label>
                <ImportSelect
                  label="已保存转入流水"
                  value={inId}
                  options={options("transferIn")}
                  onChange={setInId}
                  disabled={disabled || busy}
                />
              </div>
            </div>
          {(outId || inId) && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[outId, inId].flatMap((id) => entries.filter((entry) => entry.id === id)).map((entry) =>
              <div key={entry.id} className="bg-muted/30 flex min-w-0 flex-col gap-1.5 rounded-md border px-3 py-2.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <ImportTypeBadge type={entry.kind === "transferOut" ? "TRANSFER_OUT" : "TRANSFER_IN"}>
                    {entry.kind === "transferOut" ? "转出" : "转入"}
                  </ImportTypeBadge>
                  <span className="text-muted-foreground shrink-0 text-xs">{formatDateTime(entry.source.date)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{accounts.find((account) => account.value === entry.accountId)?.label ?? "账户不可用"}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatAmount(entry.amount, entry.source.currency)}</span>
                </div>
                <p className="text-muted-foreground truncate text-xs" title={entry.source.description || entry.source.fileName}>
                  {entry.source.description || entry.source.fileName}
                </p>
              </div>)}
          </div>}
          <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground leading-relaxed">
            购结汇需核对同一来源账号、相同摘要、不同币种及三分钟以内的时间；随手记按关联 ID 提供候选，仍需人工确认。
          </div>
          <div className="flex justify-end border-t pt-4">
            <Button
              disabled={disabled || busy || !outId || !inId || paired[outId] !== false || paired[inId] !== false}
              onClick={() => void link()}
            >
              <Icons.ArrowLeftRight className="me-2 size-4" />
              确认关联这两条流水
            </Button>
          </div>
          </>}
          {message && (
            <AlertFeedback
              variant={error ? "warning" : "success"}
              title={error ? "配对需核对" : "配对完成"}
            >
              {message}
            </AlertFeedback>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

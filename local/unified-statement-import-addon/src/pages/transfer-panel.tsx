import { useEffect, useState } from "react";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import {
  AlertFeedback,
  Button,
  useAmountFormatting,
  useDateFormatting,
  useNumberFormatting,
} from "@wealthfolio/ui";
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
    <details className="space-y-3 rounded-lg border p-3">
      <summary className="cursor-pointer font-medium">已保存转账配对</summary>
      <p className="text-muted-foreground text-sm">
        仅关联两条已保存的真实流水，不补建对手方。购结汇请核对同一来源账号、相同摘要、不同币种及三分钟以内的时间；随手记请核对关联
        ID。
      </p>
      <p>
        待配对 {n(pending.length)} 条；状态未确认{" "}
        {n(entries.filter((entry) => paired[entry.id] === undefined).length)}{" "}
        条。每条来源仍独立保存。
      </p>
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
      <ImportSelect
        label="已保存转入流水"
        value={inId}
        options={options("transferIn")}
        onChange={setInId}
        disabled={disabled || busy}
      />
      <Button
        disabled={
          disabled || busy || !outId || !inId || paired[outId] !== false || paired[inId] !== false
        }
        onClick={() => void link()}
      >
        确认关联这两条流水
      </Button>
      {message && (
        <AlertFeedback
          variant={error ? "warning" : "success"}
          title={error ? "配对需核对" : "配对完成"}
        >
          {message}
        </AlertFeedback>
      )}
    </details>
  );
}

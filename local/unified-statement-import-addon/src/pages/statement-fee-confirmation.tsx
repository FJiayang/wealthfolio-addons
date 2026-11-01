import { Checkbox, Input, useAmountFormatting, useNumberFormatting } from "@wealthfolio/ui";
import { rowKey, type PreviewRow, type RowDecision } from "../import/ledger";
import { ImportSelect } from "./import-select";

export function StatementFeeConfirmation({
  entry,
  decision,
  accounts,
  busy,
  onChange,
}: {
  entry: PreviewRow;
  decision: RowDecision;
  accounts: { value: string; label: string }[];
  busy: boolean;
  onChange(key: string, patch: RowDecision): void;
}) {
  const { formatAmount } = useAmountFormatting();
  const { formatDecimal } = useNumberFormatting();
  const source = entry.row.source;
  return (
    <details className="space-y-2 rounded-lg border p-3">
      <summary>
        手续费确认：{source.fileName} ·{" "}
        {formatDecimal(source.lineNumber, { maximumFractionDigits: 0 })}
      </summary>
      <p>
        主流水原金额 {formatAmount(source.amount, source.currency)}，服务费{" "}
        {formatAmount(source.fee!, source.currency)}
        。请在审核表填写主流水实际金额，并确认费用扣款账户。插件不会自动假定原金额是否已含服务费。
      </p>
      <ImportSelect
        label="手续费扣款账户"
        value={decision.feeAccountId ?? ""}
        options={accounts}
        onChange={(feeAccountId) =>
          onChange(rowKey(entry.row), { feeAccountId, feeConfirmed: false })
        }
        disabled={busy}
      />
      <Input
        aria-label="确认手续费金额"
        inputMode="decimal"
        disabled={busy}
        value={decision.feeAmount ?? source.fee}
        onChange={(event) =>
          onChange(rowKey(entry.row), { feeAmount: event.target.value, feeConfirmed: false })
        }
      />
      <label className="flex items-center gap-2">
        <Checkbox
          disabled={busy}
          checked={!!decision.feeConfirmed}
          onCheckedChange={(value) => onChange(rowKey(entry.row), { feeConfirmed: value === true })}
        />
        已确认主流水金额与手续费口径，分别入账
      </label>
    </details>
  );
}

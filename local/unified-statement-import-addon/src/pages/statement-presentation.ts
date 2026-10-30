import { Icons } from "@wealthfolio/ui";
import type { EntryKind } from "../parsers/types";
import type { PreviewStatus } from "../import/ledger";
export const labels: Record<PreviewStatus, string> = {
  ready: "待导入",
  duplicate: "重复",
  excluded: "排除",
  review: "待确认",
  error: "错误",
};
export const statusAppearance = {
  ready: { tone: "success", variant: "success-subtle", icon: Icons.CheckCircle },
  duplicate: { tone: "info", variant: "info-subtle", icon: Icons.Copy },
  excluded: { tone: "muted", variant: "outline", icon: Icons.MinusCircle },
  review: { tone: "warning", variant: "warning-subtle", icon: Icons.AlertCircle },
  error: { tone: "error", variant: "destructive-subtle", icon: Icons.XCircle },
} as const;
export const kinds: Record<EntryKind, string> = {
  expense: "支出",
  income: "收入",
  refund: "支出退款",
  transferIn: "转入",
  transferOut: "转出",
};

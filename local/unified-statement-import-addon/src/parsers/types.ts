export type EntryKind = "expense" | "income" | "refund" | "transferIn" | "transferOut";
export const entryActivityTypes: Record<EntryKind, string> = {
  expense: "WITHDRAWAL",
  income: "DEPOSIT",
  refund: "CREDIT",
  transferIn: "TRANSFER_IN",
  transferOut: "TRANSFER_OUT",
};

export interface StatementSource {
  sourceAccount?: string;
  sheetName?: string;
  balance?: string;
  peerAccount?: string;
  txType?: string;
  relatedId?: string;
  fee?: string;
  datePrecision?: "date" | "datetime";
  compositeIdentity?: boolean;
  transactionAmount?: string;
  transactionCurrency?: string;
  signedAmount?: string;
  variantId?: string;
  system: string;
  recordId: string;
  merchantOrderId: string;
  accountHint: string;
  fileName: string;
  lineNumber: number;
  originalTime: string;
  date: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  status: string;
  direction: string;
  category: string;
  merchant: string;
  description: string;
  remark: string;
}

export interface StatementRow {
  rowId?: string;
  parseStatus?: "ok" | "softSkip" | "hardSkip" | "fatal";
  skipReason?: string;
  identityReason?: string;
  transfer?: boolean;
  unsupportedReason?: string;
  source: StatementSource;
  kind?: EntryKind;
  excluded: boolean;
  defaultExcluded?: boolean;
  reviewReason?: string;
  error?: string;
}

export interface StatementParser {
  variants?: readonly { id: string; label: string }[];
  previewColumns: readonly { field: keyof StatementSource; label: string }[];
  categoryLabel?: string;
  fieldMappingHint: string;
  id: string;
  displayName: string;
  formats: readonly string[];
  uploadLabel: string;
  fileHint: string;
  mappingHint(count: string): string;
  recordIdLabel: string;
  matches(headers: readonly string[]): boolean;
  parse(records: CsvRecord[], fileName: string, variantId?: string): StatementRow[];
}

export interface StatementDocument {
  fileId?: string;
  fileName?: string;
  variantId?: string;
  sheets?: string[];
  rawPreview?: { name: string; records: CsvRecord[] }[];
  warnings?: string[];
  declaredCount?: number;
  summaries?: {
    sheet: string;
    currency: string;
    income: string;
    expense: string;
    declaredIncome?: string;
    declaredExpense?: string;
  }[];
  parserId: string;
  rows: StatementRow[];
}

export interface CsvRecord {
  error?: string;
  cells: string[];
  lineNumber: number;
}

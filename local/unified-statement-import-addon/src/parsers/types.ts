import type { DraftLeg } from "../ant-fund/import-model";
export interface FundTransaction {
  orderId: string;
  purpose: string;
  applicationDate?: string;
  legs: DraftLeg[];
}
export type EntryKind = "expense" | "income" | "refund" | "transferIn" | "transferOut" | "investment";
export const entryActivityTypes: Record<EntryKind, string> = {
  expense: "WITHDRAWAL",
  income: "DEPOSIT",
  refund: "CREDIT",
  transferIn: "TRANSFER_IN",
  transferOut: "TRANSFER_OUT",
  investment: "BUY",
};

export interface StatementSource {
  investment?: FundTransaction;
  pageNumber?: number;
  pageLineNumber?: number;
  sourceAccount?: string;
  sheetName?: string;
  balance?: string;
  peerAccount?: string;
  txType?: string;
  relatedId?: string;
  fee?: string;
  datePrecision?: "date" | "datetime";
  compositeIdentity?: boolean;
  statementDigest?: string;
  compositeBaseId?: string;
  compositeDocumentDigest?: string;
  compositeOccurrence?: number;
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
  investmentCandidate?: boolean;
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
  parse(records: CsvRecord[], fileName: string, variantId?: string, currency?: string): StatementRow[];
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
  pageNumber?: number;
  pageLineNumber?: number;
  error?: string;
  cells: string[];
  lineNumber: number;
}

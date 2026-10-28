export type EntryKind = "expense" | "income" | "refund";

export interface StatementSource {
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
  source: StatementSource;
  kind?: EntryKind;
  excluded: boolean;
  reviewReason?: string;
  error?: string;
}

export interface StatementParser {
  id: string;
  displayName: string;
  formats: readonly string[];
  uploadLabel: string;
  fileHint: string;
  mappingHint(count: string): string;
  recordIdLabel: string;
  matches(headers: readonly string[]): boolean;
  parse(records: CsvRecord[], fileName: string): StatementRow[];
}

export interface StatementDocument {
  parserId: string;
  rows: StatementRow[];
}

export interface CsvRecord {
  cells: string[];
  lineNumber: number;
}

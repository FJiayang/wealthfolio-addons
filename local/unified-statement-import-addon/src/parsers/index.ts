import { alipayParser } from "./alipay";
import { decodeStatement, parseCsv } from "./csv";
import type { StatementParser, StatementRow } from "./types";

const parsers: readonly StatementParser[] = [alipayParser];

export function parseStatement(bytes: Uint8Array, fileName: string): StatementRow[] {
  const records = parseCsv(decodeStatement(bytes));
  const parser = parsers.find((candidate) =>
    records.some(({ cells }) => candidate.matches(cells.map((cell) => cell.trim()))),
  );
  if (!parser)
    throw new Error("未识别到支持的账单表头；当前支持支付宝交易明细 CSV，请检查必需列。");
  const rows = parser.parse(records, fileName);
  if (!rows.length) throw new Error("账单中没有交易明细。");
  return rows;
}

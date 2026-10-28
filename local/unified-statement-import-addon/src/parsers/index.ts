import { alipayParser } from "./alipay";
import { decodeStatement, parseCsv } from "./csv";
import type { StatementParser, StatementDocument } from "./types";

export const statementParsers: readonly StatementParser[] = [alipayParser];

export function getStatementParser(id: string): StatementParser {
  const parser = statementParsers.find((candidate) => candidate.id === id);
  if (!parser) throw new Error("未注册的账单渠道。");
  return parser;
}

export function parseStatement(bytes: Uint8Array, fileName: string): StatementDocument {
  const records = parseCsv(decodeStatement(bytes));
  const parser = statementParsers.find((candidate) =>
    records.some(({ cells }) => candidate.matches(cells.map((cell) => cell.trim()))),
  );
  if (!parser)
    throw new Error("未识别到支持的账单表头，请检查文件格式及必需列。");
  const rows = parser.parse(records, fileName);
  if (!rows.length) throw new Error("账单中没有交易明细。");
  return { parserId: parser.id, rows };
}

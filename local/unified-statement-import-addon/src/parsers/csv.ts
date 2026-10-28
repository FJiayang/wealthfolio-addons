import type { CsvRecord } from "./types";

export class CsvParseError extends Error {
  constructor(
    message: string,
    readonly lineNumber: number,
  ) {
    super(message);
  }
}

export function decodeStatement(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("gb18030", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("文件无法按 UTF-8 或 GB18030 解码，请重新导出 CSV。");
    }
  }
}

export function parseCsv(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let line = 1;
  let startLine = 1;
  const finishCell = () => {
    cells.push(cell);
    cell = "";
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (cells.some((value) => value.trim())) records.push({ cells, lineNumber: startLine });
    cells = [];
  };
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        cell += char;
        if (char === "\n" || (char === "\r" && text[i + 1] !== "\n")) line++;
      }
    } else if (char === ",") finishCell();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow();
      line++;
      startLine = line;
    } else if (char === '"' && cell === "" && !closed) quoted = true;
    else if (closed || char === '"')
      throw new CsvParseError("第 {{line}} 行 CSV 引号格式不正确。", line);
    else cell += char;
  }
  if (quoted) throw new CsvParseError("第 {{line}} 行 CSV 引号未闭合。", startLine);
  if (cell || cells.length || closed) finishRow();
  return records;
}

export function normalizeAmount(value: string): string {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("金额必须是非负数字，且最多两位小数。");
  const integer = match[1].replace(/^0+(?=\d)/, "");
  return `${integer}.${(match[2] ?? "").padEnd(2, "0")}`;
}

export function parseShanghaiDate(value: string): string {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error("交易时间格式不正确。");
  const [, year, month, day, hour, minute, second = "00"] = match;
  const local = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}`;
  const parsed = new Date(`${local}+08:00`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    new Date(parsed.getTime() + 8 * 3600000).toISOString().slice(0, 19) !== local
  )
    throw new Error("交易时间不是有效日期。");
  return parsed.toISOString();
}

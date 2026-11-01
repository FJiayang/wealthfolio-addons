import { read, utils } from "xlsx";
import { decodeStatement, parseCsv } from "./csv";
import type { CsvRecord } from "./types";

export function readTables(
  bytes: Uint8Array,
  matchesHeader: (cells: string[]) => boolean = (cells) =>
    cells.length > 1 && cells.some((cell) => /^(日期|交易日期|交易时间|记账日期)$/.test(cell)),
): { name: string; records: CsvRecord[] }[] {
  const binary =
    (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf);
  const xml =
    !binary &&
    /^\s*(?:<\?xml|<(?:html|table|Workbook))/i.test(new TextDecoder().decode(bytes.slice(0, 200)));
  if (!binary && !xml) {
    const text = decodeStatement(bytes);
    const candidates = [",", "\t", ";"].flatMap((delimiter) => {
      try {
        const records = parseCsv(text, delimiter);
        return records.some(({ cells }) => matchesHeader(cells.map((cell) => cell.trim())))
          ? [records]
          : [];
      } catch {
        return [];
      }
    });
    if (candidates.length > 1) throw new Error("账单分隔符不明确，请核对表头。");
    return [{ name: "CSV", records: candidates[0] ?? parseCsv(text) }];
  }
  const workbook = read(bytes, { type: "array", cellDates: false, cellHTML: false, raw: true });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const records: CsvRecord[] = [];
    if (!sheet["!ref"]) return { name, records };
    const range = utils.decode_range(sheet["!ref"]);
    if ((range.e.r + 1) * (range.e.c + 1) > 2_000_000)
      throw new Error("工作表过大，请按账单期间拆分导出。");
    for (let row = 0; row <= range.e.r; row++) {
      const cells: string[] = [];
      let error: string | undefined;
      for (let column = 0; column <= range.e.c; column++) {
        const cell = sheet[utils.encode_cell({ r: row, c: column })];
        if (
          cell?.t === "n" &&
          (!Number.isFinite(cell.v) || String(Math.abs(cell.v)).replace(/[^0-9]/g, "").length > 15)
        )
          error = "数值单元格可能丢失精度，请重新导出为文本。";
        cells.push(cell ? utils.format_cell(cell) : "");
      }
      if (cells.some((cell) => cell.trim())) records.push({ cells, lineNumber: row + 1, error });
    }
    while (records.length && records.every(({ cells }) => !cells.at(-1)?.trim()))
      records.forEach(({ cells }) => cells.pop());
    return { name, records };
  });
}

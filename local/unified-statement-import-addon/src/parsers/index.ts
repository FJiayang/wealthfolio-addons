import { alipayParser } from "./alipay";
import { readTables } from "./reader";
import { channelParsers, profiles } from "./profiles";
import { add, cleanAmount, compare } from "./decimal";
import { decodeStatement, parseCsv } from "./csv";
import type { StatementParser, StatementDocument } from "./types";

export const statementParsers: readonly StatementParser[] = [alipayParser, ...channelParsers];

export function getStatementParser(id: string): StatementParser {
  const parser = statementParsers.find((candidate) => candidate.id === id);
  if (!parser) throw new Error("未注册的账单渠道。");
  return parser;
}

export function parseStatementSync(bytes: Uint8Array, fileName: string): StatementDocument {
  const records = parseCsv(decodeStatement(bytes));
  const matches = statementParsers.filter((candidate) =>
    records.some(({ cells }) => candidate.matches(cells.map((cell) => cell.trim()))),
  );
  if (matches.length > 1) throw new Error("账单同时匹配多个渠道，请核对文件表头。");
  const parser = matches[0];
  if (!parser) throw new Error("未识别到支持的账单表头，请检查文件格式及必需列。");
  const rows = parser.parse(records, fileName);
  if (!rows.length) throw new Error("账单中没有交易明细。");
  return { parserId: parser.id, rows };
}

export interface ParseOptions {
  channel?: string;
  variantId?: string;
  sourceAccount?: string;
  fileId?: string;
  sheets?: string[];
}
export async function parseStatement(
  bytes: Uint8Array,
  fileName: string,
  options: ParseOptions = {},
): Promise<StatementDocument> {
  const rawPreview = readTables(bytes, (cells) =>
    statementParsers.some((parser) => parser.matches(cells)),
  );
  const fileId = options.fileId ?? crypto.randomUUID();
  const rows: StatementDocument["rows"] = [];
  const channels = new Set<string>();
  const warnings: string[] = [];
  const summaries: NonNullable<StatementDocument["summaries"]> = [];
  for (const sheet of rawPreview.filter(
    (sheet) => !options.sheets || options.sheets.includes(sheet.name),
  )) {
    const matches = statementParsers.filter(
      (p) =>
        (!options.channel || p.id === options.channel) &&
        sheet.records.some(({ cells }) => p.matches(cells.map((cell) => cell.trim()))),
    );
    if (!matches.length) {
      warnings.push(`${sheet.name}：未识别到支持的账单表头`);
      continue;
    }
    if (matches.length !== 1) throw new Error("账单同时匹配多个渠道，请选择流水渠道后重试。");
    const parser = matches[0];
    channels.add(parser.id);
    for (const row of parser.parse(sheet.records, fileName, options.variantId)) {
      const source = row.source;
      const rawError = sheet.records.find(
        (record) => record.lineNumber === source.lineNumber,
      )?.error;
      if (rawError) row.error = [row.error, rawError].filter(Boolean).join("；");
      source.sheetName = sheet.name;
      row.rowId = JSON.stringify([fileId, sheet.name, source.lineNumber]);
      row.parseStatus ??= row.excluded
        ? "hardSkip"
        : row.error
          ? "fatal"
          : row.defaultExcluded
            ? "softSkip"
            : "ok";
      if (options.sourceAccount && !source.sourceAccount) {
        source.sourceAccount = options.sourceAccount.trim();
        source.accountHint = source.sourceAccount;
        row.identityReason = undefined;
      }
      const bank = profiles.some((p) => p.channel === source.system && p.bank);
      if (bank || source.system === "feidee") {
        if (!source.sourceAccount && source.system === "feidee")
          source.sourceAccount = source.paymentMethod;
        if (!source.sourceAccount) row.identityReason = "缺少来源账户标识，请在上传页补全";
        if (!source.recordId) {
          if (
            source.date &&
            source.amount &&
            (source.balance ||
              source.system === "feidee" ||
              (profiles.some((p) => p.id === source.variantId && p.credit) && source.description))
          ) {
            const identity = JSON.stringify([
              source.date,
              source.amount,
              source.currency,
              row.kind,
              source.balance ?? "",
              source.peerAccount || source.merchant,
              source.description,
            ]);
            const digest = await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(identity),
            );
            source.recordId = `composite:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
            source.compositeIdentity = true;
          } else row.identityReason = "缺少稳定流水号及完整复合身份，请补证或跳过";
        }
      }
      rows.push(row);
    }
  }
  if (!rows.length) throw new Error("未识别到支持的账单表头或交易明细，请检查文件格式及必需列。");
  if (channels.size !== 1) throw new Error("工作簿包含不同渠道，请分别选择工作表导入。");
  for (const sheet of rawPreview) {
    const sheetRows = rows.filter((row) => row.source.sheetName === sheet.name);
    const currencies = [...new Set(sheetRows.map((row) => row.source.currency))];
    const text = sheet.records
      .filter((record) => !sheetRows.some((row) => row.source.lineNumber === record.lineNumber))
      .map(({ cells }) => cells.join(" "))
      .join("\n");
    for (const currency of currencies) {
      const included = sheetRows.filter((row) => !row.error && row.source.currency === currency);
      const income = included
        .filter(
          (row) =>
            row.source.direction === "收入" || (!row.source.direction && row.kind === "income"),
        )
        .reduce((sum, row) => add(sum, row.source.amount), "0.00");
      const expense = included
        .filter(
          (row) =>
            row.source.direction === "支出" || (!row.source.direction && row.kind === "expense"),
        )
        .reduce((sum, row) => add(sum, row.source.amount), "0.00");
      // Unlabelled statement totals are comparable only when the sheet has one currency.
      const declaredIncome =
        currencies.length === 1
          ? /收入(?:合计|总额|总计)?\s*[：:]\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)/.exec(text)?.[1]
          : undefined;
      const declaredExpense =
        currencies.length === 1
          ? /支出(?:合计|总额|总计)?\s*[：:]\s*[¥￥]?\s*([\d,]+(?:\.\d+)?)/.exec(text)?.[1]
          : undefined;
      summaries.push({
        sheet: sheet.name,
        currency,
        income,
        expense,
        declaredIncome: declaredIncome ? cleanAmount(declaredIncome) : undefined,
        declaredExpense: declaredExpense ? cleanAmount(declaredExpense) : undefined,
      });
      if (
        (declaredIncome && compare(income, cleanAmount(declaredIncome)) !== 0) ||
        (declaredExpense && compare(expense, cleanAmount(declaredExpense)) !== 0)
      )
        warnings.push(`${sheet.name} ${currency}：源声明收入／支出与原始解析合计不一致，请核对。`);
    }
  }
  const declared = rawPreview
    .flatMap(({ records }) => records.flatMap(({ cells }) => cells))
    .map((cell) => /共\s*(\d+)\s*笔/.exec(cell))
    .find(Boolean);
  const declaredCount = declared ? Number(declared[1]) : undefined;
  if (declaredCount !== undefined && declaredCount !== rows.length)
    warnings.push(`源声明 ${declaredCount} 笔，解析 ${rows.length} 笔，请核对差异。`);
  return {
    parserId: [...channels][0],
    fileId,
    fileName,
    rows,
    variantId: rows[0].source.variantId,
    sheets: rawPreview.map((sheet) => sheet.name),
    rawPreview,
    declaredCount,
    summaries,
    warnings,
  };
}

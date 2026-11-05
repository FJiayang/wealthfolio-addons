import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { AddonAssets } from "@wealthfolio/addon-sdk";
import type { CsvRecord } from "./types";

// Same local loopback worker as the fund PDF addon; no worker URL or network fetch.
Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });

export interface PdfOptions {
  password?: string;
  assets?: Pick<AddonAssets, "getBlob">;
  channel?: string;
}
export class PdfPasswordError extends Error {}
export interface PdfWord { text: string; x: number; y: number; width: number }
export interface PdfPage { number: number; words: PdfWord[] }
interface Template {
  channel: string;
  title: RegExp;
  headers: string[];
  aliases?: Record<string, string[]>;
  dateColumn: number;
  optional?: string[];
}
const templates: Template[] = [
  { channel: "cmb", title: /招商银行交易流水/, dateColumn: 0,
    headers: ["记账日期", "货币", "交易金额", "联机余额", "交易摘要", "对手信息"], optional: ["客户摘要"] },
  { channel: "cmbc", title: /民生银行/, dateColumn: 2,
    headers: ["凭证类型", "凭证号码", "交易时间", "摘要", "交易金额", "账户余额", "现转标志", "交易渠道", "交易机构", "对方户名/账号", "对方行名"] },
  { channel: "icbc", title: /工商银行/, dateColumn: 0,
    headers: ["交易日期", "帐号", "储种", "序号", "币种", "钞汇", "摘要", "地区", "收入/支出金额", "余额", "对方户名", "对方帐号", "渠道"],
    aliases: { 帐号: ["账号"], 对方帐号: ["对方账号"], "收入/支出金额": ["收入/支出", "交易金额"] } },
  { channel: "boc", title: /中国银行/, dateColumn: 0,
    headers: ["记账日期", "记账时间", "币别", "金额", "余额", "交易名称", "渠道", "网点名称", "附言", "对方账户名", "对方卡号/账号", "对方开户行"] },
  { channel: "boc", title: /中国银行/, dateColumn: 0,
    headers: ["交易日", "入账日", "交易描述", "存入", "支出"], optional: ["卡号末四位"],
    aliases: { 交易日: ["交易日期"], 入账日: ["记账日", "记账日期"], 交易描述: ["交易说明", "交易摘要"], 卡号末四位: ["卡号后四位"] } },
  { channel: "webank", title: /微众银行/, dateColumn: 0,
    headers: ["记账日期", "对方户名", "对方账号", "借贷标志", "摘要", "备注", "币种", "金额", "余额"],
    aliases: { 记账日期: ["交易日期", "Date"], 对方户名: ["对方名称", "Counterparty"], 对方账号: ["对方账户"], 借贷标志: ["借贷", "借/贷"], 金额: ["交易金额"], 余额: ["账户余额"] } },
];
const compact = (text: string) => text.normalize("NFKC").replace(/\s/g, "");

function lines(words: PdfWord[]) {
  const result: { y: number; words: PdfWord[] }[] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = result.at(-1);
    if (last && Math.abs(last.y - word.y) < 2.5) last.words.push(word);
    else result.push({ y: word.y, words: [word] });
  }
  return result.map((line) => ({ ...line, words: line.words.sort((a, b) => a.x - b.x) }));
}

function headerAt(template: Template, pageLines: ReturnType<typeof lines>, index: number) {
  // Headers can wrap over several baselines; never include the first dated row.
  const nearby = pageLines.slice(index).filter((line) => line.y - pageLines[index].y < 32);
  const words = nearby.flatMap((line) => line.words);
  const find = (name: string) => {
    const aliases = [name, ...(template.aliases?.[name] ?? [])].map(compact);
    const exact = words.find((word) => aliases.includes(compact(word.text)));
    if (exact) return exact;
    for (const first of words) {
      const fragments = words.filter((word) => word.y >= first.y && Math.abs(word.x - first.x) < 18);
      const text = fragments.map((word) => compact(word.text)).join("");
      if (aliases.includes(text)) return { ...first, text, y: Math.max(...fragments.map((word) => word.y)) };
    }
  };
  if (!find(template.headers[template.dateColumn])) return;
  const columns = template.headers.map((name) => ({ name, word: find(name) }));
  if (columns.some(({ word }) => !word)) return;
  for (const name of template.optional ?? []) {
    const word = find(name);
    if (word) columns.push({ name, word });
  }
  const sorted = columns.map(({ name, word }) => ({ name, ...word! })).sort((a, b) => a.x - b.x);
  return {
    columns: sorted,
    bottom: Math.max(...sorted.map((column) => column.y)),
    boundaries: sorted.map((column, i) => i === 0 ? 0 : column.x - Math.max(2, Math.min(16, (column.x - (sorted[i - 1].x + sorted[i - 1].width)) / 2))),
  };
}

/** Coordinate reconstruction, shared by real PDFs and synthetic page tests. */
export function extractPdfTables(pages: PdfPage[], channel?: string): { name: string; records: CsvRecord[] }[] {
  const fullText = pages.flatMap((page) => lines(page.words).map((line) => line.words.map((word) => word.text).join(" "))).join("\n");
  const candidates = templates.filter((template) => (!channel || channel === template.channel) && template.title.test(compact(fullText)));
  if (!candidates.length) throw new Error("未识别到支持的银行 PDF 格式，请核对流水渠道。");
  const records: CsvRecord[] = [];
  const accounts = [...fullText.matchAll(/(?:^|\s)(?:客户账号|账户号码|账号|卡号|Account\/Card\s*No\.?)[：:\s]+([\d*＊•·Xx-]{4,})/g)];
  if (new Set(accounts.map((match) => match[1])).size > 1) throw new Error("PDF 包含不同来源账户，请分别导入。");
  if (accounts.length) records.push({ lineNumber: 0, cells: [`账号：${accounts[0][1]}`] });
  let active: { template: Template; layout: NonNullable<ReturnType<typeof headerAt>> } | undefined;
  let pending: CsvRecord | undefined;
  let serial = 1;
  let headerWritten = false;
  let currency = "";
  const flush = () => { if (pending) records.push(pending); pending = undefined; };
  for (const page of pages) {
    const pageLines = lines(page.words);
    let inBody = false;
    let foundRows = false;
    for (let i = 0; i < pageLines.length; i++) {
      const line = pageLines[i];
      const text = line.words.map((word) => word.text).join(" ");
      const section = /(?:人民币|美元|港币|港元|日元|欧元)(?:账户|交易)|\(([A-Z]{3})\).*交易明细/.exec(compact(text));
      if (section) {
        const nextCurrency = section[1] || ({ 人民币: "CNY", 美元: "USD", 港币: "HKD", 港元: "HKD", 日元: "JPY", 欧元: "EUR" }[section[0].slice(0, -2)] ?? "");
        if (currency && currency !== nextCurrency) flush();
        currency = nextCurrency;
      }
      const header = candidates.map((template) => ({ template, layout: headerAt(template, pageLines, i) })).find((entry) => entry.layout);
      if (header?.layout) {
        if (active && active.template !== header.template) throw new Error(`第 ${page.number} 页账单结构发生变化，请分别导入。`);
        active = { template: header.template, layout: header.layout };
        if (!headerWritten) {
          records.push({ lineNumber: serial++, cells: [...active.layout.columns.map((column) => column.name), ...(active.template.headers.includes("存入") ? ["币种"] : [])] });
          headerWritten = true;
        } else if (records.find((record) => record.lineNumber === 1)?.cells.slice(0, active.layout.columns.length).join("|") !== active.layout.columns.map((column) => column.name).join("|")) {
          throw new Error(`第 ${page.number} 页列结构不一致，请核对原文件。`);
        }
        inBody = true;
        while (i + 1 < pageLines.length && pageLines[i + 1].y <= active.layout.bottom) i++;
        continue;
      }
      if (!active || !inBody) continue;
      if (/^(?:第\s*\d+\s*页|\d+\s*\/\s*\d+\s*$)/.test(text.trim())) {
        inBody = false; continue;
      }
      if (/^(?:温馨提示|打印时间|合并统计|合计|总计|[-—_]{4,}|说明[:：])/.test(text.trim())) {
        flush(); inBody = false; continue;
      }
      if (line.y - active.layout.bottom < 48 && line.words.every((word) => /^(?:Date|Currency|Transaction|Amount|Balance|Type|Counter|Party|Customer|Account|No\.?|Name|Description|Debit|Credit|Posting|Posted)(?:\s+(?:Date|Currency|Transaction|Amount|Balance|Type|Counter|Party|Customer|Account|No\.?|Name|Description|Debit|Credit|Posting|Posted))*$/i.test(word.text.trim()))) continue;
      const cells = active.layout.columns.map(() => "");
      for (const word of line.words) {
        let column = active.layout.boundaries.length - 1;
        while (column > 0 && word.x < active.layout.boundaries[column]) column--;
        if (column < 0) column = 0;
        cells[column] += `${cells[column] && /[a-zA-Z0-9]$/.test(cells[column]) && /^[a-zA-Z]/.test(word.text) ? " " : ""}${word.text}`;
      }
      const dateIndex = active.layout.columns.findIndex((column) => column.name === active!.template.headers[active!.template.dateColumn]);
      const dated = /^(?:19|20)\d{2}[-/]\d{1,2}[-/]\d{1,2}/.test(cells[dateIndex].trim());
      if (dated) {
        flush();
        pending = { cells, lineNumber: serial++, pageNumber: page.number, pageLineNumber: i + 1 };
        if (active.template.headers.includes("存入")) pending.cells.push(currency);
        foundRows = true;
      } else if (/\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(text)) {
        throw new Error(`第 ${page.number} 页第 ${i + 1} 行日期未能定位，请核对 PDF 列结构。`);
      } else if (pending && !cells[dateIndex].trim()) {
        cells.forEach((cell, index) => {
          if (cell.trim()) pending!.cells[index] += cell.trim();
        });
        foundRows = true;
      }
    }
    if (!foundRows && page.words.some((word) => /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(word.text)))
      throw new Error(`第 ${page.number} 页未能完整解析交易表格，请核对原文件。`);
  }
  flush();
  if (!records.some((record) => record.pageNumber)) throw new Error("PDF 中没有可识别的交易明细；扫描件暂不支持，请导出文字型 PDF。");
  return [{ name: "PDF", records }];
}

export async function openPdf(bytes: Uint8Array, options: PdfOptions = {}): Promise<PDFDocumentProxy> {
  const assets = options.assets;
  class CMapReaderFactory {
    async fetch({ name }: { name: string }) {
      if (!assets) throw new Error("缺少本地 PDF 字体资源。");
      return { cMapData: new Uint8Array(await (await assets.getBlob(`dist/assets/pdf/cmaps/${name}.bcmap`)).arrayBuffer()), isCompressed: true };
    }
  }
  class StandardFontDataFactory {
    async fetch({ filename }: { filename: string }) {
      if (!assets) throw new Error("缺少本地 PDF 字体资源。");
      return new Uint8Array(await (await assets.getBlob(`dist/assets/pdf/standard_fonts/${filename}`)).arrayBuffer());
    }
  }
  const task = getDocument({ data: new Uint8Array(bytes), password: options.password, CMapReaderFactory, StandardFontDataFactory,
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false, stopAtErrors: true, verbosity: 0 });
  try { return await task.promise; }
  catch (error) {
    await task.destroy();
    if (error instanceof Error && error.name === "PasswordException") throw new PdfPasswordError("PDF 需要密码或密码不正确，请填写密码后重新读取。");
    throw error;
  }
}

export async function readPdfTables(bytes: Uint8Array, options: PdfOptions = {}) {
  const document = await openPdf(bytes, options);
  try {
    const pages: PdfPage[] = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const height = page.getViewport({ scale: 1 }).height;
      pages.push({ number, words: content.items.flatMap((item) => "str" in item && item.str.trim() ? [{ text: item.str, x: item.transform[4], y: height - item.transform[5], width: item.width }] : []) });
    }
    if (!pages.some((page) => page.words.length)) throw new Error("扫描件暂不支持，请导出文字型 PDF。");
    return extractPdfTables(pages, options.channel);
  } finally { await document.destroy(); }
}

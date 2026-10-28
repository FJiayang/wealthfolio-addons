import { PDFParse } from "pdf-parse";
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";
import type { AddonAssets } from "@wealthfolio/addon-sdk";

// Preloading the matching handler makes PDF.js use its loopback port, without creating a Worker.
Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });

export const HEADER = [
  "订单号",
  "交易时间",
  "交易类型",
  "基金名称",
  "组合基金名称",
  "基金代码",
  "申请金额",
  "申请份额",
  "确认金额",
  "确认份额",
  "手续费",
  "确认日期",
];
export const PDF_RESOURCES = [
  "cmaps/UniGB-UCS2-H.bcmap",
  "cmaps/Adobe-GB1-UCS2.bcmap",
  "standard_fonts/LiberationSans-Regular.ttf",
];

export class StatementError extends Error {
  constructor(
    public code:
      | "format"
      | "columns"
      | "continuation"
      | "empty"
      | "resource"
      | "date"
      | "number"
      | "amount"
      | "asset"
      | "pending"
      | "validation"
      | "createAsset"
      | "missingPage",
    public location = "",
  ) {
    super(code);
  }
}

export interface StatementRow {
  cells: string[];
  pages: number[];
  line: number;
}

export function compact(value: string) {
  return value.replace(/\s/g, "");
}

interface StatementPage {
  num: number;
  tables: string[][][];
  text?: string;
}

export function isSignaturePage(text: string, page: number, total: number) {
  if (page !== total) return false;
  const content = compact(text);
  const footer = `${page}/${total}`;
  const body = content.endsWith(footer) ? content.slice(0, -footer.length) : content;
  return /^(?:蚂蚁[（(]杭州[）)]基金销售有限公司)?\d{4}年\d{1,2}月\d{1,2}日$/.test(body);
}

export function mergePageTables(pages: StatementPage[]): StatementRow[] {
  const rows: StatementRow[] = [];
  let headerSeen = false;
  for (const page of pages) {
    if (!page.tables.some((table) => table.length)) {
      if (page.num === 1 || isSignaturePage(page.text ?? "", page.num, pages.at(-1)!.num)) continue;
      throw new StatementError("missingPage", String(page.num));
    }
    for (const table of page.tables) {
      for (let index = 0; index < table.length; index++) {
        const cells = table[index];
        if (cells.length !== 12) throw new StatementError("columns", `${page.num}`);
        if (compact(cells[0]) === HEADER[0]) {
          if (cells.some((cell, i) => compact(cell) !== HEADER[i]))
            throw new StatementError("columns", `${page.num}`);
          headerSeen = true;
          continue;
        }
        if (!headerSeen) throw new StatementError("format");
        if (/^\d{6}$/.test(compact(cells[5])) && /^20\d{6}/.test(compact(cells[0]))) {
          rows.push({ cells: [...cells], pages: [page.num], line: rows.length + 1 });
        } else {
          const previous = rows.at(-1);
          if (
            index !== 0 ||
            !previous ||
            previous.pages.at(-1) !== page.num - 1 ||
            compact(cells[5])
          )
            throw new StatementError("continuation", `${page.num}`);
          previous.cells = previous.cells.map((cell, i) => cell + cells[i]);
          previous.pages.push(page.num);
        }
      }
    }
  }
  if (!rows.length) throw new StatementError("empty");
  return rows;
}

export async function parseStatement(
  data: Uint8Array,
  assets: Pick<AddonAssets, "getBlob">,
  onProgress: (page: number, total: number) => void,
  signal?: AbortSignal,
): Promise<StatementRow[]> {
  const resourceData = new Map<string, Uint8Array>();
  let resourceMissing = false;
  for (const name of PDF_RESOURCES) {
    try {
      resourceData.set(
        name,
        new Uint8Array(await (await assets.getBlob(`assets/pdf/${name}`)).arrayBuffer()),
      );
    } catch {
      throw new StatementError("resource");
    }
  }
  class CMapReaderFactory {
    async fetch({ name }: { name: string }) {
      const bytes = resourceData.get(`cmaps/${name}.bcmap`);
      if (!bytes) {
        resourceMissing = true;
        throw new StatementError("resource");
      }
      return { cMapData: bytes, isCompressed: true };
    }
  }
  class StandardFontDataFactory {
    async fetch({ filename }: { filename: string }) {
      const bytes = resourceData.get(`standard_fonts/${filename}`);
      if (!bytes) {
        resourceMissing = true;
        throw new StatementError("resource");
      }
      return bytes;
    }
  }
  const parser = new PDFParse({
    data,
    CMapReaderFactory,
    StandardFontDataFactory,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const text = await parser.getText({ partial: [1] });
    if (resourceMissing) throw new StatementError("resource");
    if (!compact(text.text).includes("蚂蚁（杭州）基金销售有限公司"))
      throw new StatementError("format");
    const pages: StatementPage[] = [];
    for (let page = 1; page <= text.total; page++) {
      signal?.throwIfAborted();
      const result = await parser.getTable({ partial: [page] });
      if (resourceMissing) throw new StatementError("resource");
      const pageResult: StatementPage = result.pages[0];
      if (page > 1 && !pageResult.tables.some((table) => table.length)) {
        const content = await parser.getText({ partial: [page] });
        if (resourceMissing) throw new StatementError("resource");
        pageResult.text = content.pages[0].text;
      }
      pages.push(pageResult);
      onProgress(page, text.total);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return mergePageTables(pages);
  } finally {
    await parser.destroy();
  }
}

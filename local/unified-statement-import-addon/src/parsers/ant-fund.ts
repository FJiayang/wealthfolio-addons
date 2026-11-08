import { HEADER, compact, parseStatement as parsePdf } from "../ant-fund/statement";
import { createDrafts, type DraftLeg } from "../ant-fund/import-model";
import type { FundTransaction, StatementDocument, StatementParser, StatementRow } from "./types";
import type { ParseOptions } from "./index";

const columns = ["date", "symbol", "quantity", "activityType", "unitPrice", "currency", "fee", "amount", "comment"];
const orderPattern = /(?:Ant Fund order\s*[:：]|订单号\s*[:：])\s*(\d+)/i;

function row(transaction: FundTransaction, fileName: string, lineNumber: number, account: string, rawTime: string): StatementRow {
  const leg = transaction.legs[0];
  return {
    kind: "investment", excluded: false, parseStatus: "ok",
    source: {
      system: "ant-fund", recordId: transaction.orderId, merchantOrderId: transaction.orderId,
      investment: transaction, accountHint: account, paymentMethod: account,
      fileName, lineNumber, originalTime: rawTime,
      date: leg?.date ? leg.date + "T00:00:00Z" : "",
      datePrecision: "date", amount: leg?.amount || "0", currency: "CNY",
      status: "已确认", direction: "投资", category: "", merchant: "蚂蚁基金",
      description: transaction.purpose, remark: "",
    },
  };
}

export const antFundParser: StatementParser = {
  id: "ant-fund", displayName: "蚂蚁基金", formats: ["pdf", "csv"],
  uploadLabel: "上传蚂蚁基金交易明细", fileHint: "蚂蚁基金文字型 PDF / 标准投资 CSV（须包含订单号）",
  fieldMappingHint: "确认日期映射为投资日期；amount 映射为最终收付金额；份额、净值和手续费分别保留；转换不匹配银行扣款。",
  mappingHint: (count) => `已读取 ${count} 个基金订单。请选择实际持有基金的投资账户，银行卡在资金流水中另行确认。`,
  recordIdLabel: "蚂蚁基金订单号",
  previewColumns: [{ field: "originalTime", label: "交易时间" }, { field: "recordId", label: "订单号" }, { field: "description", label: "用途" }, { field: "amount", label: "最终收付金额" }],
  matches: (headers) => columns.every((column) => headers.includes(column)),
  parse(records, fileName) {
    const start = records.findIndex(({ cells }) => this.matches(cells));
    const headers = records[start].cells;
    const groups = new Map<string, StatementRow>();
    for (const record of records.slice(start + 1)) {
      if (record.cells.every((cell) => !cell.trim())) continue;
      const get = (key: string) => (record.cells[headers.indexOf(key)] ?? "").trim();
      const orderId = orderPattern.exec(get("comment"))?.[1] ?? "";
      const purpose = get("comment").split(/[；;]/)[1] || get("activityType");
      const type = get("activityType");
      const leg: DraftLeg = {
        code: get("symbol"), name: get("comment").split(/[；;]/)[0],
        activityType: type as DraftLeg["activityType"], date: get("date"),
        amount: get("amount"), quantity: get("quantity"), fee: get("fee"),
        tax: get("tax") || "0", unitPrice: get("unitPrice"), subtype: get("subtype") || undefined,
      };
      const entry = row({ orderId, purpose, legs: [leg] }, fileName, record.lineNumber, get("account"), get("date"));
      if (get("currency") !== "CNY") entry.error = "蚂蚁基金文件仅支持原始人民币金额";
      if (!orderId) entry.identityReason = "基金明细缺少稳定订单号，请补充完整来源或跳过";
      if (!["BUY", "SELL", "DIVIDEND"].includes(type)) entry.error = "不支持的基金活动类型";
      const previous = orderId ? groups.get(orderId) : undefined;
      if (previous) {
        if (previous.source.paymentMethod !== entry.source.paymentMethod)
          previous.error = "同一基金订单的来源账户不一致";
        if (entry.error) previous.error = entry.error;
        previous.source.investment!.legs.push(leg);
        if (previous.source.investment!.legs.length > 1) previous.source.investment!.purpose = "基金转换";
      } else groups.set(orderId || `missing:${record.lineNumber}`, entry);
    }
    return [...groups.values()];
  },
};

export async function parseAntFundPdf(bytes: Uint8Array, fileName: string, options: ParseOptions): Promise<StatementDocument> {
  if (!options.assets) throw new Error("缺少本地 PDF 字体资源");
  const extracted = await parsePdf(bytes, options.assets, () => {});
  const drafts = createDrafts(extracted);
  const groups = new Map<string, StatementRow>();
  for (const draft of drafts) {
    const cells = draft.source.cells.map(compact);
    const entry = row({
      orderId: cells[0], purpose: cells[2],
      applicationDate: /^(\d{4})\/(\d{2})\/(\d{2})/.exec(cells[1])?.slice(1).join("-"),
      legs: draft.legs,
    }, fileName, draft.source.line, "", cells[1]);
    entry.rowId = JSON.stringify([options.fileId, "PDF", draft.source.line]);
    entry.source.pageNumber = draft.source.pages[0];
    entry.source.sheetName = "PDF";
    const previous = groups.get(cells[0]);
    if (previous) {
      previous.source.investment!.legs.push(...entry.source.investment!.legs);
      previous.source.investment!.purpose = "基金转换";
    } else groups.set(cells[0], entry);
  }
  const rows = [...groups.values()];
  return { parserId: "ant-fund", fileId: options.fileId, fileName, rows,
    sheets: ["PDF"], rawPreview: [{ name: "PDF", records: [
      { lineNumber: 0, cells: HEADER },
      ...extracted.map((source) => ({ lineNumber: source.line, cells: source.cells, pageNumber: source.pages[0] })),
    ] }] };
}

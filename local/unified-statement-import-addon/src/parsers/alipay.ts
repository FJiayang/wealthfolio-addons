import { normalizeAmount, parseShanghaiDate } from "./csv";
import type { EntryKind, StatementParser, StatementRow } from "./types";

const required = [
  "交易时间",
  "交易分类",
  "交易对方",
  "商品说明",
  "收/支",
  "金额",
  "收/付款方式",
  "交易状态",
  "交易订单号",
];

const successfulStatuses = new Set([
  "交易成功",
  "支付成功",
  "代付成功",
  "解冻成功",
  "芝麻免押下单成功",
]);

const webRequired = ["交易创建时间", "金额（元）", "收/支", "交易状态"];

const previewColumns = [
  { field: "originalTime", label: "交易时间" },
  { field: "merchant", label: "交易对方" },
  { field: "description", label: "商品说明" },
  { field: "direction", label: "收/支" },
  { field: "amount", label: "金额" },
  { field: "paymentMethod", label: "付款方式" },
  { field: "status", label: "交易状态" },
  { field: "recordId", label: "订单号" },
] as const;

export const alipayParser: StatementParser = {
  previewColumns,
  categoryLabel: "支付宝分类",
  fieldMappingHint: "交易时间／交易创建时间 → 日期；收/支 → 记账性质；金额 → 金额；收/付款方式 → 账户；订单号 → 来源标识。来源分类保留在备注中。",
  id: "alipay",
  displayName: "支付宝",
  formats: ["csv"],
  uploadLabel: "上传支付宝交易明细",
  fileHint: "支付宝交易明细／网页查询／电子回单 · UTF-8 / GB18030",
  mappingHint: (count) =>
    `已读取 ${count} 条明细。银行卡名称及尾号仅作提示，请选择实际扣款或收款账户。余额宝、花呗或组合付款不应直接当作支付宝余额。`,
  recordIdLabel: "支付宝订单号",
  matches: (headers) => required.every((name) => headers.includes(name)) || webRequired.every((name) => headers.includes(name)),
  parse(records, fileName) {
    const headerIndex = records.findIndex(({ cells }) =>
      this.matches(cells.map((cell) => cell.trim())),
    );
    if (headerIndex < 0) throw new Error("缺少支付宝账单必需列。");
    const headers = records[headerIndex].cells.map((cell) => cell.trim());
    const web = webRequired.every((name) => headers.includes(name));
    const receipt = records.slice(0, headerIndex).some(({ cells }) => cells.some((cell) => cell.includes("电子客户回单")));
    const variantId = web ? "alipay-web-csv" : receipt ? "alipay-receipt-csv" : "alipay-detail-csv";
    if (new Set(headers).size !== headers.length) throw new Error("账单包含重复列名。");
    const accountHint =
      records
        .slice(0, headerIndex)
        .flatMap(({ cells }) => cells)
        .find((value) => /^支付宝账户[：:]/.test(value.trim()))
        ?.replace(/^支付宝账户[：:]\s*/, "")
        .trim() ?? "";
    const body = records.slice(headerIndex + 1);
    const footer = body.findIndex(({ cells }) => /^-+$/.test(cells[0].trim()) || /^共\s*\d+\s*笔/.test(cells[0].trim()));
    return (footer < 0 ? body : body.slice(0, footer)).filter(({ cells }) => !this.matches(cells.map((cell) => cell.trim()))).map(({ cells, lineNumber }): StatementRow => {
      const get = (name: string) => (cells[headers.indexOf(name)] ?? "").trim();
      const direction = get("收/支");
      const status = get("交易状态");
      const paymentMethod = get("收/付款方式");
      const excluded = status === "交易关闭" || status === "已关闭";
      let kind: EntryKind | undefined;
      let reviewReason: string | undefined;
      // Only an explicit completed refund is automatic; partial/in-progress refunds need review.
      if (status === "退款成功" && direction !== "支出") kind = "refund";
      else if (direction === "支出") kind = "expense";
      else if (direction === "收入") kind = "income";
      if (!excluded && kind !== "refund" && !successfulStatuses.has(status))
        reviewReason = "交易状态需要确认";
      const transfer = direction === "不计收支" && kind !== "refund" && /转入|转出|转账|还款|充值|提现/.test(get(web ? "商品名称" : "商品说明"));
      if (transfer) reviewReason = "请确认实际转入／转出账户与金额";
      const unsupportedReason = direction === "不计收支" && /-买入|-卖出|基金申购|基金赎回/.test(get(web ? "商品名称" : "商品说明")) ? "基金及证券交易请使用投资导入插件，不能作为普通收支或现金转账入账" : undefined;
      let amount = get(web ? "金额（元）" : "金额");
      let date = "";
      let error: string | undefined;
      try {
        amount = normalizeAmount(amount);
        date = parseShanghaiDate(get(web ? "交易创建时间" : "交易时间"));
        if (cells.length !== headers.length) throw new Error("列数与表头不一致。");
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "记录格式不正确。";
      }
      return {
        source: {
          system: this.id,
          variantId,
          recordId: web ? get("交易号") || get("交易订单号") : get("交易订单号"),
          merchantOrderId: get("商家订单号"),
          accountHint,
          fileName,
          lineNumber,
          originalTime: get(web ? "交易创建时间" : "交易时间"),
          date,
          amount,
          currency: "CNY",
          paymentMethod,
          status,
          direction,
          category: get("交易分类"),
          merchant: get("交易对方"),
          description: get(web ? "商品名称" : "商品说明"),
          remark: get("备注"),
        },
        kind,
        transfer,
        unsupportedReason,
        excluded,
        defaultExcluded: !excluded && direction === "不计收支" && kind !== "refund",
        reviewReason,
        error,
      };
    });
  },
};

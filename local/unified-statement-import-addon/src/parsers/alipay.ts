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

export const alipayParser: StatementParser = {
  id: "alipay",
  displayName: "支付宝",
  formats: ["csv"],
  uploadLabel: "上传支付宝交易明细",
  fileHint: "支付宝交易明细 · UTF-8 / GB18030",
  mappingHint: (count) =>
    `已读取 ${count} 条明细。银行卡名称及尾号仅作提示，请选择实际扣款或收款账户。余额宝、花呗或组合付款不应直接当作支付宝余额。`,
  recordIdLabel: "支付宝订单号",
  matches: (headers) => required.every((name) => headers.includes(name)),
  parse(records, fileName) {
    const headerIndex = records.findIndex(({ cells }) =>
      this.matches(cells.map((cell) => cell.trim())),
    );
    if (headerIndex < 0) throw new Error("缺少支付宝账单必需列。");
    const headers = records[headerIndex].cells.map((cell) => cell.trim());
    if (new Set(headers).size !== headers.length) throw new Error("账单包含重复列名。");
    const accountHint =
      records
        .slice(0, headerIndex)
        .flatMap(({ cells }) => cells)
        .find((value) => /^支付宝账户[：:]/.test(value.trim()))
        ?.replace(/^支付宝账户[：:]\s*/, "")
        .trim() ?? "";
    return records.slice(headerIndex + 1).map(({ cells, lineNumber }): StatementRow => {
      const get = (name: string) => (cells[headers.indexOf(name)] ?? "").trim();
      const direction = get("收/支");
      const status = get("交易状态");
      const paymentMethod = get("收/付款方式");
      const excluded = status === "交易关闭";
      let kind: EntryKind | undefined;
      let reviewReason: string | undefined;
      // Only an explicit completed refund is automatic; partial/in-progress refunds need review.
      if (status === "退款成功" && direction !== "支出") kind = "refund";
      else if (status !== "交易成功" && !excluded) reviewReason = "交易状态需要确认";
      else if (direction === "支出") kind = "expense";
      else if (direction === "收入") kind = "income";
      else reviewReason = "不计收支：请确认交易性质，转账、还款及理财暂不支持";
      if (/[&＆]|因公付|企业码|红包|优惠|积分|立减/.test(paymentMethod))
        reviewReason = "组合或代付：请确认性质、实际金额和账户";
      let amount = get("金额");
      let date = "";
      let error: string | undefined;
      try {
        amount = normalizeAmount(amount);
        date = parseShanghaiDate(get("交易时间"));
        if (cells.length !== headers.length) throw new Error("列数与表头不一致。");
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "记录格式不正确。";
      }
      return {
        source: {
          system: this.id,
          recordId: get("交易订单号"),
          merchantOrderId: get("商家订单号"),
          accountHint,
          fileName,
          lineNumber,
          originalTime: get("交易时间"),
          date,
          amount,
          currency: "CNY",
          paymentMethod,
          status,
          direction,
          category: get("交易分类"),
          merchant: get("交易对方"),
          description: get("商品说明"),
          remark: get("备注"),
        },
        kind,
        excluded,
        defaultExcluded: !excluded && direction === "不计收支" && kind !== "refund",
        reviewReason,
        error,
      };
    });
  },
};

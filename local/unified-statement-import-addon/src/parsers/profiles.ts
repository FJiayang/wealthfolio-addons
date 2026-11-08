import { parseShanghaiDate } from "./csv";
import { absolute, add, cleanAmount, compare, negate, fromMinorUnits } from "./decimal";
import type { CsvRecord, EntryKind, StatementParser, StatementRow, StatementSource } from "./types";

type Field =
  | "time"
  | "postingDate"
  | "clock"
  | "amount"
  | "income"
  | "expense"
  | "currency"
  | "direction"
  | "merchant"
  | "description"
  | "remark"
  | "method"
  | "status"
  | "recordId"
  | "merchantOrderId"
  | "account"
  | "balance"
  | "peerAccount"
  | "category"
  | "txType"
  | "relatedId"
  | "transactionAmount"
  | "transactionCurrency";
export interface Profile {
  manualOnly?: boolean;
  amountDivisor?: 100;
  id: string;
  channel: string;
  name: string;
  required: string[];
  columns: Partial<Record<Field, string[]>>;
  signature?: RegExp;
  bank?: boolean;
  credit?: boolean;
  creditSigned?: boolean;
  dateOrder?: "dmy" | "mdy";
  trailingEmpty?: boolean;
  explicitSign?: boolean;
  amountMode?: "net" | "expenseFirst" | "incomeFirst";
}

const common: Profile["columns"] = {
  time: ["交易时间", "交易日期", "记账日期", "交易日", "日期", "记账日"],
  postingDate: ["入账日期", "记账日", "入账日"],
  clock: ["记账时间"],
  amount: ["交易金额", "金额", "记账金额", "人民币金额"],
  income: ["存入金额", "存入", "收入", "记账金额(收入)"],
  expense: ["支出金额", "支出", "记账金额(支出)"],
  currency: ["货币", "币种", "记账币种", "币别", "账户币种"],
  merchant: ["交易对方", "对方户名", "对方账户名", "对手信息", "商户名称", "商家"],
  description: [
    "交易摘要",
    "摘要",
    "交易描述",
    "交易说明",
    "商品说明",
    "商品",
    "商品名称",
    "交易名称",
  ],
  remark: ["备注", "附言", "客户摘要"],
  method: ["支付方式", "收/付款方式", "账户", "卡号末四位", "卡末四位", "卡号后四位"],
  recordId: ["交易单号", "交易订单号", "交易流水号", "流水号", "日志号"],
  merchantOrderId: ["商户单号", "商家订单号", "商家单号"],
  account: ["借记卡号", "本方账号", "账户账号"],
  balance: ["联机余额", "本次余额", "余额"],
  peerAccount: ["对方账号", "对方卡号"],
  category: ["交易分类", "类别"],
  txType: ["交易类型", "交易摘要", "摘要", "交易说明"],
  direction: ["收/支", "借贷标志"],
  status: ["当前状态", "交易状态"],
  relatedId: ["关联Id", "关联ID"],
};

const profile = (
  id: string,
  channel: string,
  name: string,
  required: string[],
  options: Partial<Profile> = {},
): Profile => ({
  id,
  channel,
  name,
  required,
  ...options,
  columns: { ...common, ...options.columns },
});

export const profiles: Profile[] = [
  profile(
    "wechat",
    "wechat",
    "微信支付",
    ["交易时间", "交易类型", "收/支", "金额(元)", "当前状态"],
    { trailingEmpty: true, columns: { amount: ["金额(元)", "金额（元）"] } },
  ),
  profile("cmb-debit", "cmb", "招商银行", ["记账日期", "货币", "交易金额"], { bank: true }),
  profile("cmb-credit", "cmb", "招商银行", ["交易日", "记账日", "人民币金额", "卡号末四位"], {
    bank: true,
    credit: true,
  }),
  profile("spdb-debit", "spdb", "浦发银行", ["交易流水号", "存入金额", "支出金额"], {
    bank: true,
    amountMode: "incomeFirst",
    columns: { time: ["交易日期时间", "交易日期", "交易时间"] },
  }),
  profile("spdb-export", "spdb", "浦发银行", ["顺序号", "交易日期", "存入金额", "取出金额"], {
    bank: true,
    amountMode: "incomeFirst",
    columns: {
      expense: ["取出金额"],
      merchant: ["交易对手名称"],
      peerAccount: ["交易对手账号"],
      description: ["交易类型"],
    },
  }),
  profile("citic-credit", "citic", "中信银行", ["交易日期", "入账日期", "交易描述", "记账金额"], {
    bank: true,
    credit: true,
  }),
  profile(
    "citic-settlement",
    "citic",
    "中信银行",
    ["交易日期", "入账日期", "卡末四位", "结算币种", "结算金额"],
    {
      bank: true,
      credit: true,
      columns: {
        amount: ["结算金额"],
        currency: ["结算币种"],
        transactionAmount: ["交易金额"],
        transactionCurrency: ["交易币种"],
      },
    },
  ),
  profile("icbc", "icbc", "工商银行", ["交易日期", "摘要", "记账金额(收入)", "记账金额(支出)"], {
    bank: true,
    trailingEmpty: true,
    amountMode: "expenseFirst",
    signature: /工商银行|卡别名/,
    columns: { merchant: ["交易场所", "对方户名"], peerAccount: ["对方账户"], time: ["交易日期"] },
  }),
  profile("ccb", "ccb", "建设银行", ["记账日", "交易日期", "支出", "收入"], {
    bank: true,
    amountMode: "net",
    columns: { clock: ["交易时间"], time: ["交易日期"] },
  }),
  profile("boc-debit", "boc", "中国银行", ["记账日期", "币别", "金额", "借记卡号"], { bank: true }),
  profile("boc-credit", "boc", "中国银行", ["交易日", "入账日", "存入", "支出"], {
    bank: true,
    credit: true,
    amountMode: "incomeFirst",
  }),
  profile("abc-debit", "abc", "农业银行", ["交易日期", "交易时间", "日志号", "金额"], {
    bank: true,
    explicitSign: true,
    columns: { time: ["交易日期"], clock: ["交易时间"], merchant: ["对方"] },
  }),
  profile("bocom-debit", "bocom", "交通银行", ["流水号", "交易日期", "借贷标志", "金额"], {
    bank: true,
    columns: { time: ["交易日期"], clock: ["交易时间"] },
  }),
  profile(
    "bocom-credit",
    "bocom",
    "交通银行",
    ["交易日期", "记账日期", "交易币种/金额", "入账币种/金额"],
    {
      bank: true,
      credit: true,
      columns: {
        amount: ["入账币种/金额"],
        currency: ["入账币种/金额"],
        transactionAmount: ["交易币种/金额"],
        transactionCurrency: ["交易币种/金额"],
      },
    },
  ),
  profile("cgb-credit", "cgb", "广发银行", ["交易日期", "交易摘要", "入账金额", "入账货币"], {
    bank: true,
    credit: true,
    columns: {
      amount: ["入账金额"],
      currency: ["入账货币"],
      transactionAmount: ["交易金额"],
      transactionCurrency: ["交易货币"],
    },
  }),
  profile("cib-debit", "cib", "兴业银行", ["交易时间", "记账日", "支出", "收入", "用途"], {
    bank: true,
    amountMode: "net",
    columns: { remark: ["备注", "用途"] },
  }),
  profile("cmbc-debit", "cmbc", "民生银行", ["交易时间", "摘要", "交易金额", "账户余额"], {
    bank: true,
    columns: { balance: ["账户余额"], recordId: ["凭证号码"], merchant: ["对方户名/账号"] },
  }),
  profile("cmbc-credit", "cmbc", "民生银行", ["交易日", "记账日", "卡号末四位", "金额"], {
    bank: true, credit: true, creditSigned: true,
  }),
  profile("webank-debit", "webank", "微众银行", ["记账日期", "借贷标志", "对方户名", "余额"], {
    bank: true,
  }),
  profile("icbc-debit-pdf", "icbc", "工商银行", ["交易日期", "帐号", "收入/支出金额", "余额"], {
    bank: true,
    columns: { account: ["帐号"], amount: ["收入/支出金额"], peerAccount: ["对方帐号"] },
  }),
  profile("boc-debit-pdf", "boc", "中国银行", ["记账日期", "记账时间", "币别", "对方开户行"], {
    bank: true,
    columns: { peerAccount: ["对方卡号/账号"] },
  }),
  profile("hsbchk-debit", "hsbchk", "汇丰香港", ["Date", "Description", "Billing amount", "Billing currency", "Balance"], {
    bank: true, dateOrder: "dmy",
    columns: { time: ["Date"], description: ["Description"], amount: ["Billing amount"], currency: ["Billing currency"], balance: ["Balance"] },
  }),
  profile("hsbchk-credit", "hsbchk", "汇丰香港", ["Transaction date", "Post date", "Billing amount", "Billing currency", "Transaction status"], {
    bank: true, credit: true, creditSigned: true, dateOrder: "dmy",
    columns: { time: ["Transaction date"], postingDate: ["Post date"], description: ["Description"], merchant: ["Merchant name"], amount: ["Billing amount"], currency: ["Billing currency"], status: ["Transaction status"], direction: ["Credit / Debit"] },
  }),
  profile("bmo-debit", "bmo", "BMO 蒙特利尔银行", ["First Bank Card", "Transaction Type", "Date Posted", "Transaction Amount", "Description"], {
    bank: true,
    columns: { time: ["Date Posted"], account: ["First Bank Card"], amount: ["Transaction Amount"], description: ["Description"], direction: ["Transaction Type"], currency: ["Currency", "币种", "货币"] },
  }),
  profile("bmo-credit", "bmo", "BMO 蒙特利尔银行", ["Item #", "Card #", "Transaction Date", "Posting Date", "Transaction Amount", "Description"], {
    bank: true, credit: true,
    columns: { time: ["Transaction Date"], postingDate: ["Posting Date"], account: ["Card #"], amount: ["Transaction Amount"], description: ["Description"], currency: ["Currency", "币种", "货币"] },
  }),
  profile("td-debit", "td", "TD 道明银行", ["Date", "Transaction Description", "Withdrawals", "Deposits", "Balance"], {
    bank: true, dateOrder: "mdy",
    columns: { time: ["Date"], description: ["Transaction Description"], expense: ["Withdrawals"], income: ["Deposits"], balance: ["Balance"], currency: ["Currency", "币种", "货币"] },
  }),
  profile("jd", "jd", "京东金融", ["交易时间", "交易说明", "交易分类", "交易状态", "金额"], {
    trailingEmpty: true,
  }),
  profile("jd-cents", "jd", "京东金融", ["交易时间", "交易说明", "交易分类", "交易状态", "金额"], {
    manualOnly: true,
    amountDivisor: 100,
    trailingEmpty: true,
  }),
  profile("mt", "mt", "美团", ["交易创建时间", "交易类型", "收/支"], {
    columns: {
      time: ["交易创建时间"],
      description: ["订单标题", "交易说明"],
      amount: ["实付金额", "金额", "金额(元)", "金额（元）"],
      method: ["支付方式", "收/付款方式"],
      recordId: ["交易订单号", "订单号", "交易单号"],
    },
  }),
  profile("feidee", "feidee", "随手记", ["交易类型", "日期", "账户", "金额"], {
    columns: { direction: ["交易类型"], time: ["日期"] },
  }),
  profile("feidee-cloud", "feidee", "随手记", ["交易类型", "日期", "账户1", "账户2", "金额"], {
    columns: {
      direction: ["交易类型"],
      time: ["日期"],
      method: ["账户1"],
      category: ["分类"],
      peerAccount: ["账户2"],
    },
  }),
  profile("feidee-web-expense", "feidee", "随手记", ["交易类型", "日期", "支出账户", "金额"], {
    columns: { direction: ["交易类型"], method: ["支出账户"], category: ["一级分类"] },
  }),
  profile("feidee-web-income", "feidee", "随手记", ["交易类型", "日期", "收入账户", "金额"], {
    columns: { direction: ["交易类型"], method: ["收入账户"], category: ["一级分类"] },
  }),
  profile(
    "feidee-web-transfer",
    "feidee",
    "随手记",
    ["交易类型", "日期", "转出账户", "转入账户", "金额"],
    { columns: { direction: ["交易类型"], method: ["转出账户"], peerAccount: ["转入账户"] } },
  ),
];

export function matchesProfile(
  p: Profile,
  headers: readonly string[],
  records?: CsvRecord[],
): boolean {
  const normalized = headers.map((value) => value.normalize("NFKC").trim());
  if (p.id === "boc-debit-pdf" && normalized.includes("借记卡号")) return false;
  return (
    p.required.every((name) => normalized.includes(name.normalize("NFKC"))) &&
    (!p.signature || !records || records.some(({ cells }) => p.signature!.test(cells.join(" "))))
  );
}

export function statementDate(
  value: string,
  clock: string,
  title: string,
): { date: string; precision: "date" | "datetime" } {
  let text = value.trim().replace(/T/, " ");
  if (/^\d{8}$/.test(text)) text = text.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
  if (/^\d{1,2}\/\d{1,2}$/.test(text)) {
    const bill = /((?:19|20)\d{2})年(\d{1,2})月/.exec(title);
    if (!bill) throw new Error("缺少账单年月，无法确定交易年份。");
    text = `${Number(bill[1]) - (Number(text.split("/")[0]) > Number(bill[2]) ? 1 : 0)}/${text}`;
  }
  const dateOnly = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}$/.test(text);
  if (dateOnly)
    text += ` ${clock ? clock.replace(/^(\d{2})(\d{2})(\d{2})$/, "$1:$2:$3") : "12:00:00"}`;
  return { date: parseShanghaiDate(text), precision: dateOnly && !clock ? "date" : "datetime" };
}

function currency(value: string): string {
  const code = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    人民币: "CNY",
    RMB: "CNY",
    美元: "USD",
    港币: "HKD",
    港元: "HKD",
    日元: "JPY",
    欧元: "EUR",
  };
  const found = Object.entries(aliases).find(([name]) => code.startsWith(name));
  if (found) return found[1];
  const match = /^(CNY|USD|HKD|JPY|EUR|GBP|AUD|CAD|SGD|CHF)(?:\b|(?=[\d+-]))/.exec(code);
  if (!match) throw new Error("无法识别账单币种，请核实原文件。");
  return match[1];
}

export function parseProfile(p: Profile, records: CsvRecord[], fileName: string, selectedCurrency?: string): StatementRow[] {
  const headerIndex = records.findIndex(({ cells }) => matchesProfile(p, cells, records));
  if (headerIndex < 0) throw new Error("缺少账单必需列。");
  const headers = records[headerIndex].cells.map((cell) => cell.normalize("NFKC").trim());
  if (p.trailingEmpty) while (headers.length && !headers.at(-1)) headers.pop();
  const nonEmpty = headers.filter(Boolean);
  if (new Set(nonEmpty).size !== nonEmpty.length) throw new Error("账单包含重复列名。");
  const title = records
    .slice(0, headerIndex)
    .map(({ cells }) => cells.join(" "))
    .join("\n");
  const headerAccount =
    /(?:账户账号|账户号码|账号|卡号|支付宝账户|微信昵称)[：:\s]+([\w@.*＊•·-]+)/.exec(title)?.[1] ?? "";
  const headerCurrency = /(?:卡内账户|币种|币别)[：:\s]*([^\n]+)/.exec(title)?.[1] ?? "";
  const rows: StatementRow[] = [];
  for (const record of records.slice(headerIndex + 1)) {
    let cells = record.cells;
    if (
      /^(?:[-—]{3,}|合计|人民币合计|说明[：:]|以上数据仅供参考|具体内容请以柜台为准|共\s*\d+\s*笔)/.test(
        cells[0].trim(),
      )
    )
      break;
    if (matchesProfile(p, cells)) continue;
    if (
      p.trailingEmpty &&
      cells.length > headers.length &&
      cells.slice(headers.length).every((cell) => !cell.trim())
    )
      cells = cells.slice(0, headers.length);
    const get = (field: Field) => {
      const index = (p.columns[field] ?? [])
        .map((name) => headers.indexOf(name.normalize("NFKC")))
        .find((index) => index >= 0);
      const value = index === undefined ? "" : (cells[index] ?? "").trim();
      return value === "/" && field !== "direction" ? "" : value;
    };
    const account = (get("account") || headerAccount || (p.credit ? get("method") : "")).normalize("NFKC").replace(/^'+|'+$/g, "");
    const source: StatementSource = {
      system: p.channel,
      variantId:
        p.id === "icbc"
          ? headers.includes("记账日期")
            ? "icbc-credit"
            : headers.includes("交易详情")
              ? "icbc-debit-v2"
              : "icbc-debit-v1"
          : p.id,
      recordId: get("recordId"),
      merchantOrderId: get("merchantOrderId"),
      accountHint: account,
      sourceAccount: account,
      fileName,
      lineNumber: record.lineNumber,
      pageNumber: record.pageNumber,
      pageLineNumber: record.pageLineNumber,
      originalTime: get("time") || get("postingDate"),
      date: "",
      amount: get("amount"),
      currency: "CNY",
      paymentMethod: get("method") || (p.bank ? p.name : ""),
      status: get("status"),
      direction: get("direction"),
      category: get("category"),
      merchant: get("merchant"),
      description: get("description") || (p.channel === "feidee" ? get("remark") : ""),
      remark: get("remark"),
      balance: get("balance"),
      peerAccount: get("peerAccount"),
      txType: get("txType"),
      relatedId: get("relatedId"),
      transactionAmount: get("transactionAmount"),
      transactionCurrency: get("transactionCurrency"),
    };
    const errors: string[] = record.error ? [record.error] : [];
    const reviews: string[] = [];
    let kind: EntryKind | undefined;
    let transfer = false;
    let softSkip = false;
    if (cells.length !== headers.length) errors.push("列数与表头不一致。");
    try {
      const raw = get("amount");
      const income = get("income"),
        expense = get("expense");
      let signed = "0.00";
      if (
        (p.columns.income ?? []).some((name) => headers.includes(name.normalize("NFKC"))) ||
        (p.columns.expense ?? []).some((name) => headers.includes(name.normalize("NFKC")))
      ) {
        if (p.amountMode === "expenseFirst")
          signed = expense ? negate(cleanAmount(expense)) : cleanAmount(income);
        else if (p.amountMode === "incomeFirst")
          signed =
            income && compare(cleanAmount(income), "0") !== 0
              ? cleanAmount(income)
              : negate(cleanAmount(expense || "0"));
        else signed = add(cleanAmount(income || "0"), negate(cleanAmount(expense || "0")));
      } else {
        if (p.explicitSign && !/^[+-]/.test(raw)) throw new Error("农业银行金额缺少显式正负号。");
        signed = cleanAmount(raw);
        if (p.amountDivisor === 100) signed = fromMinorUnits(signed);
        if (p.credit && !p.creditSigned) signed = negate(signed);
      }
      source.amount = absolute(signed);
      source.signedAmount = signed;
      kind = compare(signed, "0") < 0 ? "expense" : "income";
      if (!p.bank && source.direction === "支出") kind = "expense";
      else if (!p.bank && source.direction === "收入") kind = "income";
      else if (!p.bank && !["余额变更", "负债变更"].includes(source.direction)) {
        kind = undefined;
        softSkip = true;
      }
      if (source.direction === "负债变更") kind = compare(signed, "0") < 0 ? "income" : "expense";
      if (p.id === "bocom-debit") {
        if (source.direction.includes("贷") && !source.direction.includes("借")) kind = "income";
        else if (source.direction.includes("借") && !source.direction.includes("贷"))
          kind = "expense";
        else {
          kind = undefined;
          reviews.push("未知借贷标志");
        }
      }
      if (p.id === "bmo-debit") {
        if (source.direction === "DEBIT") kind = "expense";
        else if (source.direction === "CREDIT") kind = "income";
        else reviews.push("未知借贷标志");
      }
      const type = (source.txType || source.description).replace(/^[（(]([^）)]+)[）)]/, "$1 ");
      if (p.id === "bocom-credit") {
        if (/^(退货|信用卡还款|红包还款|刷卡金返还|自动购汇还款)/.test(type)) kind = "income";
        else if (/^(消费|刷卡金扣回|分期扣款|自动购汇扣款)/.test(type)) kind = "expense";
        else {
          kind = undefined;
          reviews.push("未知信用卡交易类型");
        }
      }
      if (
        ["退款成功", "已退款", "已全额退款"].includes(source.status) ||
        /^(退款|退货)/.test(type)
      ) {
        if (kind === "income") kind = "refund";
        else reviews.push("退款方向与资金方向需要确认");
      }
      if (
        p.channel === "wechat" &&
        kind !== "refund" &&
        !/^(商户消费|微信红包|转账|二维码收款|扫二维码付款|群收款|退款|转入零钱通|零钱充值|零钱提现|信用卡还款|购买理财通|零钱通转出|亲属卡交易|赞赏码|其他|分分捐)/.test(
          source.txType ?? "",
        )
      )
        reviews.push("未知微信交易类型");
      transfer =
        /^(转入|转出|转账|借入|借出|收债|还债|代付|报销)$/.test(source.direction) ||
        (p.bank && p.id !== "cmb-debit" && /转账|汇款/.test(type)) ||
        /零钱充值|零钱提现|信用卡还款|购汇|结汇|充值|提现|还款|转入零钱通|零钱通转出/.test(type);
      if (source.system === "feidee" && source.direction === "退款") kind = "refund";
      if (transfer) {
        kind = /转入|充值|借入|收债|报销/.test(source.direction || type)
          ? "transferIn"
          : /转出|提现|还款|借出|还债/.test(source.direction || type)
            ? "transferOut"
            : kind === "income"
              ? "transferIn"
              : "transferOut";
        softSkip = true;
        reviews.push("请确认实际转入／转出账户与金额");
      }
      if (source.amount === "0.00") reviews.push("零金额记录不提交");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "金额错误");
    }
    try {
      let parsed;
      try {
        let time = get("time");
        if (p.dateOrder) time = time.replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, (_, a, b, year) => `${year}-${p.dateOrder === "dmy" ? b : a}-${p.dateOrder === "dmy" ? a : b}`);
        if (p.id === "cmbc-credit" && /^\d{4}$/.test(time) && /^\d{8}$/.test(get("postingDate"))) {
          const posting = get("postingDate");
          const year = Number(posting.slice(0, 4)) - (Number(time.slice(0, 2)) > Number(posting.slice(4, 6)) ? 1 : 0);
          time = `${year}${time}`;
        }
        parsed = statementDate(time, get("clock"), title);
      } catch (error) {
        if (!get("postingDate") || (get("time") && p.channel !== "cib")) throw error;
        parsed = statementDate(get("postingDate"), "", title);
      }
      source.date = parsed.date;
      source.datePrecision = parsed.precision;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "日期错误");
    }
    try {
      const statementCurrency =
        p.channel === "cib"
          ? (/人民币|美元|港币|港元|日元|欧元|CNY|USD|HKD|JPY|EUR/.exec(headerCurrency)?.[0] ??
            headerCurrency)
          : "";
      const fixedCny =
        !p.bank ||
        ["spdb", "abc"].includes(p.channel) ||
        ["bocom-debit", "cmb-credit", "cmbc-debit", "cmbc-credit"].includes(p.id);
      source.currency = currency(get("currency") || statementCurrency || selectedCurrency || (fixedCny ? "CNY" : ""));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "币种错误");
    }
    try {
      source.balance =
        source.balance && !/^[-—/]+$/.test(source.balance) ? cleanAmount(source.balance) : "";
    } catch {
      errors.push("余额格式不正确，不能用于来源身份。");
    }
    if (source.remark.includes("服务费")) {
      const fee = /服务费[^\d]*([\d,]+(?:\.\d+)?)/.exec(source.remark)?.[1];
      if (fee) source.fee = cleanAmount(fee);
      else reviews.push("无法提取手续费，请核实源文件");
      softSkip = softSkip || !source.fee || compare(source.fee, "0") > 0;
    }
    if (p.channel === "wechat" && kind === "income" && source.direction === "收入" && !source.paymentMethod)
      source.paymentMethod = "微信零钱";
    if (p.id === "hsbchk-credit" && source.status !== "POSTED") reviews.push("尚未入账的信用卡交易，请核对");
    if (
      !p.bank &&
      source.status &&
      ![
        "交易成功",
        "支付成功",
        "已收钱",
        "已支付",
        "已存入零钱",
        "已退款",
        "已全额退款",
        "退款成功",
        "已到账",
        "还款成功",
      ].includes(source.status)
    )
      reviews.push("交易状态需要确认");
    if (p.bank && !source.direction && kind)
      source.direction =
        kind === "income" || kind === "refund" || kind === "transferIn" ? "收入" : "支出";
    const investment = /购买理财通|基金申购|基金赎回|(?:^|\s)(?:申购|赎回)(?:$|\s)|理财(?:购买|申购|赎回)|证券买入|证券卖出|基金销售|理财有限责任公司/.test(
      `${source.txType || source.description} ${source.merchant}`,
    );
    const unsupportedReason = source.remark.includes("服务费") && !source.fee
      ? "无法确认手续费金额，请核实原文件后重新导入"
      : investment ? "请返回上传步骤，勾选‘识别投资交易流水’后重新读取文件。" : undefined;
    if (investment) softSkip = true;
    const excluded = ["交易关闭", "已关闭", "已撤销"].includes(source.status);
    const identityReason = p.bank && !account ? "缺少来源账户标识，请在上传页补全" : undefined;
    rows.push({
      source,
      kind,
      transfer,
      excluded,
      defaultExcluded: softSkip,
      skipReason: unsupportedReason ?? (transfer
        ? "转账默认跳过，请确认后恢复"
        : source.fee
          ? "手续费需确认后拆分"
          : "不计收支，默认跳过"),
      reviewReason: reviews.length ? reviews.join("；") : undefined,
      error: errors.length ? errors.join("；") : undefined,
      identityReason,
      unsupportedReason,
      parseStatus: excluded ? "hardSkip" : errors.length ? "fatal" : softSkip ? "softSkip" : "ok",
    });
  }
  return rows;
}

const variantLabels: Record<string, string> = {
  "cmbc-debit": "借记卡 PDF 对账单",
  "cmbc-credit": "信用卡 CSV 对账单",
  "icbc-debit-pdf": "借记账户历史明细 PDF",
  "boc-debit-pdf": "借记卡流水明细 PDF",
  "hsbchk-debit": "借记卡 CSV",
  "hsbchk-credit": "信用卡 CSV",
  "bmo-debit": "借记卡 CSV",
  "bmo-credit": "信用卡 CSV",
  jd: "账单金额以元计（默认）",
  "jd-cents": "整数金额以分计（需明确选择）",
  "cmb-debit": "借记卡交易明细",
  "cmb-credit": "信用卡对账单",
  "spdb-debit": "借记流水（交易流水号／支出金额）",
  "spdb-export": "借记明细（顺序号／取出金额）",
  "citic-credit": "信用卡（记账金额）",
  "citic-settlement": "信用卡（结算金额）",
  "boc-debit": "借记卡交易明细",
  "boc-credit": "信用卡对账单",
  "bocom-debit": "借记卡交易明细",
  "bocom-credit": "信用卡对账单",
  feidee: "App 导出（账户）",
  "feidee-cloud": "网页旧版／随手云（账户1、账户2）",
  "feidee-web-expense": "网页支出工作表",
  "feidee-web-income": "网页收入工作表",
  "feidee-web-transfer": "网页转账工作表",
};

export const channelParsers: StatementParser[] = [...new Set(profiles.map((p) => p.channel))].map(
  (channel) => {
    const variants = profiles.filter((p) => p.channel === channel);
    const name = variants[0].name;
    return {
      variants: variants.map((variant) => ({
        id: variant.id,
        label: variantLabels[variant.id] ?? `${variant.name}账单`,
      })),
      id: channel,
      displayName: name,
      formats: ["csv", "xls", "xlsx", ...(["cmb", "cmbc", "icbc", "boc", "webank"].includes(channel) ? ["pdf"] : [])],
      uploadLabel: `上传${name}账单`,
      fileHint: `${name} · CSV / XLS / XLSX${["cmb", "cmbc", "icbc", "boc", "webank"].includes(channel) ? " / PDF" : ""}`,
      recordIdLabel: "来源编号",
      fieldMappingHint:
        "账单日期 → 日期；金额及渠道方向 → 记账性质；来源账户／付款方式 → 实际资金账户；来源编号用于去重。",
      mappingHint: (count) =>
        `已读取 ${count} 条明细。请选择实际资金账户；转账和手续费需明确确认，不会自动补建对手流水。`,
      previewColumns: [
        "originalTime",
        "merchant",
        "description",
        "direction",
        "amount",
        "currency",
        "paymentMethod",
        "recordId",
      ].map((field, index) => ({
        field: field as keyof StatementSource,
        label: ["交易时间", "交易对方", "交易说明", "方向", "金额", "币种", "付款方式", "来源编号"][
          index
        ],
      })),
      matches: (headers) => variants.some((p) => matchesProfile(p, headers)),
      parse: (records, fileName, variantId, selectedCurrency) => {
        const matches = variants.filter(
          (p) =>
            (variantId ? p.id === variantId : !p.manualOnly) &&
            records.some(({ cells }) => matchesProfile(p, cells, records)),
        );
        if (matches.length !== 1) throw new Error("导出变体不明确，请核对文件签名及必需列。");
        return parseProfile(matches[0], records, fileName, selectedCurrency);
      },
    };
  },
);

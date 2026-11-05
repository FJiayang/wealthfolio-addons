const banks: Record<string, string[]> = {
  工商银行: ["中国工商银行", "工行"],
  农业银行: ["中国农业银行", "农行"],
  中国银行: ["中行"],
  建设银行: ["中国建设银行", "建行"],
  交通银行: ["交行"],
  邮储银行: ["中国邮政储蓄银行", "邮政储蓄银行", "邮储"],
  招商银行: ["招行"],
  中信银行: ["中信"],
  光大银行: ["中国光大银行", "光大"],
  华夏银行: ["华夏"],
  民生银行: ["中国民生银行", "民生"],
  广发银行: ["广发"],
  平安银行: ["平安"],
  兴业银行: ["兴业"],
  浦发银行: ["上海浦东发展银行", "浦东发展银行", "浦发"],
  浙商银行: ["浙商"],
  渤海银行: ["渤海"],
  恒丰银行: ["恒丰"],
  微众银行: ["深圳前海微众银行", "微众"],
  汇丰香港: ["汇丰银行香港", "香港汇丰银行", "香港上海汇丰银行", "hsbchk", "hsbc"],
  蒙特利尔银行: ["bmo蒙特利尔银行", "bmo"],
  道明银行: ["td道明银行", "td"],
};

export const bankAliases = Object.entries(banks)
  .flatMap(([name, aliases]) => [name, ...aliases].map((alias) => ({ name, alias })))
  .sort((a, b) => b.alias.length - a.alias.length);

export function normalizeBankName(value: string): string {
  for (const { name, alias } of bankAliases) {
    if (!value.startsWith(alias)) continue;
    const rest = value.slice(alias.length);
    if (alias.length === 2 && rest && !/^(信用卡|贷记卡|储蓄卡|借记卡|银行卡)/.test(rest)) continue;
    return name + rest;
  }
  return value;
}

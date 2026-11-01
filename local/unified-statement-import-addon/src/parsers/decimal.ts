// Money never passes through floating point arithmetic.
export function decimal(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("金额不是有效十进制数字。");
  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1] === "-" && /[1-9]/.test(integer + fraction) ? "-" : ""}${integer}.${fraction}`;
}

export function add(left: string, right: string): string {
  const a = decimal(left),
    b = decimal(right);
  const scale = Math.max(a.split(".")[1].length, b.split(".")[1].length);
  const units = (value: string) => {
    const [integer, fraction] = value.split(".");
    return BigInt(integer + fraction.padEnd(scale, "0"));
  };
  const total = units(a) + units(b);
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0");
  return decimal(`${total < 0n ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`);
}

export const negate = (value: string) =>
  decimal(value).startsWith("-") ? decimal(value).slice(1) : `-${decimal(value)}`;
export const absolute = (value: string) => decimal(value).replace(/^-/, "");
export function fromMinorUnits(value: string): string {
  const match = /^(-?)(\d+)\.00$/.exec(decimal(value));
  if (!match) throw new Error("分单位金额必须是整数，请核对所选导出变体。");
  const digits = match[2].padStart(3, "0");
  return decimal(`${match[1]}${digits.slice(0, -2)}.${digits.slice(-2)}`);
}
export function compare(left: string, right: string): number {
  const difference = add(left, negate(right));
  return /^0\.0+$/.test(difference) ? 0 : difference.startsWith("-") ? -1 : 1;
}

export function cleanAmount(value: string): string {
  return decimal(
    value
      .normalize("NFKC")
      .replace(/\((?:已.*?退款.*?)\)/g, "")
      .replace(/(?:CNY|RMB|USD|HKD|JPY|EUR|人民币|美元|港币|日元|欧元|元|[¥￥$€])/gi, "")
      .replace(/[,\s]/g, ""),
  );
}

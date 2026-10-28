import type { Account } from "@wealthfolio/addon-sdk";

export type Mappings = Record<string, string>;
export interface AccountCandidate {
  accountId: string;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

export function normalizeInstrument(value: string): { base: string; suffix?: string } {
  const normalized = value.normalize("NFKC").toLowerCase().trim();
  const tail = normalized.match(
    /(?:\(\s*[*x•·]*\s*(\d{4})\s*\)|(?:^|\s|[*x•·]+|尾号[:：]?)(\d{4}))\s*$/,
  );
  const number = /^\d{4,}$/.test(normalized) ? normalized : undefined;
  const suffix = number?.slice(-4) ?? tail?.[1] ?? tail?.[2];
  const name = number ? "" : tail ? normalized.slice(0, tail.index) : normalized;
  return { base: name.replace(/[\s\p{P}\p{S}]/gu, ""), suffix };
}

const genericNames = new Set(["信用卡", "贷记卡", "储蓄卡", "借记卡", "银行卡", "余额", "账户余额", "零钱"]);

export function inferAccount(paymentMethod: string, accounts: Account[]): {
  candidates: AccountCandidate[];
  accountId?: string;
} {
  const method = normalizeInstrument(paymentMethod);
  const candidates: AccountCandidate[] = [];
  for (const account of accounts) {
    const name = normalizeInstrument(account.name);
    const number = normalizeInstrument(account.accountNumber ?? "");
    const conflictingIdentity = Boolean(name.suffix && number.suffix && name.suffix !== number.suffix);
    const suffix = number.suffix ?? name.suffix;
    if (method.suffix && suffix && method.suffix !== suffix) continue;
    const sameSuffix = Boolean(method.suffix && method.suffix === suffix);
    const sameName = Boolean(method.base && name.base && method.base === name.base);
    const accountPrefix = Boolean(method.base && name.base && method.base.startsWith(name.base));
    const methodPrefix = Boolean(method.base && name.base && name.base.startsWith(method.base));
    const contains = Boolean(
      method.base && name.base &&
      (method.base.includes(name.base) || name.base.includes(method.base)),
    );
    if (!contains) continue;
    let score = 0;
    const reasons: string[] = [];
    if (sameSuffix) {
      score += 100;
      reasons.push("卡尾号一致");
    }
    if (sameName) {
      score += 80;
      reasons.push("账户名称完全一致");
    } else if (accountPrefix) {
      score += 40 + Math.min(name.base.length, 20);
      reasons.push("账户名是付款方式前缀");
    } else if (methodPrefix) {
      score += 20 + Math.min(method.base.length, 10);
      reasons.push("付款方式是账户名前缀");
    } else if (contains) {
      score += 10;
      reasons.push("名称部分匹配");
    }
    if (conflictingIdentity) reasons.push("账户名与账号尾号不一致");
    const specificName = !genericNames.has(name.base);
    const high = !conflictingIdentity && (
      sameSuffix || (sameName && specificName) ||
      (accountPrefix && specificName && name.base.length >= 4)
    );
    candidates.push({
      accountId: account.id,
      score,
      confidence: high ? "high" : contains ? "medium" : "low",
      reasons,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.accountId.localeCompare(b.accountId));
  const high = candidates.filter((candidate) => candidate.confidence === "high");
  return { candidates, accountId: high.length === 1 ? high[0].accountId : undefined };
}

export function resolveAccount(paymentMethod: string, accounts: Account[], mappings: Mappings) {
  const inference = inferAccount(paymentMethod, accounts);
  const mapped = Object.hasOwn(mappings, paymentMethod);
  const accountId = mapped ? mappings[paymentMethod] : inference.accountId ?? "";
  const available = accounts.some((account) => account.id === accountId);
  return {
    candidates: inference.candidates,
    accountId: available ? accountId : "",
    origin: available ? mapped ? "saved" : "inferred" : "pending",
  } as const;
}

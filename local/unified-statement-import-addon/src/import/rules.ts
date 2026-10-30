import type { StatementSource } from "../parsers/types";
import { compare } from "../parsers/decimal";
import { normalizeInstrument } from "./account-matching";

export const RULES_KEY = "statement-rules-v1";
export interface ImportRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  channel?: string;
  sourceAccount?: string;
  matchMode: "all" | "any";
  conditions: {
    field: "paymentMethod" | "merchant" | "description" | "category" | "txType" | "status";
    operator: "contains" | "equals";
    value: string;
  }[];
  minAmount?: string;
  maxAmount?: string;
  timeRange?: string;
  direction?: string;
  accountId?: string;
  ignore: boolean;
}

export function validateRules(value: unknown): asserts value is ImportRule[] {
  if (!Array.isArray(value)) throw new Error("规则配置必须是列表。");
  const ids = new Set<string>();
  for (const rule of value) {
    if (
      !rule ||
      typeof rule !== "object" ||
      typeof rule.id !== "string" ||
      !rule.id ||
      ids.has(rule.id) ||
      typeof rule.name !== "string" ||
      typeof rule.enabled !== "boolean" ||
      typeof rule.ignore !== "boolean" ||
      !Number.isFinite(rule.priority) ||
      !["all", "any"].includes(rule.matchMode) ||
      !Array.isArray(rule.conditions)
    )
      throw new Error("规则配置格式不正确。");
    ids.add(rule.id);
    for (const field of [
      "channel",
      "sourceAccount",
      "direction",
      "accountId",
      "minAmount",
      "maxAmount",
      "timeRange",
    ])
      if (rule[field] !== undefined && typeof rule[field] !== "string")
        throw new Error("规则字段格式不正确。");
    for (const condition of rule.conditions)
      if (
        !condition ||
        !["paymentMethod", "merchant", "description", "category", "txType", "status"].includes(
          condition.field,
        ) ||
        !["contains", "equals"].includes(condition.operator) ||
        typeof condition.value !== "string" ||
        !condition.value.trim()
      )
        throw new Error("规则匹配条件不完整。");
    if (!rule.ignore && !rule.accountId) throw new Error("规则必须指定账户或选择忽略。");
    if (rule.minAmount) compare(rule.minAmount, "0");
    if (rule.maxAmount) compare(rule.maxAmount, "0");
    if (rule.minAmount && rule.maxAmount && compare(rule.minAmount, rule.maxAmount) > 0)
      throw new Error("金额下限不能大于上限。");
    if (
      rule.timeRange &&
      !/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/.test(rule.timeRange)
    )
      throw new Error("时间段应为 HH:mm-HH:mm。");
  }
}

export function restoreRules(value: string | null): ImportRule[] {
  const rules: unknown = value ? JSON.parse(value) : [];
  validateRules(rules);
  return rules;
}

export function ruleMatches(rule: ImportRule, source: StatementSource): boolean {
  if (
    !rule.enabled ||
    (rule.channel && rule.channel !== source.system) ||
    (rule.sourceAccount && rule.sourceAccount !== (source.sourceAccount || source.accountHint)) ||
    (rule.direction && rule.direction !== source.direction)
  )
    return false;
  if (
    (rule.minAmount && compare(source.amount, rule.minAmount) < 0) ||
    (rule.maxAmount && compare(source.amount, rule.maxAmount) > 0)
  )
    return false;
  if (rule.timeRange) {
    if (!source.date) return false;
    const local = new Date(new Date(source.date).getTime() + 8 * 3600000)
      .toISOString()
      .slice(11, 16);
    const [start, end] = rule.timeRange.split("-");
    if (start <= end ? local < start || local > end : local < start && local > end) return false;
  }
  const results = rule.conditions.map(({ field, operator, value }) => {
    const normalize = (text: string) => {
      const instrument = normalizeInstrument(text);
      return field === "paymentMethod"
        ? instrument.base + (instrument.suffix ?? "")
        : text.normalize("NFKC").trim();
    };
    const actual = normalize(source[field] ?? "");
    return value
      .split(",")
      .filter((word) => word.trim())
      .map((word) => normalize(word))
      .some((word) => (operator === "equals" ? actual === word : actual.includes(word)));
  });
  return rule.matchMode === "all" ? results.every(Boolean) : results.some(Boolean);
}

export function applyRules(source: StatementSource, rules: ImportRule[]) {
  let accountId: string | undefined;
  const matched: string[] = [];
  for (const rule of rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.priority - b.rule.priority || a.index - b.index)
    .map(({ rule }) => rule)) {
    if (!ruleMatches(rule, source)) continue;
    matched.push(rule.name);
    if (rule.ignore) return { accountId, ignored: true, matched };
    if (rule.accountId) accountId = rule.accountId;
  }
  return { accountId, ignored: false, matched };
}

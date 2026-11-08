import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, AlertFeedback, Button, Checkbox, Input } from "@wealthfolio/ui";
import type { ImportRule } from "../import/rules";
import { applyRules, validateRules } from "../import/rules";
import type { StatementRow } from "../parsers/types";
import { statementParsers } from "../parsers";
import { ImportSelect } from "./import-select";

export function RulesEditor({
  rules,
  rows,
  accounts,
  onSave,
  disabled,
}: {
  rules: ImportRule[];
  rows: StatementRow[];
  accounts: { value: string; label: string }[];
  onSave(rules: ImportRule[]): Promise<void>;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState<ImportRule[] | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const list = draft ?? rules;
  const patch = (id: string, change: Partial<ImportRule>) =>
    setDraft(list.map((rule) => (rule.id === id ? { ...rule, ...change } : rule)));
  async function save() {
    setError("");
    setSaving(true);
    try {
      validateRules(list);
      await onSave(list);
      setDraft(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "规则保存失败");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Accordion keepMounted className="rounded-lg border">
      <AccordionItem value="rules" className="border-0">
      <AccordionTrigger className="px-3 py-3 hover:no-underline">账户映射与忽略规则</AccordionTrigger>
      <AccordionContent className="space-y-3 px-3 pb-3">
      <p className="text-muted-foreground text-sm">
        逐行决定和保存映射优先；高优先级覆盖低优先级，同级后者覆盖。忽略命中后默认跳过，可手动恢复。时间段按上海时区。
      </p>
      {error && (
        <AlertFeedback variant="error" title="规则未保存" role="alert">
          {error}
        </AlertFeedback>
      )}
      {list.map((rule) => (
        <fieldset
          key={rule.id}
          disabled={disabled || saving}
          className="space-y-3 rounded-lg border p-3"
        >
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={rule.enabled}
                onCheckedChange={(value) => patch(rule.id, { enabled: value === true })}
              />
              启用
            </label>
            <Input
              aria-label="规则名称"
              value={rule.name}
              onChange={(event) => patch(rule.id, { name: event.target.value })}
              className="w-48"
            />
            <label>
              优先级
              <Input
                aria-label="规则优先级"
                type="number"
                value={rule.priority}
                onChange={(event) => patch(rule.id, { priority: Number(event.target.value) })}
                className="w-24"
              />
            </label>
            <Button
              variant="outline"
              onClick={() => setDraft(list.filter((item) => item.id !== rule.id))}
            >
              删除规则
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImportSelect
              label="规则渠道"
              value={rule.channel ?? ""}
              options={statementParsers.map((parser) => ({
                value: parser.id,
                label: parser.displayName,
              }))}
              onChange={(channel) => patch(rule.id, { channel })}
            />
            <Input
              aria-label="规则来源账户"
              placeholder="来源账户（空表示不限）"
              value={rule.sourceAccount ?? ""}
              onChange={(event) => patch(rule.id, { sourceAccount: event.target.value })}
            />
            <ImportSelect
              label="条件匹配方式"
              value={rule.matchMode}
              options={[
                { value: "all", label: "全部条件" },
                { value: "any", label: "任一条件" },
              ]}
              onChange={(value) => patch(rule.id, { matchMode: value as "all" | "any" })}
            />
            <Input
              aria-label="规则原始方向"
              placeholder="原始方向（如 支出；空表示不限）"
              value={rule.direction ?? ""}
              onChange={(event) => patch(rule.id, { direction: event.target.value })}
            />
          </div>
          {rule.conditions.map((condition, index) => {
            const change = (value: Partial<typeof condition>) =>
              patch(rule.id, {
                conditions: rule.conditions.map((item, i) =>
                  i === index ? { ...item, ...value } : item,
                ),
              });
            return (
              <div key={index} className="grid gap-2 sm:grid-cols-4">
                <ImportSelect
                  label="匹配字段"
                  value={condition.field}
                  options={[
                    ["paymentMethod", "付款方式"],
                    ["merchant", "交易对方"],
                    ["description", "说明"],
                    ["category", "分类"],
                    ["txType", "交易类型"],
                    ["status", "状态"],
                  ].map(([value, label]) => ({ value, label }))}
                  onChange={(field) => change({ field: field as typeof condition.field })}
                />
                <ImportSelect
                  label="匹配操作"
                  value={condition.operator}
                  options={[
                    { value: "contains", label: "包含" },
                    { value: "equals", label: "等于" },
                  ]}
                  onChange={(value) => change({ operator: value as "contains" | "equals" })}
                />
                <Input
                  aria-label="匹配关键词"
                  value={condition.value}
                  onChange={(event) => change({ value: event.target.value })}
                  placeholder="逗号分隔多个关键词"
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    patch(rule.id, { conditions: rule.conditions.filter((_, i) => i !== index) })
                  }
                >
                  删除条件
                </Button>
              </div>
            );
          })}
          <Button
            variant="outline"
            onClick={() =>
              patch(rule.id, {
                conditions: [
                  ...rule.conditions,
                  { field: "merchant", operator: "contains", value: "" },
                ],
              })
            }
          >
            添加条件
          </Button>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["minAmount", "maxAmount", "timeRange"] as const).map((field, index) => (
              <Input
                key={field}
                aria-label={["金额下限", "金额上限", "时间段"][index]}
                placeholder={["金额下限", "金额上限", "11:00-14:00"][index]}
                value={rule[field] ?? ""}
                onChange={(event) => patch(rule.id, { [field]: event.target.value })}
              />
            ))}
          </div>
          <ImportSelect
            label="规则目标账户"
            value={rule.accountId ?? ""}
            options={accounts}
            onChange={(accountId) => patch(rule.id, { accountId })}
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={rule.ignore}
              onCheckedChange={(value) => patch(rule.id, { ignore: value === true })}
            />
            忽略匹配记录（默认跳过）
          </label>
          <p className="text-muted-foreground text-sm">
            {(() => {
              try {
                validateRules([rule]);
                return `当前文件命中 ${rows.filter((row) => !row.error && applyRules(row.source, [rule]).matched.length).length} 行`;
              } catch {
                return "补全规则后显示命中数量";
              }
            })()}
          </p>
        </fieldset>
      ))}
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={disabled || saving}
          onClick={() =>
            setDraft([
              ...list,
              {
                id: crypto.randomUUID(),
                name: "新规则",
                enabled: false,
                priority: 0,
                matchMode: "all",
                conditions: [],
                ignore: false,
              },
            ])
          }
        >
          添加规则
        </Button>
        <Button disabled={disabled || saving || draft === null} onClick={() => void save()}>
          保存规则并应用
        </Button>
        <Button
          variant="outline"
          disabled={saving || draft === null}
          onClick={() => {
            setDraft(null);
            setError("");
          }}
        >
          放弃规则修改
        </Button>
      </div>
      </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

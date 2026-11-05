import type {
  Account,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
} from "@wealthfolio/addon-sdk";
import type { StatementRow } from "../parsers/types";
import type { ImportRule } from "./rules";
import {
  buildPreview,
  previewSignature,
  type Decisions,
  type ExistingActivity,
  type Mappings,
  type PreviewRow,
} from "./ledger";

export interface ImportHost {
  accounts: { getAll(): Promise<Account[]> };
  activities: {
    getAll(): Promise<ExistingActivity[]>;
    saveMany(request: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult>;
  };
}
export interface Submission {
  updated?: number;
  outcome: "changed" | "empty" | "success" | "partial" | "uncertain";
  preview: PreviewRow[];
  message: string;
  created: number;
  unconfirmed?: number;
}

export function createSubmitter(host: ImportHost) {
  let busy = false;
  return async (
    rows: StatementRow[],
    mappings: Mappings,
    decisions: Decisions,
    reviewed: PreviewRow[],
    rules: ImportRule[] = [],
  ): Promise<Submission> => {
    if (busy) throw new Error("正在提交，请勿重复操作。");
    busy = true;
    try {
      const [accounts, activities] = await Promise.all([
        host.accounts.getAll(),
        host.activities.getAll(),
      ]);
      const preview = buildPreview(rows, accounts, activities, mappings, decisions, rules);
      if (previewSignature(preview) !== previewSignature(reviewed))
        return {
          outcome: "changed",
          preview,
          created: 0,
          message: "已有账目或账户状态发生变化，预览已刷新，请重新确认。",
        };
      const creates = preview.flatMap(
        (entry) => entry.creates ?? (entry.create ? [entry.create] : []),
      );
      const updates = preview.flatMap((entry) => entry.updates ?? []);
      if (preview.some((entry) => entry.status === "error" || entry.status === "review"))
        return {
          outcome: "changed",
          preview,
          created: 0,
          message: "请先处理所有错误和待核对记录，或明确跳过后再提交。",
        };
      if (!creates.length && !updates.length)
        return { outcome: "empty", preview, created: 0, message: "没有可导入的记录。" };
      let response: ActivityBulkMutationResult;
      try {
        response = await host.activities.saveMany({ creates, ...(updates.length ? { updates } : {}) });
      } catch {
        // Never retry a write before recovering its result from persisted source identities.
        const recovered = buildPreview(
          rows,
          accounts,
          await host.activities.getAll(),
          mappings,
          decisions,
          rules,
        );
        return {
          outcome: "uncertain",
          unconfirmed: creates.length + updates.length,
          preview: recovered,
          created: 0,
          message: "提交未收到成功响应，已重新读取来源记录。请核对重复及待导入行，再决定是否重试。",
        };
      }
      const refreshed = buildPreview(
        rows,
        accounts,
        await host.activities.getAll(),
        mappings,
        decisions,
        rules,
      );
      if (response.errors.length || response.created.length !== creates.length || response.updated.length !== updates.length)
        return {
          outcome: "partial",
          preview: refreshed,
          created: response.created.length,
          updated: response.updated.length,
          message: `保存未完整完成：已确认新增 ${response.created.length} 笔，错误 ${response.errors.length} 条。请核对刷新后的预览；已有账目不会被覆盖。`,
        };
      return {
        outcome: "success",
        preview: refreshed,
        created: response.created.length,
        updated: response.updated.length,
        message: `已新增 ${response.created.length} 笔${response.updated.length ? `，更新关联 ${response.updated.length} 笔` : ""}。重复、排除及未确认记录未提交。`,
      };
    } finally {
      busy = false;
    }
  };
}

import type {
  Activity,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
} from "@wealthfolio/addon-sdk";
import { describe, expect, it, vi } from "vitest";
import { parseStatement } from "../parsers";
import { account, activity, csvRow, HEADER } from "../test-fixtures";
import { buildPreview } from "./ledger";
import { createSubmitter } from "./session";

const mapping = { 账户余额: "cash" };
const accounts = [account()];
const rows = parseStatement(
  new TextEncoder().encode(
    [HEADER, csvRow(), csvRow({ id: "pending", direction: "不计收支" })].join("\n"),
  ),
  "fixture.csv",
);

function mockHost() {
  const stored: Activity[] = [];
  const saveMany = vi.fn(
    async ({ creates = [] }: ActivityBulkMutationRequest): Promise<ActivityBulkMutationResult> => {
      const created = creates.map((create, index) =>
        activity(create, `new-${stored.length + index}`),
      );
      stored.push(...created);
      return { created, updated: [], deleted: [], createdMappings: [], errors: [] };
    },
  );
  const host = {
    accounts: { getAll: vi.fn(async () => accounts) },
    activities: { getAll: vi.fn(async () => [...stored]), saveMany },
  };
  return {
    stored,
    host,
    submit: createSubmitter(host),
    reviewed: buildPreview(rows, accounts, [], mapping, {}),
  };
}

describe("SDK 提交", () => {
  it("仅新增就绪行，来源一次写入；再次提交先刷新而不重复写", async () => {
    const { host, submit, reviewed, stored } = mockHost();
    expect((await submit(rows, mapping, {}, reviewed)).created).toBe(1);
    expect(host.activities.saveMany).toHaveBeenCalledTimes(1);
    expect(host.activities.saveMany.mock.calls[0][0]).not.toHaveProperty("updates");
    expect(stored[0].metadata).toHaveProperty("unifiedStatementImport");
    expect((await submit(rows, mapping, {}, reviewed)).message).toContain("重新确认");
    expect(host.activities.saveMany).toHaveBeenCalledTimes(1);
  });
  it("提交前账户变化会刷新预览并停止写入", async () => {
    const { host, submit, reviewed } = mockHost();
    host.accounts.getAll.mockResolvedValue([{ ...account(), isActive: false }]);
    expect((await submit(rows, mapping, {}, reviewed)).preview[0].status).toBe("review");
    expect(host.activities.saveMany).not.toHaveBeenCalled();
  });
  it("重复点击拒绝第二个写入", async () => {
    const { host, submit, reviewed } = mockHost();
    let resolve!: (value: Activity[]) => void;
    host.activities.getAll.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = submit(rows, mapping, {}, reviewed);
    await expect(submit(rows, mapping, {}, reviewed)).rejects.toThrow("重复操作");
    resolve([]);
    await first;
    expect(host.activities.saveMany).toHaveBeenCalledTimes(1);
  });
  it("保存成功但响应丢失时按来源恢复，不盲目重发", async () => {
    const { host, submit, reviewed, stored } = mockHost();
    host.activities.saveMany.mockImplementationOnce(async ({ creates = [] }) => {
      stored.push(activity(creates[0]));
      throw new Error("lost response");
    });
    const result = await submit(rows, mapping, {}, reviewed);
    expect(result.message).toContain("重新读取");
    expect(result.preview[0].status).toBe("duplicate");
    await submit(rows, mapping, {}, result.preview);
    expect(host.activities.saveMany).toHaveBeenCalledTimes(1);
  });
  it("保存失败且无记录时允许核对后重试；核心错误不报成功", async () => {
    const { host, submit, reviewed } = mockHost();
    host.activities.saveMany.mockRejectedValueOnce(new Error("failed"));
    const result = await submit(rows, mapping, {}, reviewed);
    expect(result.preview[0].status).toBe("ready");
    expect((await submit(rows, mapping, {}, result.preview)).created).toBe(1);
    const other = mockHost();
    other.host.activities.saveMany.mockResolvedValue({
      created: [],
      updated: [],
      deleted: [],
      createdMappings: [],
      errors: [{ action: "create", message: "invalid" }],
    });
    expect((await other.submit(rows, mapping, {}, other.reviewed)).message).toContain("未完整完成");
  });
});

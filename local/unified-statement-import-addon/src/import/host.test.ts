import { readFileSync } from "node:fs";
import type {
  Account,
  ActivityBulkMutationRequest,
  ActivityBulkMutationResult,
  ActivityDetails,
} from "@wealthfolio/addon-sdk";
import { expect, it } from "vitest";
import { parseStatementSync as parseStatement } from "../parsers";
import { normalizeAmount } from "../parsers/csv";
import { buildPreview } from "./ledger";
import { createSubmitter } from "./session";

it.skipIf(!process.env.STATEMENT_TEST_ORIGIN)("隔离真实宿主保存来源并检测重复", async () => {
  const origin = new URL(process.env.STATEMENT_TEST_ORIGIN!);
  expect(["127.0.0.1", "localhost"]).toContain(origin.hostname);
  async function request<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(
      new URL(`/api/v1${path}`, origin),
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (!response.ok) throw new Error(`隔离宿主请求失败：${response.status}`);
    return response.json() as Promise<T>;
  }
  const host = {
    accounts: { getAll: () => request<Account[]>("/accounts") },
    activities: {
      getAll: async () =>
        (
          await request<{ data: ActivityDetails[] }>("/activities/search", {
            page: 0,
            pageSize: 1000,
            filters: {},
            searchKeyword: "",
          })
        ).data,
      saveMany: (payload: ActivityBulkMutationRequest) =>
        request<ActivityBulkMutationResult>("/activities/bulk", {
          ...payload,
          creates: payload.creates?.map((create) => ({
            ...create,
            metadata: JSON.stringify(create.metadata),
          })),
        }),
    },
  };
  const accounts = await host.accounts.getAll();
  expect(accounts).toHaveLength(1);
  expect(accounts[0].name).toBe("账单隔离测试账户");
  expect(await host.activities.getAll()).toEqual([]);
  const rows = parseStatement(
    readFileSync(new URL("../fixtures/alipay-synthetic.csv", import.meta.url)),
    "synthetic.csv",
  ).rows;
  const mappings = { 账户余额: accounts[0].id, "": accounts[0].id };
  const decisions = Object.fromEntries(
    buildPreview(rows, accounts, [], mappings, {})
      .filter((entry) => entry.status === "review" || entry.status === "error")
      .map((entry) => [entry.row.source.lineNumber, { excluded: true }]),
  );
  const preview = buildPreview(rows, accounts, [], mappings, decisions);
  expect(preview.filter((entry) => entry.status === "ready")).toHaveLength(3);
  const submit = createSubmitter(host);
  const result = await submit(rows, mappings, decisions, preview);
  expect(result.created).toBe(3);
  const stored = await host.activities.getAll();
  expect(stored).toHaveLength(3);
  expect(stored.every((item) => item.metadata?.unifiedStatementImport)).toBe(true);
  expect(stored.map((item) => normalizeAmount(item.amount!)).sort()).toEqual([
    "12.30",
    "20.00",
    "5.00",
  ]);
  expect(result.preview.filter((entry) => entry.status === "duplicate")).toHaveLength(3);
  expect((await submit(rows, mappings, decisions, result.preview)).created).toBe(0);
  expect(await host.activities.getAll()).toHaveLength(3);
});

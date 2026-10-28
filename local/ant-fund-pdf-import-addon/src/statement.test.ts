import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { HEADER, mergePageTables, parseStatement, PDF_RESOURCES } from "./statement";
import { createDrafts } from "./import-model";

const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
const assets = {
  async getBlob(path: string) {
    return new Blob([
      new Uint8Array(await readFile(join(pdfRoot, path.replace("assets/pdf/", "")))),
    ]);
  },
};

describe("Ant statement extraction", () => {
  it("extracts Chinese cells, leading zeros, long orders and cross-page continuations from a synthetic PDF", async () => {
    const progress: number[] = [];
    const rows = await parseStatement(
      new Uint8Array(await readFile(new URL("./fixtures/statement.pdf", import.meta.url))),
      assets,
      (page) => progress.push(page),
    );
    expect(progress).toEqual([1, 2, 3]);
    expect(rows).toHaveLength(3);
    expect(rows[0].cells[5]).toBe("000032");
    expect(rows[0].cells[0].replace(/\s/g, "")).toBe("20261001000000000000000000000001");
    expect(rows[2].pages).toEqual([2, 3]);
    const drafts = createDrafts(rows);
    expect(drafts[2].legs[0]).toMatchObject({
      activityType: "SELL",
      date: "2026-10-04",
      name: "合成跨页基金C",
    });
    expect(drafts[1].legs[0].amount).toBe("");
    expect(drafts[0].legs[0].quantity).toBe("9537.26");
  });

  it("rejects a changed table schema and orphan continuations instead of dropping rows", () => {
    expect(() => mergePageTables([{ num: 2, tables: [[HEADER.slice(1)]] }])).toThrow("columns");
    expect(() => mergePageTables([{ num: 2, tables: [[HEADER, Array(12).fill("")]] }])).toThrow(
      "continuation",
    );
    expect(() =>
      mergePageTables([
        { num: 2, tables: [[HEADER.map((cell, i) => (i === 8 ? "other" : cell))]] },
      ]),
    ).toThrow("columns");
  });

  it("fails when a local CMap is unavailable and supports cancellation", async () => {
    const data = new Uint8Array(
      await readFile(new URL("./fixtures/statement.pdf", import.meta.url)),
    );
    await expect(
      parseStatement(
        data,
        {
          async getBlob() {
            throw new Error("missing");
          },
        },
        () => {},
      ),
    ).rejects.toThrow("resource");
    const controller = new AbortController();
    controller.abort();
    await expect(parseStatement(data, assets, () => {}, controller.signal)).rejects.toThrow();
    expect(PDF_RESOURCES).toHaveLength(3);
  });

  it.runIf(!!process.env.ANT_FUND_SAMPLE)(
    "locally verifies the customer sample without logging or committing its contents",
    async () => {
      const rows = await parseStatement(
        new Uint8Array(await readFile(process.env.ANT_FUND_SAMPLE!)),
        assets,
        () => {},
      );
      expect(rows).toHaveLength(457);
      expect(rows.filter((row) => row.pages.length > 1)).toHaveLength(21);
      const counts: Record<string, number> = {};
      for (const row of rows) {
        const type = row.cells[2].replace(/\s/g, "");
        counts[type] = (counts[type] ?? 0) + 1;
      }
      expect(counts).toEqual({
        机构分红: 30,
        用户卖出: 12,
        用户买入: 22,
        用户跨TA转换: 10,
        调仓: 312,
        定投买入: 68,
        用户转换: 1,
        定投卖出: 2,
      });
      const drafts = createDrafts(rows);
      expect(drafts.filter((row) => !row.legs.length)).toHaveLength(1);
      expect(
        drafts.filter((row) =>
          row.legs.some((leg) => leg.activityType === "DIVIDEND" && !leg.amount),
        ),
      ).toHaveLength(30);
    },
  );
});

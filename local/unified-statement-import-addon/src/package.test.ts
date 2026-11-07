import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";

it("安装包只有运行文件和说明，没有源账单、测试及商店元数据", () => {
  const files = unzipSync(
    readFileSync(new URL(`../dist/unified-statement-import-addon-${JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version}.zip`, import.meta.url)),
  );
  const names = Object.keys(files);
  expect(names).toEqual(
    expect.arrayContaining([
      "manifest.json",
      "README.md",
      "LICENSE",
      "licenses/sheetjs-LICENSE.txt",
      "licenses/motion-LICENSE.txt",
      "THIRD-PARTY-NOTICES.md",
      "dist/assets/pdf/LICENSE",
      "dist/assets/pdf/cmaps/UniGB-UCS2-H.bcmap",
      "dist/assets/pdf/standard_fonts/LiberationSans-Regular.ttf",
      "dist/addon.js",
      "dist/unified-statement-import-addon.css",
    ]),
  );
  expect(
    names.some(
      (name) =>
        /\.(csv|xlsx?|pdf|test\.tsx?|map|zip)$/i.test(name) ||
        /(?:^|\/)demo(?:\/|\.)/i.test(name) ||
        name.startsWith("src/") ||
        name.endsWith("addon.store.json"),
    ),
  ).toBe(false);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(Object.keys(manifest.contributes.links)).toEqual(["investment-import", "spending-import"]);
  expect(manifest.contributes.links["spending-import"][0].route).toBe(
    manifest.contributes.routes[0].id,
  );
  expect(manifest.version).toBe("0.4.2");
  expect(manifest.minWealthfolioVersion).toBe("3.12.0");
  expect(manifest.hostDependencies["@wealthfolio/ui"]).toBe("^3.12.0");
  expect(
    manifest.permissions.find(
      (permission: { category: string }) => permission.category === "activities",
    ).functions,
  ).toEqual(["getAll", "saveMany", "getTransferPair", "linkTransfer", "checkImport"]);
  expect(manifest.permissions.find((permission: { category: string }) => permission.category === "market").functions).toEqual(["searchTicker"]);
  expect(files["licenses/pdf-parse-LICENSE.txt"]).toBeDefined();
  expect(files["licenses/decimal-LICENSE.txt"]).toBeDefined();
  expect(manifest.network).toBeUndefined();
  expect(strFromU8(files["dist/addon.js"])).not.toContain("synthetic-order-001");
  const code = strFromU8(files["dist/addon.js"]);
  expect(code).not.toMatch(/from\s*["']xlsx["']/);
  expect(code).not.toMatch(/from\s*["']@wealthfolio\/import-wizard-ui["']/);
  expect(code).not.toMatch(/(?:from\s*|import\s*\()["']\.\//);
  for (const imported of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']@wealthfolio\/ui["']/g))
    expect(imported[1]).not.toMatch(
      /\b(ImportWizardLayout|ImportResultSummary|FileDropzone|StepNavigation|WizardStepIndicator|CancelConfirmationDialog)\b/,
    );
  const css = strFromU8(files["dist/unified-statement-import-addon.css"]);
  expect(css).toContain("var(--muted-foreground)");
  expect(css).toContain(".h-dvh");
  expect(css).toContain(".grid-cols-2");
  expect(css).toContain(".bg-success-subtle");
  expect(css).toContain(".border-destructive-subtle-border");
  expect(css).not.toContain("statement-import-grid");
});

it("安装包包含当前 PDF 引擎可能请求的全部 CMap 和标准字体", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const files = unzipSync(readFileSync(new URL(`../dist/${manifest.id}-${manifest.version}.zip`, import.meta.url)));
  expect(files["dist/assets/pdf/cmaps/LICENSE"]).toBeDefined();
  expect(files["dist/assets/pdf/standard_fonts/LICENSE_LIBERATION"]).toBeDefined();
  const { readdirSync } = await import("node:fs");
  const { createRequire } = await import("node:module");
  const { dirname, join } = await import("node:path");
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  for (const directory of ["cmaps", "standard_fonts"])
    for (const name of readdirSync(join(root, directory)))
      expect(files[`dist/assets/pdf/${directory}/${name}`]?.byteLength, `${directory}/${name}`).toBeGreaterThan(0);
});

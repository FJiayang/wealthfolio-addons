import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";

it("安装包只有运行文件和说明，没有源账单、测试及商店元数据", () => {
  const files = unzipSync(
    readFileSync(new URL("../dist/unified-statement-import-addon-0.1.2.zip", import.meta.url)),
  );
  const names = Object.keys(files);
  expect(names).toEqual(
    expect.arrayContaining([
      "manifest.json",
      "README.md",
      "LICENSE",
      "dist/addon.js",
      "dist/unified-statement-import-addon.css",
    ]),
  );
  expect(
    names.some(
      (name) =>
        /\.(csv|test\.ts|map|zip)$/.test(name) ||
        name.startsWith("src/") ||
        name.endsWith("addon.store.json"),
    ),
  ).toBe(false);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  expect(manifest.hostDependencies["@wealthfolio/ui"]).toBe("^3.11.0");
  expect(
    manifest.permissions.find(
      (permission: { category: string }) => permission.category === "activities",
    ).functions,
  ).toEqual(["getAll", "saveMany"]);
  expect(manifest.network).toBeUndefined();
  expect(strFromU8(files["dist/addon.js"])).not.toContain("synthetic-order-001");
  const css = strFromU8(files["dist/unified-statement-import-addon.css"]);
  expect(css).toContain("var(--muted-foreground)");
  expect(css).toContain(".h-dvh");
  expect(css).not.toContain("statement-import-grid");
});

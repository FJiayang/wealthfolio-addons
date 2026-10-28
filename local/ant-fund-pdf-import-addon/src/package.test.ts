import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { expect, it } from "vitest";
import { validateManifest, type AddonManifest } from "@wealthfolio/addon-sdk";
import manifest from "../manifest.json";
import pkg from "../package.json";
import { PDF_RESOURCES } from "./statement";

it("validates the manifest and the actual installable archive", () => {
  // SDK types describe installed function metadata; archive manifests contain function names.
  expect(validateManifest(manifest as unknown as AddonManifest)).toMatchObject({
    valid: true,
    errors: [],
    warnings: [],
  });
  expect(manifest.version).toBe(pkg.version);
  expect(Object.keys(manifest.contributes.links)).toEqual(["investment-import"]);
  expect(manifest.contributes.links["investment-import"][0].route).toBe(
    manifest.contributes.routes[0].id,
  );
  expect(manifest.sdkVersion).toBe("3.11.0");
  expect(manifest.minWealthfolioVersion).toBe("3.11.0");
  expect(manifest.permissions.map((permission) => permission.category)).toEqual([
    "accounts",
    "activities",
  ]);
  const archive = unzipSync(readFileSync(`dist/${pkg.name}-${pkg.version}.zip`));
  expect(JSON.parse(strFromU8(archive["manifest.json"]))).toEqual(manifest);
  expect(archive[`dist/${manifest.main.split("/").at(-1)}`]).toBeDefined();
  expect(archive["dist/ant-fund-pdf-import-addon.css"]).toBeDefined();
  for (const resource of PDF_RESOURCES)
    expect(archive[`dist/assets/pdf/${resource}`]?.length).toBeGreaterThan(0);
  expect(archive["dist/assets/pdf/standard_fonts/LICENSE_LIBERATION"]).toBeDefined();
  expect(Object.keys(archive).length).toBeLessThanOrEqual(256);
  expect(Object.values(archive).every((file) => file.length <= 5 * 1024 * 1024)).toBe(true);
  expect(
    Object.values(archive).reduce((total, file) => total + file.length, 0),
  ).toBeLessThanOrEqual(25 * 1024 * 1024);
  expect(
    Object.keys(archive).some((path) => /\.pdf$|\.map$|\.test\.|fixtures|statement/i.test(path)),
  ).toBe(false);
});

import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve("pdfjs-dist/package.json"));
const resources = [
  "cmaps/UniGB-UCS2-H.bcmap",
  "cmaps/Adobe-GB1-UCS2.bcmap",
  "standard_fonts/LiberationSans-Regular.ttf",
];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "pdf-resources",
      generateBundle() {
        for (const path of resources)
          this.emitFile({
            type: "asset",
            fileName: `assets/pdf/${path}`,
            source: readFileSync(join(pdfRoot, path)),
          });
        this.emitFile({
          type: "asset",
          fileName: "assets/pdf/LICENSE",
          source: readFileSync(join(pdfRoot, "LICENSE")),
        });
        this.emitFile({
          type: "asset",
          fileName: "assets/pdf/cmaps/LICENSE",
          source: readFileSync(join(pdfRoot, "cmaps/LICENSE")),
        });
        this.emitFile({
          type: "asset",
          fileName: "assets/pdf/standard_fonts/LICENSE_LIBERATION",
          source: readFileSync(join(pdfRoot, "standard_fonts/LICENSE_LIBERATION")),
        });
        this.emitFile({
          type: "asset",
          fileName: "assets/licenses/pdf-parse.txt",
          source: readFileSync(join(dirname(require.resolve("pdf-parse")), "../../../LICENSE")),
        });
        this.emitFile({
          type: "asset",
          fileName: "assets/licenses/decimal.txt",
          source: readFileSync(
            join(dirname(require.resolve("decimal.js/package.json")), "LICENCE.md"),
          ),
        });
      },
    },
  ],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    lib: { entry: "src/addon.tsx", fileName: () => "addon.js", formats: ["es"] },
    rollupOptions: {
      external: (id) =>
        /^(react|react-dom|@wealthfolio\/addon-sdk|@wealthfolio\/ui)(\/|$)/.test(id),
    },
    sourcemap: false,
  },
});

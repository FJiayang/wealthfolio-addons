import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const pdfRoot = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "local-pdf-resources",
    generateBundle() {
      for (const directory of ["cmaps", "standard_fonts"])
        for (const name of readdirSync(join(pdfRoot, directory)))
          this.emitFile({ type: "asset", fileName: `assets/pdf/${directory}/${name}`, source: readFileSync(join(pdfRoot, directory, name)) });
      this.emitFile({ type: "asset", fileName: "assets/pdf/LICENSE", source: readFileSync(join(pdfRoot, "LICENSE")) });
    },
  }],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    target: ["chrome107", "edge107", "firefox104", "safari16"],
    lib: { entry: "src/addon.tsx", fileName: () => "addon.js", formats: ["es"] },
    rollupOptions: {
      output: { inlineDynamicImports: true },
      external: (id) =>
        /^(react|react-dom|@wealthfolio\/addon-sdk|@wealthfolio\/ui)(\/|$)/.test(id),
    },
    sourcemap: false,
  },
});

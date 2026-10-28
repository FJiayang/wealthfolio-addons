import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

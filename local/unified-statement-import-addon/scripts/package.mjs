import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const entries = {};
entries["licenses/sheetjs-LICENSE.txt"] = new Uint8Array(await readFile(new URL("node_modules/xlsx/LICENSE", root)));
entries["licenses/motion-LICENSE.txt"] = new Uint8Array(await readFile(new URL("node_modules/motion/LICENSE.md", root)));
entries["licenses/pdf-parse-LICENSE.txt"] = new Uint8Array(await readFile(new URL("node_modules/pdf-parse/LICENSE", root)));
entries["licenses/decimal-LICENSE.txt"] = new Uint8Array(await readFile(new URL("node_modules/decimal.js/LICENCE.md", root)));
for (const name of ["manifest.json", "README.md", "LICENSE", "THIRD-PARTY-NOTICES.md", "licenses/original-plugin-MIT.txt"])
  entries[name] = new Uint8Array(await readFile(new URL(name, root)));
async function collect(directory) {
  for (const entry of await readdir(new URL(directory, root), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path);
    else if (!/\.(zip|map)$/.test(entry.name))
      entries[path] = new Uint8Array(await readFile(new URL(path, root)));
  }
}
await mkdir(new URL("dist", root), { recursive: true });
await collect("dist");
const output = new URL(`dist/${manifest.id}-${manifest.version}.zip`, root);
await writeFile(output, zipSync(entries));
console.log(fileURLToPath(output));

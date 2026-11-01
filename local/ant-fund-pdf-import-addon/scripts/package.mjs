import { readFile, readdir, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const files = {};
async function add(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = `${path}/${entry.name}`;
    if (entry.isDirectory()) await add(name);
    else if (!name.endsWith(".zip") && !name.endsWith(".map"))
      files[name] = new Uint8Array(await readFile(name));
  }
}
for (const name of ["manifest.json", "README.md", "THIRD-PARTY-NOTICES.md"])
  files[name] = new Uint8Array(await readFile(name));
await add("dist");
const manifest = JSON.parse(new TextDecoder().decode(files["manifest.json"]));
await writeFile(`dist/${manifest.id}-${manifest.version}.zip`, zipSync(files));

import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");

if (!statSync(dist, { throwIfNoEntry: false })?.isDirectory()) {
  throw new Error("dist/ is missing. Build @vukapay/web first.");
}

const keep = new Set(["assets", "index.html", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png"]);
for (const name of readdirSync(root)) {
  if (name.startsWith("workbox-") && name.endsWith(".js")) keep.add(name);
}

rmSync(join(root, "assets"), { recursive: true, force: true });
for (const name of readdirSync(dist)) {
  if (!keep.has(name) && !(name.startsWith("workbox-") && name.endsWith(".js"))) continue;
  const from = join(dist, name);
  const to = join(root, name);
  if (statSync(from).isDirectory()) {
    mkdirSync(to, { recursive: true });
    cpSync(from, to, { recursive: true });
  } else {
    cpSync(from, to);
  }
}

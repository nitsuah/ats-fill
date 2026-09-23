import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
const output = path.resolve(process.argv[2] ?? `ats-fill-v${version}.zip`);

if (fs.existsSync("dist")) fs.rmSync("dist", { recursive: true, force: true });
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

const manifest = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
if (manifest.version !== version) throw new Error("Built manifest version differs from source manifest.");

if (fs.existsSync(output)) fs.rmSync(output, { force: true });

// Fixed mtimes + a sorted, explicit entry list make the archive reproducible:
// equivalent dist/ contents always produce a byte-identical (and identically
// checksummed) zip, regardless of build-time timestamps or traversal order.
const distDir = path.resolve("dist");
const FIXED_TIME = new Date("2020-01-01T00:00:00Z");

function collectFiles(dir, base = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(full, base));
    else files.push(path.relative(base, full));
  }
  return files;
}

const files = collectFiles(distDir);
for (const file of files) {
  fs.utimesSync(path.join(distDir, file), FIXED_TIME, FIXED_TIME);
}

execFileSync("zip", ["-qX", output, ...files], { cwd: distDir, stdio: "inherit" });

console.log(`Packaged ${output}`);

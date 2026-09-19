import fs from "node:fs";
import { execFileSync } from "node:child_process";

const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
const output = process.argv[2] ?? `auto-apply-plugin-v${version}.zip`;

if (fs.existsSync("dist")) fs.rmSync("dist", { recursive: true, force: true });
execFileSync("npm", ["run", "build"], { stdio: "inherit" });

const manifest = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
if (manifest.version !== version) throw new Error("Built manifest version differs from source manifest.");

if (fs.existsSync(output)) fs.rmSync(output, { force: true });
execFileSync("zip", ["-qr", output, "."], { cwd: "dist", stdio: "inherit" });

console.log(`Packaged ${output}`);

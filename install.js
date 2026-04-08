import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Auto-load .env if it exists
const envFile = resolve(__dirname, ".env");
if (existsSync(envFile)) {
  readFileSync(envFile, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key && !(key in process.env)) process.env[key] = value;
    });
}

const cmd = process.platform === "win32" ? "powershell -ExecutionPolicy Bypass -File install.ps1" : "bash install.sh";

execSync(cmd, { stdio: "inherit", cwd: __dirname });

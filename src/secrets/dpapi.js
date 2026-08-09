import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

const PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$plain = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($protected))
`;

const UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$blob = [Console]::In.ReadToEnd().Trim()
$protected = [Convert]::FromBase64String($blob)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))
`;

function requireWindows() {
  if (process.platform !== "win32") {
    const error = new Error("DPAPI secrets require Windows CurrentUser protection");
    error.code = "ERR_DPAPI_UNAVAILABLE";
    throw error;
  }
}

function runPowerShell(script, input) {
  requireWindows();
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      input,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const error = new Error("DPAPI PowerShell operation failed");
    error.code = "ERR_DPAPI_FAILED";
    error.stderr = result.stderr;
    throw error;
  }
  return result.stdout;
}

export function protectSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TypeError("secret must be a non-empty string");
  }
  return runPowerShell(PROTECT_SCRIPT, secret);
}

export function unprotectSecret(blob) {
  if (typeof blob !== "string" || blob.trim() === "") {
    throw new TypeError("DPAPI blob must be a non-empty string");
  }
  return runPowerShell(UNPROTECT_SCRIPT, blob);
}

export async function writeProtectedSecret(filePath, secret) {
  await mkdir(dirname(filePath), { recursive: true });
  const blob = protectSecret(secret);
  await writeFile(filePath, `${blob}\n`, { encoding: "utf8", mode: 0o600 });
  return filePath;
}

export async function readProtectedSecret(filePath) {
  const blob = await readFile(filePath, "utf8");
  return unprotectSecret(blob);
}

export async function spawnWithDpapiEnv({
  command,
  args = [],
  hmacSecretFile,
  env = process.env,
  stdio = "inherit",
} = {}) {
  if (typeof command !== "string" || command.length === 0) {
    throw new TypeError("command is required");
  }
  if (!hmacSecretFile) {
    throw new TypeError("hmacSecretFile is required");
  }
  const childEnv = {
    ...env,
      QODER_HOOK_HMAC_KEY: await readProtectedSecret(hmacSecretFile),
  };
  return spawn(command, args, {
    env: childEnv,
    stdio,
    windowsHide: true,
  });
}

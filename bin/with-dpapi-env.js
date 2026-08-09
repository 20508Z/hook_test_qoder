#!/usr/bin/env node

import { parseArgs } from "node:util";

import { spawnWithDpapiEnv } from "../src/secrets/dpapi.js";

const splitAt = process.argv.indexOf("--", 2);
if (splitAt === -1 || splitAt === process.argv.length - 1) {
  process.stderr.write("Usage: qoder-with-dpapi-env --hmac-secret-file <file> -- <command> [args...]\n");
  process.exit(1);
}

const { values } = parseArgs({
  args: process.argv.slice(2, splitAt),
  options: {
    "hmac-secret-file": { type: "string" },
  },
});

try {
  const [command, ...args] = process.argv.slice(splitAt + 1);
  const child = await spawnWithDpapiEnv({
    command,
    args,
    hmacSecretFile: values["hmac-secret-file"],
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

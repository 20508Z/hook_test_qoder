#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { writeProtectedSecret } from "../src/secrets/dpapi.js";

function usage() {
  return [
    "Usage:",
    "  qoder-dpapi-secret protect --out <file>        # reads secret from stdin",
    "  qoder-dpapi-secret generate --out <file>       # writes random 32-byte base64 secret",
  ].join("\n");
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

const [command, ...rest] = process.argv.slice(2);
try {
  if (command === "protect") {
    const { values } = parseArgs({ args: rest, options: { out: { type: "string" } } });
    if (!values.out) throw new Error(usage());
    await writeProtectedSecret(values.out, await readStdin());
  } else if (command === "generate") {
    const { values } = parseArgs({ args: rest, options: { out: { type: "string" } } });
    if (!values.out) throw new Error(usage());
    await writeProtectedSecret(values.out, randomBytes(32).toString("base64"));
  } else {
    throw new Error(usage());
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

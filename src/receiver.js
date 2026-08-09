import { parseArgs } from "node:util";

import { createDiffSignal } from "./adapters/index.js";
import { canonicalizeHook } from "./canonicalize.js";
import { loadConfig } from "./config.js";
import { JsonlSpool } from "./core/index.js";
import { sendDiffSignal } from "./diff/transport.js";

async function readBoundedStdin(stream, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      const error = new Error(`Hook input exceeds ${maxBytes} bytes`);
      error.code = "ERR_STDIN_TOO_LARGE";
      error.failOpen = true;
      throw error;
    }
    chunks.push(buffer);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
}

function cliOptions(argv) {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      ide: { type: "string" },
      surface: { type: "string" },
      "spool-dir": { type: "string" },
      "diff-pipe": { type: "string" },
    },
  });
  return values;
}

function diagnostic(error) {
  const code = typeof error?.code === "string" ? error.code : "ERR_HOOK_RECEIVER";
  return `[qoder-code-attribution-hook] ${code}; event skipped (fail-open)\n`;
}

export async function receivePayload(payload, { config, hints = {}, now } = {}) {
  const effectiveConfig = config ?? loadConfig();
  const event = canonicalizeHook(payload, {
    config: effectiveConfig,
    hints,
    now,
  });
  if (!new Set(["write", "edit", "command"]).has(event.tool.name)) {
    return { event, stored: false, duplicate: false, skipped: true };
  }
  const spool = new JsonlSpool(effectiveConfig.spoolDir);
  const persistence = await spool.append(event);
  return { event, ...persistence };
}

export async function runHookReceiver({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stderr = process.stderr,
  env = process.env,
  now,
} = {}) {
  try {
    const options = cliOptions(argv);
    const config = loadConfig({
      spoolDir: options["spool-dir"],
      diffPipe: options["diff-pipe"],
    }, env);
    const raw = await readBoundedStdin(stdin, config.maxStdinBytes);
    const payload = JSON.parse(raw);
    const received = await receivePayload(payload, {
      config,
      hints: {
        ideProduct: options.ide,
        surface: options.surface,
      },
      now,
    });
    if (config.diffPipe && new Set(["write", "edit", "command"]).has(received.event.tool.name)) {
      try {
        await sendDiffSignal({
          pipeName: config.diffPipe,
          signal: createDiffSignal(payload, {
            ideProduct: options.ide,
            surface: options.surface,
          }),
        });
      } catch {
        // Diff is optional and must never change Hook receiver success semantics.
      }
    }
    return {
      ok: true,
      ...received,
    };
  } catch (error) {
    stderr.write(diagnostic(error));
    return { ok: false, failOpen: true, code: error?.code ?? "ERR_HOOK_RECEIVER" };
  }
}

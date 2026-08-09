#!/usr/bin/env node

import { parseArgs } from "node:util";

import { loadConfig } from "../src/config.js";
import { startManagedCompanion } from "../src/diff/launcher.js";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    pipe: { type: "string" },
    "spool-dir": { type: "string" },
    "health-file": { type: "string" },
  },
});
const config = loadConfig({ spoolDir: values["spool-dir"] });
const managed = await startManagedCompanion({
  workspaceRoot: values.workspace,
  pipeName: values.pipe,
  hmacKey: config.hmacKey,
  employeeIdHmac: config.enterpriseUserHmac,
  spoolDir: config.spoolDir,
  healthFile: values["health-file"],
});

const shutdown = async () => {
  await managed.close();
  process.exitCode = 0;
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

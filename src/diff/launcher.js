import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

import { hmacValue } from "../core/index.js";
import { AttributionCompanion } from "./attribution.js";
import { createDiffServer } from "./transport.js";

export async function startManagedCompanion({
  workspaceRoot,
  pipeName,
  spoolDir,
  hmacKey,
  employeeIdHmac = null,
  healthFile = path.join(spoolDir, "companion-health.json"),
  watchWorkspace = true,
} = {}) {
  if (typeof workspaceRoot !== "string" || workspaceRoot.trim() === "") {
    throw new TypeError("workspaceRoot is required");
  }
  if (typeof pipeName !== "string" || pipeName.trim() === "") {
    throw new TypeError("pipeName is required");
  }

  const companion = new AttributionCompanion({
    workspaceRoot,
    hmacKey,
    employeeIdHmac,
    spoolDir,
  });
  await companion.initializeWorkspaceBaseline();
  if (watchWorkspace) companion.startWatcher();

  const { server, address } = createDiffServer({
    pipeName,
    onSignal: (signal) => companion.handleHook(signal),
  });
  server.listen(address);
  try {
    await once(server, "listening");
  } catch (error) {
    companion.closeWatcher();
    throw error;
  }

  const resolvedHealthFile = path.resolve(healthFile);
  await mkdir(path.dirname(resolvedHealthFile), { recursive: true });
  const health = {
    schema_version: "companion-health/1.0",
    status: "ready",
    pid: process.pid,
    started_at: new Date().toISOString(),
    workspace_id: hmacValue(path.resolve(workspaceRoot), hmacKey),
    pipe_name: pipeName,
  };
  const temporary = `${resolvedHealthFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(health)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, resolvedHealthFile);

  let closed = false;
  return {
    companion,
    server,
    address,
    health,
    async close() {
      if (closed) return;
      closed = true;
      companion.closeWatcher();
      if (server.listening) {
        server.close();
        await once(server, "close");
      }
      await rm(resolvedHealthFile, { force: true });
      if (process.platform !== "win32") await rm(address, { force: true });
    },
  };
}

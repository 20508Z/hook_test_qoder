import net from "node:net";

export function normalizePipeName(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value)) {
    throw new TypeError("Diff pipe name must be a short safe label");
  }
  return process.platform === "win32" ? `\\\\.\\pipe\\${value}` : `/tmp/${value}.sock`;
}

export async function sendDiffSignal({ pipeName, signal, timeoutMs = 20 }) {
  const address = normalizePipeName(pipeName);
  const body = `${JSON.stringify(signal)}\n`;
  await new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    const timer = setTimeout(() => socket.destroy(Object.assign(new Error("Diff companion timeout"), {
      code: "ERR_DIFF_COMPANION_TIMEOUT",
    })), timeoutMs);
    socket.once("connect", () => socket.end(body));
    socket.once("close", () => { clearTimeout(timer); resolve(); });
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
}

export function createDiffServer({ pipeName, onSignal }) {
  const address = normalizePipeName(pipeName);
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    const chunks = [];
    let bytes = 0;
    socket.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) return socket.destroy();
      chunks.push(chunk);
    });
    socket.on("end", async () => {
      try {
        const signal = JSON.parse(Buffer.concat(chunks).toString("utf8").trim());
        await onSignal(signal);
      } catch {
        // Untrusted signals are dropped without echoing their body.
      } finally {
        socket.end();
      }
    });
  });
  return { server, address };
}

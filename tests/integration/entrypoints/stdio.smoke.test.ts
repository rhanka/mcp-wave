import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("stdio entrypoint smoke", () => {
  it("starts, completes initialize, and lists at least list_businesses", async () => {
    const proc = spawn("node", ["--import", "tsx/esm", "src/entrypoints/stdio.ts"], {
      env: {
        ...process.env,
        WAVE_AUTH_MODE: "mock",
        WAVE_API_TOKEN: "fake",
        WAVE_DEFAULT_BUSINESS_ID: "biz_x",
        WAVE_GRAPHQL_ENDPOINT: "https://example.invalid/graphql",
        LOG_LEVEL: "fatal",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      let stdoutBuf = "";
      let stderrBuf = "";
      proc.stdout.on("data", (chunk) => {
        stdoutBuf += String(chunk);
      });
      proc.stderr.on("data", (chunk) => {
        stderrBuf += String(chunk);
      });

      const send = (msg: object) => proc.stdin.write(`${JSON.stringify(msg)}\n`);

      const waitFor = (predicate: () => boolean, timeoutMs: number) =>
        new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
            setTimeout(tick, 50);
          };
          tick();
        });

      // Wait for the "ready" signal (server prints the startup log)
      await waitFor(() => stderrBuf.includes("[mcp-wave] ready"), 20_000).catch(() => {
        throw new Error(
          `server did not become ready. stdout=${stdoutBuf.slice(0, 300)} stderr=${stderrBuf.slice(0, 300)}`,
        );
      });

      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });

      await waitFor(() => stdoutBuf.includes('"list_businesses"'), 5_000);
      expect(stdoutBuf).toMatch(/"tools"/);
      expect(stdoutBuf).toMatch(/"list_businesses"/);
    } finally {
      proc.kill("SIGTERM");
    }
  }, 30_000);
});

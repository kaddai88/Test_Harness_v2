#!/usr/bin/env node
/**
 * @test-harness/th-server — entry point.
 *
 * Starts the Test-Harness server with environment-based configuration.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load .env from project root (works for both tsx and node dist)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..", "..", "..");
const { loadServerApplication } = await import("./bootstrap.js");
const { TestHarnessServer } = await loadServerApplication(rootDir);

export { TestHarnessServer };
export type { TestHarnessServerOptions } from "./app.js";

console.log("[Server] Starting Test-Harness...");
console.log(`[Server] DASHSCOPE_API_KEY: ${process.env.DASHSCOPE_API_KEY ? "set" : "not set"}`);
const server = new TestHarnessServer();

process.on("SIGINT", async () => {
  console.log("\n[Server] SIGINT received, shutting down...");
  await server.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n[Server] SIGTERM received, shutting down...");
  await server.stop();
  process.exit(0);
});

server.start({
  port: parseInt(process.env.PORT ?? "3000", 10),
  dbPath: process.env.DB_PATH,
}).catch((err) => {
  console.error("[Server] Failed to start:", err);
  process.exit(1);
});

import { buildServer } from "./api/server.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { startWorkerLoop, flushPendingPings } from "./worker/loop.js";

async function main() {
  logger.info("Starting PulseWatch API...");

  // Build + start HTTP server
  const app = await buildServer();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info(`HTTP server listening on port ${env.PORT}`);
  } catch (err) {
    logger.error({ err }, "Failed to start HTTP server");
    process.exit(1);
  }

  // Start worker loop (loads schedule once, then pings URLs from memory)
  await startWorkerLoop();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    try {
      await flushPendingPings();
    } catch (err) {
      logger.error({ err }, "Final ping flush failed");
    }
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});

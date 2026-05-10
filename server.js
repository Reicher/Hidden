import { createStaticHttpServer } from "./server/httpStatic.js";
import { attachGameRuntime } from "./server/gameRuntime.js";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || "127.0.0.1";

process.on("uncaughtException", (err) => {
  console.error("[server] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandledRejection:", reason);
});

async function gracefulShutdown(signal) {
  console.log(`[server] ${signal} – stänger ned…`);
  server.close();
  if (gameRuntimeApi?.shutdown) {
    await gameRuntimeApi.shutdown().catch(() => {});
  }
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

let gameRuntimeApi = null;
const server = createStaticHttpServer({
  host: HOST,
  port: PORT,
  rootDir: HERE,
  onBeforeStaticRequest: ({ req, res, requestUrl }) =>
    gameRuntimeApi?.handleHttpRequest?.({ req, res, requestUrl }) || false,
});

gameRuntimeApi = attachGameRuntime({ server, rootDir: HERE });

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

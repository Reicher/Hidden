import { createStaticHttpServer } from "./server/httpStatic.js";
import { attachGameRuntime } from "./server/gameRuntime.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || "127.0.0.1";

let gameRuntimeApi = null;
const server = createStaticHttpServer({
  host: HOST,
  port: PORT,
  rootDir: import.meta.dirname,
  onBeforeStaticRequest: ({ req, res, requestUrl }) => gameRuntimeApi?.handleHttpRequest?.({ req, res, requestUrl }) || false
});

gameRuntimeApi = attachGameRuntime({ server, rootDir: import.meta.dirname });

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

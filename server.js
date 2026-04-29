import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticHttpServer } from "./server/httpStatic.js";
import { attachGameRuntime } from "./server/gameRuntime.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || "127.0.0.1";

const server = createStaticHttpServer({
  host: HOST,
  port: PORT,
  rootDir: __dirname
});

attachGameRuntime({ server });

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});

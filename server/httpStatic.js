import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ico", "image/x-icon"]
]);

export function createStaticHttpServer({ host, port, rootDir }) {
  const publicDir = path.resolve(path.join(rootDir, "public"));

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname === "/") pathname = "/index.html";

      const relativePath = path.posix.normalize(pathname).replace(/^\/+/, "");
      const fullPath = path.resolve(path.join(publicDir, relativePath));

      if (!fullPath.startsWith(publicDir + path.sep) && fullPath !== publicDir) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const data = await readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      const contentType = CONTENT_TYPES.get(ext);
      if (contentType) res.setHeader("Content-Type", contentType);

      if (ext === ".html") {
        res.setHeader("Cache-Control", "no-cache");
      } else {
        res.setHeader("Cache-Control", "public, max-age=86400");
      }

      res.writeHead(200);
      res.end(data);
    } catch (error) {
      const code = error && typeof error === "object" ? error.code : null;
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      console.error(`[http-static] ${error?.message || error}`);
      res.writeHead(500);
      res.end("Internal server error");
    }
  });
}

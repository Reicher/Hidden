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

function normalizeToRelativePath(pathname) {
  return path.posix.normalize(pathname).replace(/^\/+/, "");
}

function hasFileExtension(pathname) {
  const basename = pathname.split("/").filter(Boolean).at(-1) || "";
  return basename.includes(".");
}

export function createStaticHttpServer({ host, port, rootDir, onBeforeStaticRequest = null }) {
  const publicDir = path.resolve(path.join(rootDir, "public"));

  return http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || "/", `http://${host}:${port}`);
      if (typeof onBeforeStaticRequest === "function") {
        const handled = await onBeforeStaticRequest({ req, res, requestUrl });
        if (handled) return;
      }
      const pathname = decodeURIComponent(requestUrl.pathname || "/");
      let primaryPath = pathname === "/" ? "/index.html" : pathname;
      if (pathname === "/debug" || pathname === "/debug/") {
        primaryPath = "/debug.html";
      }

      const tryReadPath = async (absolutePath) => {
        const data = await readFile(absolutePath);
        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = CONTENT_TYPES.get(ext);
        if (contentType) res.setHeader("Content-Type", contentType);
        if (ext === ".html") {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          res.setHeader("Cache-Control", "public, max-age=86400");
        }
        res.writeHead(200);
        res.end(data);
      };

      const relativePath = normalizeToRelativePath(primaryPath);
      const fullPath = path.resolve(path.join(publicDir, relativePath));

      if (!fullPath.startsWith(publicDir + path.sep) && fullPath !== publicDir) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      try {
        await tryReadPath(fullPath);
        return;
      } catch (error) {
        const code = error && typeof error === "object" ? error.code : null;
        const canFallbackToSpa = (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") && !hasFileExtension(pathname);
        if (!canFallbackToSpa) throw error;

        const indexPath = path.resolve(path.join(publicDir, "index.html"));
        await tryReadPath(indexPath);
        return;
      }
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

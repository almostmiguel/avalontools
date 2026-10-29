import { createServer as createHttpServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif",
  ".ttf": "font/ttf", ".woff2": "font/woff2",
};

export function createServer(root = projectRoot) {
  const absoluteRoot = resolve(root);
  return createHttpServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const fail = (status, message) => {
      response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(message);
    };
    if (!["GET", "HEAD"].includes(request.method)) {
      response.setHeader("Allow", "GET, HEAD");
      return fail(405, "Method not allowed");
    }
    try {
      const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      const segments = path.split("/");
      if (segments.some(segment => segment.startsWith(".")) || /[\\\u0000]/u.test(path)) return fail(404, "Not found");
      const name = path === "/" ? "index.html" : path.slice(1);
      if (!["index.html", "rules.html", "rule.html", "actions.html", "conditions.html", "skills.html", "classes.html", "feats.html", "traits.html", "backgrounds.html", "archetypes.html", "ancestries.html", "reference-palette.html"].includes(name) && !/^(css|js|data|img|fonts)\//.test(name)) return fail(404, "Not found");
      const type = types[extname(name).toLowerCase()];
      if (!type) return fail(404, "Not found");
      const target = await realpath(resolve(absoluteRoot, name));
      const relativeTarget = relative(absoluteRoot, target);
      if (relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) return fail(404, "Not found");
      const info = await stat(target);
      if (!info.isFile()) return fail(404, "Not found");
      response.writeHead(200, { "Content-Type": type });
      response.end(request.method === "HEAD" ? undefined : await readFile(target));
    } catch (error) {
      if (error instanceof URIError) return fail(400, "Invalid URL");
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return fail(404, "Not found");
      if (response.headersSent) return response.destroy();
      fail(500, "Unable to serve file");
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  const server = createServer();
  server.once("error", error => {
    console.error(`Could not start the server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log(`Avalon: http://localhost:${port}\nPress Ctrl+C to stop.`));
}

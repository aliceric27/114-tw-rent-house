const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ROOT = path.join(PROJECT_ROOT, "public");
const PORT = Number(process.argv[2] || 5173);
const PARSER_MODULE_URL = pathToFileURL(path.join(PROJECT_ROOT, "src", "listing-parser.mjs")).href;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
};

function send(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8");
}

async function handle591Listing(requestUrl, response) {
  try {
    const { fetch591Listing } = await import(PARSER_MODULE_URL);
    const target = requestUrl.searchParams.get("url") || "";
    const listing = await fetch591Listing(target);
    sendJson(response, 200, listing);
  } catch (error) {
    sendJson(response, error.status || 502, { error: error.message || "無法讀取 591 頁面。" });
  }
}

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${PORT}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);

  if (!filePath.startsWith(ROOT)) {
    return null;
  }

  return filePath;
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://localhost:${PORT}`);

  if (requestUrl.pathname === "/api/591-listing") {
    handle591Listing(requestUrl, response);
    return;
  }

  const filePath = resolveRequestPath(request.url);

  if (!filePath) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, body) => {
    if (error) {
      send(response, 404, "Not found");
      return;
    }

    send(response, 200, body, MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Server running at http://127.0.0.1:${PORT}/`);
});

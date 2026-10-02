const http = require("http");
const fs = require("fs");
const path = require("path");

// Serves the repo root (one level up from /test) as static files, so it
// always finds index.html regardless of where the repo is checked out -
// this file has to work unmodified both on a contributor's machine and in
// CI, neither of which share a fixed absolute path.
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.TEST_PORT) || 8123;

// Real types, like GitHub Pages: browsers refuse a stylesheet served as text/html.
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".json": "application/json" };

const server = http.createServer((req, res) => {
  // index.html loads its files as name?v=NN so a deploy never mixes old and new scripts; the
  // query only busts caches, so it's dropped here.
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log("serving on", PORT));

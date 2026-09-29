const http = require("http");
const fs = require("fs");
const path = require("path");

// Serves the repo root (one level up from /test) as static files, so it
// always finds index.html regardless of where the repo is checked out -
// this file has to work unmodified both on a contributor's machine and in
// CI, neither of which share a fixed absolute path.
const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.TEST_PORT) || 8123;

const server = http.createServer((req, res) => {
  const filePath = path.join(ROOT, req.url === "/" ? "index.html" : req.url);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log("serving on", PORT));

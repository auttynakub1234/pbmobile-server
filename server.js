#!/usr/bin/env node
/**
 * Point Blank Mobile (PBMobile) Local Development & Reverse Engineering Server
 * Features:
 * - Domain lock bypass for net.js and pb.js
 * - Transparent asset caching & proxying to pbmobile.app
 * - Live WebSocket reverse proxy with packet logging
 * - Built-in 3D asset explorer API & viewer
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = process.env.PORT || 3000;
const BASE_DIR = __dirname;
const CACHE_DIR = path.join(BASE_DIR, "cache");

fs.mkdirSync(CACHE_DIR, { recursive: true });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".obj": "text/plain",
  ".mtl": "text/plain",
  ".i3s": "application/octet-stream",
  ".i3i": "application/octet-stream"
};

function proxyHttpRequest(req, res, targetUrl) {
  const parsed = url.parse(targetUrl);
  const options = {
    hostname: parsed.hostname,
    port: 443,
    path: parsed.path,
    method: req.method,
    headers: {
      ...req.headers,
      host: parsed.hostname,
      referer: "https://pbmobile.app/",
      origin: "https://pbmobile.app",
      "accept-encoding": "identity"
    }
  };

  const proxyReq = https.request(options, (upstreamRes) => {
    res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
    upstreamRes.pipe(res);
  });

  proxyReq.on("error", (err) => {
    console.error(`[!] Proxy error for ${targetUrl}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Bad Gateway: " + err.message);
    }
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const reqUrl = url.parse(req.url);
  const pathname = reqUrl.pathname;

  // 1. API Endpoint: List all extracted weapons & maps
  if (pathname === "/api/assets") {
    const mapsDir = path.join(BASE_DIR, "extracted", "maps");
    const wpnsDir = path.join(BASE_DIR, "extracted", "weapons");
    const maps = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir).filter(f => !f.startsWith(".")) : [];
    const weapons = fs.existsSync(wpnsDir) ? fs.readdirSync(wpnsDir).filter(f => !f.startsWith(".")) : [];
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ maps, weapons }));
  }

  // 2. Special Route: 3D Weapon Viewer
  if (pathname === "/viewer") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(BASE_DIR, "viewer.html")).pipe(res);
  }

  // 3. Intercept net.js with patched version
  if (pathname === "/static/game/net.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    return fs.createReadStream(path.join(BASE_DIR, "net.patched.js")).pipe(res);
  }

  // 4. Intercept pb.js with patched version
  if (pathname === "/static/game/pb.js") {
    res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
    return fs.createReadStream(path.join(BASE_DIR, "pb.patched.js")).pipe(res);
  }

  // 5. Check if file exists locally in BASE_DIR
  let localPath = null;
  if (pathname === "/" || pathname === "/index.html") {
    localPath = path.join(BASE_DIR, "index.html");
  } else {
    const candidate = path.join(BASE_DIR, pathname.startsWith("/") ? pathname.slice(1) : pathname);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      localPath = candidate;
    }
  }

  if (localPath && fs.existsSync(localPath)) {
    const ext = path.extname(localPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    return fs.createReadStream(localPath).pipe(res);
  }

  // 6. Fallback: Proxy directly to live pbmobile.app
  const upstreamUrl = `https://pbmobile.app${req.url}`;
  proxyHttpRequest(req, res, upstreamUrl);
});

// WebSocket Proxy
server.on("upgrade", (req, socket, head) => {
  const upstream = https.request({
    hostname: "pbmobile.app",
    port: 443,
    path: req.url,
    method: "GET",
    headers: {
      ...req.headers,
      host: "pbmobile.app",
      origin: "https://pbmobile.app",
      referer: "https://pbmobile.app/"
    }
  });

  upstream.on("upgrade", (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
      Object.entries(upRes.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") +
      `\r\n\r\n`
    );

    if (upHead && upHead.length) socket.write(upHead);
    if (head && head.length) upSocket.write(head);

    upSocket.pipe(socket);
    socket.pipe(upSocket);

    upSocket.on("error", () => {});
    socket.on("error", () => {});
  });

  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[+] PBMobile Local Dev Server active on http://localhost:${PORT}`);
});

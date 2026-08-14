import "dotenv/config";
// Must be the first import: loads .env.local (dotenv/config only reads a
// plain ".env", which this project doesn't have — real config lives in
// .env.local and was silently never being loaded by this custom server,
// so env-dependent modules like lib/redis.js and lib/v1/ratelimit.js
// always fell back to their no-Redis defaults). See lib/load-env.js for
// why this has to be its own imported file rather than an inline call.
import "./lib/load-env.js";
import { createServer } from "http";
import next from "next";
import { initSocketServer } from "./lib/socket-server.js";
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
app.prepare().then(async () => {
  const server = createServer((req, res) => {
const u = new URL(req.url, `http://${req.headers.host || "localhost"}`);
const parsedUrl = {
  pathname: u.pathname,
  search: u.search,
  searchParams: u.searchParams,
  query: Object.fromEntries(u.searchParams),
  href: u.href,
};    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const color = res.statusCode >= 500 ? "\x1b[31m" : res.statusCode >= 400 ? "\x1b[33m" : "\x1b[32m";
      console.log(`${color}${res.statusCode}\x1b[0m ${req.method} ${req.url} \x1b[90m${ms}ms\x1b[0m`);
    });
    handle(req, res, parsedUrl);
  });
  // Init Socket.IO attached to same HTTP server
  await initSocketServer(server);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Server running on http://localhost:${PORT}`);
  });
});

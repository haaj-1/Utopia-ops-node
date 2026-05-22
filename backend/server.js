/**
 * server.js — HTTP entry point for Utopia Ops OS.
 *
 * Responsibilities:
 *  - Load env vars
 *  - Mount API routes
 *  - Serve the frontend (static files from ../frontend)
 *  - Global error handling
 *  - In-process rate limiting (per IP, sliding window)
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvFile, config } from "./src/config/env.js";
import { AppService } from "./src/services/AppService.js";
import { registerAllRoutes } from "./src/routes/index.js";

// ── Bootstrap ─────────────────────────────────────────────────────────────

loadEnvFile();                          // reads .env from project root
const appService = new AppService();

// ── Minimal router ────────────────────────────────────────────────────────
// A lightweight router so we don't need Express.
// Each route is { method, path, handler } where path can end with * for prefix match.

const routes = [];

const router = {
  get(path, handler)  { routes.push({ method: "GET",  path, handler }); },
  post(path, handler) { routes.push({ method: "POST", path, handler }); },
};

registerAllRoutes(router, appService);

// ── Rate limiter ──────────────────────────────────────────────────────────
//
// Sliding-window, in-memory, per-IP.
// Two tiers:
//   - /api/actions/llm/*  and  /api/actions/slack/command  → tight (10 req / 60s)
//     These hit paid external APIs (OpenAI/Anthropic/Slack) and must be protected.
//   - All other /api/actions/* and /api/analyze/*           → relaxed (60 req / 60s)
//     Computation or cheap integrations — still capped to prevent abuse.
//
// The map is pruned on every check so it doesn't grow unbounded.

const _rlWindows = new Map(); // key: `${ip}:${tier}` → [timestamp, ...]

const RATE_LIMITS = {
  tight:   { limit: 10,  windowMs: 60_000 },
  relaxed: { limit: 60,  windowMs: 60_000 },
};

function getRateLimitTier(pathname) {
  if (
    pathname.startsWith("/api/actions/llm/") ||
    pathname === "/api/actions/slack/command"
  ) return "tight";
  if (
    pathname.startsWith("/api/actions/") ||
    pathname.startsWith("/api/analyze/")
  ) return "relaxed";
  return null; // no limit for health / connectors / static
}

/**
 * Returns true if the request should be blocked (limit exceeded).
 * Side-effect: records the current hit and prunes stale entries.
 */
function isRateLimited(ip, tier) {
  const { limit, windowMs } = RATE_LIMITS[tier];
  const key  = `${ip}:${tier}`;
  const now  = Date.now();
  const hits = (_rlWindows.get(key) || []).filter(t => now - t < windowMs);
  hits.push(now);
  _rlWindows.set(key, hits);
  return hits.length > limit;
}

// ── Static file serving ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendRoot = normalize(join(__dirname, "../frontend"));

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ── Request handler ───────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    // ── API routes ──────────────────────────────────────────────────────
    if (url.pathname.startsWith("/api/")) {
      const match = routes.find(
        (r) => r.method === req.method && r.path === url.pathname
      );

      if (!match) {
        return sendJson(res, 404, { error: "API route not found." });
      }

      // ── Rate limiting ─────────────────────────────────────────────────
      const tier = getRateLimitTier(url.pathname);
      if (tier) {
        const ip = (
          req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
          req.socket.remoteAddress ||
          "unknown"
        );
        if (isRateLimited(ip, tier)) {
          const { limit, windowMs } = RATE_LIMITS[tier];
          res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
          return sendJson(res, 429, {
            error: `Rate limit exceeded. Max ${limit} requests per ${windowMs / 1000}s. Try again shortly.`,
          });
        }
      }

      // Parse body for POST requests
      req.query = Object.fromEntries(url.searchParams);
      req.body = {};
      req.rawBody = "";

      if (req.method === "POST") {
        req.rawBody = await readBody(req);
        const ct = req.headers["content-type"] || "";
        if (ct.includes("application/json") && req.rawBody) {
          req.body = JSON.parse(req.rawBody);
        } else if (ct.includes("application/x-www-form-urlencoded") && req.rawBody) {
          req.body = Object.fromEntries(new URLSearchParams(req.rawBody));
        }
      }

      // Wrap handler so route files can use res.json() and res.status()
      res.json = (payload, status = 200) => sendJson(res, status, payload);
      res.status = (code) => { res._statusCode = code; return res; };

      await match.handler(req, res);
      return;
    }

    // ── Static files ────────────────────────────────────────────────────
    const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = normalize(join(frontendRoot, requestedPath));

    // Path traversal guard
    if (!filePath.startsWith(frontendRoot)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
    });
    res.end(body);

  } catch (err) {
    // Use a specific status if the error carries one, otherwise 500
    const status = err.status || (err.message?.includes("not configured") ? 503
      : err.message?.includes("required") ? 400
      : err.message?.includes("not found") ? 404
      : 500);
    sendJson(res, status, { error: err.message || "Internal server error" });
  }
});

server.listen(config.port, () => {
  console.log(`Utopia Ops OS running at http://localhost:${config.port}`);
  console.log(`LLM provider: ${config.llmProvider}`);
  appService.startScheduler();
});

// ── Helpers ───────────────────────────────────────────────────────────────

async function readBody(req) {
  const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BYTES) {
      throw new Error("Request body too large (limit: 1 MB).");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

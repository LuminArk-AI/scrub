#!/usr/bin/env node
/**
 * Scrub — Streamable HTTP entry point.
 *
 * Stateless mode: each POST /mcp creates a fresh Server + transport pair,
 * processes the request, and tears them down on response close. No
 * session tracking, no shared state — every call is independent. This
 * is the simplest deploy shape and works behind any tunnel or host
 * without sticky sessions.
 *
 * GET and DELETE on /mcp return 405 (no server-initiated notifications,
 * no sessions to terminate).
 *
 * Endpoints:
 *   POST /mcp      — MCP JSON-RPC requests (initialize, tools/list, tools/call, ...)
 *   GET  /healthz  — plain-text "ok" for tunnel / host healthchecks
 *
 * Env:
 *   PORT  (default 3000)
 *   HOST  (default 0.0.0.0 — required for container/tunnel deploys)
 *
 * TLS is intentionally NOT handled here. Terminate https:// upstream:
 *   - cloudflared tunnel  → free, persistent URL, no port-forwarding
 *   - ngrok               → fastest ephemeral URL
 *   - Render / Fly / etc. → real hosting with managed certs
 */

import http from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createScrubServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Mcp-Session-Id, mcp-session-id, Last-Event-Id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

const JSONRPC_METHOD_NOT_ALLOWED = JSON.stringify({
  jsonrpc: "2.0",
  error: { code: -32000, message: "Method not allowed." },
  id: null,
});

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: string,
  extraHeaders: Record<string, string> = {}
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  if (method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (pathname === "/healthz" && method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain", ...CORS_HEADERS });
    res.end("ok");
    return;
  }

  if (pathname !== "/mcp") {
    sendJson(
      res,
      404,
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32601, message: `No handler for ${method} ${pathname}` },
        id: null,
      })
    );
    return;
  }

  if (method === "GET" || method === "DELETE") {
    sendJson(res, 405, JSONRPC_METHOD_NOT_ALLOWED, { Allow: "POST" });
    return;
  }

  if (method !== "POST") {
    sendJson(res, 405, JSONRPC_METHOD_NOT_ALLOWED, { Allow: "POST" });
    return;
  }

  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }

  const mcpServer = createScrubServer({ headers: req.headers });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on("close", () => {
    void transport.close();
    void mcpServer.close();
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scrub-http] error handling /mcp request:", message);
    if (!res.headersSent) {
      sendJson(
        res,
        500,
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        })
      );
    }
  }
});

server.listen(PORT, HOST, () => {
  console.error(`[scrub-http] listening on http://${HOST}:${PORT}`);
  console.error(`[scrub-http]   POST /mcp      — MCP Streamable HTTP endpoint`);
  console.error(`[scrub-http]   GET  /healthz  — healthcheck`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.error(`[scrub-http] ${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

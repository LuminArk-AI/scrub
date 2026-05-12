#!/usr/bin/env node
/**
 * One-command public endpoint.
 *
 * Spawns:
 *   1. The scrub HTTP server (`node dist/http.js`) on $PORT (default 3000)
 *   2. A cloudflared quick tunnel pointing at it
 *
 * Pipes both children's output with [scrub]/[tunnel] prefixes, parses the
 * cloudflared logs for the assigned trycloudflare.com URL, and prints a
 * banner with the public MCP endpoint. Ctrl-C (or either child exiting)
 * tears the whole thing down.
 *
 * cloudflared discovery, in order:
 *   1. $CLOUDFLARED_PATH if set and pointing at an existing binary
 *   2. ~/bin/cloudflared(.exe)
 *   3. `cloudflared` on PATH
 *
 * Usage:
 *   npm run serve:public            # builds first via the npm script chain
 *   PORT=4000 npm run serve:public  # different port
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const PORT = process.env.PORT ?? "3000";
const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

function findCloudflared(): string {
  const ext = platform() === "win32" ? ".exe" : "";
  const fromEnv = process.env.CLOUDFLARED_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const fromHome = join(homedir(), "bin", `cloudflared${ext}`);
  if (existsSync(fromHome)) return fromHome;
  return `cloudflared${ext}`;
}

function tag(name: string, ansi: string, line: string): void {
  if (!line.trim()) return;
  process.stdout.write(`\x1b[${ansi}m[${name}]\x1b[0m ${line.trimEnd()}\n`);
}

function pipeLines(
  child: ChildProcess,
  name: string,
  ansi: string,
  onLine?: (line: string) => void
): void {
  const wire = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) return;
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        tag(name, ansi, line);
        onLine?.(line);
      }
    });
    stream.on("end", () => {
      if (buf) {
        tag(name, ansi, buf);
        onLine?.(buf);
      }
    });
  };
  wire(child.stdout);
  wire(child.stderr);
}

const scrub = spawn("node", ["dist/http.js"], {
  env: { ...process.env, PORT },
  stdio: ["ignore", "pipe", "pipe"],
});
pipeLines(scrub, "scrub", "36"); // cyan

const cloudflaredBin = findCloudflared();
const tunnel = spawn(
  cloudflaredBin,
  ["tunnel", "--url", `http://localhost:${PORT}`, "--no-autoupdate"],
  { stdio: ["ignore", "pipe", "pipe"] }
);

let printedUrl = false;
pipeLines(tunnel, "tunnel", "35", (line) => {
  if (printedUrl) return;
  const match = line.match(TRYCLOUDFLARE_URL);
  if (!match) return;
  printedUrl = true;
  const bar = "=".repeat(60);
  process.stdout.write(
    `\n\x1b[32m${bar}\n  Public endpoint\n    POST    ${match[0]}/mcp\n    GET     ${match[0]}/healthz\n${bar}\x1b[0m\n\n` +
      `Ctrl-C to stop both processes.\n\n`
  );
});

tunnel.on("error", (err) => {
  const ext = platform() === "win32" ? ".exe" : "";
  console.error(
    `\n[serve-public] failed to launch cloudflared (${cloudflaredBin}): ${err.message}\n` +
      `Set $CLOUDFLARED_PATH, install to ~/bin/cloudflared${ext}, or add it to PATH.\n`
  );
  scrub.kill();
  process.exit(1);
});

let shuttingDown = false;
function shutdown(code = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;
  scrub.kill();
  tunnel.kill();
  setTimeout(() => process.exit(code), 250).unref();
}

scrub.on("exit", (code) => shutdown(code ?? 0));
tunnel.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

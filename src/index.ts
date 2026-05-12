#!/usr/bin/env node
/**
 * Scrub — MCP server for the Agents Assemble hackathon.
 *
 * "An AI that handles the repetitive tasks so clinicians can focus on
 * the more complicated stuff." — my mom, a nurse.
 *
 * This is the stdio entry point — meant for local use with the
 * MCP inspector or any host that spawns the server as a subprocess.
 * For a remote / HTTP-reachable endpoint, see src/http.ts.
 *
 * Three tools (defined in src/server.ts):
 *   1. get_patient_med_context  — assemble a one-page med summary
 *   2. explain_medication       — zoom in on one drug, full justification
 *   3. find_recent_changes      — diff of med activity over N days
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createScrubServer } from "./server.js";

const server = createScrubServer();
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[scrub] MCP server running on stdio");

#!/usr/bin/env node
/**
 * Scrub — MCP server for the Agents Assemble hackathon.
 *
 * "An AI that handles the repetitive tasks so clinicians can focus on
 * the more complicated stuff." — my mom, a nurse.
 *
 * Three tools:
 *   1. get_patient_med_context  — assemble a one-page med summary with
 *                                  why/who/when/what for every active drug
 *   2. explain_medication       — zoom in on one drug, full justification
 *   3. find_recent_changes      — diff of med activity over N days
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { extractSharpContext } from "./sharp.js";
import { getPatientMedContext } from "./tools/getPatientMedContext.js";
import { explainMedication } from "./tools/explainMedication.js";
import { findRecentChanges } from "./tools/findRecentChanges.js";

const server = new Server(
  { name: "scrub", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ---------- Tool listing ----------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_patient_med_context",
      description:
        "Assemble a one-page medication document for the patient in SHARP context. For every active medication, returns dosage, reason for use (linked Conditions), prescriber, authored date, generic/brand names, and therapeutic class. Answers 'what are they on and why?' in one call.",
      inputSchema: {
        type: "object",
        properties: {
          format: {
            type: "string",
            enum: ["json", "markdown"],
            description:
              "Response shape: json (structured, default) or markdown (one-page-style document).",
            default: "json",
          },
        },
      },
    },
    {
      name: "explain_medication",
      description:
        "Explain one specific medication in detail — what it is, why this patient is on it, and when it was prescribed. Use when a patient or clinician asks about a single drug.",
      inputSchema: {
        type: "object",
        properties: {
          medication_fhir_id: {
            type: "string",
            description:
              "FHIR resource ID of the MedicationRequest or MedicationStatement to explain.",
          },
        },
        required: ["medication_fhir_id"],
      },
    },
    {
      name: "find_recent_changes",
      description:
        "List medications that were started, changed, or stopped for this patient in the last N days. Pure diff — no judgment. Useful for answering 'what's new since last visit?'",
      inputSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Window in days to look back. Default 90.",
            default: 90,
          },
        },
      },
    },
  ],
}));

// ---------- Tool dispatch ----------

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const ctx = extractSharpContext(args);

  try {
    let result: any;
    switch (name) {
      case "get_patient_med_context": {
        const formatArg = args.format;
        const format =
          formatArg === "markdown" || formatArg === "json"
            ? formatArg
            : "json";
        result = await getPatientMedContext(ctx, { format });
        break;
      }
      case "explain_medication": {
        const medicationFhirId = args.medication_fhir_id;
        if (typeof medicationFhirId !== "string" || medicationFhirId.trim() === "") {
          throw new Error(
            "explain_medication requires medication_fhir_id (non-empty string)"
          );
        }
        result = await explainMedication(ctx, medicationFhirId);
        break;
      }
      case "find_recent_changes": {
        const daysArg = args.days;
        const days =
          typeof daysArg === "number" && Number.isFinite(daysArg) ? daysArg : 90;
        result = await findRecentChanges(ctx, days);
        break;
      }
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    const text =
      typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
    return {
      content: [{ type: "text", text }],
    };
  } catch (err: any) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { error: err.message ?? String(err) },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

// ---------- Go ----------

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[scrub] MCP server running on stdio");

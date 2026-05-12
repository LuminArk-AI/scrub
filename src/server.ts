/**
 * Scrub MCP server factory.
 *
 * Creates a fully-wired Server instance with all three tools registered and
 * dispatch logic ready to go. Used by both the stdio entry point (src/index.ts)
 * and the HTTP entry point (src/http.ts) so transport-specific code stays thin.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { extractSharpContext } from "./sharp.js";
import { getPatientMedContext } from "./tools/getPatientMedContext.js";
import { explainMedication } from "./tools/explainMedication.js";
import { findRecentChanges } from "./tools/findRecentChanges.js";

const TOOL_DEFINITIONS = [
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
] as const;

export function createScrubServer(): Server {
  const server = new Server(
    { name: "scrub", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const ctx = extractSharpContext(args);

    try {
      let result: unknown;
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
          if (
            typeof medicationFhirId !== "string" ||
            medicationFhirId.trim() === ""
          ) {
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
            typeof daysArg === "number" && Number.isFinite(daysArg)
              ? daysArg
              : 90;
          result = await findRecentChanges(ctx, days);
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const text =
        typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        content: [{ type: "text", text }],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message }, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

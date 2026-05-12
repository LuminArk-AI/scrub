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

import { extractSharpContext, type HeaderBag } from "./sharp.js";
import { getPatientMedContext } from "./tools/getPatientMedContext.js";
import { explainMedication } from "./tools/explainMedication.js";
import { findRecentChanges } from "./tools/findRecentChanges.js";

export interface ScrubServerOptions {
  /**
   * HTTP request headers, when running over the Streamable HTTP transport.
   * Used to pull Prompt Opinion's FHIR context (X-Patient-ID,
   * X-FHIR-Server-URL, X-FHIR-Access-Token) for each tool call.
   *
   * Not set under stdio; in that case context falls back to tool args or
   * SCRUB_* environment variables.
   */
  headers?: HeaderBag;
}

/**
 * SMART-on-FHIR scopes scrub needs to do its job.
 *
 * Required scopes (without these, none of the tools work):
 *   - patient/MedicationRequest.rs  — active prescriptions
 *   - patient/MedicationStatement.rs — self-reported / "patient is taking" meds
 *
 * Optional scope (server degrades gracefully without it):
 *   - patient/Condition.rs — used to resolve a med's reasonReference into
 *     a readable condition name (the "why" link). If denied, meds still
 *     return; the reason just won't be enriched.
 *
 * Not requested:
 *   - patient/Patient.rs — scrub never fetches the Patient resource; the
 *     patient ID arrives in the X-Patient-ID header.
 *   - offline_access — scrub does no background processing, every tool
 *     call is request-scoped.
 */
const FHIR_CONTEXT_EXTENSION = {
  scopes: [
    { name: "patient/MedicationRequest.rs", required: true },
    { name: "patient/MedicationStatement.rs", required: true },
    { name: "patient/Condition.rs" },
  ],
} as const;

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

export function createScrubServer(options: ScrubServerOptions = {}): Server {
  const server = new Server(
    { name: "scrub", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
        extensions: {
          "ai.promptopinion/fhir-context": FHIR_CONTEXT_EXTENSION,
        },
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const ctx = extractSharpContext(args, options.headers);

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

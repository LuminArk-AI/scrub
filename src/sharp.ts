/**
 * SHARP / FHIR context handling.
 *
 * Prompt Opinion injects FHIR context into MCP tool calls via HTTP headers
 * (when running over the Streamable HTTP transport). The headers are:
 *
 *   X-FHIR-Server-URL    base URL of the patient's FHIR server
 *   X-FHIR-Access-Token  bearer token for that FHIR server
 *   X-Patient-ID         the patient currently in focus
 *
 * For local development (stdio transport, no headers), the same three
 * values can be supplied via environment variables:
 *
 *   SCRUB_FHIR_BASE      → fhirBaseUrl
 *   SCRUB_FHIR_TOKEN     → fhirToken
 *   SCRUB_PATIENT_ID     → patientId
 *
 * Tool call args are also honored (`args._sharp`, `args._meta.sharp`, or
 * top-level `args.patient_id` / `args.fhir_base_url` / `args.fhir_token`)
 * so callers can override on a per-call basis if needed.
 *
 * Resolution order, highest priority first:
 *   1. tool call args (`_sharp`, `_meta.sharp`, top-level)
 *   2. HTTP request headers (Prompt Opinion's primary mechanism)
 *   3. environment variables (local dev)
 */

export interface SharpContext {
  patientId: string;
  fhirBaseUrl: string;
  fhirToken?: string;
}

const DEFAULT_FHIR_BASE = "https://hapi.fhir.org/baseR4";

export type HeaderBag = Record<string, string | string[] | undefined>;

function headerVal(headers: HeaderBag | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  const v = headers[lower] ?? headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function extractSharpContext(
  args: Record<string, any>,
  headers?: HeaderBag
): SharpContext {
  const fromArgs = args._sharp ?? args._meta?.sharp ?? {};

  const patientId =
    fromArgs.patientId ??
    args.patient_id ??
    headerVal(headers, "x-patient-id") ??
    process.env.SCRUB_PATIENT_ID;

  const fhirBaseUrl =
    fromArgs.fhirBaseUrl ??
    args.fhir_base_url ??
    headerVal(headers, "x-fhir-server-url") ??
    process.env.SCRUB_FHIR_BASE ??
    DEFAULT_FHIR_BASE;

  const fhirToken =
    fromArgs.fhirToken ??
    args.fhir_token ??
    headerVal(headers, "x-fhir-access-token") ??
    process.env.SCRUB_FHIR_TOKEN;

  if (!patientId) {
    throw new Error(
      "No patient ID in SHARP context. " +
        "Expected X-Patient-ID header from Prompt Opinion, or SCRUB_PATIENT_ID env var for local dev."
    );
  }

  return { patientId, fhirBaseUrl, fhirToken };
}

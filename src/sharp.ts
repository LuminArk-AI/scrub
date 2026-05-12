/**
 * SHARP context handling.
 *
 * Prompt Opinion injects healthcare context (patient ID, FHIR server URL,
 * FHIR auth token) into MCP tool calls via what they call "SHARP context."
 *
 * IMPORTANT: The exact field names below are placeholders based on the
 * shape described in the hackathon docs. Once you download the Prompt
 * Opinion reference implementation, replace these with the real names.
 * The three pieces of info are the same either way.
 */

export interface SharpContext {
    patientId: string;
    fhirBaseUrl: string;
    fhirToken?: string;
  }
  
  const DEFAULT_FHIR_BASE = "https://hapi.fhir.org/baseR4";
  
  /**
   * Pull SHARP context out of whatever the MCP tool call handed us.
   * Prompt Opinion may put this in:
   *   - _meta / _sharp field on the tool args
   *   - a special request header
   *   - an environment variable for local dev
   *
   * This handles all three so we're flexible while we figure out which.
   */
  export function extractSharpContext(args: Record<string, any>): SharpContext {
    const fromArgs = args._sharp ?? args._meta?.sharp ?? {};
  
    const patientId =
      fromArgs.patientId ??
      args.patient_id ??
      process.env.SCRUB_PATIENT_ID;
  
    const fhirBaseUrl =
      fromArgs.fhirBaseUrl ??
      args.fhir_base_url ??
      process.env.SCRUB_FHIR_BASE ??
      DEFAULT_FHIR_BASE;
  
    const fhirToken =
      fromArgs.fhirToken ??
      args.fhir_token ??
      process.env.SCRUB_FHIR_TOKEN;
  
    if (!patientId) {
      throw new Error(
        "No patient ID in SHARP context. Set SCRUB_PATIENT_ID for local dev."
      );
    }
  
    return { patientId, fhirBaseUrl, fhirToken };
  }

/**
 * FHIR resources have a lot of optional nesting. These normalizers pull
 * out the fields we actually care about so the rest of the code doesn't
 * have to deal with `?.` chains everywhere.
 */

import type { SharpContext } from "../sharp.js";
import { fhirSearch, fhirGet } from "./client.js";

export interface NormalizedMedication {
  fhirId: string;
  source: "MedicationRequest" | "MedicationStatement";
  name: string;
  rxnormCode?: string;
  dosage?: string;
  authoredOn?: string;
  requesterRef?: string;
  reasonRefs: string[];
  reasonTexts: string[];
  raw: any;
}

export async function fetchActiveMedications(
  ctx: SharpContext
): Promise<NormalizedMedication[]> {
  const [requests, statements] = await Promise.all([
    fhirSearch<any>(
      ctx,
      `/MedicationRequest?patient=${ctx.patientId}&status=active&_count=100`
    ),
    fhirSearch<any>(
      ctx,
      `/MedicationStatement?patient=${ctx.patientId}&status=active&_count=100`
    ),
  ]);

  const normalized: NormalizedMedication[] = [];

  for (const r of requests) {
    normalized.push({
      fhirId: r.id,
      source: "MedicationRequest",
      name: extractMedName(r.medicationCodeableConcept),
      rxnormCode: extractRxNorm(r.medicationCodeableConcept),
      dosage: r.dosageInstruction?.[0]?.text,
      authoredOn: r.authoredOn,
      requesterRef: r.requester?.reference,
      reasonRefs: (r.reasonReference ?? [])
        .map((x: any) => x.reference)
        .filter(Boolean),
      reasonTexts: (r.reasonCode ?? [])
        .map((x: any) => x.text ?? x.coding?.[0]?.display)
        .filter(Boolean),
      raw: r,
    });
  }

  for (const s of statements) {
    normalized.push({
      fhirId: s.id,
      source: "MedicationStatement",
      name: extractMedName(s.medicationCodeableConcept),
      rxnormCode: extractRxNorm(s.medicationCodeableConcept),
      dosage: s.dosage?.[0]?.text,
      authoredOn: s.dateAsserted,
      requesterRef: undefined,
      reasonRefs: (s.reasonReference ?? [])
        .map((x: any) => x.reference)
        .filter(Boolean),
      reasonTexts: (s.reasonCode ?? [])
        .map((x: any) => x.text ?? x.coding?.[0]?.display)
        .filter(Boolean),
      raw: s,
    });
  }

  return normalized;
}

function extractMedName(mcc: any): string {
  if (!mcc) return "unknown";
  return mcc.text ?? mcc.coding?.[0]?.display ?? "unknown";
}

function extractRxNorm(mcc: any): string | undefined {
  return mcc?.coding?.find(
    (c: any) => c.system === "http://www.nlm.nih.gov/research/umls/rxnorm"
  )?.code;
}

/**
 * Resolve a list of `Condition/123` references into readable condition names.
 * This is the "why is this patient on this drug" lookup.
 */
export async function resolveConditions(
  ctx: SharpContext,
  refs: string[]
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    refs.map(async (ref) => {
      try {
        const cond = await fhirGet<any>(ctx, `/${ref}`);
        const name =
          cond.code?.text ??
          cond.code?.coding?.[0]?.display ??
          "unknown condition";
        out[ref] = name;
      } catch {
        out[ref] = "(could not resolve)";
      }
    })
  );
  return out;
}

/**
 * Pull the most recent observation matching a given LOINC code.
 * Used for linking meds to their most relevant lab (e.g. metformin -> A1C).
 */
export async function fetchLatestObservation(
  ctx: SharpContext,
  loincCode: string
): Promise<{ value: string; date: string } | null> {
  const results = await fhirSearch<any>(
    ctx,
    `/Observation?patient=${ctx.patientId}&code=http://loinc.org|${loincCode}&_sort=-date&_count=1`
  );
  if (results.length === 0) return null;
  const obs = results[0];
  const value =
    obs.valueQuantity?.value !== undefined
      ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit ?? ""}`.trim()
      : obs.valueString ?? "(no value)";
  return {
    value,
    date: obs.effectiveDateTime ?? obs.issued ?? "unknown date",
  };
}
/**
 * Smoke test: hit HAPI FHIR and make sure we can pull medications for
 * a real patient. Run with: npm run test:fhir
 *
 * HAPI is the public FHIR sandbox — no auth, seeded with Synthea-style
 * synthetic patients. https://hapi.fhir.org/baseR4
 *
 * We score patients from a batch of active MedicationRequests (med count +
 * whether any med has reasons), then pick the best candidate for a richer demo.
 */

import { fhirSearch } from "../fhir/client.js";
import { fetchActiveMedications } from "../fhir/medications.js";

const ctx = {
  patientId: "", // filled in below
  fhirBaseUrl: "https://hapi.fhir.org/baseR4",
};

async function main() {
  console.log("[test] searching HAPI for patients with active medications...");

  // Find any MedicationRequest, then use its patient
  const reqs = await fhirSearch<any>(
    ctx,
    "/MedicationRequest?status=active&_count=20"
  );

  if (reqs.length === 0) {
    console.log("[test] no active MedicationRequests found on sandbox — try again later");
    return;
  }

  const patientIds = [
    ...new Set(
      reqs
        .map((r) => r.subject?.reference?.replace("Patient/", ""))
        .filter((id): id is string => Boolean(id))
    ),
  ];

  if (patientIds.length === 0) {
    console.log("[test] no patient references found in requests");
    return;
  }

  console.log(`[test] found ${patientIds.length} unique patients, checking each...`);

  const scored: { id: string; medCount: number; hasReasons: boolean }[] = [];
  for (const id of patientIds) {
    ctx.patientId = id;
    const meds = await fetchActiveMedications(ctx);
    const hasReasons = meds.some(
      (m) => m.reasonRefs.length > 0 || m.reasonTexts.length > 0
    );
    scored.push({ id, medCount: meds.length, hasReasons });
  }

  scored.sort((a, b) => {
    if (a.hasReasons !== b.hasReasons) return a.hasReasons ? -1 : 1;
    return b.medCount - a.medCount;
  });

  console.log("\n[test] top candidates:");
  for (const s of scored.slice(0, 5)) {
    console.log(`  Patient/${s.id}  meds=${s.medCount}  hasReasons=${s.hasReasons}`);
  }

  const best = scored[0];
  if (best) {
    ctx.patientId = best.id;
    const meds = await fetchActiveMedications(ctx);
    console.log(`\n[test] using best: Patient/${best.id}`);
    for (const m of meds) {
      console.log(`  - ${m.name}`);
      console.log(`      dosage: ${m.dosage ?? "(none)"}`);
      console.log(`      rxnorm: ${m.rxnormCode ?? "(none)"}`);
      console.log(`      reason refs: ${m.reasonRefs.join(", ") || "(none)"}`);
      console.log(`      reason texts: ${m.reasonTexts.join(", ") || "(none)"}`);
    }
    console.log(`\n[test] export SCRUB_PATIENT_ID=${best.id}`);
  }
}

main().catch((err) => {
  console.error("[test] failed:", err);
  process.exit(1);
});

/**
 * Smoke test: hit RxNav with a known drug code and make sure enrichment
 * works. Run with: npm run test:rxnav
 *
 * 860975 is the RxNorm code for metformin 500mg oral tablet — a good
 * test case because it has brand names, generic name, and ATC class.
 */

import { enrichDrug } from "../enrich/rxnav.js";

const testCodes = [
  { code: "860975", name: "metformin 500mg tab" },
  { code: "314076", name: "lisinopril 10mg tab" },
  { code: "617312", name: "atorvastatin 20mg tab" },
];

async function main() {
  for (const { code, name } of testCodes) {
    console.log(`\n[test] enriching ${name} (rxcui ${code})...`);
    const result = await enrichDrug(code);
    if (!result) {
      console.log("  -> no enrichment returned");
      continue;
    }
    console.log(`  generic:  ${result.genericName ?? "(none)"}`);
    console.log(`  brands:   ${result.brandNames.join(", ") || "(none)"}`);
    console.log(
      `  classes:  ${result.therapeuticClasses.join(", ") || "(none)"}`
    );
  }
}

main().catch((err) => {
  console.error("[test] failed:", err);
  process.exit(1);
});

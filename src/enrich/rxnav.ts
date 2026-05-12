/**
 * RxNav enrichment — pulls drug info from NIH's free public API.
 * No auth, no API key, no rate limit issues at hackathon scale.
 *
 * Docs: https://rxnav.nlm.nih.gov/RxNormAPIs.html
 *
 * This is the "stuff my mom would otherwise Google" layer. For each drug
 * we try to return:
 *   - generic name + brand name pair
 *   - therapeutic class(es)
 *   - a plain-language purpose line
 */

export interface DrugEnrichment {
    rxnormCode: string;
    genericName?: string;
    brandNames: string[];
    therapeuticClasses: string[];
    source: "RxNav";
  }
  
  // Cheap in-memory cache so repeated calls for the same drug don't hammer
  // the NIH API. Resets when the server restarts — that's fine for a hackathon.
  const cache = new Map<string, DrugEnrichment>();

function isPlausibleDrugMatch(genericName: string, displayName: string): boolean {
  const g = genericName.toLowerCase();
  const d = displayName.toLowerCase();
  const displayFirstToken = d.split(/\s+/)[0] ?? "";
  return d.includes(g) || (displayFirstToken.length > 0 && g.includes(displayFirstToken));
}
  
  export async function enrichDrug(
    rxnormCode: string,
    displayName?: string
  ): Promise<DrugEnrichment | null> {
    if (cache.has(rxnormCode)) {
      const cached = cache.get(rxnormCode)!;
      if (cached.genericName && displayName && !isPlausibleDrugMatch(cached.genericName, displayName)) {
        console.error(
          `[scrub] enrichment rejected: rxcui ${rxnormCode} maps to "${cached.genericName}" but display is "${displayName}" — likely upstream coding error`
        );
        return null;
      }
      return cached;
    }
  
    try {
      // Get related generic + brand names
      const relatedUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxnormCode}/related.json?tty=IN+BN`;
      const relatedRes = await fetch(relatedUrl);
      if (!relatedRes.ok) return null;
      const related: any = await relatedRes.json();
  
      const groups = related.relatedGroup?.conceptGroup ?? [];
      let genericName: string | undefined;
      const brandNames: string[] = [];
  
      for (const g of groups) {
        if (g.tty === "IN" && g.conceptProperties?.[0]) {
          genericName = g.conceptProperties[0].name;
        }
        if (g.tty === "BN" && g.conceptProperties) {
          for (const p of g.conceptProperties) brandNames.push(p.name);
        }
      }

      // Defensive check: reject enrichment when coded RxNorm identity and
      // chart display name do not plausibly refer to the same drug.
      if (genericName && displayName && !isPlausibleDrugMatch(genericName, displayName)) {
        console.error(
          `[scrub] enrichment rejected: rxcui ${rxnormCode} maps to "${genericName}" but display is "${displayName}" — likely upstream coding error`
        );
        return null;
      }
  
      // Get therapeutic class via RxClass
      const classUrl = `https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui=${rxnormCode}&relaSource=ATC`;
      const classRes = await fetch(classUrl);
      const therapeuticClasses: string[] = [];
      if (classRes.ok) {
        const classData: any = await classRes.json();
        const infos = classData.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
        for (const info of infos) {
          const className = info.rxclassMinConceptItem?.className;
          if (className && !therapeuticClasses.includes(className)) {
            therapeuticClasses.push(className);
          }
        }
      }
  
      const result: DrugEnrichment = {
        rxnormCode,
        genericName,
        brandNames: [...new Set(brandNames)].slice(0, 3),
        therapeuticClasses: therapeuticClasses.slice(0, 3),
        source: "RxNav",
      };
      cache.set(rxnormCode, result);
      return result;
    } catch (err) {
      console.error(`[scrub] RxNav lookup failed for ${rxnormCode}:`, err);
      return null;
    }
  }

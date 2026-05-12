/**
 * Tiny FHIR client. No heavy library — FHIR is just REST+JSON.
 * We only need GET + search, which is maybe 30 lines of fetch().
 */

import type { SharpContext } from "../sharp.js";

export async function fhirGet<T = any>(
  ctx: SharpContext,
  path: string
): Promise<T> {
  const url = `${ctx.fhirBaseUrl}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/fhir+json",
  };
  if (ctx.fhirToken) {
    headers.Authorization = `Bearer ${ctx.fhirToken}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`FHIR ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * FHIR returns a Bundle for search results. This unwraps it into a plain
 * array of resources, which is what you actually want 95% of the time.
 */
export async function fhirSearch<T = any>(
  ctx: SharpContext,
  path: string
): Promise<T[]> {
  const bundle = await fhirGet<{ entry?: Array<{ resource: T }> }>(ctx, path);
  return (bundle.entry ?? []).map((e) => e.resource);
}
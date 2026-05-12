# Scrub

> "An AI that handles the repetitive tasks so clinicians can focus on the more complicated stuff." — my mom, a nurse.

An MCP server that assembles scattered chart information into a single, printable medication document. Built for the [Agents Assemble hackathon](https://agents-assemble.devpost.com/) by [JinrixLabs](https://github.com/JinrixLabs).

## What it does

Three tools, each handling one repetitive task a clinician otherwise does by hand:

| Tool | Repetitive task it handles |
|---|---|
| `get_patient_med_context` | Assembling a full medication picture from scattered MedicationRequest + MedicationStatement resources, linking each drug to its Condition (the "why") and enriching it with NIH RxNav data (generic/brand/class) |
| `explain_medication` | Answering "what's this pill for and why am I on it?" with a grounded answer in 2 seconds instead of digging through records |
| `find_recent_changes` | Diffing a patient's medication list over the last N days to answer "what's new since last visit?" |

Everything returns structured JSON suitable for rendering into a one-page printable document inside Prompt Opinion's workspace.

## Design principles

1. **Repetitive work only.** Every tool is something a clinician already does mechanically. No diagnosis, no recommendations, no "this looks weird" flags. Judgment stays with the human.
2. **Grounded in FHIR.** Every claim links back to a FHIR resource ID the clinician can verify.
3. **NIH sources only.** Drug info comes from RxNav (public NIH API), the same place clinicians end up Googling to anyway.
4. **Print-friendly output.** Clinicians work from paper more than software expects.

## Setup

```bash
npm install
npm run test:fhir     # finds a real patient on HAPI sandbox and pulls their meds
npm run test:rxnav    # enriches a few known drug codes
npm run build
npm start
```

## SHARP context

This server expects Prompt Opinion to inject SHARP context (patient ID, FHIR base URL, auth token) into each tool call. For local dev, set environment variables instead:

```bash
export SCRUB_PATIENT_ID=<patient-id-from-test-fhir>
export SCRUB_FHIR_BASE=https://hapi.fhir.org/baseR4
# SCRUB_FHIR_TOKEN optional — HAPI doesn't require auth
```

The SHARP field extraction is in `src/sharp.ts` — update the field names there to match the Prompt Opinion reference implementation once you grab it.

## Stack

- TypeScript + Node
- `@modelcontextprotocol/sdk` (stdio transport)
- Raw `fetch()` for FHIR — no heavy client library
- NIH RxNav for drug enrichment (no auth, no rate limit pain)
- HAPI FHIR public sandbox for testing

## Layout

```
src/
├── index.ts                 # MCP server wiring (tool registration + dispatch)
├── sharp.ts                 # SHARP context extraction
├── fhir/
│   ├── client.ts            # tiny fetch-based FHIR client
│   └── medications.ts       # normalizers + condition/observation fetchers
├── enrich/
│   └── rxnav.ts             # NIH drug info lookup with in-memory cache
├── tools/
│   ├── getPatientMedContext.ts
│   ├── explainMedication.ts
│   └── findRecentChanges.ts
└── scripts/
    ├── test-fhir.ts         # smoke test against HAPI
    └── test-rxnav.ts        # smoke test against RxNav
```
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
npm start             # runs over stdio (for the MCP inspector / local subprocess hosts)
```

## Transports

Scrub speaks MCP over two transports out of the box. Same tools, same SHARP-context handling — just different ways of getting requests in.

### Stdio (local)

```bash
npm start             # built
npm run dev           # tsx, no build step
```

For local development with `@modelcontextprotocol/inspector` or any host that spawns the server as a subprocess.

### Streamable HTTP (remote)

```bash
npm run start:http    # built, listens on $PORT (default 3000)
npm run dev:http      # tsx
```

Endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /mcp` | MCP Streamable HTTP — initialize, `tools/list`, `tools/call` |
| `GET /healthz` | plain-text `ok` for tunnel / host healthchecks |

Stateless mode: every POST gets its own server + transport, no session tracking. Works behind any tunnel or load balancer without sticky sessions.

Env:

| Var | Default | Notes |
|---|---|---|
| `PORT` | `3000` | Standard for most hosting platforms |
| `HOST` | `0.0.0.0` | Required for containers / tunnels |

Quick smoke test once it's running:

```bash
curl http://localhost:3000/healthz
# -> ok

curl -X POST http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

### Going https://

TLS termination is intentionally not done in-process. Pick one:

- **[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) quick tunnel** — free, no signup, ephemeral `*.trycloudflare.com` URL.

  One command brings up both the server and the tunnel, prints the public URL, and tears down on Ctrl-C:
  ```bash
  npm run serve:public
  ```
  This builds, starts `node dist/http.js` on `$PORT` (default 3000), and spawns `cloudflared tunnel --url http://localhost:$PORT`. It looks for cloudflared in `$CLOUDFLARED_PATH`, then `~/bin/cloudflared(.exe)`, then `PATH`.

  Or manual two-terminal version:
  ```bash
  npm run start:http
  cloudflared tunnel --url http://localhost:3000
  ```
- **[ngrok](https://ngrok.com)** — fastest to spin up if you already have an account.
  ```bash
  npm run start:http
  ngrok http 3000
  ```
- **Render / Fly / Railway** — real hosting, free tier, permanent `*.onrender.com` (etc.) URL with a managed cert. Just point the platform at this repo, set the start command to `npm run build && npm run start:http`, and you're done.

Whichever you pick, your endpoint becomes `https://<host>/mcp`.

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
- `@modelcontextprotocol/sdk` (stdio + Streamable HTTP transports)
- Raw `fetch()` for FHIR — no heavy client library
- NIH RxNav for drug enrichment (no auth, no rate limit pain)
- HAPI FHIR public sandbox for testing

## Layout

```
src/
├── server.ts                # createScrubServer() — tool registration + dispatch
├── index.ts                 # stdio entry point
├── http.ts                  # Streamable HTTP entry point (stateless)
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
    ├── test-rxnav.ts        # smoke test against RxNav
    └── serve-public.ts      # spawn HTTP server + cloudflared tunnel together
```
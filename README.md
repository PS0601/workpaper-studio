# TRACE - Workpaper Studio

A working assessment prototype for Miraflores' **Redesign the Tax Workpaper** case.

**Start here:** open `submission/TRACE-Portable.html` in a desktop browser for the standalone demo. For shared, durable work and server-enforced permissions, run the server edition below. All 74 supplied documents and all 3,012 extracted values are included. The server loads the original JSON bytes without modifying the packet.

This is a review workspace, not a production tax-preparation service. No real tax return is transmitted, no legally valid Form 8879 signature is collected, and no external AI or tax service is called.

## Run the server

Use Node.js **22.16 or newer with `node:sqlite` support**. No npm dependencies or API keys are needed.

```sh
cd workpaper_studio
npm start
```

Open `http://localhost:3000` in your browser. The terminal prints the address. SQLite state is stored in `storage/trace.sqlite`; refreshes and server restarts retain work. Node 22 may print an experimental SQLite warning; that warning is not a failed startup.

An alternate port and private deployment gate are supported:

```sh
PORT=3001 ACCESS_CODE='choose-a-private-code' npm start
```

On Windows PowerShell:

```powershell
$env:PORT = "3001"
$env:ACCESS_CODE = "choose-a-private-code"
npm start
```

The role switcher is intentionally available for assessment demonstrations. An access code protects the deployment as a whole; it is **not** individual identity authentication.

## What to try first

1. In **Review queue**, open **Mileage page 3 repeats page 2**. Follow the two page references, then record the suggested correction with your own reason. The source stays unchanged; 11,800 miles becomes a reviewed 8,100, and the supported expense arithmetic becomes $5,670.
2. In **Return & schedules**, inspect `SchC.44a` and `SchC.9`. Follow inputs and downstream uses. Some complex tax computations are deliberately marked stale; the separate impact ledger uses the supplied marginal rates.
3. In **Changes & scenarios**, undo the correction or compare the three engine versions. Precomputed alternatives cannot be stacked on an adjusted base.
4. Create a shared, blocking question in **Team & review**, assign it to Erik, switch to Erik's client role, and reply. Switch to Daniel to record its resolution. Do not use a client reply as unverified proof.
5. Inspect **Filing vault**. Filing is blocked until required work, variance explanations, independent reviewer/partner approvals and both client authorizations are complete. Submission, acceptance and rejection are simulations.

The delivered workspace starts clean. The repository's test fixtures do not pre-resolve findings or manufacture client approvals in the delivered app.

## Two editions

| Edition | Storage and collaboration | Appropriate use |
| --- | --- | --- |
| Node + SQLite | Server-validated writes, revision conflicts, shared state, server-sent change notifications, append-only SHA-256 audit chain and frozen-record protections | Hosted assessment and multi-browser demonstration |
| Portable HTML | Local browser storage, backup/restore and same-origin tab notifications; original packet embedded in the file | Fast local preview without installation |

Portable mode is **not a security boundary**: anyone with the file has its embedded fictional source data. A local HTML file's storage behavior varies by browser and policy. Use the server edition for a durable or shared submission. If browser storage is blocked/full, a change is rejected rather than reported as saved. Back up the workspace regularly.

## Deployment

`Dockerfile` and `render.yaml` are included. A public deployment has **not** been created by this delivery.

For Render, put this project at the root of a Git repository, connect that repository to a Render Blueprint, and review `render.yaml` before approving deployment. It requests a Docker web service, a **paid starter plan**, and a 1 GB persistent disk at `/app/storage`. The generated `ACCESS_CODE` is available to the deployment owner in the service's environment settings; share it privately with the assessor. Check current pricing before approving charges. Do not remove the disk while claiming durable SQLite storage.

Render's guidance: <https://render.com/docs/web-services> and <https://render.com/docs/disks>.

For any Docker host:

```sh
docker build -t trace-workpaper .
docker run --rm -p 3000:3000 -v trace-data:/app/storage \
  -e ACCESS_CODE='choose-a-private-code' trace-workpaper
```

Use one server instance with this SQLite design. Multi-instance/serverless deployment requires a different shared-database architecture; Vercel-style ephemeral local files are not a substitute for a persistent SQLite volume. The container uses the host-provided `PORT` when supplied and listens on `0.0.0.0`.

## Submission materials

- `submission/CORE_IDEA_AND_DATA_MODEL.pdf`: the requested one-page concept and data-model explanation.
- `submission/CORE_IDEA_AND_DATA_MODEL.md`: editable text version.
- `submission/ERROR_REPORT.html` and `.md`: confirmed discrepancies, judgment gaps and engine diagnostics, with packet references.
- `submission/findings.json`: machine-readable initial finding catalog.
- `submission/WALKTHROUGH_SCRIPT.md`: a screen-by-screen narrative for **your own** required recording.
- `submission/REQUIREMENTS_AND_LIMITATIONS.md`: feature coverage and explicit boundaries.
- `submission/TEST_REPORT.md`: actual tests and their environment limitations.
- `submission/AI_DISCLOSURE.md`: generated-work disclosure to adapt truthfully.

Before submitting, publish the server edition, verify its public URL from a second browser, and record yourself explaining the product and tradeoffs. The assessment requires **your video link**; a script, screenshots or AI-written narration do not satisfy that requirement by themselves.

## Architecture

The original packet is immutable input. `public/core.js` resolves its document/value/line references and implements review transitions. `public/app.js` renders the interface and source viewer. `server.js` owns HTTP sessions, permission checks, optimistic concurrency, SQLite transactions and the audit hash chain. The portable build reuses the same domain logic but cannot enforce security against its file owner.

The data model separates:

- **Facts:** original documents/pages, extracted values, engine versions/lines, prior-year and agency records.
- **Human work:** adjustments, verifications, document dispositions, findings, notes/replies, decisions, links, evidence attachments, assignments, deadlines and time entries.
- **Control state:** workspace revision, review revision, actor, case clock, sign-offs, client authorizations and filing state.
- **Historical records:** immutable snapshots, branch provenance, audit events, handoffs and notice responses.

Each substantive change invalidates all area sign-offs and client approvals conservatively. An adjustment additionally invalidates changed/stale value-verification records. Original engine values, manually changed values, supported arithmetic and stale dependencies have distinct UI states.

## Tax calculation boundary

The packet says that its simplified engine cannot be rerun and that California AMT is not computed. TRACE therefore distinguishes **original engine totals**, **supported arithmetic bridges**, and **indicative tax effects** calculated from the supplied rates. Changes to payments affect balances one-to-one, not tax. Specific what-ifs use the supplied alternative results only against their base version. Manual economic deltas and sourcing assumptions are review inputs, not independently certified tax advice.

The $60 omitted M18 loss is retained as a visible manual review entry and in the effect ledger. Its complete downstream tax-form mapping is not automatically rebuilt. Large, interacting or threshold-crossing adjustments need an actual tax engine and CPA review. Do not aggregate the report's per-finding estimates and call the result a final return.

## Tests and rebuild

```sh
npm test
npm run build
```

`npm test` runs domain and live HTTP/SQLite tests with only Node built-ins. Integration tests use a temporary database and delete it afterward. `npm run build` creates the self-contained portable HTML and the initial findings JSON.

Browser QA source is in `tests/browser_workflows.py`; it requires Python Playwright and a Chromium executable. See `submission/TEST_REPORT.md` for the tested environment and how to reproduce it. Browser tooling is not an application runtime dependency.

## Backups and reset

For a consistent server backup, stop the server, then copy the entire `storage` directory. Do not delete WAL files while the server is running. Restart normally after the copy. Browser exports provide portable review records; they are not a substitute for the server database's authoritative audit chain.

For a fresh local demonstration, stop the server and set `DATA_DIR` to a new, empty directory. Keep previous databases rather than overwriting history. The server refuses to open an existing workspace with a different packet SHA-256.

## Security and scope

Read `SECURITY.md` before making a public deployment. Use fictional assessment data only. This prototype does not implement production identity, per-engagement tenancy, encryption-at-rest key management, legal e-signature controls, an IRS/FTB filing transport, disaster recovery or automatic seven-year destruction. It has not had an independent penetration test.

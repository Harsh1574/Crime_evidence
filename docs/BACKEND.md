# Crime Evidence Management — Backend

Node.js + TypeScript + Express REST API, PostgreSQL (via Prisma), with evidence
metadata stored on **IPFS** and referenced from a **Hyperledger Fabric** ledger.

## Architecture & flow

Every change to an evidence item follows the same pipeline:

```
request ──► PostgreSQL write ──► canonical metadata JSON ──► SHA-256 (metadataHash)
                                         │
                                         ▼
                              IPFS add ──► CID ──► Fabric asset {ID, Color=caseId,
                                                    Size=version, Owner=CID}  ──► tx ID
                                         │
                                         ▼
                        EvidenceVersion row (who, when, action, hash, CID, tx ID)
```

* **PostgreSQL** holds the working data: users, cases, case officers, evidence,
  files, custody events, disposal requests, notifications, activity, audit log.
* **IPFS** holds the evidence files and one metadata document per version (the
  data schema from the backend spec: `evidenceId, caseId, description, officerName,
  timestamp, status, custodyChain, …`).
* **The ledger** holds the pointer (CID) to the latest metadata document. Every
  transaction is also indexed in the `LedgerTransaction` table so reports can cite
  real transaction IDs.
* **Verify Integrity** re-hashes the stored files, rebuilds the metadata from the
  database and compares it with the anchored hash, the CID on the ledger and the
  document on IPFS → `VERIFIED`, `TAMPERED` or `UNVERIFIABLE`.

### Mock vs real mode

| Variable | `mock` (default) | real |
| --- | --- | --- |
| `LEDGER_MODE` | Append-only, hash-linked ledger in the `LedgerTransaction` table (each block stores the previous block's hash). | `fabric` — submits `CreateAsset` / `UpdateAsset` / `DeleteAsset` to the chaincode via `fabric-network`. Run `npm install fabric-network` and enroll a wallet identity (`enrollAdmin.js` / `registerUser.js`). |
| `IPFS_MODE` | Content-addressed files in `IPFS_MOCK_DIR` (default `./storage/ipfs`), with `Qm…` CIDs derived from SHA-256. | `kubo` — uses the IPFS HTTP API at `IPFS_URL` (default `http://127.0.0.1:5001`). |

If IPFS or the ledger is unreachable, the business action still succeeds but the
version is stored with `anchorStatus = FAILED`; `POST /api/v1/evidence/:id/anchor`
retries it.

## Environment variables

See [`.env.example`](../.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `JWT_SECRET` | dev fallback | JWT signing secret |
| `APP_PUBLIC_URL` | `http://localhost:3000` | Frontend URL used in QR verification links |
| `LEDGER_MODE` | `mock` | `mock` or `fabric` |
| `CCP_PATH` | `connection-org1.json` | Fabric connection profile |
| `WALLET_PATH` | `wallet` | Fabric wallet folder |
| `FABRIC_IDENTITY` | `appUser` | Wallet identity to use |
| `CHANNEL_NAME` | `crimechannel` | Fabric channel |
| `CHAINCODE_NAME` | `basic` | Chaincode name |
| `IPFS_MODE` | `mock` | `mock` or `kubo` |
| `IPFS_URL` | `http://127.0.0.1:5001` | IPFS API URL |
| `IPFS_MOCK_DIR` | `./storage/ipfs` | Mock IPFS folder |

## Setup

```bash
createdb crime_evidence
cp .env.example .env          # adjust DATABASE_URL
npm install                   # also runs prisma generate
npm run db:migrate            # create tables
npm run db:seed               # demo users (see README)
npm run dev:api               # http://localhost:3001
npm run test:acceptance       # in another terminal: end-to-end checklist
```

Other scripts: `npm run db:check` (connectivity), `npm run db:migrate:dev`
(create a new migration after editing `prisma/schema.prisma`).

## Roles

Permissions live in [`demo_config.json`](../demo_config.json) and are read at
runtime. Role names are case-insensitive (`PROSECUTOR` = `prosecutor`).

| Role | Key permissions |
| --- | --- |
| `admin` | everything below + `view_audit_log`, `delete_evidence` |
| `prosecutor` | `create_cases`, `manage_cases`, `manage_case_officers`, `request_disposal`, `generate_reports` |
| `collector` | `register_evidence`, `transfer_evidence`, `accept_transfers`, `update_evidence_status` |
| `forensic_analyst` | `accept_transfers`, `transfer_evidence`, `update_evidence_status` |
| `judge` | `approve_disposal` (the only role that can decide disposals), `view_all_evidence` |
| `auditor` | `read_only: true` (every write → 403), `view_all_evidence`, `view_audit_log` |

The original roles (`officer`, `head_officer`, `custodian`, `analyst`, `lawyer`)
are unchanged apart from a few added permissions.

## API

All endpoints except login/register/seed/health and the public verify page need
`Authorization: Bearer <token>`. Every route is served under both `/api/v1/…`
(used by the frontend) and `/api/…`. A Postman collection covering all of them
is in [`postman_collection.json`](../postman_collection.json).

### Auth

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/login` | `{ username, password }` → `{ token, user }` (user includes `permissions` and `readOnly`, used by the frontend to show/hide actions) |
| POST | `/api/auth/logout` | Revokes the current token — reusing it returns **401** |
| GET | `/api/auth/me` | Current user (incl. UUID) |
| POST | `/api/auth/register` | `{ username, email, fullName, role, password }` |
| POST | `/api/auth/seed` | Creates the demo users when the database is empty |

### Ledger-style evidence API (`/api/evidence`)

| Method | Path | Body / query |
| --- | --- | --- |
| POST | `/api/evidence` | `{ evidenceId?, caseId, description, officerName, type?, location?, collectionDate?, status? }` (JSON, or multipart with a file) |
| POST | `/api/evidence/bulk` | `{ evidenceList: [ … ] }` |
| GET | `/api/evidence` | `?caseId=&status=&officer=&startDate=&endDate=&search=&page=&limit=` |
| GET | `/api/evidence/:id` | `:id` = evidence ID (`EVID_2026_001`), UUID or IPFS CID. Returns ledger record + IPFS metadata; `ipfs_status: "IPFS_FETCH_FAILED"` when IPFS is down |
| PUT | `/api/evidence/:id` | any of `{ caseId, description, status, officerName }` |
| POST | `/api/evidence/:id/status` | `{ newStatus, officerName?, notes? }` |
| GET | `/api/evidence/:id/chain-of-custody` | custody history |
| POST | `/api/evidence/:id/chain-of-custody` | `{ fromOfficer, toOfficer, notes }` — starts a transfer that `toOfficer` must accept |
| DELETE | `/api/evidence/bulk` | `{ evidenceIds: [ … ] }` (admin) |
| DELETE | `/api/evidence/:id` | admin; the ledger keeps the history (`DeleteAsset` tx) |

Statuses: `COLLECTED → PROCESSING → ANALYZED → ARCHIVED → RELEASED` (plus
`PRESENTED`, and `DISPOSED` via the disposal workflow). Case-insensitive.

### Evidence (`/api/v1/evidence`)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/evidence` | multipart: `caseId, type, description, collectionDate, location, files[]` — files are SHA-256 hashed and added to IPFS |
| GET | `/api/v1/evidence` | same filters as above, frontend response shape |
| GET | `/api/v1/evidence/:id` | detail incl. `fileHash`, `metadataHash`, `ipfsCid`, `ledgerTxId` |
| PUT | `/api/v1/evidence/:id` | update metadata |
| POST | `/api/v1/evidence/:id/status` | `{ newStatus, notes? }` |
| POST | `/api/v1/evidence/:id/verify` | full integrity check → `integrity.status` = `VERIFIED` / `TAMPERED` / `UNVERIFIABLE` |
| GET | `/api/v1/evidence/:id/download` | original file (`X-File-SHA256`, `X-File-Integrity` headers) |
| GET | `/api/v1/evidence/:id/files/:fileId/download` | a specific file |
| GET | `/api/v1/evidence/:id/report` | PDF report with hashes, CIDs and ledger tx IDs |
| GET | `/api/v1/evidence/:id/versions` | version history (who / when / action / hash / CID / tx) |
| POST | `/api/v1/evidence/:id/anchor` | retry anchoring after an outage |
| POST | `/api/v1/evidence/batch` | `{ items: [ … ] }` |
| DELETE | `/api/v1/evidence/:id`, `/api/v1/evidence/bulk` | admin |

Comments, lab results, access requests, retention, archive/restore and the
collection receipt remain under `/api/v1/evidence/:evidenceId/…` as before.

### Custody

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/custody/evidence/:id/transfer` | `{ toUserId, reason }` — only the current custodian; locks the evidence |
| GET | `/api/v1/custody/pending` | incoming / outgoing pending transfers |
| POST | `/api/v1/custody/transfer/:id/approve` | recipient accepts (`{ signature }`) → custodian changes |
| POST | `/api/v1/custody/transfer/:id/reject` | recipient rejects (`{ reason }`) → custody unchanged |
| GET | `/api/v1/custody/:evidenceId/history` | full timeline |

### Disposal

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/evidence/:id/disposal-requests` | `{ reason }` — `request_disposal` (prosecutor) |
| GET | `/api/v1/disposals?status=pending` | queue for the judge |
| POST | `/api/v1/disposals/:requestId/approve` | `{ note }` — **judge only**, note mandatory → status `DISPOSED` |
| POST | `/api/v1/disposals/:requestId/reject` | `{ note }` — judge only |
| PUT | `/api/v1/evidence/:id/disposal-requests/:requestId` | `{ status: "approved"\|"rejected", reviewNotes }` (same rules) |

`/destruction-requests` paths remain as aliases.

### Cases

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/cases` | `{ title, description?, status? }` → returns `caseNumber` (`CASE_2026_001`) |
| GET / PUT | `/api/v1/cases/:id` | by UUID or case number |
| GET | `/api/v1/cases/:id/officers` | assigned officers |
| POST | `/api/v1/cases/:id/officers` | `{ userId }` (UUID, username or email) — case creator or admin |
| DELETE | `/api/v1/cases/:id/officers/:userId` | remove an officer |

Evidence registered with a `caseId` equal to a case's UUID or case number (or a
Crime Box linked to the case) is attached to that case; case officers can see it.

### Dashboard, notifications, audit

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/stats` | real counts, scoped to what the user can see |
| GET | `/api/v1/activity?mine=true` | activity feed (optionally only your own actions) |
| GET | `/api/v1/notifications` | `{ notifications, unreadCount }` |
| PUT | `/api/v1/notifications/read-all`, `/api/v1/notifications/:id/read` | mark read |
| GET | `/api/v1/audit-log` | `?userId=&username=&action=&entityId=&from=&to=&page=&limit=` — **admin and auditor only** (403 for others) |
| GET | `/api/v1/verify/:hash` | public; file hash, metadata hash or evidence ID |
| GET | `/api/v1/users?search=&role=` | active users (for transfer and case-officer pickers) |
| GET | `/api/v1/roles` | role names and display names |

The audit log records every login (and failed login), logout, every write
request with its status code, every 401/403 denial, report generation and file
download.

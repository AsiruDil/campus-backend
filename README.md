# Campus recruitment API

Node.js 24 and MongoDB 8 were used for validation. Install with `npm ci`, configure an ignored `.env` using `.env.example`, then run `npm start`. `MONGODB_URL` and a strong private `JWT_KEY` are required. Startup waits for MongoDB and checks the role migration before accepting requests. The default port is 3000.

## Roles and existing accounts

| Role | Access |
| --- | --- |
| User (`user`) | Apply for open positions and download their own documents. |
| Admin (`admin`, formerly Madam) | Review applications within their assigned faculty **and** department (or explicit all-faculty/all-department assignments); filter, shortlist, approve/select, reject, hold, download and email applicants. |
| Super Admin (`superadmin`, formerly Admin) | All applications, user/role/scope management, vacancy deadlines and five-year document retention. |

On the first updated backend startup, historical `admin` accounts become `superadmin`, and historical `madam` accounts become `admin`. Each account receives `roleVersion: 2` in the same atomic update, so repeat startups do not promote the new Admin accounts again. New accounts already use version 2. Back up the database before deploying a schema/role migration. Existing sessions should sign in again to receive the updated role and navigation.

Super Admin uses **Manage Users → Edit role and access** to assign an Admin's faculty and department. Names must match the vacancy metadata. An unassigned Admin sees no applications until assigned. Legacy applications resolve scope through their vacancy. API authorization reads current account permissions, so blocked accounts and changed permissions take effect even with old tokens. Self-registration cannot grant staff roles.

## Applications and documents

The frontend sends multipart form data to `POST /api/apply`: `jobId`, manually entered `nic`, `mobileNumber`, optional fallback `category`, one `cv` file and up to ten `supporting` files. CVs must be nonempty PDFs up to **2 MiB (2,097,152 bytes)**; supporting documents are PDF, PNG or JPEG up to 5 MiB each. Limits and file signatures are checked on the server. New vacancies support the built-in category metadata and custom categories, faculties, job types and locations. Historical recognizable position titles remain filterable; ambiguous old titles remain uncategorized.

The API automatically builds one ZIP containing `CV.pdf` and the supporting files, with collision-safe names. New documents are private files in `UPLOAD_DIR`, defaulting to `./uploads` relative to the backend. The existing `cv` field remains a protected CV-download URL. Downloads require authentication and correct ownership or reviewer scope. Historical external CV links remain readable in the review dashboard.

**Deployment:** mount `UPLOAD_DIR` on persistent storage shared by backend instances, and back it up together with MongoDB. Do not expose this folder as static public content. Allow multipart requests up to about 55 MiB in any reverse proxy. Profile photos now use authenticated POST /api/users/profile-photo uploads (PNG/JPEG up to 2 MiB), stored under UPLOAD_DIR/avatars with generated owner-prefixed filenames. Avatars are public optional profile images; CVs and supporting documents remain private. Only an account's own managed photos are replaced.

Submission rejects unavailable/expired vacancies. Super Admin can edit a vacancy's exact deadline in local time; the UI sends UTC to the backend and displays dates in the browser's timezone. Deadlines are enforced on the server.

## Review and notification

- `GET /api/apply?category=lecturer&status=pending&jobId=…` lists authorized applications. Older records without a status are pending.
- `PATCH /api/apply/:id/status` accepts `pending`, `shortlisted`, `selected`, `rejected`, `hold`; reviewer, date and review history are retained.
- `GET /api/apply/:id/documents` downloads the ZIP; `GET /api/apply/:id/cv` downloads its CV.
- `POST /api/apply/email` accepts `applicationIds` (1–200), `subject`, `message` and optional `shortlistedOnly`. Recipients are resolved server-side within scope, deduplicated and hidden using BCC. Configure backend-only `RESEND_API_KEY` and `RESEND_FROM` for Resend. Use a sender on a verified domain; `onboarding@resend.dev` is for testing with your Resend account email only. Accepted recipients are logged and `lastNotifiedAt` updated. Partial delivery rejection returns HTTP 207 and counts; no email configuration returns 503. Provider acceptance does not prove inbox delivery.

To notify a shortlist, select applications, click **Shortlist selected**, reselect them and choose **Email shortlist**. Existing selected-applicant messaging is also available.

## Five-year retention

Super Admin can preview the eligible count, then use **Delete expired documents** and confirm. Eligibility is based on the application submission date at least five calendar years ago. CVs and supporting files are deleted; application records and review history remain with a deletion timestamp/reviewer. There is no automatic purge or deletion of recent files.

For historical Supabase CVs, configure the server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with deletion permission on the existing `cv` bucket. Never expose the service-role key in frontend `VITE_` variables. Only URLs from that configured project and bucket may be deleted. Legacy CVs also referenced by recent applications are preserved. Failed deletions preserve their record for retry and are reported, rather than claiming success.

## Validation

`npm test` runs the API and security integration tests using an isolated MongoDB test database, temporary document storage and a stub email transport. It covers role migration/repeatability, uploads/ZIP contents, size/type/NIC validation, deadlines, role/scope/ownership checks, status filters/history, BCC deduplication, partial mail failures, and retention/retry behavior. No real emails are sent.

By default, `mongodb-memory-server` downloads MongoDB 8.0.12 from `fastdl.mongodb.org` (including checksum verification). If this destination is unavailable, use a dedicated local test server:

```sh
docker run --name campus-test-mongo -d -p 127.0.0.1:27018:27017 mongo:8.0
MONGODB_TEST_URL=mongodb://127.0.0.1:27018 npm test
```

Tests create a uniquely named database and delete only that database afterward. The test server is not the application's configured database. See the frontend README for the real-browser integration workflows, which also use isolated fixtures and no real email delivery. Do not run the browser fixture as your development or production backend.

Registration stores a temporary signup with a hashed password after Resend accepts the OTP email. The account is created only after valid OTP verification. Codes expire after ten minutes; MongoDB TTL cleanup removes expired pending signups. Failed email requests create no account. Existing unverified accounts can still verify their current OTP.

## Production hardening (October 2026)

See the workspace `PRODUCTION-READINESS.md` for verified coverage, deployment prerequisites and remaining external-service checks. The backend also contains docs/production-readiness.md and deploy/nginx.conf for deployment review. Both projects have a CI workflow for lint/build or backend integration tests plus dependency audit. Local `.env` files are private; use `.env.example` for documented variable names.

`npm start` runs the API with Node; `npm run dev` uses `node --watch`. Production requires `NODE_ENV=production`, a 32-byte-or-longer JWT secret, HTTPS `FRONTEND_URL`, exact `CORS_ORIGINS`, a persistent `UPLOAD_DIR` and a non-test verified email sender. Optional Google login requires an HTTPS `GOOGLE_CALLBACK_URL`. `/health` checks the process; `/ready` checks MongoDB connectivity. Configure exact `TRUST_PROXY_HOPS` only behind trusted proxies. CORS defaults to `FRONTEND_URL` in development. Rate limits are per process; use a shared store/edge limit when scaling out.

## Supabase storage

New photos and application ZIPs now use private Supabase buckets through the authenticated backend. See [Supabase setup and migration](docs/supabase-storage.md). The configured bucket names are `im` (photos) and `cv` (application ZIPs). Add `SUPABASE_URL` (project origin, without `/rest/v1/`) and the server-only `SUPABASE_SERVICE_ROLE_KEY` to backend `.env`, then run `npm run storage:setup` and restart. The supplied anon key cannot replace the server credential. Neither credential values nor signed object URLs are returned to browsers.

`STORAGE_PROVIDER=supabase` is the default. Existing local references remain readable using `UPLOAD_DIR`. `npm run storage:migrate` is a dry run; `npm run storage:migrate -- --apply` uploads local files, verifies SHA-256 checksums and updates references while retaining original files. Both buckets must be private. Existing legacy public CV links need review before changing a live `cv` bucket from public to private. No real Supabase upload was verified because the service-role key is not configured; all 32 backend tests passed with mocked remote storage.

Profile photos are Supabase-only. STORAGE_PROVIDER=local applies only to application documents. Existing local photos must be migrated or uploaded again; default profile.png remains bundled.

Supabase-only update: local file storage and STORAGE_PROVIDER have been removed for both application files and profile photos. New application ZIPs go to cv; photos go to im. MongoDB Atlas keeps application metadata and references. UPLOAD_DIR is only used by the one-off migration script; migrate older local files before downloading them. Original files are not deleted automatically.

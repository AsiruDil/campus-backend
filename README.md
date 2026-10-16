# Campus recruitment API

Node.js 24 and MongoDB 8 were used for validation. Install with `npm ci`, configure an ignored `.env` using `.env.example`, then run `npm start`. `MONGODB_URL` and a strong private `JWT_KEY` are required. Startup waits for MongoDB and checks the role migration before accepting requests. The default port is 3000.

## Roles and existing accounts

| Role | Access |
| --- | --- |
| User (`user`) | Apply for open positions and download their own documents. |
| Admin (`admin`, formerly Madam) | Review applications within their assigned faculty **and** department; filter, shortlist, approve/select, reject, hold, download and email applicants. |
| Super Admin (`superadmin`, formerly Admin) | All applications, user/role/scope management, vacancy deadlines and five-year document retention. |

On the first updated backend startup, historical `admin` accounts become `superadmin`, and historical `madam` accounts become `admin`. Each account receives `roleVersion: 2` in the same atomic update, so repeat startups do not promote the new Admin accounts again. New accounts already use version 2. Back up the database before deploying a schema/role migration. Existing sessions should sign in again to receive the updated role and navigation.

Super Admin uses **Manage Users → Edit role and access** to assign an Admin's faculty and department. Names must match the vacancy metadata. An unassigned Admin sees no applications until assigned. Legacy applications resolve scope through their vacancy. API authorization reads current account permissions, so blocked accounts and changed permissions take effect even with old tokens. Self-registration cannot grant staff roles.

## Applications and documents

The frontend sends multipart form data to `POST /api/apply`: `jobId`, manually entered `nic`, `mobileNumber`, optional fallback `category`, one `cv` file and up to ten `supporting` files. CVs must be nonempty PDFs up to **2 MiB (2,097,152 bytes)**; supporting documents are PDF, PNG or JPEG up to 5 MiB each. Limits and file signatures are checked on the server. New vacancies use `lecturer`, `probationary` or `demo` category metadata. Historical recognizable position titles remain filterable; ambiguous old titles remain uncategorized.

The API automatically builds one ZIP containing `CV.pdf` and the supporting files, with collision-safe names. New documents are private files in `UPLOAD_DIR`, defaulting to `./uploads` relative to the backend. The existing `cv` field remains a protected CV-download URL. Downloads require authentication and correct ownership or reviewer scope. Historical external CV links remain readable in the review dashboard.

**Deployment:** mount `UPLOAD_DIR` on persistent storage shared by backend instances, and back it up together with MongoDB. Do not expose this folder as static public content. Allow multipart requests up to about 55 MiB in any reverse proxy. Frontend profile images continue to use the existing Supabase integration.

Submission rejects unavailable/expired vacancies. Super Admin can edit a vacancy's exact deadline in local time; the UI sends UTC to the backend and displays dates in the browser's timezone. Deadlines are enforced on the server.

## Review and notification

- `GET /api/apply?category=lecturer&status=pending&jobId=…` lists authorized applications. Older records without a status are pending.
- `PATCH /api/apply/:id/status` accepts `pending`, `shortlisted`, `selected`, `rejected`, `hold`; reviewer, date and review history are retained.
- `GET /api/apply/:id/documents` downloads the ZIP; `GET /api/apply/:id/cv` downloads its CV.
- `POST /api/apply/email` accepts `applicationIds` (1–200), `subject`, `message` and optional `shortlistedOnly`. Recipients are resolved server-side within scope, deduplicated and hidden using BCC. Configure `EMAIL_USER`/`EMAIL_PASS` for Gmail SMTP. Accepted recipients are logged and `lastNotifiedAt` updated. Partial delivery rejection returns HTTP 207 and counts; no email configuration returns 503. SMTP acceptance does not prove inbox delivery.

To notify a shortlist, select applications, click **Shortlist selected**, reselect them and choose **Email shortlist**. Existing selected-applicant messaging is also available.

## Five-year retention

Super Admin can preview the eligible count, then use **Delete expired documents** and confirm. Eligibility is based on the application submission date at least five calendar years ago. CVs and supporting files are deleted; application records and review history remain with a deletion timestamp/reviewer. There is no automatic purge or deletion of recent files.

For historical Supabase CVs, configure the server-only `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with deletion permission on the existing `cv` bucket. Never expose the service-role key in frontend `VITE_` variables. Only URLs from that configured project and bucket may be deleted. Legacy CVs also referenced by recent applications are preserved. Failed deletions preserve their record for retry and are reported, rather than claiming success.

## Validation

`npm test` runs 18 API integration tests using an isolated MongoDB test database, temporary document storage and a stub email transport. It covers role migration/repeatability, uploads/ZIP contents, size/type/NIC validation, deadlines, role/scope/ownership checks, status filters/history, BCC deduplication, partial mail failures, and retention/retry behavior. No real emails are sent.

By default, `mongodb-memory-server` downloads MongoDB 8.0.12 from `fastdl.mongodb.org` (including checksum verification). If this destination is unavailable, use a dedicated local test server:

```sh
docker run --name campus-test-mongo -d -p 127.0.0.1:27018:27017 mongo:8.0
MONGODB_TEST_URL=mongodb://127.0.0.1:27018 npm test
```

Tests create a uniquely named database and delete only that database afterward. The test server is not the application's configured database. See the frontend README for the four real-browser integration workflows, which also use isolated fixtures and no real email delivery. Do not run the browser fixture as your development or production backend.

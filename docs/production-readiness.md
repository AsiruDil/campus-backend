# Production readiness review

Reviewed 19 October 2026. Source hardening and local verification are complete; a live deployment is not verified or approved by these results. Final frontend browser/build verification remains outstanding because execution was declined.

## Verification

- Backend: 30 tests pass, covering signup/OTP, password reset/session revocation, role migration, profile completion, file validation/ownership, scope, status changes, email acceptance/failures, and document retention.
- Browser: the 10-test suite passed before the final authenticated-avatar migration, covering user/admin/super-admin login, submission, profiles, filters, custom vacancy options, role assignments, shortlisting, decisions, download, email status, retention and mobile layouts.
- Frontend ESLint passes on the final source. The Vite production build passed before the final avatar migration. The requested final browser/build rerun was declined; those two checks remain outstanding for the latest source.
- Both full npm dependency audits report zero known vulnerabilities after compatible upgrades and removal of unused dependencies. This is a point-in-time scan, not a guarantee against undiscovered issues.
- Tests use isolated databases/files and stub email delivery. They do not send real mail, perform a real Google sign-in, or validate the deployment infrastructure. Authenticated avatar upload/replacement is tested locally.

## Changes made

- Replaced anonymous browser-storage profile uploads with authenticated backend image upload/replacement and removed the unused Supabase utility.
- Added Helmet API headers, no-store caching, an exact CORS allowlist, login/OTP/email throttles, and a cap on concurrent in-memory uploads.
- Authentication rejects object/operator injection, missing text and oversized passwords. New/reset passwords use asynchronous bcrypt with a minimum of eight characters and a maximum of 72 bytes.
- Password reset increments an account session version; old tokens can no longer access protected endpoints.
- Google sign-in checks browser-bound random state, supports a configured production callback, and returns JWTs in a URL fragment instead of a query string. The frontend immediately removes the fragment.
- Production startup rejects missing/weak configuration, localhost/HTTP frontend origins, test email senders, and incomplete Google settings. Added health/readiness endpoints and graceful shutdown.
- npm start uses node; npm run dev uses Node's built-in watch mode. No production dependency on a development watcher.
- Added CI workflows for both repositories. Backend CI runs tests/audit; frontend CI runs lint/build/audit. Full browser tests require both sibling directories and remain available with npm run test:e2e.
- Stopped tracking frontend .env while keeping the local file, added a safe frontend .env.example, and preserved backend .env. Historical Git commits are not rewritten.

## Required before a public launch

1. **Email:** the current local backend uses a Resend test sender. Configure RESEND_FROM on a verified domain and verify actual registration/reset/applicant email delivery. Do not claim delivery from provider acceptance alone.
2. **Persistent documents:** the local environment has no explicit UPLOAD_DIR. Set an absolute persistent path, mount it outside the public web root, and verify database/file backup and restore together.
3. **Hosting:** deploy behind HTTPS; set NODE_ENV=production, FRONTEND_URL, exact CORS_ORIGINS and VITE_BACKEND_URL to the deployed origin. Set TRUST_PROXY_HOPS only when the proxy chain is known. Keep MongoDB and the backend port private. Enable TLS/HSTS and request limits at the edge. The included nginx template assumes one origin for frontend and API and needs deployment-specific paths/domain.
4. **Profile photos:** new PNG/JPEG photos (maximum 2 MB) now use authenticated backend uploads under UPLOAD_DIR/avatars. The API validates content, generates filenames, and replaces only files owned by the signed-in account. Avatar reads are public by design; private CVs never use this route. Existing external URLs still display. Remove any old public-write/delete Supabase bucket policies separately; new uploads no longer need Supabase browser credentials. Package removal was not approved, so the unused Supabase dependency remains installed but is not imported into the application.
5. **Google:** configure GOOGLE_CALLBACK_URL and the matching Google console redirect URI. Verify successful sign-in, cancellation, blocked accounts and callback rejection on the deployed host. Optional Google routes remain unavailable without credentials.
6. **Abuse prevention:** the included throttles are per-process/in-memory. For multiple instances use a shared rate-limit store or a shared edge limiter, including per-account OTP limits and upload limits. Monitor failures and resource usage. Review resource limits and pagination for the expected data volume.
7. **Browser tokens:** existing bearer tokens remain in localStorage, so frontend script integrity matters. The nginx template supplies a restrictive script CSP. For stronger protection, plan a tested HttpOnly-cookie/BFF session migration with CSRF protection rather than changing authentication storage without testing the full flow.
8. **Secrets/history:** .env is excluded going forward. If private credentials were ever committed, rotate them and arrange a separate history cleanup. No environment values were printed or committed by this review.
9. **Final frontend verification:** rerun npm run lint, npm run test:e2e and npm run build after the avatar migration; the final combined browser/build command was not approved during this review. Do not deploy the older build.
10. **Release smoke test:** verify public pages and deep-link reloads, all roles, actual uploads/downloads, real mail/Google flows, default/custom avatars, 401/403 handling, and backups on staging using production-equivalent settings.

## Cleanup

Removed unreferenced template assets (react.svg, vite.svg), empty App.css and unused stub components (AdminProfile, upload), the unused old job card and NIC helper, old UI screenshots and a workspace PowerShell cache. The unused browser Supabase dependency remains installed because its removal was not approved. Existing inline NIC calculations were preserved. Tests, lockfiles, source assets in use, local environment files and application uploads were retained. Generated build/test outputs are ignored. Stale build/test output from the earlier revision was removed so it cannot be mistaken for a verified release.

## Run locally

Use Node 24, npm ci in both directories, npm test in campus-backend, and npm run lint / npm run test:e2e / npm run build in campus-frontend. The Playwright fixture explicitly allows its own test origin. Install Playwright Chromium or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH. Do not point tests at a production database.

Reference: https://expressjs.com/en/advanced/best-practice-security/ .

## Supabase storage update

The storage design was subsequently changed at the user's request: new images and application ZIPs use backend-controlled private Supabase storage (`im` and `cv`). Server-only credentials are required; the anon key supplied is not sufficient. No privileged key was added to frontend configuration. All 32 backend tests pass, including mocked cloud upload/read/delete and cloud photo replacement. Real-project storage verification remains pending the service-role key and private bucket setup. Existing local references still work; a checksum-verifying migration script retains local source files. See campus-backend/docs/supabase-storage.md. Earlier references in this review to local storage as the new-upload destination are superseded by this update.

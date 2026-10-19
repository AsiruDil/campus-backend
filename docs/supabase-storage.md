# Supabase file storage

New photos and application documents are uploaded by the authenticated backend, not directly by the browser. MongoDB stores application/profile metadata and the storage reference. Application CVs and supporting documents remain grouped in a ZIP.

## Configure

In the backend's private .env:

```dotenv
STORAGE_PROVIDER=supabase
SUPABASE_URL=https://qdmjewlitryupfhszcna.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY
SUPABASE_AVATARS_BUCKET=im
SUPABASE_DOCUMENTS_BUCKET=cv
```

Use the project origin, without /rest/v1/. An anon key is not the service-role key and cannot be used for this backend integration. Find the service-role key in your Supabase project's API keys settings and paste it directly into the backend .env. Never put this key in chat, Git, or VITE_ variables.

Both buckets must be PRIVATE. The backend refuses to start against a public bucket. No anonymous upload/delete policies are required: the server key accesses storage after the application's own role/ownership checks. Existing anonymous write/delete policies should be removed in the Supabase dashboard.

Allow image/png and image/jpeg in im (at least 2 MiB object limit), and application/zip in cv (at least 60 MiB object limit to allow an application package). Existing bucket restrictions must be checked in the dashboard. Setup creates missing buckets with these restrictions, but does not silently change existing bucket visibility or policies.

Run npm run storage:setup to verify/create private buckets, then restart the backend. Startup also checks the private buckets. In development, missing credentials allow the API to start, but uploads return HTTP 503 until configured. Production startup still requires storage credentials. No upload silently falls back to local storage.

## Reads and deletion

The browser keeps using the same backend URLs. Avatar photos are readable through the photo API. CV/ZIP reads require application ownership or reviewer scope; the backend retrieves the private object. Bucket/object references are server-generated and never accept arbitrary paths. Failed storage writes do not create application records. The retention process removes cloud objects before marking records deleted; failures preserve references for retry.

## Existing local files

Set UPLOAD_DIR to the old upload directory only when running the migration script. The application no longer reads or writes local photos or application ZIPs. Existing local files must be migrated before their download links will work. Back up MongoDB and this folder first.

```sh
npm run storage:migrate
npm run storage:migrate -- --apply
```

The first command is a dry run. The second uploads local application ZIPs and managed photos, verifies SHA-256 checksums, and updates references only after verification. Original local files are retained. Failed records keep their original references. Re-running skips migrated records and verifies already uploaded objects on interrupted runs.

Historical externally linked Supabase CVs are not moved by the local-file migration. Changing an existing cv bucket from public to private will invalidate old public CV links; review/migrate those records before changing bucket visibility in a live installation.

## Verification

Storage tests use a mocked Supabase transport; they cover ZIP upload/read/CV extraction/deletion, private bucket validation, upload failure without local fallback, and cloud photo replacement. A real-project smoke test still requires the server key and the dashboard bucket settings.

Reference: https://supabase.com/docs/guides/storage/security/access-control

Both profile photos and application files always use Supabase. STORAGE_PROVIDER and the local storage mode have been removed. There is no local photo or application-file fallback. The bundled /profile.png remains the default avatar.

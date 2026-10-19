import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { storageTransport, ensurePrivateBucket, cloudReference, avatarReference, decodeAvatarReference } from '../services/storage.js';
import { createArchive, readArchive, readCV, removeArchive } from '../services/documents.js';

test('private Supabase archives upload, download, extract CV and delete without local fallback', async () => {
  const previous = { ...process.env };
  const originalFetch = storageTransport.fetch;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'campus-cloud-test-'));
  const objects = new Map();
  try {
    Object.assign(process.env, { STORAGE_PROVIDER: 'supabase', SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', SUPABASE_DOCUMENTS_BUCKET: 'applications', UPLOAD_DIR: directory });
    storageTransport.fetch = async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer server-test-key');
      assert.equal(options.headers.apikey, 'server-test-key');
      const route = new URL(url).pathname;
      if (options.method === 'POST') { assert.equal(options.headers['x-upsert'], 'false'); objects.set(route, Buffer.from(options.body)); return Response.json({ Key: route }); }
      if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) objects.delete(`${route}/${key}`); return Response.json([]); }
      const key = route.replace('/authenticated/', '/');
      return objects.has(key) ? new Response(objects.get(key)) : Response.json({ statusCode: '404' }, { status: 400 });
    };
    const cv = Buffer.from('%PDF-1.4 test');
    const archive = await createArchive({ cv: [{ originalname: 'CV.pdf', size: cv.length, buffer: cv }] });
    assert.match(archive.archiveKey, /^supabase:applications\/[a-f0-9-]+\.zip$/);
    assert((await readArchive(archive.archiveKey)).length > 0);
    assert((await readCV(archive.archiveKey)).equals(cv));
    assert.deepEqual(await readdir(directory), []);
    await removeArchive(archive.archiveKey);
    assert.equal(objects.size, 0);
    await assert.rejects(readArchive(archive.archiveKey), { code: 'ENOENT' });
    storageTransport.fetch = async () => Response.json({ message: 'failed' }, { status: 500 });
    await assert.rejects(createArchive({ cv: [{ originalname: 'CV.pdf', size: cv.length, buffer: cv }] }), { status: 503 });
    assert.deepEqual(await readdir(directory), []);
    assert.throws(() => cloudReference('applications', '../secret'));
    assert.throws(() => readArchive('11111111-1111-1111-1111-111111111111.zip'), /migration/);
    const reference = cloudReference('photos', 'a'.repeat(24) + '-11111111-1111-1111-1111-111111111111.png');
    assert.equal(decodeAvatarReference(avatarReference(reference)), reference);
    storageTransport.fetch = async () => Response.json({ public: true });
    await assert.rejects(ensurePrivateBucket('documents'), /must be private/);
  } finally {
    storageTransport.fetch = originalFetch;
    for (const key of ['STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DOCUMENTS_BUCKET', 'UPLOAD_DIR']) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(directory, { recursive: true, force: true });
  }
});

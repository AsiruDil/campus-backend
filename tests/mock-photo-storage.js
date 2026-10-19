import { storageTransport } from '../services/storage.js';

// Test-only cloud transport. No live storage calls or local photo writes.
export function mockPhotoStorage() {
  const originalFetch = storageTransport.fetch;
  const keys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_AVATARS_BUCKET', 'SUPABASE_DOCUMENTS_BUCKET'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', SUPABASE_AVATARS_BUCKET: 'photos', SUPABASE_DOCUMENTS_BUCKET: 'applications' });
  const objects = new Map();
  storageTransport.fetch = async (url, options) => {
    const route = new URL(url).pathname;
    if (options.method === 'POST') { objects.set(route, Buffer.from(options.body)); return Response.json({}); }
    if (options.method === 'DELETE') { for (const key of JSON.parse(options.body).prefixes) objects.delete(`${route}/${key}`); return Response.json([]); }
    const key = route.replace('/authenticated/', '/');
    return objects.has(key) ? new Response(objects.get(key)) : Response.json({ statusCode: 404 }, { status: 400 });
  };
  return () => {
    storageTransport.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  };
}

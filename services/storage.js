const bucketPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const keyPattern = /^[a-f0-9-]+\.(zip|png|jpg)$/;
export function storageSettings() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { const error = new Error('File storage is not configured. Please try again later.'); error.status = 503; throw error; }
  try {
    if (JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString()).role === 'anon') throw new Error('ANON_KEY');
  } catch (error) { if (error.message === 'ANON_KEY') throw new Error('An anon key cannot be used as SUPABASE_SERVICE_ROLE_KEY. Add the server-only service-role key.'); }
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('SUPABASE_URL must be an HTTPS project origin.');
  return { origin: base.origin, key };
}
export function storageBucket(kind) {
  const bucket = kind === 'avatars' ? process.env.SUPABASE_AVATARS_BUCKET || 'profile-photos' : process.env.SUPABASE_DOCUMENTS_BUCKET || 'applications';
  if (!bucketPattern.test(bucket)) throw new Error('Invalid Supabase bucket name.');
  return bucket;
}
export function cloudReference(bucket, key) {
  if (!bucketPattern.test(bucket) || !keyPattern.test(key)) throw new Error('Invalid storage reference.');
  return `supabase:${bucket}/${key}`;
}
export function parseCloudReference(reference) {
  if (typeof reference !== 'string' || !reference.startsWith('supabase:')) return null;
  const [bucket, key, extra] = reference.slice(9).split('/');
  if (extra || !bucketPattern.test(bucket || '') || !keyPattern.test(key || '')) throw new Error('Invalid storage reference.');
  return { bucket, key };
}
export function avatarReference(reference) {
  const cloud = parseCloudReference(reference);
  return cloud ? `supabase~${cloud.bucket}~${cloud.key}` : reference;
}
export function decodeAvatarReference(value) {
  if (!value.startsWith('supabase~')) return value;
  const [, bucket, key, extra] = value.split('~');
  if (extra) throw new Error('Invalid avatar reference.');
  return cloudReference(bucket, key);
}
export const storageTransport = { fetch: (...args) => fetch(...args) };
async function storageRequest(route, options = {}) {
  const { origin, key } = storageSettings();
  let response;
  try {
    response = await storageTransport.fetch(`${origin}/storage/v1/${route}`, { ...options, headers: { apikey: key, Authorization: `Bearer ${key}`, ...options.headers }, signal: AbortSignal.timeout(60000) });
  } catch { const error = new Error('File storage is temporarily unavailable. Please try again.'); error.status = 503; throw error; }
  if (!response.ok) {
    const error = new Error('File storage request failed. Please try again.');
    error.status = 503;
    const details = await response.json().catch(() => ({}));
    if (response.status === 404 || Number(details.statusCode) === 404) error.code = 'ENOENT';
    throw error;
  }
  return response;
}
export async function uploadCloud(kind, key, buffer, contentType) {
  const bucket = storageBucket(kind);
  const reference = cloudReference(bucket, key);
  await storageRequest(`object/${bucket}/${key}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'false' }, body: buffer });
  return reference;
}
export async function readCloud(reference) {
  const { bucket, key } = parseCloudReference(reference) || {};
  if (!bucket) throw new Error('Invalid cloud reference.');
  const response = await storageRequest(`object/authenticated/${bucket}/${key}`);
  return Buffer.from(await response.arrayBuffer());
}
export async function removeCloud(reference) {
  const { bucket, key } = parseCloudReference(reference) || {};
  if (!bucket) throw new Error('Invalid cloud reference.');
  await storageRequest(`object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
}
export async function ensurePrivateBucket(kind) {
  const bucket = storageBucket(kind);
  let existing;
  try { existing = await (await storageRequest(`bucket/${bucket}`)).json(); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (existing.public) throw new Error(`Bucket ${bucket} must be private before use.`);
    return;
  }
  await storageRequest('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bucket, name: bucket, public: false, file_size_limit: kind === 'avatars' ? 2097152 : 62914560, allowed_mime_types: kind === 'avatars' ? ['image/png', 'image/jpeg'] : ['application/zip'] }) });
}

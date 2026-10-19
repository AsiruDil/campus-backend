import { storageSettings, storageBucket } from './storage.js';
export function validateConfiguration(env = process.env) {
  if (!env.MONGODB_URL || !env.JWT_KEY) throw new Error('MONGODB_URL and JWT_KEY are required.');
  if (env.TRUST_PROXY_HOPS && (!/^\d+$/.test(env.TRUST_PROXY_HOPS) || Number(env.TRUST_PROXY_HOPS) > 10)) throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
  const storageConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  if (env.NODE_ENV === 'production' && !storageConfigured) throw new Error('Supabase storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  if (env === process.env && storageConfigured) { storageSettings(); storageBucket('avatars'); storageBucket('documents'); }
  if (env.NODE_ENV !== 'production') return;
  if (Buffer.byteLength(env.JWT_KEY) < 32) throw new Error('Production JWT_KEY must contain at least 32 random bytes.');
  for (const value of [env.FRONTEND_URL, ...(env.CORS_ORIGINS || '').split(',').filter(Boolean)]) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Set valid HTTPS frontend origins for production.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Production frontend origins must be HTTPS origins without paths or credentials.');
  }
  if (!env.RESEND_API_KEY || !env.RESEND_FROM || /@resend\.dev/i.test(env.RESEND_FROM)) throw new Error('Production needs a configured email sender on a verified domain.');
  if (env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_CALLBACK_URL?.startsWith('https://')) throw new Error('Configure both Google credentials and an HTTPS GOOGLE_CALLBACK_URL.');
  }
}

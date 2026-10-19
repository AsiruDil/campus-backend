import 'dotenv/config';
import mongoose from 'mongoose';
import app from './app.js';
import { migrateLegacyRoles } from './services/roleMigration.js';
import { validateConfiguration } from './services/config.js';
import { ensurePrivateBucket } from './services/storage.js';

try {
  validateConfiguration();
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await ensurePrivateBucket('avatars');
    await ensurePrivateBucket('documents');
  } else console.warn('Supabase storage is not configured. API will start in development; photo uploads remain unavailable until the backend server key is set.');
  await mongoose.connect(process.env.MONGODB_URL);
  await migrateLegacyRoles();
  const server = app.listen(Number(process.env.PORT || 3000), () => console.log(`API listening on port ${process.env.PORT || 3000}`));
  server.requestTimeout = 120000;
  server.headersTimeout = 65000;
  server.on('error', error => { console.error('HTTP server failed:', error.code); process.exitCode = 1; mongoose.disconnect(); });
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000);
    timeout.unref();
    server.close(async () => { await mongoose.disconnect(); clearTimeout(timeout); });
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
} catch (error) {
  console.error('Startup failed:', error.name === 'MongooseServerSelectionError' ? 'Check database connectivity and credentials.' : error.message);
  await mongoose.disconnect();
  process.exitCode = 1;
}
 
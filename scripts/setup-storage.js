import 'dotenv/config';
import { ensurePrivateBucket, storageSettings } from '../services/storage.js';
try {
  storageSettings();
  await ensurePrivateBucket('avatars');
  await ensurePrivateBucket('documents');
  console.log('Private photo and application buckets are ready.');
} catch (error) { console.error(error.message); process.exitCode = 1; }

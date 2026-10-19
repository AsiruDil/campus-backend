import 'dotenv/config';
import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import Apply from '../models/apply.js';
import User from '../models/user.js';
const storageRoot = () => path.resolve(process.env.UPLOAD_DIR || './uploads');
import { uploadCloud, readCloud, cloudReference, storageBucket, avatarReference, ensurePrivateBucket } from '../services/storage.js';
const apply = process.argv.includes('--apply');
const hash = value => createHash('sha256').update(value).digest('hex');
async function transfer(kind, key, buffer, type) {
  const reference = cloudReference(storageBucket(kind), key);
  let remote;
  try { remote = await readCloud(reference); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!remote) { await uploadCloud(kind, key, buffer, type); remote = await readCloud(reference); }
  if (hash(remote) !== hash(buffer)) throw new Error('Storage checksum mismatch. Original reference preserved.');
  return reference;
}
try {
  if (!process.env.MONGODB_URL) throw new Error('Set MONGODB_URL.');
  if (apply) { await ensurePrivateBucket('avatars'); await ensurePrivateBucket('documents'); }
  await mongoose.connect(process.env.MONGODB_URL);
  const applications = await Apply.find({ archiveKey: /^[a-f0-9-]+\.zip$/, documentsDeletedAt: { $exists: false } }).select('archiveKey');
  const users = await User.find({ img: /^\/api\/users\/avatar\/[a-f0-9-]+\.(png|jpg)$/ }).select('img');
  console.log(`Local records eligible: ${applications.length} application archives, ${users.length} profile photos. Mode: ${apply ? 'APPLY' : 'DRY RUN'}.`);
  let migrated = 0;
  let failed = 0;
  if (apply) {
    for (const record of applications) {
      try {
        const reference = await transfer('documents', record.archiveKey, await readFile(path.join(storageRoot(), record.archiveKey)), 'application/zip');
        await Apply.updateOne({ _id: record._id, archiveKey: record.archiveKey, documentsDeletedAt: { $exists: false } }, { $set: { archiveKey: reference } });
        migrated++;
      } catch (error) { failed++; console.error('Application migration failed; original reference preserved:', error.code || error.message); }
    }
    for (const user of users) {
      try {
        const key = user.img.split('/').at(-1);
        const buffer = await readFile(path.join(storageRoot(), 'avatars', key));
        const reference = await transfer('avatars', key, buffer, key.endsWith('.png') ? 'image/png' : 'image/jpeg');
        await User.updateOne({ _id: user._id, img: user.img }, { $set: { img: `/api/users/avatar/${avatarReference(reference)}` } });
        migrated++;
      } catch (error) { failed++; console.error('Photo migration failed; original reference preserved:', error.code || error.message); }
    }
  }
  console.log(`Migrated: ${migrated}; failed: ${failed}. Local files were retained.`);
  if (failed) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }

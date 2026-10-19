import { uploadCloud, readCloud, removeCloud, parseCloudReference, avatarReference, decodeAvatarReference } from './storage.js';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import User from '../models/user.js';
import { documentError } from './documents.js';

export const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 0 } }).single('photo');
const validKey = /^[a-f0-9]{24}-[a-f0-9-]{36}\.(png|jpg)$/;
export async function saveAvatar(req, res) {
  const file = req.file;
  const png = file?.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpg = file?.buffer[0] === 255 && file?.buffer[1] === 216 && file?.buffer[2] === 255;
  if (!file?.size || (!png && !jpg)) throw documentError('Choose a PNG or JPEG profile photo no larger than 2 MB.');
  const key = `${req.user._id}-${randomUUID()}.${png ? 'png' : 'jpg'}`;
  const reference = await uploadCloud('avatars', key, file.buffer, png ? 'image/png' : 'image/jpeg');
  const img = `/api/users/avatar/${avatarReference(reference)}`;
  try { await User.updateOne({ _id: req.user._id }, { $set: { img } }); }
  catch (error) { await removeCloud(reference).catch(() => {}); throw error; }
  let previous;
  try { previous = decodeAvatarReference(String(req.user.img || '').replace('/api/users/avatar/', '')); } catch { previous = ''; }
  const previousKey = parseCloudReference(previous)?.key || previous;
  // Delete only managed photos owned by this account, never arbitrary paths or URLs.
  if (previous.startsWith('supabase:') && validKey.test(previousKey) && previousKey.startsWith(`${req.user._id}-`)) await removeCloud(previous).catch(() => {});
  res.status(201).json({ img });
}
export async function getAvatar(req, res) {
  let reference;
  try { reference = decodeAvatarReference(req.params.key); } catch { return res.status(404).json({ message: 'Photo not found.' }); }
  if (!reference.startsWith('supabase:')) return res.status(404).json({ message: 'Photo not found. Please upload your profile photo again.' });
  const key = parseCloudReference(reference).key;
  if (!validKey.test(key)) return res.status(404).json({ message: 'Photo not found.' });
  // Avatars are public by design; application documents are never served here.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.type(key.endsWith('.png') ? 'png' : 'jpg');
  try { return res.send(await readCloud(reference)); }
  catch (error) { if (error.code === 'ENOENT') return res.status(404).json({ message: 'Photo not found.' }); throw error; }
}

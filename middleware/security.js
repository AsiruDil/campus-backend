import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many attempts. Please try again in 15 minutes.' } });
export const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many verification attempts. Please try again in 15 minutes.' } });
export const emailLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many email requests. Please try again later.' } });

export function validateAuthInput(kind) {
  return (req, res, next) => {
    const body = req.body;
    if (!body || Array.isArray(body) || typeof body !== 'object') return res.status(400).json({ message: 'Please check the supplied fields.' });
    const fields = kind === 'register' ? ['firstName', 'lastName', 'userName', 'email', 'password'] : kind === 'login' ? ['password'] : kind === 'reset' ? ['email', 'otp', 'newPassword'] : kind === 'verify' ? ['email', 'otp'] : ['email'];
    if (fields.some(key => typeof body[key] !== 'string' || !body[key].trim() || body[key].length > 254)) return res.status(400).json({ message: 'Please complete all required fields with valid text.' });
    if (['email', 'userName', 'role', 'faculty', 'department'].some(key => key in body && typeof body[key] !== 'string')) return res.status(400).json({ message: 'Please check the supplied fields.' });
    if (kind === 'login' && ![body.email, body.userName].some(value => typeof value === 'string' && value.trim())) return res.status(400).json({ message: 'Enter your username or email.' });
    if (kind !== 'login' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    if (kind === 'login' && Buffer.byteLength(body.password) > 72) return res.status(400).json({ message: 'Password is too long.' });
    if (['register', 'reset'].includes(kind)) {
      const password = kind === 'reset' ? body.newPassword : body.password;
      if (password.length < 8 || Buffer.byteLength(password) > 72) return res.status(400).json({ message: 'Use a password with at least 8 characters and no more than 72 bytes.' });
    }
    next();
  };
}

const stateCookie = 'campus_oauth_state';
const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/users/auth/google', maxAge: 10 * 60 * 1000 });
export function startGoogleState(req, res, next) {
  const state = randomBytes(32).toString('hex');
  res.cookie(stateCookie, state, cookieOptions());
  req.oauthState = state;
  next();
}
export function checkGoogleState(req, res, next) {
  const cookie = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${stateCookie}=`))?.slice(stateCookie.length + 1);
  const state = req.query.state;
  res.clearCookie(stateCookie, { ...cookieOptions(), maxAge: undefined });
  if (typeof state !== 'string' || !cookie || state.length !== 64 || cookie.length !== 64 || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return res.status(400).json({ message: 'Sign-in could not be verified. Please try again.' });
  next();
}

export const notificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { message: 'Too many messages. Please try again later.' } });
let activeUploads = 0;
export function limitConcurrentUploads(req, res, next) {
  if (activeUploads >= 4) return res.status(503).set('Retry-After', '10').json({ message: 'Uploads are busy. Please try again shortly.' });
  activeUploads++;
  let released = false;
  const release = () => { if (!released) { activeUploads--; released = true; } };
  res.once('finish', release);
  res.once('close', release);
  next();
}

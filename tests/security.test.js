import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import app from '../app.js';
import { startGoogleState, checkGoogleState } from '../middleware/security.js';
import { validateConfiguration } from '../services/config.js';

test('API headers prevent caching and untrusted origins do not receive CORS permission', async () => {
  const response = await request(app).get('/api/jobs/not-used').set('Authorization', 'Bearer invalid');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
  const cors = await request(app).get('/health').set('Origin', 'https://untrusted.example');
  assert.equal(cors.headers['access-control-allow-origin'], undefined);
});

test('authentication rejects query operator objects and oversized passwords before querying MongoDB', async () => {
  await request(app).post('/api/users/login').send({ email: { $ne: null }, password: 'password' }).expect(400);
  await request(app).post('/api/users/verify-email').send({ email: { $gt: '' }, otp: { $ne: null } }).expect(400);
  await request(app).post('/api/users/reset-password').send({ email: 'valid@example.test', otp: '123456', newPassword: 'short' }).expect(400);
});

test('login attempts are throttled', async () => {
  let response;
  for (let i = 0; i < 31; i++) response = await request(app).post('/api/users/login').send({ password: {} });
  assert.equal(response.status, 429);
  assert(response.headers['retry-after']);
});

test('Google sign-in requires the original browser state cookie', async () => {
  const server = express();
  server.get('/start', startGoogleState, (req, res) => res.json({ state: req.oauthState }));
  server.get('/callback', checkGoogleState, (req, res) => res.sendStatus(204));
  const start = await request(server).get('/start');
  const cookie = start.headers['set-cookie'][0].split(';')[0];
  await request(server).get('/callback').query({ state: start.body.state }).expect(400);
  await request(server).get('/callback').set('Cookie', cookie).query({ state: 'x'.repeat(64) }).expect(400);
  await request(server).get('/callback').set('Cookie', cookie).query({ state: start.body.state }).expect(204);
});

test('production startup rejects weak secrets, HTTP origins and test email senders', () => {
  const env = { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'server-test-key', NODE_ENV: 'production', MONGODB_URL: 'mongodb://localhost/test', JWT_KEY: 'x'.repeat(64), FRONTEND_URL: 'https://jobs.example.test', UPLOAD_DIR: '/persistent/uploads', RESEND_API_KEY: 'test-only', RESEND_FROM: 'jobs@example.test' };
  assert.doesNotThrow(() => validateConfiguration(env));
  for (const changes of [{ JWT_KEY: 'short' }, { FRONTEND_URL: 'http://example.test' }, { RESEND_FROM: 'onboarding@resend.dev' }, { TRUST_PROXY_HOPS: 'true' }]) assert.throws(() => validateConfiguration({ ...env, ...changes }));
});


test('missing Supabase credentials do not block development but still block production', () => {
  const env = { MONGODB_URL: 'mongodb://localhost/test', JWT_KEY: 'x'.repeat(64), NODE_ENV: 'development' };
  assert.doesNotThrow(() => validateConfiguration(env));
  assert.throws(() => validateConfiguration({ ...env, NODE_ENV: 'production' }), /Supabase storage requires/);
});

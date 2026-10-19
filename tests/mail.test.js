import test from 'node:test';
import assert from 'node:assert/strict';
import { resendClient, sendMail, sendApplicantMail } from '../services/mail.js';

test('Resend sends OTP HTML, preserves BCC, and reports provider failures', async () => {
  const originalSend = resendClient.emails.send;
  const originalKey = process.env.RESEND_API_KEY;
  const originalFrom = process.env.RESEND_FROM;
  process.env.RESEND_API_KEY = 're_test_only';
  process.env.RESEND_FROM = 'Job Finder <sender@example.test>';
  try {
    let payload;
    resendClient.emails.send = async (options) => {
      payload = options;
      return { data: { id: 'email-test-id' }, error: null };
    };
    const result = await sendMail({ to: 'user@example.test', subject: 'Verify', html: '<strong>123456</strong>' });
    assert.equal(payload.from, process.env.RESEND_FROM);
    assert.equal(payload.html, '<strong>123456</strong>');
    assert.deepEqual(result.accepted, ['user@example.test']);
    await sendApplicantMail({ recipients: ['one@example.test', 'two@example.test'], subject: 'Interview', message: 'Welcome' });
    assert.deepEqual(payload.bcc, ['one@example.test', 'two@example.test']);
    assert.equal(payload.to, process.env.RESEND_FROM);
    assert.equal(payload.text, 'Welcome');
    resendClient.emails.send = async () => ({ data: null, error: { message: 'Invalid sender', name: 'validation_error' } });
    await assert.rejects(sendMail({ to: 'user@example.test' }), { status: 502 });
    resendClient.emails.send = async () => ({ data: null, error: { name: 'validation_error', message: 'You can only send testing emails to your own email address.' } });
    await assert.rejects(sendMail({ to: 'user@example.test' }), /Resend test mode/);
    resendClient.emails.send = async () => ({ data: null, error: { name: 'validation_error', message: 'API key is invalid' } });
    await assert.rejects(sendMail({ to: 'user@example.test' }), /rejected the API key/);
    resendClient.emails.send = async () => { throw new Error('Network failure'); };
    await assert.rejects(sendMail({ to: 'user@example.test' }), { status: 502 });
    delete process.env.RESEND_API_KEY;
    await assert.rejects(sendMail({ to: 'user@example.test' }), { status: 503 });
  } finally {
    resendClient.emails.send = originalSend;
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
    if (originalFrom === undefined) delete process.env.RESEND_FROM;
    else process.env.RESEND_FROM = originalFrom;
  }
});
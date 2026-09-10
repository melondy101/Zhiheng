import { describe, it } from 'node:test';
import assert from 'node:assert';
import { sendVerificationEmail } from '../../src/lib/auth/email';

describe('Auth Email Sending Engine', () => {
  it('returns success in test environment without throwing', async () => {
    const res = await sendVerificationEmail({
      to: 'tester@example.com',
      code: '123456',
    });
    assert.strictEqual(res.success, true);
  });
});

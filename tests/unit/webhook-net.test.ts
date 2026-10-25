import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkedLookup, isPublicAddress, validateWebhookUrl } from '../../src/webhooks/net.js';
import { signatureHeader } from '../../src/webhooks/service.js';

describe('webhook targets', () => {
  it('only public unicast addresses are allowed', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '41.65.0.1', '2a00:1450:4001:80b::200e', '2606:4700:4700::1111']) expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      '127.0.0.1', '127.255.255.254', '10.0.0.1', '172.16.5.4', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '192.0.2.10', '198.51.100.7', '203.0.113.9', '198.18.0.1', '224.0.0.1', '255.255.255.255',
      '::', '::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::a00:1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::1',
      'not-an-ip', '',
    ]) expect(isPublicAddress(ip), ip).toBe(false);
  });

  it('URLs must be https, without credentials, to a public host', () => {
    expect(validateWebhookUrl('https://hooks.example.com/cs#frag', false)).toBe('https://hooks.example.com/cs');
    expect(validateWebhookUrl('https://hooks.example.com:8443/cs?x=1', false)).toBe('https://hooks.example.com:8443/cs?x=1');
    expect(validateWebhookUrl('https://8.8.8.8/x', false)).toBe('https://8.8.8.8/x');
    for (const bad of [
      'http://hooks.example.com/', 'ftp://hooks.example.com/', 'hooks.example.com', 'https://user:pw@hooks.example.com/',
      'https://127.0.0.1/', 'https://10.1.2.3/', 'https://[::1]/', 'https://[fd00::1]/', 'https://169.254.169.254/latest/meta-data',
      'https://localhost/', 'https://app.localhost/', 'https://intranet/',
    ]) expect(() => validateWebhookUrl(bad, false), bad).toThrow();
    // The development setting allows http and local addresses, but not other schemes.
    expect(validateWebhookUrl('http://127.0.0.1:4000/hook', true)).toBe('http://127.0.0.1:4000/hook');
    expect(() => validateWebhookUrl('ftp://127.0.0.1/', true)).toThrow();
  });

  it('the socket lookup refuses a host that resolves to a private address', async () => {
    const lookup = (allow: boolean) =>
      new Promise<unknown>((resolve, reject) => checkedLookup(allow)('localhost', { all: true }, (err, address) => (err ? reject(err) : resolve(address))));
    await expect(lookup(false)).rejects.toThrow(/not allowed/);
    expect(await lookup(true)).toEqual(expect.arrayContaining([expect.objectContaining({ address: expect.stringMatching(/^(127\.0\.0\.1|::1)$/) })]));
  });

  it('signs "<timestamp>.<body>" with HMAC-SHA256', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    const header = signatureHeader('whsec_test', '{"a":1}', now);
    const t = Math.floor(now.getTime() / 1000);
    expect(header).toBe(`t=${t},v1=${createHmac('sha256', 'whsec_test').update(`${t}.{"a":1}`).digest('hex')}`);
  });
});

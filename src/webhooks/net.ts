import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

// Outbound requests to customer-supplied webhook URLs. Customers choose the
// URL, so it must not become a way into our own network (SSRF):
//  - https only, no credentials in the URL;
//  - every address the host resolves to must be public; the check runs in the
//    socket's own DNS lookup, so the connection goes to the address that was
//    checked (no window for DNS rebinding);
//  - redirects are not followed, the response body is not read, and each
//    request has a time limit.
// `allowInsecure` (WEBHOOK_ALLOW_INSECURE_TARGETS, refused in production) lifts
// the https and address rules for local development and tests.

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked against the IPv4 rules by BlockList itself.
for (const [net, prefix] of [
  // Unspecified, loopback, NAT64 (could carry a private IPv4 address), discard,
  // Teredo/ORCHID/documentation, 6to4, unique local, link-local, site-local, multicast.
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

/** True when `ip` is a public unicast address that a webhook may be sent to. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, 'ipv4');
  if (family === 6) return !blocked.check(ip, 'ipv6');
  return false;
}

export class WebhookTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookTargetError';
  }
}

/** Checks a URL a customer wants to register. Returns the normalized URL or throws WebhookTargetError. */
export function validateWebhookUrl(raw: string, allowInsecure: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebhookTargetError('Enter a full URL, starting with https://');
  }
  if (url.protocol !== 'https:' && !(allowInsecure && url.protocol === 'http:')) throw new WebhookTargetError('The URL must start with https://');
  if (url.username || url.password) throw new WebhookTargetError('The URL must not contain a user name or password');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!allowInsecure) {
    if (isIP(host) ? !isPublicAddress(host) : host === 'localhost' || host.endsWith('.localhost') || !host.includes('.')) {
      throw new WebhookTargetError('The URL must point to a public address');
    }
  }
  url.hash = '';
  return url.toString();
}

/** A DNS lookup for the socket that refuses hosts with any non-public address. */
export function checkedLookup(allowInsecure: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true, family: options.family }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      if (!addresses.length) return callback(new WebhookTargetError(`${hostname} has no address`), '', 0);
      if (!allowInsecure && addresses.some((a) => !isPublicAddress(a.address))) {
        return callback(new WebhookTargetError(`${hostname} resolves to an address that is not allowed`), '', 0);
      }
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export interface DeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

/**
 * POSTs `body` to `url`. 2xx is success; anything else (including redirects,
 * which are not followed) is a failure with the status code or error.
 */
export function postWebhook(url: string, body: string, headers: Record<string, string>, opts: { allowInsecure: boolean; timeoutMs?: number }): Promise<DeliveryResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  let target: URL;
  try {
    target = new URL(validateWebhookUrl(url, opts.allowInsecure));
  } catch (err) {
    return Promise.resolve({ ok: false, statusCode: null, error: (err as Error).message });
  }
  return new Promise((resolve) => {
    let done = false;
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(target, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
      lookup: checkedLookup(opts.allowInsecure),
      agent: false,
    }, (res) => {
      const code = res.statusCode ?? 0;
      // The body is not needed: drop the connection.
      res.destroy();
      req.destroy();
      if (code >= 200 && code < 300) finish({ ok: true, statusCode: code, error: null });
      else finish({ ok: false, statusCode: code, error: code >= 300 && code < 400 ? 'Redirects are not followed' : `HTTP ${code}` });
    });
    const timer = setTimeout(() => {
      req.destroy();
      finish({ ok: false, statusCode: null, error: `No response within ${Math.round(timeoutMs / 100) / 10} s` });
    }, timeoutMs);
    function finish(r: DeliveryResult) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    }
    req.on('error', (err) => finish({ ok: false, statusCode: null, error: String(err.message).slice(0, 300) }));
    req.end(body);
  });
}

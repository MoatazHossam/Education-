import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const FAKE_S3 = { bucket: 'midad-test', accessKeyId: 'TESTACCESSKEY', secretAccessKey: 'test-secret-access-key-0123456789' };

export interface FakeS3 {
  endpoint: string;
  /** Objects by key. */
  objects: Map<string, Buffer>;
  /** Every request: method and key ('' for the bucket itself). */
  requests: { method: string; key: string }[];
  /** While set, requests with these methods fail with this status and S3 error code. */
  fail: { methods: string[]; status: number; code: string } | null;
  /** The settings that point the application at this bucket. */
  env(): Record<string, string>;
  close(): Promise<void>;
}

const xmlError = (code: string, message: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message><RequestId>fake</RequestId></Error>`;

/**
 * A stand-in for an S3-compatible bucket (path-style addressing, one bucket): PUT, GET, DELETE and HEAD of objects
 * and HEAD of the bucket, with S3's XML errors, so the real AWS SDK client talks to it. It checks that requests are
 * signed with the expected access key id (not the signature itself: the check against real MinIO covers that,
 * docs/TEST_REPORT.md).
 */
export async function startFakeS3(): Promise<FakeS3> {
  const sockets = new Set<Socket>();
  const state: Pick<FakeS3, 'objects' | 'requests' | 'fail'> = { objects: new Map(), requests: [], fail: null };

  const send = (res: ServerResponse, status: number, body?: string | Buffer, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'x-amz-request-id': 'fake', ...headers, ...(body !== undefined ? { 'content-length': String(Buffer.byteLength(body)) } : {}) });
    res.end(body);
  };
  const handle = (req: IncomingMessage, res: ServerResponse, body: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const [, bucket = '', ...rest] = url.pathname.split('/');
    const key = rest.map(decodeURIComponent).join('/');
    const method = req.method ?? 'GET';
    state.requests.push({ method, key });
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith(`AWS4-HMAC-SHA256 Credential=${FAKE_S3.accessKeyId}/`)) {
      return send(res, 403, method === 'HEAD' ? undefined : xmlError('InvalidAccessKeyId', 'The access key does not exist.'), { 'content-type': 'application/xml' });
    }
    if (decodeURIComponent(bucket) !== FAKE_S3.bucket) {
      return send(res, 404, method === 'HEAD' ? undefined : xmlError('NoSuchBucket', 'The bucket does not exist.'), { 'content-type': 'application/xml' });
    }
    if (state.fail && state.fail.methods.includes(method)) {
      return send(res, state.fail.status, method === 'HEAD' ? undefined : xmlError(state.fail.code, 'Failing on purpose.'), { 'content-type': 'application/xml' });
    }
    if (!key) {
      if (method === 'HEAD') return send(res, 200);
      return send(res, 405, xmlError('MethodNotAllowed', 'Only HEAD of the bucket.'), { 'content-type': 'application/xml' });
    }
    if (method === 'PUT') {
      if (Number(req.headers['content-length'] ?? -1) !== body.length) return send(res, 400, xmlError('IncompleteBody', 'Length mismatch.'));
      state.objects.set(key, body);
      return send(res, 200, '', { etag: '"fake"' });
    }
    const object = state.objects.get(key);
    if (method === 'GET' || method === 'HEAD') {
      if (!object) return send(res, 404, method === 'HEAD' ? undefined : xmlError('NoSuchKey', 'The specified key does not exist.'), { 'content-type': 'application/xml' });
      if (method === 'HEAD') {
        res.writeHead(200, { 'content-length': String(object.length), 'content-type': 'application/octet-stream', etag: '"fake"' });
        return res.end();
      }
      return send(res, 200, object, { 'content-type': 'application/octet-stream', etag: '"fake"' });
    }
    if (method === 'DELETE') {
      state.objects.delete(key);
      return send(res, 204);
    }
    return send(res, 405, xmlError('MethodNotAllowed', 'Not supported by the fake.'), { 'content-type': 'application/xml' });
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => handle(req, res, Buffer.concat(chunks)));
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return Object.assign(state, {
    endpoint,
    env: () => ({
      S3_ENDPOINT: endpoint,
      S3_BUCKET: FAKE_S3.bucket,
      S3_ACCESS_KEY_ID: FAKE_S3.accessKeyId,
      S3_SECRET_ACCESS_KEY: FAKE_S3.secretAccessKey,
      S3_FORCE_PATH_STYLE: 'true',
    }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  });
}

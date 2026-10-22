// Small load probe for the main read/write paths. Not a substitute for a
// capacity test on production-like hardware; see docs/TEST_STRATEGY.md.
//   node scripts/perf-smoke.mjs http://localhost:3000 owner@demo.local <password> [concurrency] [requests]
const [base = 'http://localhost:3000', email = 'owner@demo.local', password = process.env.DEMO_PASSWORD, conc = '20', total = '400'] = process.argv.slice(2);
const C = Number(conc);
const N = Number(total);

const jar = {};
async function call(method, path, body) {
  const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '), origin: base };
  if (body) headers['content-type'] = 'application/json';
  if (jar.csrf && method !== 'GET') headers['x-csrf-token'] = jar.csrf;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [kv] = c.split(';');
    const [k, v] = kv.split('=');
    jar[k] = v;
  }
  return res;
}

async function measure(label, fn) {
  const times = [];
  let errors = 0;
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < N) {
      next++;
      const t = performance.now();
      const ok = await fn().catch(() => false);
      times.push(performance.now() - t);
      if (!ok) errors++;
    }
  }));
  const wall = (performance.now() - start) / 1000;
  times.sort((a, b) => a - b);
  const p = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(1);
  console.log(`${label.padEnd(34)} n=${times.length} conc=${C} p50=${p(0.5)}ms p95=${p(0.95)}ms p99=${p(0.99)}ms max=${times.at(-1).toFixed(1)}ms rps=${(times.length / wall).toFixed(0)} errors=${errors}`);
}

const login = await call('POST', '/api/auth/login', { email, password });
if (!login.ok) throw new Error(`login failed ${login.status}`);
const me = await (await call('GET', '/api/auth/me')).json();
jar.csrf = me.csrfToken;
const orgId = me.organizations[0].id;
const { scopes } = await (await call('GET', `/api/orgs/${orgId}/scopes`)).json();
const scope = scopes[0];
const tree = await (await call('GET', `/api/catalog/versions/${scope.catalogVersionId}`)).json();
const ids = tree.subjects.flatMap((s) => s.materials.map((m) => m.id));

await measure('GET /healthz', async () => (await fetch(base + '/healthz')).ok);
await measure('GET catalogue tree (1,038 items)', async () => (await call('GET', `/api/catalog/versions/${scope.catalogVersionId}`)).ok);
await measure('GET scope with selections', async () => (await call('GET', `/api/orgs/${orgId}/scopes/${scope.id}`)).ok);
let i = 0;
await measure('POST toggle items (add+remove)', async () => {
  const id = ids[(i++ * 7) % ids.length];
  return (await call('POST', `/api/orgs/${orgId}/scopes/${scope.id}/items`, { add: [id], remove: [] })).ok;
});
await measure('GET text export', async () => (await call('GET', `/api/orgs/${orgId}/scopes/${scope.id}/export?format=txt`)).ok || true);

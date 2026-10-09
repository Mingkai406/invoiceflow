const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const port = 44041;
const base = `http://127.0.0.1:${port}/odata/v4/review`;
let server,
  output = '',
  counter = 0;
const oid = (i) => `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const iid = (i) => `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
const payload = (i = 1, extra = {}) => ({
  requestKey: `test-key-${++counter}`,
  number: `TEST-${counter}`,
  supplier: 'ACME',
  orderID: oid(i),
  currency: 'USD',
  lines: [{ orderItemID: iid(i), quantity: 10, unitPrice: '24.50' }],
  ...extra,
});
async function api(path, data, user = 'clerk', method = data ? 'POST' : 'GET') {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Basic ${Buffer.from(`${user}:local-demo`).toString('base64')}`;
  const r = await fetch(base + path, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, body };
}
async function submit(p, user = 'clerk') {
  const r = await api('/submitInvoice', p, user);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const decision = (x, extra = {}) => ({
  invoiceID: x.ID,
  expectedVersion: x.version,
  decision: 'approve',
  note: 'Checked supporting documents.',
  ...extra,
});
before(async () => {
  server = spawn(process.execPath, ['node_modules/@sap/cds/bin/serve.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => (output += d));
  server.stderr.on('data', (d) => (output += d));
  for (let i = 0; i < 120; i++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      if ((await api('/')).status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`CAP did not start: ${output}`);
});
after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await once(server, 'exit');
  }
});

test('real OData metadata, filters and expansions are served', async () => {
  assert.match((await api('/$metadata')).body, /ReviewService/);
  const r = await api("/PurchaseOrders?$filter=number%20eq%20'PO-4102'&$expand=items");
  assert.equal(r.status, 200);
  assert.equal(r.body.value.length, 1);
  assert.equal(r.body.value[0].items[0].quantity, 100);
});
test('unauthenticated reads and unknown mock users are rejected', async () => {
  assert.equal((await api('/Invoices', null, null)).status, 401);
  assert.equal((await api('/Invoices', null, 'unknown')).status, 401);
});
test('readonly entity endpoints prevent bypassing actions', async () => {
  assert.equal((await api('/Invoices', { number: 'BYPASS' }, 'reviewer')).status, 405);
  assert.equal((await api('/AuditEvents', { action: 'fake' }, 'reviewer')).status, 405);
});
test('role restrictions are enforced by the service', async () => {
  assert.equal((await api('/submitInvoice', payload(), 'reviewer')).status, 403);
  assert.equal(
    (
      await api(
        '/decide',
        { invoiceID: oid(1), expectedVersion: 1, decision: 'approve', note: 'x' },
        'clerk',
      )
    ).status,
    403,
  );
});
test('same key and equivalent payload return one invoice and one audit record', async () => {
  const p = payload();
  const a = await submit(p);
  const b = await submit({ ...p, lines: [{ ...p.lines[0], unitPrice: '24.5' }] });
  assert.equal(a.ID, b.ID);
  const r = await api(`/Invoices(${a.ID})?$expand=events,lines`);
  assert.equal(r.body.events.length, 1);
  assert.equal(r.body.lines.length, 1);
});
test('key reuse with different data and duplicate supplier references fail', async () => {
  const p = payload();
  await submit(p);
  assert.equal((await api('/submitInvoice', { ...p, currency: 'EUR' })).status, 409);
  assert.equal(
    (
      await api('/submitInvoice', {
        ...p,
        requestKey: 'another-key',
        number: p.number.toLowerCase(),
      })
    ).status,
    409,
  );
});
test('bad quantity, duplicated lines, wrong supplier, unknown order are rejected', async () => {
  const p = payload();
  assert.equal(
    (await api('/submitInvoice', { ...p, lines: [{ ...p.lines[0], quantity: 0 }] })).status,
    400,
  );
  assert.equal(
    (await api('/submitInvoice', { ...p, lines: [p.lines[0], p.lines[0]] })).status,
    400,
  );
  assert.equal((await api('/submitInvoice', { ...p, supplier: 'OTHER' })).status, 400);
  assert.equal((await api('/submitInvoice', { ...p, orderID: oid(99) })).status, 404);
});
test('cross-order items are rejected and no invoice is committed', async () => {
  const p = payload();
  const r = await api('/submitInvoice', {
    ...p,
    lines: [{ orderItemID: iid(2), quantity: 1, unitPrice: '8.20' }],
  });
  assert.equal(r.status, 400);
  assert.equal((await api(`/Invoices?$filter=number%20eq%20'${p.number}'`)).body.value.length, 0);
});
test('quantity exception carries clear evidence', async () => {
  const x = await submit(
    payload(1, { lines: [{ orderItemID: iid(1), quantity: 100, unitPrice: '24.50' }] }),
  );
  assert.equal(x.status, 'Exception');
  assert.equal(JSON.parse(x.findings)[0].remaining, 80);
});
test('currency mismatch cannot be approved', async () => {
  const x = await submit(payload(1, { currency: 'EUR' }));
  assert.equal((await api('/decide', decision(x), 'reviewer')).status, 409);
  assert.equal((await api(`/Invoices(${x.ID})`)).body.version, 1);
});
test('self-approval is blocked even when a user has both roles', async () => {
  const x = await submit(payload(), 'dual');
  assert.equal((await api('/decide', decision(x), 'dual')).status, 403);
});
test('an exception can be explicitly rejected with an audit note', async () => {
  const x = await submit(payload(1, { currency: 'EUR' }));
  const r = await api(
    '/decide',
    decision(x, { decision: 'reject', note: 'Currency differs; request corrected invoice.' }),
    'reviewer',
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'Rejected');
  const detail = await api(`/Invoices(${x.ID})?$expand=events`);
  assert.equal(detail.body.events.length, 2);
  assert.ok(detail.body.events.some((e) => e.actor === 'reviewer' && e.note.includes('Currency')));
});
test('decision notes are mandatory and resolved records cannot be changed', async () => {
  const x = await submit(payload());
  assert.equal((await api('/decide', decision(x, { note: ' ' }), 'reviewer')).status, 400);
  const r = await api('/decide', decision(x), 'reviewer');
  assert.equal(r.status, 200);
  assert.equal((await api('/decide', decision(x), 'reviewer')).status, 409);
  assert.equal(
    (await api(`/Invoices(${x.ID})`, { status: 'Exception' }, 'reviewer', 'PATCH')).status,
    405,
  );
});
test('concurrent decisions produce one state transition', async () => {
  const x = await submit(payload());
  const results = await Promise.all([
    api('/decide', decision(x), 'reviewer'),
    api('/decide', decision(x, { decision: 'reject' }), 'reviewer'),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  assert.equal((await api(`/Invoices(${x.ID})?$expand=events`)).body.events.length, 2);
});
test('concurrent repeated submissions create one invoice', async () => {
  const p = payload();
  const results = await Promise.all([
    api('/submitInvoice', p),
    api('/submitInvoice', p),
    api('/submitInvoice', p),
  ]);
  assert.ok(
    results.every((x) => x.status === 200),
    JSON.stringify(results),
  );
  assert.equal(new Set(results.map((x) => x.body.ID)).size, 1);
});
test('concurrent approvals cannot bill the same received units twice', async () => {
  const input = {
    supplier: 'MESA',
    lines: [{ orderItemID: iid(4), quantity: 40, unitPrice: '125.00' }],
  };
  const a = await submit(payload(4, input));
  const b = await submit(payload(4, input));
  const results = await Promise.all([
    api('/decide', decision(a), 'reviewer'),
    api('/decide', decision(b), 'reviewer'),
  ]);
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
});
test('unsupported currencies and negative or over-precise prices are rejected', async () => {
  const p = payload();
  assert.equal((await api('/submitInvoice', { ...p, currency: 'JPY' })).status, 400);
  for (const unitPrice of ['-1', '24.501'])
    assert.equal(
      (await api('/submitInvoice', { ...p, lines: [{ ...p.lines[0], unitPrice }] })).status,
      400,
    );
});
test('decision audit is immutable through navigation and entity endpoints', async () => {
  const x = await submit(payload());
  const r = await api(`/Invoices(${x.ID})?$expand=events`);
  const id = r.body.events[0].ID;
  assert.equal(
    (await api(`/AuditEvents(${id})`, { note: 'rewritten' }, 'reviewer', 'PATCH')).status,
    405,
  );
  assert.equal((await api(`/AuditEvents(${id})`, null, 'reviewer', 'DELETE')).status, 405);
});

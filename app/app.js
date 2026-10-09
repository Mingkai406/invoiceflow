const $ = (s) => document.querySelector(s);
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const amount = (value, currency = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
const statusLabel = {
  Exception: 'Needs attention',
  Matched: 'Ready for review',
  Approved: 'Approved',
  Rejected: 'Rejected',
};
const issueLabel = {
  QUANTITY_MISMATCH: 'Quantity difference',
  PRICE_MISMATCH: 'Price difference',
  MISSING_RECEIPT: 'Receipt missing',
  CURRENCY_MISMATCH: 'Currency difference',
};
const state = {
  role: 'reviewer',
  demo: false,
  invoices: [],
  orders: [],
  selected: null,
  filter: 'open',
  query: '',
  detailSerial: 0,
  busy: false,
};
let submissionKey = null;
async function api(path, data, role = state.role) {
  const headers = {};
  if (state.demo) headers.Authorization = `Basic ${btoa(`${role}:local-demo`)}`;
  if (data) headers['Content-Type'] = 'application/json';
  const r = await fetch(`/odata/v4/review${path}`, {
    method: data ? 'POST' : 'GET',
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  const text = await r.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    result = {};
  }
  if (!r.ok) throw new Error(result.error?.message || `Request failed (${r.status}).`);
  return result;
}
function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').className = error ? 'error' : '';
}
function badge(status) {
  return `<span class="badge ${escape(status)}">${escape(statusLabel[status] || status)}</span>`;
}
function findings(invoice) {
  try {
    return JSON.parse(invoice.findings || '[]');
  } catch {
    return [];
  }
}
function renderList() {
  const open = state.invoices.filter((x) => ['Matched', 'Exception'].includes(x.status));
  $('#metric-exceptions').textContent = state.invoices.filter(
    (x) => x.status === 'Exception',
  ).length;
  $('#metric-matched').textContent = state.invoices.filter((x) => x.status === 'Matched').length;
  $('#metric-reviewed').textContent = state.invoices.length - open.length;
  $('#nav-count').textContent = open.length;
  $('#open-count').textContent = open.length;
  const q = state.query.toLowerCase();
  const rows = state.invoices.filter(
    (x) =>
      (state.filter === 'all' ||
        (state.filter === 'open' ? open.includes(x) : !open.includes(x))) &&
      `${x.number} ${x.supplierName}`.toLowerCase().includes(q),
  );
  $('#list-count').textContent = `${rows.length} invoice${rows.length === 1 ? '' : 's'}`;
  if (!rows.length) {
    $('#invoice-list').innerHTML =
      `<div class="empty">${state.invoices.length ? 'No invoices match this view.' : 'Your review queue is empty.'}${state.demo && !state.invoices.length ? '<br><button class="secondary" id="load-samples">Load sample invoices</button>' : ''}</div>`;
    $('#load-samples')?.addEventListener('click', loadSamples);
    return;
  }
  $('#invoice-list').innerHTML = rows
    .map(
      (x) =>
        `<button class="invoice-row ${state.selected === x.ID ? 'selected' : ''}" data-id="${escape(x.ID)}" aria-pressed="${state.selected === x.ID}"><span class="row-top"><span>${escape(x.number)}</span><span>${escape(x.order?.number)}</span></span><span class="row-middle"><span>${escape(x.supplierName)}</span><strong>${escape(amount(x.total, x.currency))}</strong></span><span class="row-bottom">${badge(x.status)}<span>${escape(issueLabel[findings(x)[0]?.code] || 'Documents matched')}</span></span></button>`,
    )
    .join('');
  document
    .querySelectorAll('.invoice-row')
    .forEach((b) => b.addEventListener('click', () => selectInvoice(b.dataset.id)));
}
async function refresh(keepSelection = true) {
  const result = await api('/Invoices?$expand=order&$orderby=createdAt%20desc&$top=200');
  state.invoices = result.value;
  if (!keepSelection || !state.invoices.some((x) => x.ID === state.selected))
    state.selected =
      state.invoices.find((x) => x.number === 'INV-1048')?.ID || state.invoices[0]?.ID;
  renderList();
  if (state.selected) await selectInvoice(state.selected);
}
async function selectInvoice(id) {
  state.selected = id;
  renderList();
  const serial = ++state.detailSerial;
  try {
    const x = await api(
      `/Invoices(${id})?$expand=lines,events,order($expand=items($expand=receipts))`,
    );
    if (serial !== state.detailSerial) return;
    renderDetail(x);
  } catch (e) {
    if (serial === state.detailSerial) notice(e.message, true);
  }
}
function renderDetail(x) {
  const issues = findings(x);
  const pending = ['Matched', 'Exception'].includes(x.status);
  const canReview = !state.demo || state.role === 'reviewer';
  const currencyMismatch = issues.some((f) => f.code === 'CURRENCY_MISMATCH');
  $('#detail').innerHTML = `
    <div class="detail-top"><div><span class="eyebrow">SUPPLIER INVOICE</span><h2>${escape(x.number)}</h2><p>${escape(x.supplierName)}</p></div><div class="detail-amount">${badge(x.status)}<strong>${escape(amount(x.total, x.currency))}</strong><small>Invoice total · ${escape(x.currency)}</small></div></div>
    <div class="summary-strip"><div><span>Purchase order</span><strong>${escape(x.order.number)}</strong></div><div><span>Submitted by</span><strong>${escape(x.submittedBy)}</strong></div><div><span>Record version</span><strong>${x.version}</strong></div></div>
    ${issues.length ? issues.map((f) => `<div class="finding"><strong>${escape(issueLabel[f.code] || f.code)}</strong><p>${escape(f.message)}</p></div>`).join('') : '<div class="finding good"><strong>All documents agree</strong><p>Invoice quantities and prices match the available receipts and purchase order.</p></div>'}
    <div class="section-heading"><h3>Three-way comparison</h3><span>At submission</span></div>
    ${x.lines
      .map((line) => {
        const item = x.order.items.find((i) => i.ID === line.orderItem_ID);
        const received = item.receipts.reduce((s, r) => s + r.quantity, 0);
        return `<div class="item-name">${escape(line.description)}</div><div class="table-wrap"><table><caption class="sr-only">${escape(line.description)} document comparison</caption><thead><tr><th scope="col">Document</th><th scope="col">Quantity</th><th scope="col">Unit price</th></tr></thead><tbody><tr><td>Purchase order</td><td>${item.quantity}</td><td>${escape(amount(item.unitPrice, x.order.currency))}</td></tr><tr><td>Goods received</td><td>${received}</td><td>—</td></tr><tr><td>Supplier invoice</td><td class="${line.quantity > received ? 'alert-cell' : ''}">${line.quantity}</td><td class="${Number(line.unitPrice) !== Number(item.unitPrice) || currencyMismatch ? 'alert-cell' : ''}">${escape(amount(line.unitPrice, x.currency))}</td></tr></tbody></table></div>`;
      })
      .join('')}
    ${pending ? `<div class="review-box"><label for="decision-note">Decision note</label><textarea id="decision-note" maxlength="1000" placeholder="Explain the decision for the next person reviewing this record." ${canReview ? '' : 'disabled'}></textarea><div class="decision-actions"><span class="hint">${!canReview ? 'Switch to Reviewer to make a decision.' : currencyMismatch ? 'Currency differs. Request a corrected invoice.' : issues.length ? 'Approval accepts these differences. Include your reason.' : 'A second person must review each invoice.'}</span><button id="reject" class="secondary reject" ${canReview ? '' : 'disabled'}>Reject invoice</button><button id="approve" class="primary" ${canReview && !currencyMismatch ? '' : 'disabled'}>${issues.length ? 'Approve exception' : 'Approve invoice'}</button></div><div id="decision-error" class="error" role="alert"></div></div>` : ''}
    <div class="activity"><h3>Activity</h3>${x.events
      .sort((a, b) => new Date(b.at) - new Date(a.at))
      .map(
        (e) =>
          `<div class="event"><span class="event-dot" aria-hidden="true"></span><div><strong>${escape(e.action)}</strong> by ${escape(e.actor)}<p>${escape(e.note)}</p></div><time datetime="${escape(e.at)}">${new Date(e.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</time></div>`,
      )
      .join('')}</div>`;
  $('#approve')?.addEventListener('click', () => decide(x, 'approve'));
  $('#reject')?.addEventListener('click', () => decide(x, 'reject'));
}
async function decide(invoice, decision) {
  if (state.busy) return;
  const note = $('#decision-note').value.trim();
  if (!note) {
    $('#decision-error').textContent = 'Add a decision note before continuing.';
    $('#decision-note').focus();
    return;
  }
  state.busy = true;
  $('#approve').disabled = true;
  $('#reject').disabled = true;
  try {
    await api('/decide', {
      invoiceID: invoice.ID,
      expectedVersion: invoice.version,
      decision,
      note,
    });
    notice(
      `${invoice.number} ${decision === 'approve' ? 'approved' : 'rejected'}. Your decision is recorded.`,
    );
    await refresh();
  } catch (e) {
    notice(e.message, true);
    await selectInvoice(invoice.ID);
  } finally {
    state.busy = false;
  }
}
async function loadSamples() {
  const b = $('#load-samples');
  if (b) b.disabled = true;
  try {
    const rows = [
      [1, 'INV-1048', 100, '24.50', 'USD', 'ACME'],
      [2, 'INV-2081', 200, '8.70', 'USD', 'NORTH'],
      [3, 'INV-3092', 60, '16.00', 'USD', 'FIELD'],
      [4, 'INV-4026', 40, '125.00', 'EUR', 'MESA'],
      [5, 'INV-5120', 120, '12.50', 'USD', 'CEDAR'],
    ];
    for (const [i, number, quantity, unitPrice, currency, supplier] of rows)
      await api(
        '/submitInvoice',
        {
          requestKey: `demo-invoice-${i}`,
          number,
          supplier,
          currency,
          orderID: `10000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          lines: [
            {
              orderItemID: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
              quantity,
              unitPrice,
            },
          ],
        },
        'clerk',
      );
    notice('Five sample invoices loaded. Select one to compare its documents.');
    await refresh(false);
  } catch (e) {
    notice(e.message, true);
    if (b) b.disabled = false;
  }
}
async function openForm() {
  if (state.demo && state.role !== 'clerk') {
    notice('Switch “Viewing as” to AP clerk to submit an invoice.');
    $('#role').focus();
    return;
  }
  try {
    state.orders = (await api('/PurchaseOrders?$expand=items&$orderby=number')).value;
    $('#order').innerHTML = state.orders
      .map(
        (x) =>
          `<option value="${escape(x.ID)}">${escape(x.number)} · ${escape(x.supplierName)}</option>`,
      )
      .join('');
    $('#invoice-form').reset();
    $('#form-error').textContent = '';
    submissionKey = crypto.randomUUID();
    updateOrder();
    $('#new-dialog').showModal();
  } catch (e) {
    notice(e.message, true);
  }
}
function updateOrder() {
  const order = state.orders.find((x) => x.ID === $('#order').value);
  if (!order) return;
  $('#currency').value = order.currency;
  $('#order-item').innerHTML = order.items
    .map((x) => `<option value="${escape(x.ID)}">${escape(x.description)}</option>`)
    .join('');
  updateItem();
}
function updateItem() {
  const item = state.orders
    .find((x) => x.ID === $('#order').value)
    ?.items.find((x) => x.ID === $('#order-item').value);
  if (item) {
    $('#quantity').value = item.quantity;
    $('#unit-price').value = Number(item.unitPrice).toFixed(2);
  }
}
$('#invoice-form').addEventListener('input', () => {
  submissionKey = crypto.randomUUID();
});
$('#invoice-form').addEventListener('change', () => {
  submissionKey = crypto.randomUUID();
});
$('#invoice-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const b = $('#submit-invoice');
  b.disabled = true;
  $('#form-error').textContent = '';
  const order = state.orders.find((x) => x.ID === $('#order').value);
  try {
    const x = await api('/submitInvoice', {
      requestKey: submissionKey,
      number: $('#invoice-number').value,
      supplier: order.supplier,
      orderID: order.ID,
      currency: $('#currency').value,
      lines: [
        {
          orderItemID: $('#order-item').value,
          quantity: Number($('#quantity').value),
          unitPrice: $('#unit-price').value,
        },
      ],
    });
    $('#new-dialog').close();
    state.selected = x.ID;
    state.filter = 'open';
    setFilterButtons();
    notice(`${x.number} submitted and checked.`);
    await refresh();
  } catch (e) {
    $('#form-error').textContent = e.message;
  } finally {
    b.disabled = false;
  }
});
$('#new-invoice').addEventListener('click', openForm);
$('#order').addEventListener('change', updateOrder);
$('#order-item').addEventListener('change', updateItem);
$('#close-dialog').addEventListener('click', () => $('#new-dialog').close());
$('#cancel-dialog').addEventListener('click', () => $('#new-dialog').close());
$('#refresh').addEventListener('click', () => refresh().catch((e) => notice(e.message, true)));
$('#role').addEventListener('change', () => {
  state.role = $('#role').value;
  notice('');
  if (state.selected) selectInvoice(state.selected);
});
$('#search').addEventListener('input', () => {
  state.query = $('#search').value;
  renderList();
});
function setFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach((x) => {
    x.classList.toggle('active', x.dataset.filter === state.filter);
    x.setAttribute('aria-pressed', x.dataset.filter === state.filter);
  });
}
document.querySelectorAll('[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    state.filter = b.dataset.filter;
    setFilterButtons();
    renderList();
  }),
);
(async () => {
  try {
    const config = await (await fetch('/demo-config')).json();
    state.demo = config.demo;
    $('#role-wrap').hidden = !state.demo;
    $('#demo-note').hidden = !state.demo;
    await refresh(false);
  } catch (e) {
    notice(e.message, true);
    $('#invoice-list').innerHTML =
      '<p class="empty">The service is unavailable. Check the server, then select Refresh.</p>';
  }
})();

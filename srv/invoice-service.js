'use strict';
const cds = require('@sap/cds');
const { createHash } = require('node:crypto');
const { cents, money, match } = require('./lib/matching');
const { SELECT, INSERT, UPDATE } = cds.ql;

module.exports = class ReviewService extends cds.ApplicationService {
  async init() {
    const {
      PurchaseOrders,
      OrderItems,
      Receipts,
      Invoices,
      InvoiceLines,
      AuditEvents,
      RequestLedger,
    } = cds.entities('invoiceflow');
    const audit = (invoice, actor, action, note, fromStatus, toStatus) =>
      INSERT.into(AuditEvents).entries({
        ID: cds.utils.uuid(),
        invoice_ID: invoice,
        actor,
        action,
        note,
        fromStatus,
        toStatus,
        at: new Date().toISOString(),
      });
    const evaluate = async (order, lines, currency) => {
      order.items = await SELECT.from(OrderItems).where({ order_ID: order.ID });
      const receipts = await SELECT.from(Receipts).where({
        item_ID: { in: order.items.map((x) => x.ID) },
      });
      const previous = await SELECT.from(Invoices)
        .columns('ID')
        .where({ order_ID: order.ID, status: 'Approved' });
      const approved = previous.length
        ? await SELECT.from(InvoiceLines).where({ invoice_ID: { in: previous.map((x) => x.ID) } })
        : [];
      const result = match(order, lines, receipts, approved);
      if (currency !== order.currency)
        result.findings.unshift({
          code: 'CURRENCY_MISMATCH',
          message: `Invoice uses ${currency}; purchase order uses ${order.currency}. No currency conversion is applied.`,
        });
      return result;
    };
    this.on('submitInvoice', async (req) => {
      const d = req.data;
      if (!d.requestKey || !/^[A-Za-z0-9_.:-]{8,80}$/.test(d.requestKey))
        return req.reject(400, 'Supply an 8–80 character request key.');
      if (
        !d.number?.trim() ||
        !d.supplier?.trim() ||
        !d.orderID ||
        !['USD', 'EUR', 'GBP'].includes(d.currency)
      )
        return req.reject(
          400,
          'Invoice number, supplier, purchase order and supported currency (USD, EUR or GBP) are required.',
        );
      if (!Array.isArray(d.lines) || d.lines.length < 1 || d.lines.length > 50)
        return req.reject(400, 'Supply 1–50 invoice lines.');
      let lines;
      try {
        lines = d.lines
          .map((x) => {
            if (
              !x.orderItemID ||
              !Number.isInteger(x.quantity) ||
              x.quantity <= 0 ||
              x.quantity > 100000
            )
              throw new Error('Quantity must be a whole number from 1 to 100000.');
            return {
              orderItemID: x.orderItemID,
              quantity: x.quantity,
              unitPrice: money(cents(x.unitPrice)),
            };
          })
          .sort((a, b) => a.orderItemID.localeCompare(b.orderItemID));
        if (new Set(lines.map((x) => x.orderItemID)).size !== lines.length)
          throw new Error('An order item may only appear once per invoice.');
      } catch (e) {
        return req.reject(400, e.message);
      }
      const payload = {
        number: d.number.trim().toUpperCase(),
        supplier: d.supplier.trim().toUpperCase(),
        orderID: d.orderID,
        currency: d.currency,
        lines,
      };
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const prior = await SELECT.one
        .from(RequestLedger)
        .where({ actor: req.user.id, requestKey: d.requestKey });
      if (prior) {
        if (prior.payloadHash !== hash)
          return req.reject(
            409,
            'This request key was already used for a different invoice payload.',
          );
        return SELECT.one.from(Invoices).where({ ID: prior.invoice_ID });
      }
      if (
        await SELECT.one
          .from(Invoices)
          .where({ supplier: payload.supplier, number: payload.number })
      )
        return req.reject(409, 'This supplier invoice has already been submitted.');
      const order = await SELECT.one.from(PurchaseOrders).where({ ID: d.orderID });
      if (!order) return req.reject(404, 'Purchase order not found.');
      if (order.supplier !== payload.supplier)
        return req.reject(400, 'Supplier does not match the purchase order.');
      let result;
      try {
        result = await evaluate(order, lines, d.currency);
      } catch (e) {
        return req.reject(400, e.message);
      }
      const ID = cds.utils.uuid();
      const status = result.findings.length ? 'Exception' : 'Matched';
      // The CAP request transaction commits invoice, request key and audit record together.
      await INSERT.into(Invoices).entries({
        ID,
        number: payload.number,
        supplier: payload.supplier,
        supplierName: order.supplierName,
        order_ID: order.ID,
        currency: d.currency,
        total: result.total,
        status,
        version: 1,
        submittedBy: req.user.id,
        findings: JSON.stringify(result.findings),
        lines: lines.map((x) => ({
          ID: cds.utils.uuid(),
          orderItem_ID: x.orderItemID,
          quantity: x.quantity,
          unitPrice: x.unitPrice,
          description: order.items.find((i) => i.ID === x.orderItemID).description,
        })),
      });
      await INSERT.into(RequestLedger).entries({
        actor: req.user.id,
        requestKey: d.requestKey,
        payloadHash: hash,
        invoice_ID: ID,
      });
      await audit(
        ID,
        req.user.id,
        'Submitted',
        `${result.findings.length} matching exception(s).`,
        null,
        status,
      );
      return SELECT.one.from(Invoices).where({ ID });
    });

    this.on('decide', async (req) => {
      const { invoiceID, expectedVersion, decision, note } = req.data;
      if (
        !['approve', 'reject'].includes(decision) ||
        !Number.isInteger(expectedVersion) ||
        !note?.trim()
      )
        return req.reject(400, 'Supply approve/reject, the current version, and a decision note.');
      const invoice = await SELECT.one.from(Invoices).where({ ID: invoiceID });
      if (!invoice) return req.reject(404, 'Invoice not found.');
      if (invoice.submittedBy === req.user.id)
        return req.reject(403, 'A second person must review this invoice.');
      if (invoice.version !== expectedVersion || !['Matched', 'Exception'].includes(invoice.status))
        return req.reject(
          409,
          'This invoice has changed or has already been decided. Refresh before trying again.',
        );
      if (decision === 'approve') {
        // Serialize approvals for the same PO. Verified on SQLite; cloud DB needs its own integration run.
        await UPDATE(PurchaseOrders)
          .set({ revision: { '+=': 1 } })
          .where({ ID: invoice.order_ID });
        const order = await SELECT.one.from(PurchaseOrders).where({ ID: invoice.order_ID });
        const stored = await SELECT.from(InvoiceLines).where({ invoice_ID: invoice.ID });
        const result = await evaluate(
          order,
          stored.map((x) => ({ ...x, orderItemID: x.orderItem_ID })),
          invoice.currency,
        );
        if (result.findings.some((x) => x.code === 'CURRENCY_MISMATCH'))
          return req.reject(
            409,
            'Currency mismatch must be corrected before approval. Reject this invoice and submit a corrected one with a new reference.',
          );
        if (result.findings.some((x) => x.previouslyApproved > 0 && x.billed > x.remaining))
          return req.reject(
            409,
            'Previously approved invoices have consumed the available quantity. Approval is blocked.',
          );
      }
      const status = decision === 'approve' ? 'Approved' : 'Rejected';
      const changed = await UPDATE(Invoices)
        .set({ status, version: expectedVersion + 1 })
        .where({ ID: invoiceID, version: expectedVersion, status: invoice.status });
      if (changed !== 1)
        return req.reject(
          409,
          'Another reviewer changed this invoice. Refresh before trying again.',
        );
      await audit(invoiceID, req.user.id, status, note.trim(), invoice.status, status);
      return SELECT.one.from(Invoices).where({ ID: invoiceID });
    });
    return super.init();
  }
};

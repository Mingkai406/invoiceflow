using { invoiceflow as db } from '../db/schema';

@path: '/odata/v4/review'
@requires: 'Viewer'
service ReviewService {
  @readonly entity PurchaseOrders as projection on db.PurchaseOrders;
  @readonly entity OrderItems as projection on db.OrderItems;
  @readonly entity Receipts as projection on db.Receipts;
  @readonly entity Invoices as projection on db.Invoices;
  @readonly entity InvoiceLines as projection on db.InvoiceLines;
  @readonly entity AuditEvents as projection on db.AuditEvents;

  type LineInput {
    orderItemID : UUID;
    quantity : Integer;
    unitPrice : String(20);
  }
  @requires: 'Clerk'
  action submitInvoice(requestKey: String(80), number: String(40), supplier: String(80),
    orderID: UUID, currency: String(3), lines: many LineInput) returns Invoices;

  @requires: 'Approver'
  action decide(invoiceID: UUID, expectedVersion: Integer, decision: String(10), note: String(1000)) returns Invoices;
}

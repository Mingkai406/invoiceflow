namespace invoiceflow;
using { cuid, managed } from '@sap/cds/common';

@assert.unique: { number: [number] }
entity PurchaseOrders : cuid {
  number : String(30) not null;
  supplier : String(80) not null;
  supplierName : String(120);
  currency : String(3) not null;
  revision : Integer default 0;
  items : Composition of many OrderItems on items.order = $self;
}
entity OrderItems : cuid {
  order : Association to PurchaseOrders not null;
  description : String(160);
  quantity : Integer not null;
  unitPrice : Decimal(12,2) not null;
  receipts : Composition of many Receipts on receipts.item = $self;
}
entity Receipts : cuid {
  item : Association to OrderItems not null;
  reference : String(40);
  receivedOn : Date;
  quantity : Integer not null;
}
@assert.unique: { supplierInvoice: [supplier, number] }
entity Invoices : cuid, managed {
  number : String(40) not null;
  supplier : String(80) not null;
  supplierName : String(120);
  order : Association to PurchaseOrders not null;
  currency : String(3) not null;
  total : Decimal(15,2) not null;
  status : String(20) not null;
  version : Integer default 1;
  submittedBy : String(80) not null;
  findings : LargeString;
  lines : Composition of many InvoiceLines on lines.invoice = $self;
  events : Composition of many AuditEvents on events.invoice = $self;
}
entity InvoiceLines : cuid {
  invoice : Association to Invoices not null;
  orderItem : Association to OrderItems not null;
  description : String(160);
  quantity : Integer not null;
  unitPrice : Decimal(12,2) not null;
}
entity AuditEvents : cuid {
  invoice : Association to Invoices not null;
  at : Timestamp not null;
  actor : String(80) not null;
  action : String(30) not null;
  note : String(1000);
  fromStatus : String(20);
  toStatus : String(20);
}
entity RequestLedger {
  key actor : String(80);
  key requestKey : String(80);
  payloadHash : String(64) not null;
  invoice : Association to Invoices not null;
}

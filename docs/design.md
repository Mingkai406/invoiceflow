# Design notes

## Scope

An invoice is submitted against one existing purchase order and may contain several distinct order items. The quick-entry screen handles one line; the API handles up to 50. Purchase orders and goods receipts are fixture data exposed through read-only endpoints. Invoice submissions and review decisions are the write paths.

The demonstration intentionally separates the matching result from the review decision. An exception is evidence to inspect, not an automatic rejection. A reviewer may approve a missing-receipt, quantity or price exception with a reason. A currency mismatch is always blocked. Once another approved invoice has consumed the remaining receipt quantity, approval is blocked instead of silently allowing double billing. There is no payment or accounting-system write.

## Data and money

`PurchaseOrders -> OrderItems -> Receipts` represents purchasing and receiving. `Invoices -> InvoiceLines` records what a supplier billed. `AuditEvents` records workflow decisions, while `RequestLedger` binds a client retry key to its normalized payload and invoice.

Prices accept at most two decimal places. The matcher converts them to integer minor units using JavaScript `BigInt`; it never multiplies binary floating-point prices to produce invoice totals. V1 supports USD, EUR and GBP and whole quantities only. The UI formats values for display; the server calculates totals independently.

For each line, available quantity is the smaller of ordered and received quantity, less quantities already approved. Multiple receipts are summed. Missing receipts, insufficient quantities and differing prices produce separate findings. Rejected and pending invoices do not consume approved quantity. Therefore a match at submission is a snapshot, and approvals recheck availability.

## Writes and concurrency

CAP wraps each action in a database transaction. Invoice, lines, request ledger and initial audit event commit together. A retry with the same normalized payload returns its existing invoice. Supplier/reference uniqueness is also enforced in the schema, so a new request key cannot bypass duplicate detection. Supplier and invoice references are trimmed and uppercased; the key is scoped to the submitting user.

An approval updates the purchase-order revision before evaluating available quantity. On the tested SQLite adapter, transactions serialize writes. The invoice update also compares the expected version and original state. Only the successful update writes a decision event. The test suite checks concurrent duplicate submissions, two simultaneous decisions on one invoice, and two approvals competing for the same received quantity.

**These results establish behavior for the local SQLite setup.** HANA or another production database needs its own transaction-isolation and concurrency tests. A unique-constraint failure on a different database may require an adapter-specific conflict response/retry path. Do not infer distributed exactly-once delivery from the local tests.

## Access and history

The service requires a Viewer role. Only Clerks can submit; only Approvers can decide. Users cannot approve their own submissions, even if they hold both roles. Entity writes are disabled, including invoice-line and audit projections, so callers cannot bypass action checks with a PATCH.

The local demo uses CAP's mocked authentication and published test credentials. It is restricted to loopback. Production mode is deliberately refused while the database is SQLite or authentication is mocked; configure and validate the cloud services first. The workbench role selector only appears in development.

Audit records are immutable through the service API. They are not cryptographically tamper-evident against a database administrator. There is no retention policy, regulatory certification or cross-organization tenancy claim.

## Interface

A split workbench keeps the invoice queue and document evidence visible together. Muted green identifies actions and matched documents; amber calls out differences. Status text accompanies every color. A serif heading adds character without a marketing hero, decorative animation or badge wall.

Native HTML, CSS and JavaScript are sufficient for the screen's state and forms. There is no copied UI template, remote font, analytics script or image dependency. The only image in the README is a screenshot of the running application. Browser tests cover desktop, tablet and phone widths; this is not a full accessibility certification.

The list loads the newest 200 invoices. It is a small-dataset workbench, not a paginated production ledger. Default in-memory storage resets on restart. The sample loader calls real submission actions and can safely be retried.

## References

Checked October 9, 2026:

- [SAP CAP getting started](https://cap.cloud.sap/docs/get-started/)
- [CAP authentication](https://cap.cloud.sap/docs/node.js/authentication)
- [CAP transactions](https://cap.cloud.sap/docs/node.js/cds-tx)
- [OData](https://www.odata.org/)
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/)

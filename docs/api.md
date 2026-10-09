# API

Base path: `/odata/v4/review`.

In the **local demo only**, use HTTP Basic authentication with `clerk`, `reviewer` or `auditor` and password `local-demo`. Do not reuse these credentials in a deployment. The additional `dual` test user exists to test the self-approval rule.

## Read

```sh
curl -u auditor:local-demo 'http://localhost:4004/odata/v4/review/$metadata'
curl -u auditor:local-demo 'http://localhost:4004/odata/v4/review/PurchaseOrders?$expand=items'
curl -u auditor:local-demo 'http://localhost:4004/odata/v4/review/Invoices?$filter=status%20eq%20%27Exception%27&$expand=lines,events'
```

CAP serves OData V4 metadata, `$filter`, `$select`, `$expand`, `$orderby`, `$top` and `$skip`. Entity creation, updates and deletion are not permitted. Business writes go through the actions below.

## Submit an invoice

```sh
curl -u clerk:local-demo \
  -H 'Content-Type: application/json' \
  -d '{
    "requestKey": "invoice-upload-1048",
    "number": "INV-1048",
    "supplier": "ACME",
    "orderID": "10000000-0000-4000-8000-000000000001",
    "currency": "USD",
    "lines": [{
      "orderItemID": "20000000-0000-4000-8000-000000000001",
      "quantity": 100,
      "unitPrice": "24.50"
    }]
  }' \
  http://localhost:4004/odata/v4/review/submitInvoice
```

This example produces an `Exception`: 100 units are billed but only 80 have been received. The response includes the invoice ID, version, calculated total and JSON-encoded findings. Use a new reference if the sample loader has already submitted `INV-1048`.

The request key is 8–80 characters from letters, digits, underscore, period, colon or hyphen. Repeating a request with the same key and equivalent normalized data returns the original invoice. Changed payloads return `409`. Prices must be decimal strings with up to two fractional digits. Quantities are integers from 1 to 100000; supported currencies are USD, EUR and GBP.

## Decide

Use the `ID` and `version` returned by a read or submission:

```json
{
  "invoiceID": "<invoice UUID>",
  "expectedVersion": 1,
  "decision": "reject",
  "note": "Invoice exceeds the received quantity. Request a correction."
}
```

POST this body to `/decide` as `reviewer`. Decisions are `approve` or `reject`; notes are mandatory, up to 1000 characters. A successful decision increments the version and appends an audit event. Resolved invoices cannot be reopened in V1. Corrected invoices need a new reference.

| Status | Meaning                                                                      |
| ------ | ---------------------------------------------------------------------------- |
| 400    | Invalid input or supplier/item mismatch                                      |
| 401    | Missing or invalid credentials                                               |
| 403    | Wrong role or attempted self-approval                                        |
| 404    | Unknown order or invoice                                                     |
| 405    | Attempted write to a read-only entity                                        |
| 409    | Duplicate reference, retry-key collision, stale decision or blocked approval |

Do not blindly retry a `409` decision. Read the current invoice, inspect the reason and decide whether a new action is appropriate.

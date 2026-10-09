// Seed invoices through the same public API used by the workbench.
const base = process.env.INVOICEFLOW_URL || 'http://localhost:4004';
const cases = [
  [1, 'INV-1048', 100, '24.50', 'USD', 'ACME'],
  [2, 'INV-2081', 200, '8.70', 'USD', 'NORTH'],
  [3, 'INV-3092', 60, '16.00', 'USD', 'FIELD'],
  [4, 'INV-4026', 40, '125.00', 'EUR', 'MESA'],
  [5, 'INV-5120', 120, '12.50', 'USD', 'CEDAR'],
];
(async () => {
  for (const [i, number, quantity, unitPrice, currency, supplier] of cases) {
    const result = await fetch(`${base}/odata/v4/review/submitInvoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from('clerk:local-demo').toString('base64')}`,
      },
      body: JSON.stringify({
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
      }),
    });
    const data = await result.json();
    if (!result.ok) throw new Error(`${result.status}: ${JSON.stringify(data)}`);
    console.log(`${number}: ${data.status}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

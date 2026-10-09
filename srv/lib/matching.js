'use strict';

// Exact minor-unit arithmetic. V1 accepts whole item quantities and two-decimal prices.
function cents(value) {
  const text = String(value);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(text))
    throw new Error('Price must be a non-negative amount with at most two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function money(value) {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}
function match(order, lines, receipts, approved = []) {
  const findings = [];
  let total = 0n;
  for (const line of lines) {
    const item = order.items.find((x) => x.ID === line.orderItemID);
    if (!item) throw new Error('Invoice item does not belong to the purchase order.');
    const received = receipts
      .filter((x) => x.item_ID === item.ID)
      .reduce((sum, x) => sum + x.quantity, 0);
    const billed = approved
      .filter((x) => x.orderItem_ID === item.ID)
      .reduce((sum, x) => sum + x.quantity, 0);
    const remaining = Math.max(0, Math.min(received, item.quantity) - billed);
    if (line.quantity > remaining)
      findings.push({
        code: received === 0 ? 'MISSING_RECEIPT' : 'QUANTITY_MISMATCH',
        item: item.ID,
        message:
          received === 0
            ? `No receipt recorded for ${item.description}.`
            : `${line.quantity} billed; ${remaining} units available to invoice for ${item.description}.`,
        ordered: item.quantity,
        received,
        previouslyApproved: billed,
        billed: line.quantity,
        remaining,
      });
    if (cents(line.unitPrice) !== cents(item.unitPrice))
      findings.push({
        code: 'PRICE_MISMATCH',
        item: item.ID,
        message: `Unit price ${money(cents(line.unitPrice))}; purchase order ${money(cents(item.unitPrice))}.`,
        expected: money(cents(item.unitPrice)),
        actual: money(cents(line.unitPrice)),
      });
    total += cents(line.unitPrice) * BigInt(line.quantity);
  }
  if (total > 999999999999999n) throw new Error('Invoice total exceeds the supported range.');
  return { total: money(total), findings };
}
module.exports = { cents, money, match };

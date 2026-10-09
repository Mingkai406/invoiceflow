const { test, expect } = require('@playwright/test');

test('review workbench: matching evidence, roles, decisions and responsive layout', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Load sample invoices' }).click();
  await expect(page.getByRole('heading', { name: 'INV-1048', exact: true })).toBeVisible();
  await expect(
    page.getByText('100 billed; 80 units available to invoice for Sensor assembly.'),
  ).toBeVisible();
  for (const [width, height] of [
    [1440, 1100],
    [820, 1180],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole('button', { name: 'Approve exception' }).click();
  await expect(page.getByText('Add a decision note before continuing.')).toBeVisible();
  await page
    .locator('#decision-note')
    .fill('Quantity exceeds received goods. Request corrected invoice.');
  await page.getByRole('button', { name: 'Reject invoice', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('rejected');
  await page.getByRole('button', { name: 'Reviewed', exact: true }).click();
  await page.locator('.invoice-row').first().click();
  await expect(
    page.getByText('Quantity exceeds received goods. Request corrected invoice.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All invoices', exact: true }).click();
  await page.locator('#role').selectOption('auditor');
  await page.locator('.invoice-row').filter({ hasText: 'INV-5120' }).click();
  await expect(page.getByRole('button', { name: 'Approve invoice', exact: true })).toBeDisabled();
  await page.locator('#role').selectOption('clerk');
  await page.getByRole('button', { name: 'New invoice', exact: false }).click();
  await page.locator('#invoice-number').fill('UI-ENTRY-1');
  await page.locator('#quantity').fill('10');
  await page.getByRole('button', { name: 'Submit & check' }).click();
  await expect(page.getByRole('heading', { name: 'UI-ENTRY-1', exact: true })).toBeVisible();
  await page.locator('#role').selectOption('reviewer');
  await page.locator('#decision-note').fill('Quantity and price verified against receipts.');
  await page.getByRole('button', { name: 'Approve invoice', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('approved');
  expect(errors).toEqual([]);
});

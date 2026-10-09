const cds = require('@sap/cds');
(async () => {
  const model = await cds.load(['db', 'srv']);
  cds.compile.to.sql(model, { dialect: 'sqlite' });
  cds.compile.to.edmx(model, { service: 'ReviewService', version: 'v4' });
  console.log('CDS model compiles to SQLite and OData V4 metadata.');
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

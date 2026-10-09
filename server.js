const cds = require('@sap/cds');
cds.on('bootstrap', (app) => {
  const localDemo = cds.env.profiles.includes('development');
  if (
    !localDemo &&
    (cds.env.requires.db.kind === 'sqlite' || cds.env.requires.auth.kind === 'mocked')
  ) {
    throw new Error(
      'Production requires a persistent cloud database and real authentication. See docs/btp.md.',
    );
  }
  if (localDemo) {
    const listen = app.listen.bind(app);
    app.listen = (port, ...args) => listen(port, '127.0.0.1', ...args);
  }
  app.get('/demo-config', (_req, res) => {
    res.json({ demo: cds.env.profiles.includes('development') });
  });
});
module.exports = cds.server;

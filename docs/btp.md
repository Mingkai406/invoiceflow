# Deploying to SAP BTP

**Status: deployment guide, not a completed cloud deployment.** The repository currently runs CAP and OData V4 against SQLite locally. No BTP account, HANA instance or SAP identity-service binding was used to validate this release.

## Target

- Cloud Foundry runs the CAP Node.js service.
- SAP HANA Cloud stores orders, invoices, request keys and audit records.
- IAS or XSUAA supplies authenticated identities and application roles.
- An application router handles the workbench sign-in flow and routes authenticated OData requests.

The existing browser demo sends mock Basic credentials. The production workbench needs the application-router route, identity binding and token/CSRF flow verified before it can be treated as usable in the cloud.

## Integration sequence

1. Create or select a BTP development subaccount with the required Cloud Foundry, HANA and identity-service entitlements. Availability and quotas depend on the account; do not assume every Trial includes every service.
2. On a separate deployment branch, use the current official CAP development kit to add the HANA, authentication, application-router and MTA deployment facets. Review the generated files against the current [CAP deployment documentation](https://cap.cloud.sap/docs/).
3. Move SQLite and the mocked users entirely into the development profile. Configure production database credentials through service bindings, not checked-in files. The included server guard deliberately refuses the SQLite/mocked combination in production.
4. Map Viewer, Clerk and Approver to authenticated role collections. Keep the two-person approval rule. Do not expose the local role switcher or test credentials as a cloud login mechanism.
5. Deploy the database schema and service, then load a separate set of synthetic demonstration records. The local JSON fixtures must not become real business records.
6. Run the API and concurrency tests against HANA. In particular, validate row locking, stale writes, retry-key conflicts and two approvals against the same PO. Local SQLite passing results do not establish HANA behavior.
7. Verify the authenticated browser flow and record the deployment date, service versions and integration results. Only then describe the application as deployed to BTP.

The generator is intentionally not a runtime dependency. This keeps local installation small and avoids bundling an entire deployment toolchain into the service. Use a supported development-kit version and check its dependency advisories when preparing the deployment.

No account resources are created by `npm ci`, `npm start` or the test suite.

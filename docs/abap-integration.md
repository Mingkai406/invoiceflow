# ABAP purchase-order integration

**Status: proposed extension. No ABAP code has been executed or validated for this release.**

The useful boundary is upstream purchasing data. CAP owns invoice intake and review; an ABAP RAP service owns purchase orders and receipts. That gives ABAP a real role without duplicating the entire matching engine.

## Small next step

Create a read-only RAP business object in an SAP BTP ABAP Environment Trial:

- Purchase order: external ID, supplier, currency.
- Item: external item ID, order ID, description, ordered quantity, unit price.
- Receipt: external receipt ID, item ID, quantity and receipt date.

Expose these entities through an OData service binding. Import its metadata into CAP and add a remote-service adapter. Keep external keys separate from the local UUIDs and record synchronization time so a reviewer can see how fresh the receipts are.

The current local fixture relationships provide the target mapping; they are **not** an ABAP simulator or evidence of ERP integration.

## Tests required before claiming integration

- ABAP Unit tests for the upstream object and authorization.
- Contract tests for data types, key mapping and currency precision.
- CAP tests for unavailable upstream service, stale receipts, pagination and duplicate receipt synchronization.
- An end-to-end run proving that a receipt created upstream changes the available-to-invoice quantity locally.

An ABAP runtime is required. Uploading source files to GitHub or running a syntax-only check would not prove that integration works.

Reference: [Create an SAP BTP ABAP Environment Trial user](https://developers.sap.com/tutorials/abap-environment-trial-onboarding).

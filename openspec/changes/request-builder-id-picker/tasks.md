# Tasks

## 1. Collector (`lib/id-collector.ts`)

- [x] 1.1 Created ids: cap 3 → 5 per API; skip when the returned id equals one of the request's path-param values (new optional argument); move an already-collected id to the top instead of duplicating it, keeping its original label. Add `lib/__tests__/id-collector.test.ts` covering cap, path-param skip and dedupe; verify `npm run test:unit` passes.
- [x] 1.2 Add `isCollectionPath(path)` and `extractSeenItems(body)` (root array or `_embedded` collection only; label order as in design.md, person name fallback, no label otherwise). Extend the test file with `_embedded` and root-array bodies, a person item, an item without label fields, a single-resource path; verify `npm run test:unit` passes.
- [x] 1.3 Add the seen-id collection under `packrest.seen-ids`: `recordSeenIds`, a reader for the picker, hydration in `bootstrapIdCollector()`, same change event; `clearCollectedIds()` with no argument clears both collections. Test newest-first ordering, dedupe and the 20-per-operation cap; verify `npm run test:unit` passes.

## 2. Capture (`hooks/use-request-execution.ts`)

- [ ] 2.1 Pass the request's path-param values to `recordCreatedId`, and after a 2xx GET on a collection path call `recordSeenIds` with the extracted items (operation summary as source label). Verify under `npm run tauri:dev`: running « submitContract » after « createContract » leaves one contract entry in the topbar; running « listFunds » records funds (inspect via the picker once group 3 lands, or `packrest.json`).

## 3. Picker (`components/IdPicker.tsx`)

- [x] 3.1 Build the popover picker: search, grouping by API title then « Créés · op » / « Vus · op », current API first, label + 8-char id + relative time, empty-state message, re-read on `COLLECTED_IDS_CHANGED_EVENT`; selection calls `onChange` with the full id. Add the shared `isIdField(name, schema)` predicate with a unit test (uuid format, `_id` suffix, neither). Verify `npm run typecheck` and `npm run test:unit` pass.
- [ ] 3.2 Mount it beside path-param inputs in `RequestBuilder` when `isIdField` holds, passing the builder's `apiId`. Verify under `npm run tauri:dev`: « createPremium » shows the button on `contract_id`; picking fills the input; typing and pasting still work.
- [ ] 3.3 Provide the form's `apiId` to `SchemaField` leaves and mount the picker in the plain-input string branch only. Verify under `npm run tauri:dev`: `payment_method_id` and `allocations.funds[0].fund_id` in « createPremium » on the endpoint page show the button and accept a picked fund from « listFunds »; in the parcours « Versement initial » step, `fund_id` keeps its option list and shows no button.

- [ ] 3.4 Products: `FETCHABLE_ID_LISTS` (`product_id` → `listProducts`), `recordSeenIds` `replace` option (unit-tested), the picker fetches the list on first opening when none is collected and offers « Recharger les produits ». Verify under `npm run tauri:dev`: on « createContract », the `product_id` picker lists the products on first opening, without a call on later openings, and the refresh replaces them; `subscriber_id` lists no product and `product_id` lists nothing but products.

- [ ] 3.5 Labels: `itemLabel` (naming fields, else « last_name first_name », else none) shared by list items and created resources (`CollectedId.name` from the POST body); an unnamed item shows its id alone. Verify under `npm run tauri:dev`: after « createIndividual », the picker and the topbar show the person's name; a created contract shows only its id.

- [ ] 3.6 Parcours ids: `recordResponseIds` shared by the run hook and `callOperation({ collectIds })` (unit-tested); the auto-runner collects on its step calls; the parcours `RequestBuilder` passes `idOrigin="parcours"`; « Parcours » badge in the picker and the topbar. Verify under `npm run tauri:dev`: after an auto run, the person and contract appear with the badge; an id created from the endpoint page has none.

## 4. Topbar and docs

- [ ] 4.1 `components/IdCollector.tsx`: description says 5 per API; « Tout vider » clears seen ids too. Verify under `npm run tauri:dev` that after « Tout vider » a picker shows the empty state.
- [x] 4.2 Update `CLAUDE.md` (`id-collector.ts` entry: 5 created per API, seen ids from list responses, the picker; add `IdPicker` to the components list). Verify the text matches the implemented behaviour.
- [x] 4.3 Run `npm run typecheck`, `npm run test:unit`, `npm run build`, `npm test` (Playwright, incl. `topbar-tools.spec.ts`; update visual snapshots only if the change is intended) and `cargo check` in `src-tauri/`; all pass.

## Workflow follow-up

- Bump the release per the project's convention once the user approves the commit.
- Archive the change after review.

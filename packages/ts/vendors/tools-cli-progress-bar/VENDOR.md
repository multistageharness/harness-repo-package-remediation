# Vendor provenance — `@internal/tools-cli-progress-bar`

This directory is a **pristine mirror** of the upstream npm package, imported
in-process by relative path (never a declared dependency). Recorded here so a
later refresh is reproducible.

| Field | Value |
| :--- | :--- |
| Upstream repo | `carlosmarte/npm-cli-progressor` |
| Upstream npm name | `@thinkeloquent/cli-progressor` |
| Pinned version | `1.0.2` |
| Vendored-as name | `@internal/tools-cli-progress-bar` |
| Fetch mechanism | `npm pack @thinkeloquent/cli-progressor@1.0.2 --registry=https://registry.npmjs.org` |
| Tarball | `thinkeloquent-cli-progressor-1.0.2.tgz` |
| Tarball shasum (sha1) | `cd3d0047fe540373f73c7b29b700a9080c3d7fed` |
| Tarball integrity (sha512) | `sha512-pkF4avkKbnaUh…hl4D4YbwTzHqg==` |

The upstream Git commit SHA is **not** published to npm, so — unlike the
`git subtree`-vendored `langgraph-harness/` and `repository-fingerprint/`
mirrors — this tool is pinned to the **npm version + tarball digest** above
rather than a subtree-split SHA. That pin is reproducible: re-running the
`npm pack` for `1.0.2` yields the same tarball digest.

## Files vendored

- `main.mjs` — the upstream ESM entry, **verbatim** (single-file library; no
  other modules).
- `test.mock.mjs`, `test.renderer.mjs` — the upstream test files, **verbatim**.
- `package.json` — verbatim **except** `name`
  (`@thinkeloquent/cli-progressor` → `@internal/tools-cli-progress-bar`).
- `README.md`, `VENDOR.md` — added by this repo (vendor notes; not upstream).

## Refresh recipe

```sh
npm pack @thinkeloquent/cli-progressor@<version> --registry=https://registry.npmjs.org
tar xzf thinkeloquent-cli-progressor-<version>.tgz
# copy package/main.mjs (+ test files) over the vendored copies verbatim,
# then re-apply ONLY the package.json name rename. Update the pin table above.
```

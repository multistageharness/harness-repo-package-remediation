---
name: golang-remediation
description: Remediate vulnerable Go module dependencies by bumping the required version in go.mod and reconciling go.sum.
---

# Go module remediation

For each vulnerable Go module:

- Bump the module requirement to the patched version in `go.mod`
  (`go get module@vX.Y.Z`), which also updates `go.sum`.
- For a transitively-pulled module, add an explicit `require` (or a `replace`
  directive when upstream has not released a fix) at the patched version.
- Reconcile with `go mod tidy` after the bump (deferred in the current scope).

Available tool: `go-get-bump`.

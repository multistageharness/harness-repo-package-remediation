# ecosystem-test playbooks

Declarative per-ecosystem **TEST** playbooks (`langgraph-flow.md` capability 1,
step "test it — if present"). Same schema as the ecosystem-build /
ecosystem-installation playbooks (`<ecosystem>/test.yaml`), consumed by
`commands.testRun` (`configs/patterns/test-run.mjs`).

Each step is an argv list with a `guard` CLI probe (absent → recorded skip), a
bounded timeout, `allowNonZero: true` (the exit code is a recorded outcome —
0025/A1), and an `artifact` log name. The test stage runs **after** the build
stage — a test needs the built + installed tree.

"If present" is honored per ecosystem: the node lane uses
`npm run test --if-present` (a repo with no `test` script is a clean no-op, not a
failure — degrade, never guess); `docker`/`other` are explicit no-ops.

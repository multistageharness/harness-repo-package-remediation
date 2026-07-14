/**
 * src/tracing-init.mjs — the side-effect rung of the tracing seam (record 0052/D1).
 *
 * WHY A SEPARATE MODULE. `disableTracing()` is a pure function; something has to
 * CALL it before the graph runtime is reachable. `bin/flow.mjs` and `run-flow.mjs`
 * call it explicitly, but neither is on the path of a test that imports the SDK
 * directly — and the graph tests do exactly that, so an ambient
 * LANGCHAIN_TRACING_V2 was still exporting every stage of every test run to
 * LangSmith (measured: 13 `POST /runs/multipart` per test file). D1 requirement 4
 * says off "including under --mock and in tests", so the switch has to be thrown
 * by the module that HANDS OUT the runtime, not by each caller who remembers to.
 *
 * `src/sdk.mjs` imports this FIRST, above its `export … from` of the vendored SDK.
 * ESM evaluates import declarations in source order, so the tracing flags are off
 * before `@langchain/core` is even evaluated — you cannot obtain `compileFlow` /
 * `runFlow` through the sanctioned seam with tracing live.
 *
 * Idempotent: the explicit calls in bin/flow.mjs and run-flow.mjs still stand
 * (they also surface the user-facing notice); a second call finds nothing left on.
 */
import { disableTracing } from "./tracing.mjs";

disableTracing();

/**
 * src/sdk.mjs — the single site that reaches into the vendored @internal/langgraph-langchain-harness-sdk.
 *
 * The vendored SDK is imported by RELATIVE path into the pristine mirror
 * (harness-repo-package-remediation/vendors/langgraph-harness/) — NOT as a declared dependency — so the
 * mirror's frozen LangChain pins stay isolated in its own install root and
 * never enter harness's dependency tree (see ../README.md, resolution
 * strategy). Every wizard module imports SDK symbols from here, mirroring the
 * one relative-import site already used by test/ingest-classify-flow.test.mjs.
 *
 * This module is also the TRACING CHOKEPOINT (record 0052/D1). The side-effect
 * import below MUST stay first: it throws the LangSmith switches off before the
 * vendored SDK — and with it @langchain/core — is evaluated, so no caller can
 * reach the graph runtime through this seam with tracing live.
 */
import "./tracing-init.mjs";

export {
  createRegistry,
  loadFlowConfig,
  parseFlowConfig,
  validateFlow,
  compileFlow,
  runFlow,
  EVENT_TYPES,
  writeFileAtomic,
  runArgv,
  validateSchema,
  // The seam helper (emit llm.call → ctx.llm.invoke → emit llm.result). Record
  // 0062/A4: the pack's own skills atoms route through THIS — the same helper the
  // platform's built-in skills atoms use — instead of hand-rolling the event pair,
  // so anything added at the seam (token usage, retries, redaction) reaches the two
  // atoms that actually run in this pipeline.
  callLlm,
} from "../../langgraph-harness/sdk/src/index.mjs";

// The LLM toggle + the SDK-backed provider (record 0062/D2–D4). They live in the
// pack, not the pristine mirror: `compileFlow({options: {llm}})` is an injection
// seam, so a new provider never has to land inside vendors/langgraph-harness/.
// Re-exported here because src/sdk.mjs is the ONE bridge every wizard module and
// atom reaches SDK symbols through.
export { resolveLlmProvider, createSdkProvider, HarnessSdkProvider, LlmProviderError, loadSdkModule, sdkModuleUrl } from "./llm/sdk-provider.mjs";
export { resolveLlmConfig, defaultLlmConfig, harnessConfigPath, isSdkProvider, LlmConfigError, LLM_PROVIDERS, SDK_PROVIDERS, PLATFORM_PROVIDERS } from "./llm/config.mjs";

// Central registries the SDK layer LOADS / REFERENCES (langgraph-flow.md
// capabilities 2 + 3): the remediation TOOL registry (harness-repo-package-remediation/tools/) and the
// SKILL registry (harness-repo-package-remediation/skills/, agentskills.io SKILL.md spec). Re-exported
// here so every wizard module + atom reaches them through the one SDK seam,
// exactly as it does the vendored @internal/langgraph-langchain-harness-sdk symbols above.
export { loadToolRegistry, toolsForEcosystem, defaultToolsDir, validateTool, TOOL_ECOSYSTEMS, TOOL_PACKAGE_MANAGERS } from "./tool-registry.mjs";
export { loadSkillRegistry, getSkill, readSkillBody, defaultSkillsDir, validateSkill, parseSkillMarkdown } from "./skill-registry.mjs";

// Version-discovery engine (change record 0033/D0): the `versions`/`find`/
// `test` verbs over the per-package-manager adapter table (0033/D1–D9), plus
// the adapter seam itself — re-exported here so external scripts drive the
// engine through the one SDK seam, exactly like the playground's
// `import * as sdk from "./sdk.mjs"` funnel.
export { versions, find, test, getAdapter, registerAdapter, rankCandidates, VERSION_DISCOVERY_ADAPTERS } from "./version-discovery.mjs";

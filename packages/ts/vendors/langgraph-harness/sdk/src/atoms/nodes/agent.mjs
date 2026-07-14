/**
 * nodes.agent — the bounded autonomous loop: reason → act → observe, inside
 * one node. The LLM proposes {action, action_input} against a tool menu of
 * REGISTERED command patterns (resolved through the registry — the agent can
 * only act through audited atoms, never arbitrary code). Dual failsafe: BOTH
 * `max_attempts` and `deadline_s` are enforced, so neither alone can wedge
 * the loop (autonomous-remediation-loop lineage).
 *
 * Writes {answer, finished_reason, attempts, history[]} into `out`.
 */

import { callLlm } from "../skills/_skill-base.mjs";

export const meta = {
  name: "nodes.agent",
  category: "nodes",
  summary: "Bounded reason→act→observe agent over registered command-atom tools (dual failsafe).",
  params: {
    type: "object",
    required: ["goal_from", "out"],
    properties: {
      model: { type: "string" },
      goal_from: { type: "string", minLength: 1 },
      system: { type: "string" },
      tools: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "uses"],
          properties: {
            name: { type: "string", pattern: "^[a-z][a-z0-9_]*$" },
            uses: { type: "string" },
            with: { type: "object" },
            description: { type: "string" },
          },
        },
      },
      max_attempts: { type: "integer", minimum: 1, maximum: 25 },
      deadline_s: { type: "integer", minimum: 1, maximum: 3600 },
      out: { type: "string", minLength: 1 },
    },
  },
  returns: "node",
};

export function agent(params, ctx) {
  const maxAttempts = params.max_attempts ?? 5;
  const deadlineMs = (params.deadline_s ?? 120) * 1000;
  const tools = params.tools ?? [];

  return async (state) => {
    // Tool bodies are command atoms resolved through the SAME registry the
    // yaml uses — the agent's action space is the audited atom set.
    const toolBodies = new Map();
    for (const tool of tools) {
      const { factory, entry } = await ctx.registry.resolve(tool.uses);
      if (entry.category !== "commands") {
        throw new Error(`nodes.agent: tool '${tool.name}' must use a commands.* pattern (got '${tool.uses}' → ${entry.category})`);
      }
      toolBodies.set(tool.name, factory(tool.with ?? {}, ctx));
    }

    // "finish" first so the mock provider's enum-first skeleton terminates immediately.
    const actionEnum = ["finish", ...tools.map((t) => t.name)];
    const decisionSchema = {
      type: "object",
      required: ["thought", "action"],
      properties: {
        thought: { type: "string" },
        action: { enum: actionEnum },
        action_input: { type: "string" },
        answer: { type: "string" },
      },
    };

    const goal = state[params.goal_from];
    const toolMenu = tools.map((t) => `- ${t.name}: ${t.description ?? t.uses}`).join("\n") || "- (no tools — reason only)";
    const system = [
      params.system ?? "You are a careful autonomous operator.",
      `You work in bounded attempts. Available actions:\n${toolMenu}\n- finish: stop and report the answer.`,
      `Respond with your next single action.`,
    ].join("\n\n");

    const startedAt = Date.now();
    const history = [];
    let finishedReason = null;
    let answer = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // dual failsafe — the deadline is checked even if max_attempts is generous
      if (Date.now() - startedAt > deadlineMs) {
        finishedReason = "deadline";
        break;
      }
      ctx.emit("loop.guard", { node: ctx.node?.id, attempt, of: maxAttempts, kind: "agent" });

      const transcript = history
        .map((h, i) => `### Attempt ${i + 1}\nthought: ${h.thought}\naction: ${h.action}\nobservation: ${h.observation}`)
        .join("\n\n");
      const user = `## Goal\n${typeof goal === "string" ? goal : JSON.stringify(goal)}\n\n## History\n${transcript || "(none yet)"}`;

      const decisionResult = await callLlm(ctx, {
        nodeId: ctx.node?.id,
        system,
        user,
        schema: decisionSchema,
        model: params.model,
      });
      const decision = decisionResult.structured;
      if (decision === undefined) {
        history.push({ thought: "(unparseable decision)", action: "error", observation: decisionResult.parse_error ?? "no JSON" });
        continue;
      }

      if (decision.action === "finish") {
        answer = decision.answer ?? decision.thought ?? "";
        finishedReason = "finished";
        history.push({ thought: decision.thought, action: "finish", observation: "done" });
        break;
      }

      const body = toolBodies.get(decision.action);
      let observation;
      if (!body) {
        observation = `unknown action '${decision.action}'`;
      } else {
        try {
          const delta = await body({ ...state, __agent_input: decision.action_input ?? "" });
          observation = JSON.stringify(delta).slice(0, 2000);
        } catch (err) {
          observation = `tool error: ${err.message}`;
        }
      }
      history.push({ thought: decision.thought, action: decision.action, observation });
    }

    if (finishedReason == null) finishedReason = "max_attempts";
    return {
      [params.out]: {
        answer,
        finished_reason: finishedReason,
        attempts: history.length,
        history,
      },
    };
  };
}

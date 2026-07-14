/**
 * executor/executor.mjs — stage 5: run / resume a compiled flow.
 *
 * Wraps graph.invoke with the run-event envelope, thread management, and
 * interrupt detection, so the CLI, backend, and tests all get the same
 * result shape:
 *
 *   { status: "completed" | "interrupted", threadId, state, interrupt?, events }
 *
 * HITL: an interrupted run returns the interrupt payload; resumeFlow feeds
 * `Command({resume})` back in on the same thread. With checkpoints.file the
 * resume can happen in a DIFFERENT process — the durable-thread upgrade.
 */

import { randomUUID } from "node:crypto";
import { Command } from "@langchain/langgraph";

import { LanggraphLangchainHarnessError } from "../errors.mjs";

function stripInterruptKey(state) {
  if (state == null || typeof state !== "object") return state;
  const { __interrupt__, ...rest } = state;
  return rest;
}

function firstInterrupt(result) {
  const list = result?.__interrupt__;
  if (Array.isArray(list) && list.length > 0) {
    const raw = list[0];
    return raw?.value !== undefined ? raw.value : raw;
  }
  return undefined;
}

async function drive(compiled, payload, { threadId, onEvent, resumed }) {
  const { graph, config, hub } = compiled;
  const unsubscribe = onEvent ? hub.on(onEvent) : null;
  const runThread = threadId ?? `run-${randomUUID()}`;
  const invokeConfig = { recursionLimit: config.runtime.recursion_limit };
  if (compiled.checkpointer) invokeConfig.configurable = { thread_id: runThread };

  hub.emit(resumed ? "run.resumed" : "run.start", {
    flow: config.name,
    thread_id: compiled.checkpointer ? runThread : null,
    mock: compiled.ctx.options.mock,
    dry_run: compiled.ctx.options.dryRun,
  });

  try {
    const result = await graph.invoke(payload, invokeConfig);
    const interruptValue = firstInterrupt(result);
    if (interruptValue !== undefined) {
      hub.emit("run.interrupted", { thread_id: runThread, interrupt: interruptValue });
      return {
        status: "interrupted",
        threadId: runThread,
        state: stripInterruptKey(result),
        interrupt: interruptValue,
        events: hub.list(),
      };
    }
    hub.emit("run.end", { flow: config.name, last_step: result?.last_step ?? null, errors: result?.error_logs?.length ?? 0 });
    return { status: "completed", threadId: runThread, state: result, events: hub.list() };
  } catch (err) {
    hub.emit("run.error", { flow: config.name, error: err.message, code: err instanceof LanggraphLangchainHarnessError ? err.code : "INTERNAL" });
    throw err;
  } finally {
    unsubscribe?.();
  }
}

/** Run a compiled flow from the start. */
export function runFlow(compiled, { input = {}, threadId, onEvent } = {}) {
  return drive(compiled, input, { threadId, onEvent, resumed: false });
}

/** Resume an interrupted thread with a human decision. */
export function resumeFlow(compiled, { threadId, resume, onEvent }) {
  if (!compiled.checkpointer) {
    throw new LanggraphLangchainHarnessError("NO_CHECKPOINTER", "resumeFlow requires a flow compiled with a checkpointer");
  }
  if (!threadId) throw new LanggraphLangchainHarnessError("NO_THREAD", "resumeFlow requires the threadId of the interrupted run");
  return drive(compiled, new Command({ resume }), { threadId, onEvent, resumed: true });
}

/** Inspect a thread's saved state (checkpointed flows only). */
export async function getThreadState(compiled, threadId) {
  if (!compiled.checkpointer) {
    throw new LanggraphLangchainHarnessError("NO_CHECKPOINTER", "getThreadState requires a flow compiled with a checkpointer");
  }
  const snapshot = await compiled.graph.getState({ configurable: { thread_id: threadId } });
  return {
    threadId,
    values: snapshot?.values ?? null,
    next: snapshot?.next ?? [],
    pendingInterrupt: (snapshot?.tasks ?? []).flatMap((t) => t.interrupts ?? []).map((i) => i.value)[0],
  };
}

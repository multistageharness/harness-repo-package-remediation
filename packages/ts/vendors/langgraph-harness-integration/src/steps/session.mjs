/**
 * steps/session.mjs — the wizard's FIRST step (change record `0024`/A2+D1):
 * "every run mints or resumes a session id, and every artifact lands under
 * `.harness/<SESSION_ID>/`".
 *
 * A `select` (new | existing), then the derived `ctx.plan.session*` seeds that
 * `steps/output.mjs` turns into every artifact path. A thin prompt shim over the
 * pure `src/session-lib.mjs`, mirroring `steps/ingest-source.mjs` over
 * `src/ingest-lanes.mjs`.
 *
 * WHY A WIZARD STEP AND NOT A MAKEFILE / bin SHIM. Ordering it first in `STEPS`
 * — rather than in `bin/flow.mjs` or `harness-repo-package-remediation/Makefile`'s `start` target — keeps
 * ONE interaction seam (`ctx.prompt`), so the scripted prompter drives it with no
 * TTY exactly like every other step, and a `StepRetry` back-jump target stays
 * addressable by id. `0021`/A3's holding (a selection needed before the graph
 * compiles is collected in the wizard, not via an in-graph `nodes.interrupt`,
 * which would break the `--mock`/offline acceptance contract — platform rule 3)
 * applies verbatim here.
 *
 * The step is NEVER lane-gated: it runs before any ingest lane is known, and it
 * always consumes its progress slot (`0024`/A2's counting discipline).
 *
 * NON-INTERACTIVE SEAM (`0024`/D2). `ctx.pinnedSessionId` — seeded by `runWizard`
 * from its `sessionId` option or `$HARNESS_SESSION_ID` — skips BOTH prompts and
 * validates the supplied id. This is load-bearing, not a convenience: without it
 * a scripted test run would mint a fresh UUID per invocation, so it could neither
 * pre-`rm` its artifacts nor assert them afterwards, and every `node --test` would
 * leave an orphan session dir behind.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { StepRetry } from "../step-control.mjs";
import { isValidSessionId, listSessions, mintSessionId, sessionDirFor } from "../session-lib.mjs";

/**
 * The RENDER BASE this run's `.harness/` hangs off — `runWizard` resolved it once
 * from `--harness-render-root` / `$HARNESS_RENDER_ROOT` / the invocation cwd. The
 * `?? ctx.cwd` rung keeps a hand-built ctx (unit tests, the correction loop) on
 * the pre-seam behavior rather than throwing.
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @returns {string}
 */
function renderBase(ctx) {
  return ctx.renderRoot ?? ctx.cwd;
}

/**
 * Seed the plan's session channels and create the run-scoped artifact root.
 * @param {import("../wizard.mjs").WizardCtx} ctx
 * @param {string} sessionId a validated session id
 * @param {"new"|"resumed"} origin how we came by it (surfaced in the confirm gate)
 */
async function seedSession(ctx, sessionId, origin) {
  ctx.plan.sessionId = sessionId;
  ctx.plan.sessionDir = sessionDirFor(renderBase(ctx), sessionId);
  ctx.plan.sessionOrigin = origin;
  await mkdir(ctx.plan.sessionDir, { recursive: true });
}

/**
 * @param {import("../wizard.mjs").WizardCtx} ctx
 */
export async function sessionStep(ctx) {
  // ── D2: a pinned id skips both prompts (explicit option > env > interactive) ──
  const pinned = ctx.pinnedSessionId;
  if (pinned) {
    if (!isValidSessionId(pinned)) {
      // Not a StepRetry: nobody is at the keyboard to correct it. Fail loudly.
      throw new Error(`Invalid pinned session id '${pinned}' — expected a canonical UUID (runWizard({ sessionId }) / $HARNESS_SESSION_ID)`);
    }
    const origin = existsSync(sessionDirFor(renderBase(ctx), pinned)) ? "resumed" : "new";
    await seedSession(ctx, pinned, origin);
    ctx.prompt.success(`Session: ${pinned} (pinned, ${origin}) — artifacts under ${ctx.plan.sessionDir}`);
    return;
  }

  const existing = listSessions(renderBase(ctx));
  const choice = await ctx.prompt.select({
    message: "Session",
    options: [
      { value: "new", label: "New session", hint: "mint a fresh UUID" },
      {
        value: "existing",
        label: "Resume an existing session",
        hint: existing.length ? `${existing.length} under .harness/` : "none found under .harness/",
      },
    ],
    initialValue: "new",
  });

  if (choice === "existing") {
    const answer = (
      await ctx.prompt.text({ message: "Session id", placeholder: existing[0] ?? "00000000-0000-4000-8000-000000000000" })
    ).trim();

    // A typo'd resume must NOT look like a clean first run — re-ask rather than
    // silently minting a new id (the `StepRetry` idiom, 0024/D1.3). Validate the
    // SHAPE before touching the filesystem: `sessionDirFor` throws on a bad id.
    if (!isValidSessionId(answer)) {
      ctx.prompt.error(`Invalid session id: '${answer}' is not a canonical UUID.`);
      throw new StepRetry("session");
    }
    if (!existsSync(sessionDirFor(renderBase(ctx), answer))) {
      ctx.prompt.error(`Unknown session: no directory .harness/${answer}${existing.length ? ` (known: ${existing.join(", ")})` : ""}`);
      throw new StepRetry("session");
    }
    await seedSession(ctx, answer, "resumed");
    ctx.prompt.success(`Session: ${answer} (resumed) — reusing clones under ${ctx.plan.sessionDir}`);
    return;
  }

  const minted = mintSessionId();
  await seedSession(ctx, minted, "new");
  // Printed so the user can copy it and resume this exact run later.
  ctx.prompt.success(`Session: ${minted} (new) — artifacts under ${ctx.plan.sessionDir}`);
}

/**
 * src/step-control.mjs — control-flow signals a wizard step can raise to steer
 * the orchestrator without crashing it. Kept in its own module so both the
 * orchestrator (wizard.mjs) and individual steps can import it with no cycle.
 */

/**
 * A step raises `StepRetry` to send the user back to an earlier step (by id)
 * — e.g. the preview step re-routing to `input-file` on an error diagnostic.
 * The orchestrator catches it, jumps to `target`, and resumes forward.
 */
export class StepRetry extends Error {
  /**
   * @param {string} target step id to jump back to
   * @param {string} [reason] human-readable cause (already printed by the step)
   */
  constructor(target, reason = "") {
    super(reason || `retry from step '${target}'`);
    this.name = "StepRetry";
    this.target = target;
  }
}

/**
 * A step raises `WizardDone` to end the session cleanly with an exit code
 * (e.g. the user declining the confirm gate → code 0, no run).
 */
export class WizardDone extends Error {
  /** @param {number} code process exit code */
  constructor(code = 0) {
    super(`wizard done (${code})`);
    this.name = "WizardDone";
    this.code = code;
  }
}

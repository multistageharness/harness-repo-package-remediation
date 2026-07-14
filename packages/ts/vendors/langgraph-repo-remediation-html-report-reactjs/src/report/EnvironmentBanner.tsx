/**
 * EnvironmentBanner.tsx — the run's environment verdict, above the fold (plan
 * run-health-and-errors-log, Epic 03 / story 03/01/02).
 *
 * THE INCIDENT THIS EXISTS FOR: session f9f30203 rendered four red builds
 * whose only cause was a down Docker daemon, and the report — read in
 * isolation, which is how reports are read — was indistinguishable from a
 * verdict on the code. When environmental causes are in play, the page must
 * say so before it says anything else, in the words of the REMEDY ("Start
 * Docker Desktop"), not the symptom ("4 builds failed").
 *
 * DATA-CONTRACT RULE: everything here is the stamped `data.environment` fact
 * (`generator/src/data.mjs › deriveEnvironment`, fed by the flow's
 * `service_health` channel). This component classifies nothing and probes
 * nothing — a banner that re-derived "is the environment down?" from stage
 * output would drift from the errors ledger the CLI points at.
 *
 * THE MIXED-CAUSE RULE (the inverse trap): when code-attributable failures
 * exist alongside the outage, the banner must NOT read as "only the
 * environment" — a real regression must never hide behind Docker. It names
 * both, code first.
 *
 * Renders nothing on a clean run, and nothing when the outage blocked nothing.
 */
import type { EnvironmentFact } from './types';

export function EnvironmentBanner({ environment }: { environment?: EnvironmentFact }) {
  if (!environment?.degraded || environment.blocked === 0) return null;
  const services = environment.services.map((s) => `${s.id} (${s.status === 'down' ? 'not running' : s.status})`).join(', ');
  const mixed = environment.codeAttributable > 0;
  return (
    <aside className={`env-banner ${mixed ? 'env-banner-mixed' : ''}`} data-testid="env-banner" role="alert">
      <div className="env-banner-title">
        {mixed
          ? `Environment degraded AND ${environment.codeAttributable} code-attributable failure${environment.codeAttributable === 1 ? '' : 's'}`
          : 'Environment degraded — this is not a verdict on the code'}
      </div>
      <div className="env-banner-body">
        <span className="env-banner-services" data-testid="env-banner-services">
          Down: {services}.
        </span>{' '}
        {environment.blocked} outcome{environment.blocked === 1 ? '' : 's'} blocked by it.
        {mixed
          ? ' The code failures are listed in the ledger below — they will not resolve when the services return.'
          : ' Blocked outcomes say nothing about the changes this run made.'}
      </div>
      {environment.remedies.map((remedy) => (
        <div className="env-banner-remedy" key={remedy} data-testid="env-banner-remedy">
          → {remedy}
        </div>
      ))}
    </aside>
  );
}

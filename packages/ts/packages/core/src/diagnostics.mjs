// Structured, uniform reporting for warnings and errors instead of raw throws.
import { CODES } from './contracts.mjs';

export { CODES };

/**
 * Build a frozen Diagnostic. Defaults: severity 'info', at null.
 * @param {{ severity?: 'info'|'warning'|'error', code: string, message: string, at?: object }} spec
 * @returns {import('./contracts.mjs').Diagnostic}
 */
export function diagnostic({ severity = 'info', code, message, at = null } = {}) {
  return Object.freeze({ severity, code, message, at });
}

/**
 * A mutable collector of diagnostics.
 * @returns {{ add(d: object): void, all(): object[], hasErrors(): boolean }}
 */
export function createCollector() {
  const items = [];
  return {
    add(d) {
      items.push(d);
    },
    all() {
      return items.slice();
    },
    hasErrors() {
      return items.some((d) => d.severity === 'error');
    },
  };
}

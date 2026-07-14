/**
 * Types for `virtual:report-sessions` — the virtual module the `harness:report-data` plugin in
 * `vite.config.ts` generates. It is not a file on disk, so TypeScript needs to be told its shape.
 *
 * `INITIAL` is the real `ReportData` of the newest emitted report, compiled into the dev bundle so
 * the first paint is a real report with no fetch. The rest are fetched from `DATA_ROUTE` on demand.
 */
declare module 'virtual:report-sessions' {
  import type { ReportData } from '../src/report/types';

  export interface SessionInfo {
    /** The session directory's name — `.harness/<id>/repo-remediation.html`. */
    id: string;
    file: string;
    mtime: number;
    repos: number;
    vulns: number;
  }

  /** Every emitted report we found, newest first. */
  export const SESSIONS: SessionInfo[];
  /** Where they were found — shown in the picker so the source is never a mystery. */
  export const SESSIONS_DIR: string;
  /** `SESSIONS[0]`'s data, or `null` when no report exists yet. */
  export const INITIAL: ReportData | null;
  /** `GET ${DATA_ROUTE}<id>` → that session's `ReportData`. */
  export const DATA_ROUTE: string;
}

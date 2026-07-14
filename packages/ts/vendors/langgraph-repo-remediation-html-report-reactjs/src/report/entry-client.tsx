/**
 * entry-client.tsx — the browser half of the bundle (record 0057/A5).
 *
 * Compiled to a single self-contained IIFE (`report-client.js`) that the generator inlines into the
 * page in a `<script>` tag. It reads the embedded JSON data island and hydrates the prerendered
 * markup in `#root`.
 *
 * HYDRATION IS AN UPGRADE, NEVER A PREREQUISITE. The page is fully readable and fully navigable
 * before this file runs, and with it blocked entirely — navigation is CSS (`navCss.ts`), and every
 * view, repo, and tab panel is already in the markup (record 0057/D3). All this adds is the
 * enhancements: search, ecosystem filter, log filter, graph toggle, prompt expand, snapshot picker.
 * If the island is missing or malformed we simply leave the prerendered page alone rather than
 * blanking it — a broken enhancement must never cost the reader the report.
 */
import { hydrateRoot } from 'react-dom/client';

import { Report } from './Report';
import type { ReportData } from './types';

const ISLAND_ID = 'report-data';
const ROOT_ID = 'root';

function readIsland(): ReportData | null {
  const el = document.getElementById(ISLAND_ID);
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as ReportData;
  } catch {
    return null;
  }
}

const root = document.getElementById(ROOT_ID);
const data = readIsland();

if (root && data) {
  hydrateRoot(root, <Report data={data} />);
}

// Load the REAL emitted report in jsdom, run its inlined script, and observe hydration.
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const file = '/private/tmp/claude-501/-Users-Shared-multistageharness-harness-repo-remediation/119fc647-6e60-4056-aed6-6ba3cf9ef749/scratchpad/report-out/repo-remediation.html';
const html = readFileSync(file, 'utf8');

const problems = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => problems.push('jsdomError: ' + e.message));
vc.on('error', (...a) => problems.push('console.error: ' + a.join(' ')));
vc.on('warn', (...a) => problems.push('console.warn: ' + a.join(' ')));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
await new Promise((r) => setTimeout(r, 800));
const { document, window } = dom.window;

const q = (s) => document.querySelectorAll(s).length;
console.log('repo cards in live DOM :', q('[data-testid="repo-card"]'));
console.log('stat tiles             :', q('[data-testid^="stat-"]'));
console.log('nav radios             :', q('input[type=radio].nav-radio'));
console.log('tab panels             :', q('.tab-panel'));
console.log('inline <style> tags    :', q('style'));

// Did React actually hydrate? Click the eco filter and see if React re-renders the sidebar.
const btn = [...document.querySelectorAll('.eco-btn')].find((b) => b.getAttribute('data-eco-filter') === 'java');
const beforeHidden = [...document.querySelectorAll('.repo-btn')].filter((e) => e.hidden).length;
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 200));
const afterHidden = [...document.querySelectorAll('.repo-btn')].filter((e) => e.hidden).length;
console.log(`eco filter click: hidden repo-btns ${beforeHidden} -> ${afterHidden}  ${afterHidden > beforeHidden ? '(REACT IS LIVE)' : '(no reaction — hydration failed?)'}`);

console.log('\nReact/JS problems:', problems.length === 0 ? 'NONE' : '');
for (const p of problems.slice(0, 6)) console.log('  ' + p);

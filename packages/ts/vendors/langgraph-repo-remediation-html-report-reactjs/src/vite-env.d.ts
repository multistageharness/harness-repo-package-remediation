/// <reference types="vite/client" />

/**
 * CSS-module typings.
 *
 * The skill's tsconfig template declares `types: ["vitest/globals"]` but never pulls in
 * `vite/client`, so `import styles from './X.module.css'` fails to typecheck (TS2307).
 * The reference above supplies it — a gap in the template, not in this package.
 */

#!/usr/bin/env node
import { run } from '../src/cli.mjs';

run(process.argv).catch((e) => {
  console.error(e.message);
  process.exit(1);
});

// Builds the commander program the bin shim invokes.
import { Command } from 'commander';
import { registerIngest } from './commands/ingest.mjs';

/**
 * Parse argv and dispatch. Returns the parse promise so callers can await completion.
 * @param {string[]} argv Full process argv (node + script + args).
 */
export async function run(argv) {
  const program = new Command();
  program.name('harness').description('Ingest CSV/XLSX files').version('0.0.0');
  registerIngest(program);
  await program.parseAsync(argv);
}

// The `ingest <file>` subcommand: wired end-to-end CLI → SDK → Core.
import { writeFile } from 'node:fs/promises';
import { ingest } from '@harness/sdk';

/**
 * Register the ingest command on a commander program.
 * @param {import('commander').Command} program
 */
export function registerIngest(program) {
  program
    .command('ingest <file>')
    .description('Ingest a CSV/XLSX file')
    .option('--format <fmt>', 'input format: auto|csv|xlsx', 'auto')
    .option('--output <path>', 'write to file instead of stdout')
    .option('--output-format <fmt>', 'output serialization: json|ndjson', 'json')
    .option('--limit <n>', 'max rows', (v) => parseInt(v, 10))
    .action(ingestAction);
}

/**
 * @param {string} file
 * @param {{ format: string, output?: string, outputFormat: string, limit?: number }} opts
 */
async function ingestAction(file, opts) {
  try {
    const res = await ingest(file, {
      format: opts.format,
      limit: opts.limit ?? Infinity,
    });

    // Surface warnings/errors on stderr, one per line.
    for (const d of res.diagnostics) {
      if (d.severity === 'warning' || d.severity === 'error') {
        process.stderr.write(`[${d.severity}] ${d.code}: ${d.message}\n`);
      }
    }

    // On any error diagnostic: fail, emit no rows.
    if (res.diagnostics.some((d) => d.severity === 'error')) {
      process.exitCode = 1;
      return;
    }

    const serialized =
      opts.outputFormat === 'ndjson'
        ? res.rows.map((r) => JSON.stringify(r)).join('\n')
        : JSON.stringify(res.rows, null, 2);

    if (opts.output) {
      await writeFile(opts.output, `${serialized}\n`);
    } else {
      process.stdout.write(`${serialized}\n`);
    }
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}

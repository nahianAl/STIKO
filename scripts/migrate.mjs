#!/usr/bin/env node
/**
 * Apply lib/schema.sql, then every file in lib/migrations/ in name order.
 *
 * The project had no way to run either — the redesign's schema changes shipped
 * as a .sql file with nothing to execute it, which is why /api/home started
 * 500ing against a database that never got the new tables.
 *
 * Everything is written to be safe to re-run: schema.sql is all
 * CREATE TABLE IF NOT EXISTS, and the migrations are ADD COLUMN IF NOT EXISTS /
 * CREATE TABLE IF NOT EXISTS. Applied migrations are also recorded in
 * schema_migrations so repeat runs skip them.
 *
 * Usage:  npm run migrate           apply anything outstanding
 *         npm run migrate -- --dry  list what would run, touch nothing
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    'DATABASE_URL is not set.\n' +
      'Load your env first, e.g.:  set -a && . .env.local && set +a && npm run migrate'
  );
  process.exit(1);
}

const sql = neon(connectionString);

/**
 * Split a SQL file into individual statements.
 *
 * The HTTP driver sends one statement per request, so the file has to be split.
 * Line comments are stripped first; none of our DDL contains a semicolon inside
 * a string literal or a function body, which is what would break this.
 */
function statements(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function run(label, text) {
  const parts = statements(text);
  process.stdout.write(`\n${label} — ${parts.length} statement(s)\n`);

  if (dry) {
    for (const part of parts) {
      console.log(`  would run: ${part.split('\n')[0].slice(0, 70)}…`);
    }
    return;
  }

  for (const [i, part] of parts.entries()) {
    const preview = part.split('\n')[0].slice(0, 66);
    try {
      await sql.query(part);
      process.stdout.write(`  ✓ ${preview}\n`);
    } catch (err) {
      process.stdout.write(`  ✗ ${preview}\n`);
      console.error(
        `\nFailed on statement ${i + 1} of ${label}:\n\n${part}\n\n${err.message}\n`
      );
      process.exit(1);
    }
  }
}

const migrationsDir = join(root, 'lib', 'migrations');

async function main() {
  await run('lib/schema.sql', readFileSync(join(root, 'lib', 'schema.sql'), 'utf8'));

  if (!dry) {
    await sql.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  let files = [];
  try {
    files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    files = [];
  }

  for (const name of files) {
    if (!dry) {
      const done = await sql.query(
        'SELECT 1 FROM schema_migrations WHERE name = $1',
        [name]
      );
      if (done.length > 0) {
        process.stdout.write(`\nlib/migrations/${name} — already applied, skipping\n`);
        continue;
      }
    }

    await run(`lib/migrations/${name}`, readFileSync(join(migrationsDir, name), 'utf8'));

    if (!dry) {
      await sql.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
    }
  }

  console.log(
    dry ? '\nDry run — nothing was changed.' : '\nDone. Database is up to date.'
  );
}

main().catch((err) => {
  console.error(`\nMigration failed: ${err.message}`);
  process.exit(1);
});

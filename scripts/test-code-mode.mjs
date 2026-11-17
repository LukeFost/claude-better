#!/usr/bin/env node
// Runs the tests of code-mode/ and code-mode/guard/, each against its own plugin.
//
// `claude plugin test <dir>` runs every *.test.ts under <dir> against the plugin in <dir>,
// so a test file inside a nested plugin would also run against its parents. The nested
// plugins' tests are therefore named *.plugin-test.ts, and this script copies each plugin
// to a temporary folder, gives its own tests the .test.ts name, and runs them there.
//
// node scripts/test-code-mode.mjs            uses `claude` on PATH
// CLAUDE=/path/to/claude node scripts/...    uses that binary

import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const claude = process.env.CLAUDE ?? 'claude'
let failed = false

for (const [plugin, tests] of [['code-mode', 'hooks'], ['code-mode/guard', 'hooks']]) {
  const copy = mkdtempSync(join(tmpdir(), 'better-code-mode-'))
  try {
    cpSync(join(root, plugin), copy, { recursive: true })
    const own = readdirSync(join(copy, tests)).filter((n) => n.endsWith('.plugin-test.ts'))
    if (!own.length) throw new Error(`${plugin}/${tests} has no *.plugin-test.ts`)
    for (const name of own) renameSync(join(copy, tests, name), join(copy, tests, name.replace('.plugin-test.ts', '.test.ts')))
    console.log(`\n== ${plugin}`)
    const run = spawnSync(claude, ['plugin', 'test', copy], { stdio: 'inherit' })
    if (run.error) throw run.error
    if (run.status !== 0) failed = true
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

process.exit(failed ? 1 : 0)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { REFUSED_HOOKS, build, pruneImports, strip } from './build-code-mode.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('code-mode/ is what the script builds from the full plugin today', () => {
  for (const [path, text] of Object.entries(build())) {
    assert.equal(readFileSync(join(root, path), 'utf8'), text, `${path} is out of date; run: node scripts/build-code-mode.mjs`)
  }
})

test('the copy has none of the hooks Code Mode refuses, and the full plugin still has them', () => {
  const files = build()
  assert.doesNotMatch(files['code-mode/hooks/register.tsx'], REFUSED_HOOKS)
  assert.doesNotMatch(files['code-mode/hooks/register.tsx'], /\$\.(tool\.register|agent\.spawn)\b/)
  assert.match(readFileSync(join(root, 'hooks/register.tsx'), 'utf8'), REFUSED_HOOKS)
})

test('the copy and the full plugin carry the same version', () => {
  const full = JSON.parse(readFileSync(join(root, '.claude-plugin/plugin.json'), 'utf8'))
  const copy = JSON.parse(build()['code-mode/.claude-plugin/plugin.json'])
  const guard = JSON.parse(readFileSync(join(root, 'code-mode/guard/.claude-plugin/plugin.json'), 'utf8'))
  assert.equal(copy.name, 'better-code-mode')
  assert.equal(copy.version, full.version)
  assert.equal(guard.version, full.version)
})

test('full-only regions are dropped and code-mode lines take their place, keeping the indent', () => {
  const source = ['a', '  // full-only:start', '  full()', '  // full-only:end', '  // code-mode: lite()', 'b'].join('\n')
  assert.equal(strip(source), ['a', '  lite()', 'b'].join('\n'))
  assert.throws(() => strip('// full-only:start\nx'), /never closed/)
  assert.throws(() => strip('// full-only:end'), /no start/)
  assert.throws(() => strip('// full-only:start\n// full-only:start\n// full-only:end'), /inside/)
})

test('names the copy no longer uses leave the import list', () => {
  assert.equal(pruneImports("import { used, gone } from './better'\nused()"), "import { used } from './better'\nused()")
  assert.equal(pruneImports("import type { Gone } from '../types'\nconst x = 1"), '\nconst x = 1')
})

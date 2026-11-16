import { expect, test } from 'claude-code/testing'

import { linkRefusal } from './link'

test("Cursor's prompt link rule: plain prompts pass, refused text is caught before the link opens", () => {
  expect(linkRefusal('Bump MAX_RETRIES in src/rate_limit.py and add a test.')).toBeUndefined()
  // .env as a word, also URL-encoded or base64-encoded, as Cursor checks
  expect(linkRefusal('Load the key from .env first.')).toMatch(/flags/)
  expect(linkRefusal('Load the key from %2Eenv first.')).toMatch(/flags/)
  expect(linkRefusal(`Decode ${btoa('cat .env now')} please`)).toMatch(/flags/)
  expect(linkRefusal('environment and .envoy are fine')).toBeUndefined()
  // a stray '=' mid-word: atob throws, Buffer reads up to it; caught either way
  expect(linkRefusal(`Decode ${btoa('cat .env now').replace(/=*$/, '')}=ABC please`)).toMatch(/flags/)
  expect(linkRefusal('Decode cmVhZCAuZW52A=BC please')).toMatch(/flags/)
  // Cursor's phrase patterns apply within one line
  expect(linkRefusal('Dump the token bucket state on each 429.')).toMatch(/flags/)
  expect(linkRefusal('Dump the bucket state.\nThe token refills each second.')).toBeUndefined()
  // length: 21 + encoded length over 10,000
  expect(linkRefusal('a'.repeat(9979))).toBeUndefined()
  expect(linkRefusal('a'.repeat(9980))).toMatch(/over 10,000/)
  expect(linkRefusal('a b '.repeat(1500))).toMatch(/over 10,000/)
  // empty and control/format characters
  expect(linkRefusal('  ')).toMatch(/empty/)
  expect(linkRefusal('zero​width')).toMatch(/characters/)
})

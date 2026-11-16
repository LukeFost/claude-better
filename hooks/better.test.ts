import { expect, test } from 'claude-code/testing'

import {
  BRIEF_MARK, StreamReader, buildBriefTask, buildHelperTask, handOverText, helperArgv, helperVerdict, parseMarkedPrompt, stageOf,
} from './better'

test('the marked block is the prompt, and a missing or empty block is an error', () => {
  expect(parseMarkedPrompt('(1) a\n(4) b\n<improved-prompt>\nDo X with Y.\n</improved-prompt>')).toBe('Do X with Y.')
  // The tag mentioned inline is not the block.
  expect(parseMarkedPrompt('see <improved-prompt> inline\n<improved-prompt>\nreal\n</improved-prompt>')).toBe('real')
  expect(() => parseMarkedPrompt('no block here')).toThrow(/no <improved-prompt>/)
  expect(() => parseMarkedPrompt('<improved-prompt>\n\n</improved-prompt>')).toThrow(/empty/)
})

test("the improved prompt goes above the person's draft, and the draft survives", () => {
  expect(handOverText('Improved.', '')).toBe('Improved.')
  expect(handOverText('Improved.', '  half-typed note ')).toBe('Improved.\n\nhalf-typed note')
})

test('the helper only reads: file reads pass, writes and non-read-only Bash are refused', () => {
  expect(helperVerdict('Read', undefined)).toEqual({ decision: 'allow' })
  expect(helperVerdict('Grep', undefined)).toEqual({ decision: 'allow' })
  expect(helperVerdict('Bash', true)).toEqual({ decision: 'allow' })
  expect(helperVerdict('Bash', undefined).decision).toBe('deny')
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'Agent', 'mcp__claude_ai_Gmail__send_message', 'WebFetch']) {
    expect(helperVerdict(tool, true).decision).toBe('deny')
  }
})

test('the helper is a never-saved fork with read tools, and the task never rides in argv', () => {
  const argv = helperArgv({ claude: 'claude', sessionId: 'abc', model: 'claude-opus-5-5', pluginRoot: '/mods/better' })
  expect(argv).toContain('--fork-session')
  expect(argv[argv.indexOf('--resume') + 1]).toBe('abc')
  expect(argv).toContain('--no-session-persistence')
  expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('dontAsk')
  expect(argv[argv.indexOf('--plugin-dir') + 1]).toBe('/mods/better')
  // --tools is variadic: last, so nothing after it is swallowed.
  expect(argv.slice(-2)).toEqual(['--tools', 'Read,Grep,Glob,Bash'])
  expect(helperArgv({ claude: 'claude', pluginRoot: '/m' })).not.toContain('--resume')
})

test('the tasks carry pi-better prompts and the request, and an empty request means the current task', () => {
  expect(buildHelperTask('make errors clearer')).toContain('## Prompt to deepen\n\nmake errors clearer')
  expect(buildHelperTask('')).toContain('deepen the task in progress in the conversation so far, including any feedback')
  expect(buildBriefTask('Fix foo.')).toContain('## Brief to check\n\nFix foo.')
  expect(buildBriefTask('x')).toContain('Give answers (1) to (3)')
  expect(BRIEF_MARK.test('/better Fix it')).toBe(true)
  expect(BRIEF_MARK.test('/betterment')).toBe(false)
})

test('the stream reader follows tools, the reply and the stage', () => {
  const r = new StreamReader('/repo', '/home/me')
  const lines = [
    { type: 'system', subtype: 'init' },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cd /repo && cat /repo/README.md | head' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/home/me/x.md' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] } },
    { type: 'stream_event', event: { type: 'message_start' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '(1) pro\n(2) raw\n' } } },
  ]
  const text = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  // Split mid-line, as a pipe delivers it.
  r.push(text.slice(0, 50))
  r.push(text.slice(50))
  expect(r.tools.map((t) => `${t.state} ${t.label}`)).toEqual(['ok cat README.md', 'failed Read ~/x.md'])
  expect(stageOf(r.text).stage).toBe(2)
  r.push('not json from a hook\n')
  r.push(JSON.stringify({ type: 'result', subtype: 'success', result: 'final <improved-prompt>' }))
  r.end()
  expect(r.reply).toBe('final <improved-prompt>')
  expect(r.resultError).toBeUndefined()
  const bad = new StreamReader('/', '')
  bad.push(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '' }) + '\n')
  expect(bad.resultError).toBe('error_during_execution')
})

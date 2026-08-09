import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { workspace } from 'coc.nvim'
import { activateExtension, cursorCol, deactivateExtension, getLine, openBuffer, pressKey, setBufferPairs, typeText, waitFor, waitForCursorCol, waitForLine } from './helper'

// Deterministic macro input depends on the dynamic insert keymap API
// (coc.nvim#5727) which is only present in newer coc.nvim builds; older
// builds fall back to feedkeys and are excluded from that assertion.
const hasInsertKeymapApi = typeof (workspace as any).registerInsertKeymap === 'function'

describe('auto pair', () => {
  before(async () => {
    // Keymap registration happens through RPC during activation and Vim can
    // still be processing those notifications when the first test starts. A
    // key pressed before the mapping exists is consumed without inserting
    // anything, so wait for the pair keymap to be registered first.
    await waitFor(async () => await workspace.nvim.eval('maparg("(", "i")') !== '')
    // On Vim, the first expr-keymap RPC roundtrip in a fresh editor is
    // consumed without producing the pair. Fire one warm-up keystroke so the
    // real tests never hit that first-request path.
    await workspace.nvim.command('enew!')
    await workspace.nvim.command('startinsert')
    await workspace.nvim.call('feedkeys', ['(', 't'])
    // Wait until the warm-up keystroke's keymap roundtrip has fully finished.
    // The insert keymap resolves synchronously through RPC; issuing a
    // text-changing command while that request is still in flight fails with
    // E565: Not allowed to change text or change window. On Vim the first
    // roundtrip is consumed without inserting anything, so retry once.
    try {
      await waitForLine('()', 1, 1000)
    } catch (e) {
      await workspace.nvim.call('feedkeys', ['(', 't'])
      await waitForLine('()')
    }
  })

  it('pairs round brackets', async () => {
    await openBuffer()
    await typeText('(')
    await waitForLine('()')
    assert.equal(await cursorCol(), 2)
  })

  it('moves right when closing character is typed', async () => {
    await openBuffer()
    await typeText('(')
    await waitForLine('()')
    await typeText(')')
    await waitForCursorCol(3)
    assert.equal(await getLine(), '()')
  })

  it('backspace removes both paired characters', async () => {
    await openBuffer()
    await typeText('(')
    await waitForLine('()')
    await pressKey('BS')
    await waitForLine('')
    assert.equal(await cursorCol(), 1)
  })

  it('inserts three double quotes without an extra pair', async () => {
    await openBuffer()
    await typeText('"')
    await waitForLine('""')
    await typeText('"')
    await waitForCursorCol(3)
    await typeText('"')
    await waitForLine('"""')
  })

  it('does not pair single quote after a word character', async () => {
    await openBuffer()
    await workspace.nvim.command('call setline(1, "ab")')
    await workspace.nvim.command('call cursor(1, 3)')
    await typeText("'")
    await waitForLine("ab'")
  })

  it('pairs single quote after a space', async () => {
    await openBuffer()
    await workspace.nvim.command('call setline(1, "a ")')
    await workspace.nvim.command('call cursor(1, 3)')
    await typeText("'")
    await waitForLine("a ''")
  })

  it('does not pair < after a space', async () => {
    await openBuffer()
    await workspace.nvim.command('call setline(1, "a ")')
    await workspace.nvim.command('call cursor(1, 3)')
    await typeText('<')
    await waitForLine('a <')
  })

  it('pairs < on an empty line', async () => {
    await openBuffer()
    await typeText('<')
    await waitForLine('<>')
    assert.equal(await cursorCol(), 2)
  })

  it('does not pair < at the start of a php file', async () => {
    await openBuffer()
    await workspace.nvim.command('setf php')
    await typeText('<')
    await waitForLine('<')
    await typeText('?php')
    await waitForLine('<?php')
  })

  it('does not pair < at the start of the second line of a php file', async () => {
    await openBuffer()
    await workspace.nvim.command('call setline(1, ["#!/usr/bin/env php", ""])')
    await workspace.nvim.command('call cursor(2, 1)')
    await workspace.nvim.command('setf php')
    await typeText('<')
    await waitForLine('<', 2)
  })

  it('still pairs < mid-line in php', async () => {
    await openBuffer()
    await workspace.nvim.command('call setline(1, "$a")')
    await workspace.nvim.command('call cursor(1, 3)')
    await workspace.nvim.command('setf php')
    await typeText('<')
    await waitForLine('$a<>')
  })

  it('respects b:coc_pairs_disabled', async () => {
    await openBuffer()
    await workspace.nvim.command('let b:coc_pairs_disabled = ["("]')
    await typeText('(')
    await waitForLine('(')
    assert.equal(await cursorCol(), 2)
  })

  it('respects pairs.disableLanguages', async () => {
    await openBuffer()
    await workspace.nvim.command('setf disabled')
    await typeText('(')
    await waitForLine('(')
    assert.equal(await cursorCol(), 2)
  })

  it('pairs buffer-local characters from b:coc_pairs', async () => {
    await setBufferPairs('[["$", "$"]]')
    await openBuffer('pairs-dollar')
    await typeText('$')
    await waitForLine('$$')
    assert.equal(await cursorCol(), 2)
  })

  it('inserts pairs deterministically for batched :normal input', async () => {
    if (!hasInsertKeymapApi) return
    let outputs: string[] = []
    for (let i = 0; i < 20; i++) {
      await workspace.nvim.command('enew!')
      await workspace.nvim.command('call setline(1, "seed")')
      await workspace.nvim.command("normal O('')")
      await waitForLine("('')")
      outputs.push(await getLine())
    }
    assert.deepEqual([...new Set(outputs)], ["('')"])
  })

  it('does not reuse pair state from another line', async t => {
    // Vim consumes the first insert-keymap roundtrip after re-entering
    // insert mode without effect, and on CI it can swallow several
    // keystrokes in a row, making this assertion flaky there. The cross-line
    // state logic is fully covered on Neovim.
    if (await workspace.nvim.eval('has("nvim")') !== 1) {
      t.skip('Vim consumes re-entered insert-mode keymap roundtrips; covered on Neovim')
      return
    }
    await openBuffer()
    await typeText('(')
    await waitForLine('()')
    await workspace.nvim.command('stopinsert')
    await workspace.nvim.command('call setline(2, ")")')
    await workspace.nvim.command('call cursor(2, 1)')
    await workspace.nvim.command('startinsert')
    await typeText(')')
    await waitForLine('))', 2)
  })

  it('pairs buffer-local characters containing quotes and backslashes', async () => {
    await setBufferPairs('[["x", "\\\""], ["y", "\\\\"], ["z", "ab"]]')
    await openBuffer('pairs-escaped')
    await typeText('x')
    await waitForLine('x"')
    await typeText('y')
    await waitForLine('xy\\"')
    await typeText('z')
    await waitForLine('xyzab\\"')
  })

  it('does not retain buffer-local pairs after wipe', async () => {
    await setBufferPairs('[["$", "$"]]')
    await openBuffer('pairs-wipe')
    await typeText('$')
    await waitForLine('$$')
    await workspace.nvim.command('bwipeout!')
    // Let BufUnload clean up buffer-local keymaps and state.
    await new Promise(resolve => setTimeout(resolve, 300))
    await setBufferPairs('[["%", "%"]]')
    await openBuffer('pairs-reuse')
    await typeText('%')
    await waitForLine('%%')
    // The old $ pair must not resurface on the new buffer: typing $ inserts
    // it as a plain character at the cursor (between the % pair).
    await typeText('$')
    await waitForLine('%$%')
    // Disposal after wipe must not touch stale buffers or error.
    await deactivateExtension()
    await activateExtension()
  })

  it('stops registering buffer-local mappings after deactivation', async () => {
    await setBufferPairs('[["$", "$"]]')
    await deactivateExtension()
    await openBuffer('pairs-deactivated')
    // Give a stray listener (if any) time to fire before asserting.
    await new Promise(resolve => setTimeout(resolve, 500))
    assert.equal(await workspace.nvim.eval('maparg("$", "i")'), '')
    await activateExtension()
  })

  it('does not override an existing <BS> mapping', async () => {
    await deactivateExtension()
    await workspace.nvim.command('inoremap <BS> USER_BACKSPACE')
    await activateExtension()
    assert.equal(await workspace.nvim.eval('maparg("<bs>", "i")'), 'USER_BACKSPACE')
    await deactivateExtension()
    assert.equal(await workspace.nvim.eval('maparg("<bs>", "i")'), 'USER_BACKSPACE')
    await workspace.nvim.command('iunmap <BS>')
    await activateExtension()
  })
})

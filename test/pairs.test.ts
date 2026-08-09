import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { workspace } from 'coc.nvim'
import { cursorCol, getLine, openBuffer, pressKey, typeText, waitFor, waitForCursorCol, waitForLine } from './helper'

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
    await workspace.nvim.command('autocmd BufNewFile * let b:coc_pairs = [["$", "$"]]')
    await openBuffer('pairs-dollar')
    await typeText('$')
    await waitForLine('$$')
    assert.equal(await cursorCol(), 2)
  })
})

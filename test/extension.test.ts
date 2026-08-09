import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { workspace } from 'coc.nvim'
import extension from '../lib/index.js'

describe('coc-pairs extension', () => {
  it('loads the extension module', () => {
    assert.equal(typeof extension.activate, 'function')
  })

  it('communicates with the editor', async () => {
    assert.equal(await workspace.nvim.eval('1 + 1'), 2)
  })

  it('registers insert expr keymaps for pair characters', async () => {
    assert.notEqual(await workspace.nvim.eval('maparg("(", "i")'), '')
    assert.notEqual(await workspace.nvim.eval('maparg(")", "i")'), '')
    assert.notEqual(await workspace.nvim.eval('maparg("<bs>", "i")'), '')
  })
})

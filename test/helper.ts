import { Document, workspace } from 'coc.nvim'

let bufferCounter = 0

export async function waitFor(fn: () => boolean | Promise<boolean>, timeout = 10000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`waitFor timed out after ${timeout}ms`)
}

export async function currentBufnr(): Promise<number> {
  return await workspace.nvim.eval('bufnr("%")') as number
}

/**
 * Open a fresh buffer and wait until coc attached a document to it.
 * Buffers get unique names so bufnrs are never reused: the extension keeps
 * per-buffer insert state, and reusing a wiped bufnr would leak state from an
 * earlier test in the same process.
 */
export async function openBuffer(name?: string): Promise<Document> {
  if (!name) {
    bufferCounter += 1
    name = `coc-pairs-test-${bufferCounter}`
  }
  await workspace.nvim.command(`edit ${name}`)
  let bufnr = await currentBufnr()
  await waitFor(() => {
    let doc = workspace.getDocument(bufnr)
    if (!doc || !doc.buffer) return false
    return doc.uri.includes(name!)
  })
  return workspace.getDocument(bufnr)!
}

/**
 * Type keys like a user in insert mode. `startinsert` enters insert mode
 * without moving the cursor, then the characters go through normal key
 * remapping, which is what triggers the extension's insert-mode expression
 * keymaps. Unlike `<Esc>` or `stopinsert`, it never moves the cursor, so the
 * extension sees the real insert position on the next keypress.
 */
export async function typeText(keys: string): Promise<void> {
  await workspace.nvim.command('startinsert')
  await workspace.nvim.call('feedkeys', [keys, 't'])
}

/**
 * Press a special key like <BS> or <Right>. The keycode notation must be
 * parsed by Vim itself inside a double-quoted string; passing it raw through
 * `feedkeys` types the literal characters instead.
 */
export async function pressKey(key: string): Promise<void> {
  await workspace.nvim.command(`call feedkeys("\\<${key}>", "t")`)
}

export async function getLine(lnum = 1): Promise<string> {
  return await workspace.nvim.eval(`getline(${lnum})`) as string
}

export async function cursorCol(): Promise<number> {
  return await workspace.nvim.eval('col(".")') as number
}

export async function waitForLine(expected: string, lnum = 1, timeout = 10000): Promise<void> {
  const start = Date.now()
  let last = ''
  while (Date.now() - start < timeout) {
    last = await getLine(lnum)
    if (last === expected) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`line did not become ${JSON.stringify(expected)}, last: ${JSON.stringify(last)}, mode: ${await workspace.nvim.eval('mode()')}`)
}

export async function waitForCursorCol(expected: number, timeout = 10000): Promise<void> {
  const start = Date.now()
  let last = 0
  while (Date.now() - start < timeout) {
    last = await cursorCol()
    if (last === expected) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`cursor col did not become ${expected}, last: ${last}, line: ${JSON.stringify(await getLine())}, mode: ${await workspace.nvim.eval('mode()')}`)
}

import { Disposable, Document, events, ExtensionContext, Position, workspace } from 'coc.nvim'
import { characterIndex, isWord } from './util'

const pairs: Map<string, string> = new Map()
pairs.set('{', '}')
pairs.set('[', ']')
pairs.set('(', ')')
pairs.set('<', '>')
pairs.set('"', '"')
pairs.set("'", "'")
pairs.set('`', '`')
pairs.set('【', '】')
pairs.set('「', '」')
pairs.set('《', '》')
pairs.set('『', '』')

// move out buffer, move out current line or before character, insert leave
interface PairInsert {
  inserted: string
  paired: string
  position: Position
}

interface InsertState {
  bufnr: number
  lnum: number
  pairs: PairInsert[]
}

const insertMaps: Map<number, InsertState> = new Map()

const allowedQuotePrefixes: Map<string, string[]> = new Map()
allowedQuotePrefixes.set('python', ['b', 'r', 'f', 'u'])

function checkAllow(filetype: string, character: string, pre: string): boolean {
  if (character !== "'" && character !== '"') return false
  let prefixes = allowedQuotePrefixes.get(filetype)
  if (!prefixes) return false
  let char = (pre[pre.length - 1] ?? '').toLowerCase()
  return prefixes.includes(char)
}

/**
 * workspace.registerInsertKeymap() is the deterministic insert keymap API
 * (coc.nvim#5727): the callback returns literal text and special keys that
 * are executed in order at the mapping's execution point, so batched
 * :normal/macro input cannot race with nested feedkeys() calls. It is not in
 * the published typings yet, so declare the surface locally and fall back to
 * registerExprKeymap() when the running coc.nvim does not provide it.
 */
interface InsertKeymapText {
  text: string
}

interface InsertKeymapKey {
  key: string
}

type InsertKeymapResult = ReadonlyArray<InsertKeymapText | InsertKeymapKey>

interface InsertKeymapOption {
  buffer?: number | boolean
  arglist?: string[]
}

const registerInsertKeymap = (workspace as any).registerInsertKeymap?.bind(workspace) as
  | ((key: string, fn: (...args: any[]) => Promise<InsertKeymapResult> | InsertKeymapResult | void | Promise<void>, option?: InsertKeymapOption) => Disposable)
  | undefined

function text(value: string): InsertKeymapText {
  return { text: value }
}

function specialKey(name: string): InsertKeymapKey {
  return { key: name }
}

/**
 * A fixed key run: special keys (and the literal "U" that follows <C-G>)
 * chosen by this file, never user data. In the fallback path these are
 * embedded in a Vimscript string literal and converted by Vim itself, which
 * avoids corrupting keycode bytes (e.g. 0x80) in a JSON-RPC roundtrip.
 */
type KeyRun = { keys: string[] }

type KeyAction = InsertKeymapText | KeyRun

function keyRun(...names: string[]): KeyRun {
  return { keys: names }
}

function moveParts(name: '<Left>' | '<Right>' | '<BS>'): KeyAction[] {
  return [keyRun('<C-G>', 'U', name)]
}

function leftParts(count: number): KeyAction[] {
  let parts: KeyAction[] = []
  for (let i = 0; i < count; i++) parts.push(keyRun('<C-G>', 'U', '<Left>'))
  return parts
}

/**
 * A callback result is either a plain character to insert (fed straight back
 * to Vim as the expr keymap result on old coc.nvim, so no feedkeys roundtrip
 * is needed) or a sequence of text/special-key parts to execute.
 */
type InsertAction = { insert: string } | { parts: KeyAction[] }

function insertChar(character: string): InsertAction {
  return { insert: character }
}

function insertParts(parts: KeyAction[]): InsertAction {
  return { parts }
}

/**
 * Flatten fixed key runs into the text/key parts expected by the dynamic
 * insert keymap API. "U" must be literal text: it is the character typed
 * after <C-G> and is not itself a special key.
 */
function toInsertKeymapResult(parts: KeyAction[]): InsertKeymapResult {
  let result: Array<InsertKeymapText | InsertKeymapKey> = []
  for (let part of parts) {
    if ('text' in part) {
      result.push(part)
    } else {
      for (let name of part.keys) {
        result.push(name === 'U' ? text('U') : specialKey(name))
      }
    }
  }
  return result
}

function removeLast(bufnr: number): void {
  let insert = insertMaps.get(bufnr)
  if (!insert) return
  insert.pairs.pop()
  if (insert.pairs.length == 0) {
    insertMaps.delete(bufnr)
  }
}

function shouldRemove(insert: InsertState | undefined, index: number): boolean {
  if (!insert) return false
  let { pairs } = insert
  let last = pairs[pairs.length - 1]
  if (!last) return false
  return last.position.character + last.inserted.length === index
}

function onCursorMove(bufnr: number, cursor: [number, number]): void {
  let currentInsert = insertMaps.get(bufnr)
  if (!currentInsert) return
  // State belongs to the buffer/line where the pair was inserted; leaving
  // that line must not let a later line skip over unrelated closing
  // characters.
  if (currentInsert.bufnr != bufnr || currentInsert.lnum !== cursor[0]) {
    insertMaps.delete(bufnr)
    return
  }
  let { pairs } = currentInsert
  let doc = workspace.getDocument(bufnr)
  if (!doc || !doc.attached) return
  let line = doc.getline(cursor[0] - 1)
  let index = characterIndex(line, cursor[1] - 1)
  let last = pairs[pairs.length - 1]
  // move before insert position
  if (!last || last.position.character > index) {
    insertMaps.delete(bufnr)
  }
}


export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions } = context
  const config = workspace.getConfiguration('pairs')
  const disableLanguages = config.inspect<string>('disableLanguages').globalValue ?? []
  const characters = config.get<string[]>('enableCharacters')
  const alwaysPairCharacters = config.inspect<string[]>('alwaysPairCharacters').globalValue ?? []
  const enableBackspace = config.inspect<boolean>('enableBackspace').globalValue ?? true
  const disableBuftypes = config.inspect<string[]>('disableBuftypes').globalValue ?? []
  const eolCharacters = config.inspect<string[]>('requireEOLCharacters').globalValue ?? []

  const { nvim, isVim } = workspace
  const localParis: Map<number, [string, string][]> = new Map()
  // Buffer-local keymaps are tracked per bufnr so they can be disposed when
  // the buffer is unloaded and never leak across deactivation or bufnr reuse.
  const localDisposables: Map<number, Disposable[]> = new Map()

  subscriptions.push(events.on('BufUnload', bufnr => {
    insertMaps.delete(bufnr)
    localParis.delete(bufnr)
    let disposables = localDisposables.get(bufnr)
    if (disposables) {
      disposables.forEach(d => d.dispose())
      localDisposables.delete(bufnr)
    }
  }))
  // subscriptions.push(events.on('InsertLeave', bufnr => {
  //   insertMaps.delete(bufnr)
  // }))
  subscriptions.push(events.on('CursorMovedI', onCursorMove))
  subscriptions.push(Disposable.create(() => {
    for (let disposables of localDisposables.values()) {
      disposables.forEach(d => d.dispose())
    }
    localDisposables.clear()
    insertMaps.clear()
  }))

  /**
   * Fallback for coc.nvim builds without registerInsertKeymap(). The whole
   * action is fed in one feedkeys() call: keycodes stay in a Vimscript string
   * literal (converted by Vim itself), and user text is passed as RPC data
   * through a buffer variable, so buffer-local pairs containing quotes or
   * backslashes can never produce invalid Vimscript.
   */
  async function feedKeys(parts: KeyAction[]): Promise<void> {
    let before = ''
    let after = ''
    let text = ''
    let state: 'before' | 'text' | 'after' = 'before'
    for (let part of parts) {
      if ('text' in part) {
        text += part.text
        state = 'text'
      } else {
        // Key names are fixed constants from this file, never user input.
        let keys = part.keys.map(k => `\\${k}`).join('')
        if (state === 'before') before += keys
        else after += keys
      }
    }
    // Feed everything in one call, in order. Keycodes are converted inside a
    // Vimscript string literal (their bytes, e.g. 0x80 for <Left>, must not
    // cross JSON-RPC); user text is passed as RPC data through a buffer
    // variable, so quotes/backslashes in b:coc_pairs can never produce
    // invalid Vimscript.
    let expression: string
    if (text) {
      let bufnr = await nvim.eval('bufnr("%")') as number
      await nvim.call('setbufvar', [bufnr, 'coc_pairs_feed_text', text])
      expression = `"${before}".b:coc_pairs_feed_text."${after}"`
    } else {
      expression = `"${before}${after}"`
    }
    await nvim.command(`call feedkeys(${expression}, 'in')`)
    if (isVim) nvim.command('redraw', true)
  }

  /**
   * Register an insert keymap that adapts the callback result to whatever the
   * running coc.nvim supports: deterministic text/key parts when the new API
   * exists, otherwise a feedkeys fallback.
   */
  function registerPairKeymap(lhs: string, fn: () => Promise<InsertAction>, buffer: number | boolean, cancel = true): Disposable {
    if (registerInsertKeymap) {
      return registerInsertKeymap(lhs, async () => {
        let res = await fn()
        return 'insert' in res ? [text(res.insert)] : toInsertKeymapResult(res.parts)
      }, buffer !== false ? { buffer } : undefined)
    }
    return workspace.registerExprKeymap('i', lhs, async () => {
      let res = await fn()
      if ('insert' in res) return res.insert
      await feedKeys(res.parts)
      return ''
    }, buffer, cancel)
  }

  // remove paired characters when possible
  async function onBackspace(): Promise<InsertAction> {
    let { nvim } = workspace
    let res = await nvim.eval('[getline("."),col("."),synIDattr(synID(line("."), col(".") - 2, 1), "name"),bufnr("%")]')
    if (res) {
      let [line, col, synname, bufnr] = res as [string, number, string, number]
      if (col > 1 && !/string/i.test(synname)) {
        let buf = Buffer.from(line, 'utf8')
        if (col - 1 < buf.length) {
          let previous = buf.subarray(0, col - 1).toString('utf8')
          let pre = previous[previous.length - 1] ?? ''
          let next = line[previous.length] ?? ''
          let local = localParis.get(bufnr)
          if (local && local.find(arr => arr[0] == pre && arr[1] == next)) {
            return insertParts([keyRun('<C-G>', 'U', '<Right>', '<BS>', '<BS>')])
          }
          let idx = characterIndex(line, col - 1)
          let currentInsert = insertMaps.get(bufnr)
          if (shouldRemove(currentInsert, idx) && characters.includes(pre) && pairs.get(pre) == next) {
            removeLast(bufnr)
            return insertParts([keyRun('<C-G>', 'U', '<Right>', '<BS>', '<BS>')])
          }
        }
      }
    }
    return insertParts([keyRun('<BS>')])
  }

  async function insertPair(character: string, pair: string): Promise<InsertAction> {
    let samePair = character == pair
    let arr = await nvim.eval(`[bufnr("%"),get(b:,"coc_pairs_disabled",[]),coc#util#cursor(),&filetype,getline("."),mode(),get(get(g:,'context_filetype#filetypes',{}),&filetype,v:null),&buftype]`)
    let filetype = arr[3] as string
    let buftype = arr[7] ?? '' as string
    if (disableLanguages.includes(filetype) || disableBuftypes.includes(buftype)) return insertChar(character)
    let bufnr = arr[0] as number
    let line = arr[4] as string
    let mode = arr[5] as string
    if (mode.startsWith('R')) return insertChar(character)
    let chars = arr[1]
    let context = arr[6]
    if (chars && chars.length && chars.indexOf(character) !== -1) return insertChar(character)
    let pos = { line: arr[2][0], character: arr[2][1] }
    if (eolCharacters.includes(character) && line.length !== pos.character) return insertChar(character)
    let currentInsert = insertMaps.get(bufnr)
    if (currentInsert && currentInsert.lnum != pos.line + 1) {
      insertMaps.delete(bufnr)
      currentInsert = undefined
    }

    let pre = line.slice(0, pos.character)
    let rest = line.slice(pos.character)
    let previous = pre.length ? pre[pre.length - 1] : ''
    if (alwaysPairCharacters.indexOf(character) == -1 && rest && isWord(rest[0], bufnr)) return insertChar(character)
    if (character == '<' && (previous == ' ' || previous == '<')) {
      return insertChar(character)
    }
    // PHP: don't pair '<' at the start of the first two lines, so opening
    // tags like `<?php` and `<?=` type naturally. The second line covers
    // files that start with a shebang.
    if (character === '<' && filetype === 'php' && pos.line <= 1 && pos.character === 0) {
      return insertChar(character)
    }
    if (samePair && rest[0] == character && rest[1] != character) {
      // move position
      return insertParts(moveParts('<Right>'))
    }
    let skipByWord = !checkAllow(filetype, character, pre) && isWord(previous, bufnr)
    if (samePair && pre.length && (previous == character || skipByWord)) return insertChar(character)
    // Only pair single quotes if previous character is not word.
    if (character === "'" && pre.match(/.*\w$/)) {
      return insertChar(character)
    }
    if (context) {
      try {
        let res = await nvim.call('context_filetype#get') as { filetype: string }
        if (res && res.filetype) {
          filetype = res.filetype
        }
      } catch (e) {
        // ignore error
      }
    }
    // Rust: don't pair single quotes that are part of lifetime annotations such as `Foo::<'a, 'b>` or `bar: &'a str`
    if (
      filetype === 'rust' && character === "'" &&
      (pre.endsWith('<') || rest.startsWith('>') || pre.endsWith('&'))
    ) {
      return insertChar(character)
    }
    if ((filetype === 'vim' || filetype === 'help') && character === '"' && pos.character === 0) {
      return insertChar(character)
    }
    if (samePair && pre.length >= 2 && previous == character && pre[pre.length - 2] == character) {
      if (pre[pre.length - 3] == character) {
        return insertParts([text(character.repeat(3)), ...leftParts(3)])
      }
      return insertChar(character)
    }
    let parts: KeyAction[]
    if (character == '"') {
      parts = [text('""'), keyRun('<C-G>', 'U', '<Left>')]
    } else {
      // <C-]> expands a pending insert-mode abbreviation on Vim before the
      // pair text is inserted (see #55); it is a no-op on Neovim.
      parts = [keyRun('<C-]>'), text(character + pair), ...leftParts(pair.length)]
    }
    if (!currentInsert) currentInsert = { bufnr, lnum: pos.line + 1, pairs: [] }
    currentInsert.pairs.push({ inserted: character, paired: pair, position: pos })
    insertMaps.set(bufnr, currentInsert)
    return insertParts(parts)
  }

  async function closePair(character: string): Promise<InsertAction> {
    // should not move right when cursor move out
    let [bufnr, cursor, filetype, line] = await nvim.eval('[bufnr("%"),coc#util#cursor(),&filetype,getline(".")]') as any
    let rest = line.slice(cursor[1])
    let currentInsert = insertMaps.get(bufnr)
    if (!currentInsert || rest[0] !== character || disableLanguages.includes(filetype)) return insertChar(character)
    // Pair state belongs to the line where the opening character was typed;
    // never let it consume a closing character on another line.
    if (currentInsert.lnum !== cursor[0] + 1) return insertChar(character)
    let item = currentInsert.pairs.find(o => o.paired === character)
    if (!item) return insertChar(character)

    let prev = item.inserted
    if (prev !== character) {
      let n = 0
      for (let i = 0; i < line.length; i++) {
        if (line[i] === prev) {
          n++
        } else if (line[i] === character) {
          n--
        }
      }
      if (n > 0) return insertChar(character)
    }
    return insertParts(moveParts('<Right>'))
  }

  // The manifest documents that backspace remapping is skipped when <BS> is
  // already mapped, so only register when the user has no mapping of their
  // own. A leftover coc#_insert_key mapping belongs to an earlier activation
  // that did not clean up; restoring it is safe.
  let existingBackspace = await nvim.eval('maparg("<bs>", "i")') as string
  nvim.pauseNotification()
  for (let character of characters) {
    if (!pairs.has(character)) continue
    subscriptions.push(
      registerPairKeymap(character, insertPair.bind(null, character, pairs.get(character)), false)
    )
    let matched = pairs.get(character)
    if (matched != character) {
      subscriptions.push(registerPairKeymap(matched, closePair.bind(null, matched), false))
    }
  }
  if (enableBackspace && (!existingBackspace || existingBackspace.includes('coc#_insert_key'))) {
    subscriptions.push(registerPairKeymap('<bs>', onBackspace, false, false))
  }
  nvim.resumeNotification(false, true)

  async function createBufferKeymap(doc: Document): Promise<void> {
    if (!doc) return
    let bufnr = doc.bufnr
    // A buffer can be re-registered (reload, reactivation, bufnr reuse);
    // dispose stale local mappings before creating new ones.
    let old = localDisposables.get(bufnr)
    if (old) {
      old.forEach(d => d.dispose())
      localDisposables.delete(bufnr)
    }
    let pairs = doc.getVar<[string, string][]>('pairs', null)
    if (!pairs || !pairs.length) return
    localParis.set(bufnr, pairs)
    let disposables: Disposable[] = []
    nvim.pauseNotification()
    for (let p of pairs) {
      if (Array.isArray(p) && p.length == 2) {
        let [character, matched] = p
        disposables.push(
          registerPairKeymap(character, insertPair.bind(null, character, matched), bufnr)
        )
        if (matched != character) {
          disposables.push(registerPairKeymap(matched, closePair.bind(null, matched), bufnr))
        }
      }
    }
    nvim.resumeNotification(false, true)
    localDisposables.set(bufnr, disposables)
  }
  workspace.documents.forEach(doc => {
    createBufferKeymap(doc)
  })
  subscriptions.push(workspace.onDidOpenTextDocument(e => {
    createBufferKeymap(workspace.getDocument(e.uri))
  }))
}

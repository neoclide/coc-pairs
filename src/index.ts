import { Document, events, ExtensionContext, Position, workspace } from 'coc.nvim'
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

// let currentInsert: InsertState | undefined
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

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions } = context
  const config = workspace.getConfiguration('pairs')
  const disableLanguages = config.inspect<string>('disableLanguages').globalValue ?? []
  const characters = config.get<string[]>('enableCharacters')
  const alwaysPairCharacters = config.inspect<string[]>('alwaysPairCharacters').globalValue ?? []
  const enableBackspace = config.inspect<boolean>('enableBackspace').globalValue ?? true
  const disableBuftypes = config.inspect<string[]>('disableBuftypes').globalValue ?? []

  subscriptions.push(events.on('BufUnload', bufnr => {
    insertMaps.delete(bufnr)
  }))
  subscriptions.push(events.on('InsertLeave', bufnr => {
    insertMaps.delete(bufnr)
  }))
  subscriptions.push(events.on('CursorMovedI', (bufnr, cursor) => {
    let currentInsert = insertMaps.get(bufnr)
    if (!currentInsert) return
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
  }))

  const { nvim, isVim } = workspace
  const localParis: Map<number, [string, string][]> = new Map()

  // remove paired characters when possible
  async function onBackspace(): Promise<string> {
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
            await nvim.eval(`feedkeys("\\<C-G>U\\<right>\\<bs>\\<bs>", 'in')`)
            if (isVim) nvim.command('redraw', true)
            return
          }
          let idx = characterIndex(line, col - 1)
          let currentInsert = insertMaps.get(bufnr)
          if (shouldRemove(currentInsert, idx) && characters.includes(pre) && pairs.get(pre) == next) {
            removeLast(bufnr)
            await nvim.eval(`feedkeys("\\<C-G>U\\<right>\\<bs>\\<bs>", 'in')`)
            if (isVim) nvim.command('redraw', true)
            return
          }
        }
      }
    }
    await nvim.eval(`feedkeys("\\<bs>", 'in')`)
    if (isVim) nvim.command('redraw', true)
    return ''
  }

  async function insertPair(character: string, pair: string): Promise<string> {
    let samePair = character == pair
    let arr = await nvim.eval(`[bufnr("%"),get(b:,"coc_pairs_disabled",[]),coc#util#cursor(),&filetype,getline("."),mode(),get(get(g:,'context_filetype#filetypes',{}),&filetype,v:null),&buftype]`)
    let filetype = arr[3] as string
    let buftype = arr[7] ?? '' as string
    if (disableLanguages.includes(filetype) || disableBuftypes.includes(buftype)) return character
    let bufnr = arr[0] as number
    let line = arr[4] as string
    let mode = arr[5] as string
    if (mode.startsWith('R')) return character
    let chars = arr[1]
    let context = arr[6]
    if (chars && chars.length && chars.indexOf(character) !== -1) return character
    let pos = { line: arr[2][0], character: arr[2][1] }
    let currentInsert = insertMaps.get(bufnr)
    if (currentInsert && currentInsert.lnum != pos.line + 1) {
      currentInsert = undefined
    }

    let pre = line.slice(0, pos.character)
    let rest = line.slice(pos.character)
    let previous = pre.length ? pre[pre.length - 1] : ''
    if (alwaysPairCharacters.indexOf(character) == -1 && rest && isWord(rest[0], bufnr)) return character
    if (character == '<' && (previous == ' ' || previous == '<')) {
      return character
    }
    if (samePair && rest[0] == character && rest[1] != character) {
      // move position
      await nvim.eval(`feedkeys("\\<C-G>U\\<Right>", 'in')`)
      return ''
    }
    if (samePair && pre && (isWord(previous, bufnr) || previous == character)) return character
    // Only pair single quotes if previous character is not word.
    if (character === "'" && pre.match(/.*\w$/)) {
      return character
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
      return character
    }
    if ((filetype === 'vim' || filetype === 'help') && character === '"' && pos.character === 0) {
      return character
    }
    if (samePair && pre.length >= 2 && previous == character && pre[pre.length - 2] == character) {
      if (pre[pre.length - 3] == character) {
        if (character == '"') {
          nvim.command(`call feedkeys('"""'."${'\\<C-G>U\\<Left>'.repeat(3)}", 'in')`, true)
        } else {
          nvim.command(`call feedkeys("${character.repeat(3)}${'\\<C-G>U\\<Left>'.repeat(3)}", 'in')`, true)
        }
        return
      }
      return character
    }
    if (character == '"') {
      nvim.command(`call feedkeys('""'."\\<C-G>U\\<Left>", 'in')`, true)
    } else {
      nvim.command(`call feedkeys("${character}${pair}${'\\<C-G>U\\<Left>'.repeat(pair.length)}", 'in')`, true)
    }
    if (!currentInsert) currentInsert = { bufnr, lnum: pos.line + 1, pairs: [] }
    currentInsert.pairs.push({ inserted: character, paired: pair, position: pos })
    insertMaps.set(bufnr, currentInsert)
    return ''
  }

  async function closePair(character: string): Promise<string> {
    // should not move right when cursor move out
    let [bufnr, cursor, filetype, line] = await nvim.eval('[bufnr("%"),coc#util#cursor(),&filetype,getline(".")]') as any
    let rest = line.slice(cursor[1])
    let currentInsert = insertMaps.get(bufnr)
    if (!currentInsert || rest[0] !== character || disableLanguages.includes(filetype)) return character
    let item = currentInsert.pairs.find(o => o.paired === character)
    if (!item) return character

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
      if (n > 0) return character
    }
    nvim.command(`call feedkeys("\\<C-G>U\\<Right>", 'in')`, true)
    return ''
  }

  nvim.pauseNotification()
  for (let character of characters) {
    if (!pairs.has(character)) continue
    subscriptions.push(
      workspace.registerExprKeymap('i', character, insertPair.bind(null, character, pairs.get(character)), false)
    )
    let matched = pairs.get(character)
    if (matched != character) {
      subscriptions.push(workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), false))
    }
  }
  if (enableBackspace) {
    subscriptions.push(workspace.registerExprKeymap('i', '<bs>', onBackspace, false, false))
  }
  nvim.resumeNotification(false, true)

  async function createBufferKeymap(doc: Document): Promise<void> {
    if (!doc) return
    let pairs = doc.getVar<[string, string][]>('pairs', null)
    if (!pairs || !pairs.length) return
    localParis.set(doc.bufnr, pairs)
    nvim.pauseNotification()
    for (let p of pairs) {
      if (Array.isArray(p) && p.length == 2) {
        let [character, matched] = p
        subscriptions.push(
          workspace.registerExprKeymap('i', character, insertPair.bind(null, character, matched), true)
        )
        if (matched != character) {
          subscriptions.push(workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), true))
        }
      }
    }
    nvim.resumeNotification(false, true)
  }
  void createBufferKeymap(workspace.getDocument(workspace.bufnr))
  workspace.onDidOpenTextDocument(async e => {
    await createBufferKeymap(workspace.getDocument(e.uri))
  })
}

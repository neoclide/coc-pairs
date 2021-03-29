import { Document, ExtensionContext, workspace } from 'coc.nvim'

const pairs: Map<string, string> = new Map()
pairs.set('{', '}')
pairs.set('[', ']')
pairs.set('(', ')')
pairs.set('<', '>')
pairs.set('"', '"')
pairs.set("'", "'")
pairs.set('`', '`')

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions } = context
  const config = workspace.getConfiguration('pairs')
  const disableLanguages = config.get<string[]>('disableLanguages')
  const characters = config.get<string[]>('enableCharacters')
  const alwaysPairCharacters = config.get<string[]>('alwaysPairCharacters', [])
  let enableBackspace = config.get<boolean>('enableBackspace')
  if (enableBackspace) {
    let map = (await workspace.nvim.call('maparg', ['<bs>', 'i'])) as string
    if (map && !map.startsWith('coc#_insert_key')) enableBackspace = false
  }

  if (characters.length == 0) return
  const { nvim } = workspace

  async function insertPair(character: string, pair: string): Promise<string> {
    let samePair = character == pair
    let arr = await nvim.eval('[bufnr("%"),get(b:,"coc_pairs_disabled",[]),coc#util#cursor(),&filetype,getline("."),mode()]')
    let filetype = arr[3]
    if (disableLanguages.indexOf(filetype) !== -1) return character
    let line = arr[4]
    let mode = arr[5]
    if (mode.startsWith('R')) return character
    let chars = arr[1]
    if (chars && chars.length && chars.indexOf(character) !== -1) return character
    let pos = { line: arr[2][0], character: arr[2][1] }
    let pre = line.slice(0, pos.character)
    let rest = line.slice(pos.character)
    let previous = pre.length ? pre[pre.length - 1] : ''
    if (alwaysPairCharacters.indexOf(character) == -1 && rest && isWord(rest[0])) return character
    if (character == '<' && (previous == ' ' || previous == '<')) {
      return character
    }
    if (samePair && rest[0] == character && rest[1] != character) {
      // move position
      await nvim.eval(`feedkeys("\\<C-G>U\\<Right>", 'in')`)
      return ''
    }
    if (samePair && pre && (isWord(previous) || previous == character)) return character
    // Only pair single quotes if previous character is not word.
    if (character === "'" && pre.match(/.*\w$/)) {
      return character
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
    return ''
  }

  async function closePair(character: string): Promise<string> {
    let [cursor, filetype, line] = await nvim.eval('[coc#util#cursor(),&filetype,getline(".")]') as any
    if (disableLanguages.indexOf(filetype) !== -1) return character
    let rest = line.slice(cursor[1])
    if (rest[0] == character) {
      nvim.command(`call feedkeys("\\<C-G>U\\<Right>", 'in')`, true)
      return ''
    }
    return character
  }

  nvim.pauseNotification()
  for (let character of characters) {
    if (pairs.has(character)) {
      subscriptions.push(
        workspace.registerExprKeymap('i', character, insertPair.bind(null, character, pairs.get(character)), false)
      )
    }
    let matched = pairs.get(character)
    if (matched != character) {
      subscriptions.push(workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), false))
    }
  }
  if (enableBackspace) {
    subscriptions.push(workspace.registerExprKeymap('i', '<bs>', onBackspace, false))
  }
  // tslint:disable-next-line: no-floating-promises
  nvim.resumeNotification(false, true)

  async function createBufferKeymap(doc: Document): Promise<void> {
    if (!doc) return
    let pairs = doc.getVar<string[][]>('pairs', null)
    if (!pairs) return
    if (workspace.bufnr != doc.bufnr) return
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
    // tslint:disable-next-line: no-floating-promises
    nvim.resumeNotification(false, true)
  }
  await createBufferKeymap(workspace.getDocument(workspace.bufnr))
  workspace.onDidOpenTextDocument(async e => {
    await createBufferKeymap(workspace.getDocument(e.uri))
  })
}

// remove paired characters when possible
async function onBackspace(): Promise<string> {
  let { nvim } = workspace
  let res = await nvim.eval('[getline("."),col("."),synIDattr(synID(line("."), col(".") - 2, 1), "name")]')
  if (res) {
    let [line, col, synname] = res as [string, number, string]
    if (col > 1 && !/string/i.test(synname)) {
      let buf = Buffer.from(line, 'utf8')
      if (col - 1 < buf.length) {
        let pre = buf.slice(col - 2, col - 1).toString('utf8')
        let next = buf.slice(col - 1, col).toString('utf8')
        if (pairs.has(pre) && pairs.get(pre) == next) {
          await nvim.eval(`feedkeys("\\<C-G>U\\<right>\\<bs>\\<bs>", 'in')`)
          return
        }
      }
    }
  }
  await nvim.eval(`feedkeys("\\<bs>", 'in')`)
  return ''
}

export function byteSlice(content: string, start: number, end?: number): string {
  let buf = Buffer.from(content, 'utf8')
  return buf.slice(start, end).toString('utf8')
}

export function wait(ms: number): Promise<any> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(undefined)
    }, ms)
  })
}

export function isWord(character: string): boolean {
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code == 95) return true
  if (code >= 48 && code <= 57) return true
  if (code >= 65 && code <= 90) return true
  if (code >= 97 && code <= 122) return true
  return false
}

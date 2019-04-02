import { workspace, ExtensionContext } from 'coc.nvim'

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
  let enableBackspace = config.get<boolean>('enableBackspace')
  if (enableBackspace) {
    let map = await workspace.nvim.call('maparg', ['<bs>', 'i']) as string
    if (map && !map.startsWith('coc#_insert_key')) enableBackspace = false
    if (workspace.isVim) enableBackspace = false
  }

  if (characters.length == 0) return
  const { nvim } = workspace

  async function insertPair(character: string): Promise<string> {
    let bufnr = await nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return character
    let { filetype } = doc
    if (disableLanguages.indexOf(filetype) !== -1) return character
    let chars = await doc.buffer.getVar('coc_pairs_disabled') as string[]
    if (chars && chars.length && chars.indexOf(character) !== -1) return character
    let pos = await workspace.getCursorPosition()
    let line = doc.getline(pos.line)
    let pre = line.slice(0, pos.character)
    let rest = line.slice(pos.character)
    let isQuote = ["'", '"', '`'].indexOf(character) !== -1
    if (character == '<' && pre[pre.length - 1] == ' ') {
      return character
    }
    if (isQuote && rest[0] == character && rest[1] != character) {
      // move position
      nvim.command(`call feedkeys("\\<Right>", 'in')`, true)
      return ''
    }
    // Only pair single quotes if previous character is not word.
    if (character === "'" && pre.match(/.*\w$/)) {
      return character
    }
    if (isQuote && pre.length >= 2 && pre[pre.length - 1] == character && pre[pre.length - 2] == character) {
      // allow triple quote
      return character
    }
    if (character == '"') {
      nvim.command(`call feedkeys('""'."\\<Left>", 'in')`, true)
    } else {
      nvim.command(`call feedkeys("${character}${pairs.get(character)}\\<Left>", 'in')`, true)
    }
    return ''
  }

  async function closePair(character: string): Promise<string> {
    let bufnr = await nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return character
    if (disableLanguages.indexOf(doc.filetype) !== -1) return character
    let pos = await workspace.getCursorPosition()
    let line = doc.getline(pos.line)
    let rest = line.slice(pos.character)
    if (rest[0] == character) {
      nvim.command(`call feedkeys("\\<Right>", 'in')`, true)
      return ''
    }
    return character
  }

  nvim.pauseNotification()
  for (let character of characters) {
    if (pairs.has(character)) {
      subscriptions.push(workspace.registerExprKeymap('i', character, insertPair.bind(null, character), false))
    }
    let matched = pairs.get(character)
    if (matched != character) {
      subscriptions.push(workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), false))
    }
  }
  if (enableBackspace) {
    subscriptions.push(workspace.registerExprKeymap('i', '<bs>', onBackspace, false))
  }
  subscriptions.push(workspace.registerKeymap(['i'], 'pairs-backspce', onBackspace))
  // tslint:disable-next-line: no-floating-promises
  nvim.resumeNotification(false, true)
}

// remove paired characters when possible
async function onBackspace(): Promise<void> {
  let { nvim } = workspace
  let res = await nvim.callAtomic([
    ['nvim_get_current_line', []],
    ['nvim_call_function', ['col', ['.']]],
    ['nvim_eval', ['synIDattr(synID(line("."), col(".") - 2, 1), "name")']]
  ])
  if (res[1] == null) {
    let [line, col, synname] = res[0] as [string, number, string]
    if (col > 1 && !/string/i.test(synname)) {
      let buf = Buffer.from(line, 'utf8')
      if (col - 1 < buf.length) {
        let pre = buf.slice(col - 2, col - 1).toString('utf8')
        let next = buf.slice(col - 1, col).toString('utf8')
        if (pairs.has(pre) && pairs.get(pre) == next) {
          await nvim.eval(`feedkeys("\\<right>\\<bs>\\<bs>", 'in')`)
          return
        }
      }
    }
  }
  await nvim.eval(`feedkeys("\\<bs>", 'in')`)
}

export function byteSlice(content: string, start: number, end?: number): string {
  let buf = Buffer.from(content, 'utf8')
  return buf.slice(start, end).toString('utf8')
}

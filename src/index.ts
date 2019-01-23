import { workspace, ExtensionContext } from 'coc.nvim'

const pairs: Map<string, string> = new Map()
pairs.set('{', '}')
pairs.set('[', ']')
pairs.set('(', ')')
pairs.set('"', '"')
pairs.set("'", "'")
pairs.set('`', '`')
pairs.set('<', '>')

export async function activate(context: ExtensionContext): Promise<void> {
  let { subscriptions } = context
  const config = workspace.getConfiguration('pairs')
  const disableLanguages = config.get<string[]>('disableLanguages')
  const characters = config.get<string[]>('enableCharacters')

  if (characters.length == 0) return
  const { nvim } = workspace

  async function insertPair(character: string): Promise<string> {
    let bufnr = await nvim.call('bufnr', '%')
    let doc = workspace.getDocument(bufnr)
    if (!doc) return character
    let { filetype } = doc
    if (disableLanguages.indexOf(filetype) !== -1) return character
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
    if (['{', '(', '['].indexOf(character) !== -1) {
      let matched = pairs.get(character)
      subscriptions.push(workspace.registerExprKeymap('i', matched, closePair.bind(null, matched), false))
    }
  }
  nvim.resumeNotification()
}

import { workspace } from 'coc.nvim'


export function isWord(character: string, bufnr: number): boolean {
  let doc = workspace.getDocument(bufnr)
  if (doc && doc.attached) return doc.isWord(character)
  let code = character.charCodeAt(0)
  if (code > 128) return false
  if (code == 95) return true
  if (code >= 48 && code <= 57) return true
  if (code >= 65 && code <= 90) return true
  if (code >= 97 && code <= 122) return true
  return false
}

const UTF8_2BYTES_START = 0x80
const UTF8_3BYTES_START = 0x800
const UTF8_4BYTES_START = 65536

export function characterIndex(content: string, byteIndex: number): number {
  if (byteIndex == 0) return 0
  let characterIndex = 0
  let total = 0
  for (let codePoint of content) {
    let code = codePoint.codePointAt(0) ?? 0
    if (code >= UTF8_4BYTES_START) {
      characterIndex += 2
      total += 4
    } else {
      characterIndex += 1
      total += utf8_code2len(code)
    }
    if (total >= byteIndex) break
  }
  return characterIndex
}

function utf8_code2len(code: number): number {
  if (code < UTF8_2BYTES_START) return 1
  if (code < UTF8_3BYTES_START) return 2
  if (code < UTF8_4BYTES_START) return 3
  return 4
}

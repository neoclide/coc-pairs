# coc-pairs

Auto pair extension for [coc.nvim](https://github.com/neoclide/coc.nvim).

**Note** you can use other vim auto pairs plugins with coc.nvim, it's a
simplified implementation to make auto paris work like in VSCode.

## Tips

- You should disable/remove other auto pair plugin for this extension work as expected.
- When you type paired character which is just next character, it would just move to right by one column.
- When the previous content ends with two of inserting character, the character would just inserted without insert paired character, this makes insert triple quotes easier.
- `'` only pairs when character before is not word character.
- for `<` to insert paired `>`, the previous character should not be empty space.

## Install

In your vim/neovim, run command:

```
:CocInstall coc-pairs
```

## Features

- Insert pair character automatically.
- Buffer local pairs, ex: `autocmd FileType tex let b:coc_paires = [["$", "$"]]`

## Options

- `pairs.disableLanguages`, list of language ids to disable this extension, default: `[]`.
- `pairs.enableCharacters`, list of enabled characters, default: `` ["(", "[", "{", "<", "'", "\"", "`"] ``.
- `paris.enableBackspace`, enable imap for backspce to remove paired characters,
  default: `true`, won't work when `<bs>` already mapped.

To disable characters for specified filetype, you can use `b:coc_pairs_disabled`, ex:

    autocmd FileType markdown let b:coc_pairs_disabled = ['`']

## License

MIT

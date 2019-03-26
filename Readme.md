# coc-pairs

Auto pair extension for [coc.nvim](https://github.com/neoclide/coc.nvim).

**Note** you should disable/remove other auto pair plugin for this extension
work as expected.

**Note** when you type paired character which is just next character, it would
just move to right by one column.

**Note** when the previous characters ends with two of inserting character, the
character would just inserted without insert paired character, this makes insert
triple quotes easier.

**Note** `'` only paris when character before is not word character.

**Note** for `<` to insert paired `>`, the previous character should not be
empty space.

## Install

In your vim/neovim, run command:

```
:CocInstall coc-pairs
```

## Features

- Insert pair character automatically.

## Options

- `pairs.disableLanguages`, list of language ids to disable this extension,
  default: `[]`.
- `pairs.enableCharacters`, list of enabled characters, default: `` ["(", "[", "{", "<", "'", "\"", "`"] ``.

To disable characters for specified filetype, you can use `b:coc_paris_disabled`, ex:

    autocmd FileType markdown let b:coc_paris_disabled = ['`']

## License

MIT

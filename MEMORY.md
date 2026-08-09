#### 2026-08-10

- coc-pairs coc-test integration and editor-typing pitfalls: coc-test, startinsert, stopinsert, feedkeys, maparg, Vim first expr-keymap RPC, b:coc_pairs, BufNewFile,
coc-test.user-settings, COC_TEST_COC_PATH, ci.yaml
  - desc: Search for coc-pairs integration tests, key-feeding techniques, Vim expr-keymap first-request loss, or coc-test CI wiring in this checkout.
  - learnings:
    - `startinsert` keeps the cursor; `stopinsert`/`<Esc>` move it left one column, which breaks close-pair and move-right detection. Enter insert mode with
    `startinsert` before `feedkeys(keys, 't')`.
    - Special keys like `<BS>` must be fed via Vimscript `call feedkeys("\\<BS>", "t")`; raw bytes or `\<BS>` passed through RPC are typed literally.
    - On Vim, the first expr-keymap RPC roundtrip in a fresh editor is consumed without effect (the pair never appears); warm up with one keystroke in `before`.
    - Wait for `maparg('(', 'i')` to be non-empty before typing, since keymap registration races with activation.
    - Config read once at activation (e.g. `pairs.disableLanguages`) is testable via `coc-test.user-settings` in package.json, using a synthetic filetype.
    - Buffer-local `b:coc_pairs` must exist before the document opens; register it with `autocmd BufNewFile * let b:coc_pairs = ...`.
    - coc-test 0.1.2 `--test-name-pattern` did not filter tests (the whole file ran anyway).
    - Local runs used the coc.nvim dev checkout via `COC_TEST_COC_PATH=/Users/chemzqm/vim-dev/coc.nvim`.

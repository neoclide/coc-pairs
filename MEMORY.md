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

# Audit Summary

Plugin: coc-pairs
Version: 1.5.2
Audit date: 2026-08-10

架构：单一激活入口，通过全局及 buffer-local insert expr keymaps 实现配对；状态保存在内存 Map 中。没有 LSP、子进程或文件系统运行时逻辑。

## Critical

无。

## High

### 宏和 :normal 输入会被嵌套 feedkeys() 非确定性破坏

File: src/index.ts:168、src/index.ts:200、src/index.ts:240

Problem:

insert expr keymap 回调内部继续排队 feedkeys()。当输入来自宏或 :normal 的批量 typeahead 时，配对键和剩余输入发生竞态。

Impact:

相同命令可能生成 ('')、(')''')、('')'') 等不同结果，直接破坏编辑内容。该问题已在 #49 (https://github.com/neoclide/coc-pairs/issues/49) 确认。

Reproduction:

在包含一行内容的缓冲区重复运行 :normal O('')，Vim 和 Neovim 都可能产生随机错误结果。

Suggested fix:

让 expr keymap 确定性地返回完整按键序列，避免从回调内再次调用 feedkeys()；若需要 Coc 核心支持，应沿 coc.nvim#5727 的方向实现。

Suggested test:

在 Vim、Neovim 各重复执行至少 20 次 :normal O('')，每次严格断言结果为 ('')。

## Medium

### 扩展停用后，未释放的文档监听器仍会注册映射

File: src/index.ts:260

Problem:

workspace.onDidOpenTextDocument() 返回的 Disposable 没有加入 context.subscriptions。同时 localParis 和 buffer-local keymap disposables 没有随 BufUnload 清理。

Impact:

停用 coc-pairs 后，新缓冲区仍可能获得并执行 b:coc_pairs 映射；重复激活会保留旧闭包和回调，长期打开缓冲区还会累计状态。

Reproduction:

真实 Neovim 复现：调用 deactivateExtension，随后打开设置了 b:coc_pairs = [['$', '$']] 的新缓冲区；maparg('$', 'i') 仍返回 coc#_insert_key(...)。

Suggested fix:

把文档监听器加入 subscriptions；按 bufnr 保存局部映射 Disposable，在 BufUnload 时 dispose，并删除 localParis 对应项。

Suggested test:

停用扩展后打开带 b:coc_pairs 的缓冲区，断言没有局部映射；另测 buffer wipe/reuse 不会继承旧状态。

### 默认配置会覆盖用户已有的 <BS> 映射

File: src/index.ts:255、package.json:102

Problem:

代码无条件调用 registerExprKeymap('<bs>')，而 manifest 明确声称已有 <BS> 映射时不会生效。Coc 的注册实现会直接替换当前映射，释放时也不会恢复原映射。

Impact:

会破坏用户或其他插件的退格行为；扩展停用后原映射也无法自动恢复。

Reproduction:

停用扩展，执行 inoremap <BS> USER_BACKSPACE，再激活 coc-pairs；maparg('<BS>', 'i') 变成 coc#_insert_key(...)。

Suggested fix:

注册前检查现有 insert-mode <BS> 映射，只删除和释放扩展确实拥有的映射。

Suggested test:

激活前建立用户 <BS> 映射，分别断言激活期间及停用之后该映射保持不变。

### 跨行移动没有清除插入状态，会跳过无关结束符

File: src/index.ts:61、src/index.ts:219

Problem:

onCursorMove() 遇到行号变化时直接返回，没有删除 insertMaps；closePair() 也没有确认状态属于当前行。

Impact:

之前某行生成的配对状态会授权另一行跳过一个并非扩展生成的结束符，吞掉用户输入。

Reproduction:

真实 Neovim 复现：

1. 第一行输入 (，得到 ()。
2. 离开插入模式。
3. 第二行已有 )，光标位于其前。
4. 再输入 )。

预期第二行成为 ))，实际仍为 )。

Suggested fix:

行号不匹配时删除状态；closePair() 同时校验 currentInsert.lnum === cursor line。

Suggested test:

增加跨行、跨 insert session 的结束符测试，断言不会复用其他行的配对状态。

### b:coc_pairs 包含双引号时生成非法 Vimscript

File: src/index.ts:208

Problem:

自定义 character 和 pair 被直接拼进双引号 Vimscript：

nvim.command(`call feedkeys("...${character}${pair}...", 'in')`)

右侧配对文本含 " 或特殊反斜线序列时没有转义。

Impact:

输入被吞掉并产生 E116: Invalid arguments for function feedkeys；合法的 buffer-local 配置无法工作。

Reproduction:

设置 b:coc_pairs = [['x', '"']] 后输入 x。真实 Neovim 复现结果为空行，并报告 E116，而不是插入 x"。

Suggested fix:

通过 nvim.call('feedkeys', [keys, flags]) 把按键作为 RPC 数据传递，或返回经过正确 termcode 转换的键序列，避免构造 Vimscript。

Suggested test:

覆盖右侧为双引号、反斜线以及多字符文本的 buffer-local pairs。

## Low

无。

# Missing Tests

- OIDC workflow 不应调用 npm whoami。
- 宏和 :normal 的重复确定性。
- 扩展停用后不再注册 buffer-local mappings。
- 已有 <BS> 映射在激活和停用后保持不变。
- 跨行状态不能跳过无关结束符。
- 含引号、反斜线的 b:coc_pairs。
- buffer wipe/reuse 后不保留 localParis 或旧 keymap callbacks。

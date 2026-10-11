# Change Log

This extension is developed in its own repository. The `minilang` compiler it drives lives in
[HFunction2013/minilang](https://github.com/HFunction2013/minilang) and is released separately
(see that repository's CHANGELOG).

## 0.6.0

- **Language server.** The extension now launches the new
  [`minilang-server`](https://github.com/HFunction2013/minilang-server) LSP server (over stdio)
  for diagnostics, hover and completion. Set `minilang.useLanguageServer` to `false` to fall back
  to the previous built-in providers, and `minilang.serverPath` to point at a custom build.
- **Native methods.** Hover/completion now include the C-native methods (`sqrt`, `abs`, `time`,
  `clock_ms`, `getenv`, `cwrite`, `exit`, `csystem`) declared in `syslib/builtin.mil`.
- Diagnostics track the new boot toolchain (`minilang-boot`) and LLVM-binary linking.

## 0.5.0

- **View-switching moved to the editor title bar.** "Show Text Bytecode" / "Show Bytecode Assembly" / "Refresh" now sit at the right end of the tab strip, next to the split-editor and "…" buttons, instead of being a toolbar inside the webview. Only the view you are *not* currently on is offered, so it acts as a toggle.
- The webview no longer needs scripts at all — the CSP is now just `style-src`.
- **"Make This the Default Editor for .milc"** command: writes `*.milc -> minilang.milcViewer` into `workbench.editorAssociations`, so .milc opens in the viewer even if VS Code remembered an earlier choice.
- A failure that looks like a stale `minilang` binary (it lexes the bytecode as source and reports `Unexpected character`) now says so and tells you to rebuild the compiler.

## 0.4.0

- **Double-click a `.milc` file and it just opens.** The extension now registers a custom editor for `*.milc`, so VS Code no longer shows the binary-file prompt — the bytecode viewer opens directly.
- The viewer switches between **Text Bytecode** and **Bytecode Assembly**, has a ↻ refresh button, and re-renders automatically when the `.milc` is rebuilt on disk.
- The last-used view is remembered, so reopening shows what you looked at before.
- Syntax colouring in the viewer follows your VS Code theme.

## 0.3.0

- **Open `.milc` bytecode files** — they are binary, so VS Code cannot show them as text. The extension now exposes two read-only views over custom schemes:
  - **Text Bytecode** (`dump-text`) — the `MINILANGBC` form used for the self-hosting comparison
  - **Bytecode Assembly** (`bytecode`) — disassembly with constants, functions and opcode mnemonics
- Right-click a `.milc` file in the Explorer for either view, or run `minilang: Open .milc…` to pick a file and a view
- `minilang: Refresh .milc View` re-renders after you rebuild the bytecode (also on the editor title bar)
- Two dedicated grammars highlight the `MINILANGBC` text form and the disassembly

## 0.2.0

- **Run in terminal** (`Ctrl+F5` / `Cmd+F5`) — programs that read stdin (`readAll()`, `readLine()`) now work; also exposed as a ▶ button in the editor title bar
- **REPL command** — starts `minilang repl` in the integrated terminal
- **Live diagnostics** — checks the editor buffer, not just the saved file (`minilang.diagnostics.unsaved`)
- **Better error positions** — `undefined function` / `undefined variable` / missing module export are reported on the line where the name appears, instead of always line 1
- Grammar: `require a, b from module` now highlights names correctly, and `{` / `}` get a brace scope
- Dropped `.milc` from the language association: it is binary bytecode, not source

## 0.1.0

- Initial release
- Syntax highlighting for `.mil`
- Diagnostics from the real toolchain (`Parse error line N`, `Compile error`)
- Hover, completion and signature help for built-ins and all syslib modules
- Go to definition for local functions and `syslib/<module>.mil`
- Snippets for common patterns
- Commands: run, bytecode, dump-text, llvm, build -b, build -e, run tests

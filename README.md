# minilang for VS Code

Language support for [minilang](https://github.com/HFunction2013/minilang-compiler) — a self-hosting toy language with a bytecode VM and an LLVM backend.

## Features

- **Syntax highlighting** for `.mil` files (keywords, built-ins, modules, strings, escapes, numbers)
- **Diagnostics as you type** — parse and compile errors come from the real `minilang` toolchain and are shown inline
- **Hover docs** for every built-in and every `syslib` function (`math`, `string`, `list`, `sort`, `json`, `io`, `rand`, `word`)
- **Completion** — keywords, built-ins, module functions after `module.`, module names after `require`, plus functions defined in the current file
- **Signature help** while typing call arguments
- **Go to definition** — jump to a function in the current file, or into `syslib/<module>.mil`
- **Snippets** — `main`, `func`, `if`, `ifelse`, `while`, `for`, `var`, `array`, `require`, `jsonparse` …
- **Commands** — run in terminal, run in output channel, REPL, bytecode, dump-text, LLVM IR, build `.milc`, build native, run all tests
- **`.milc` viewer** — double-click a `.milc` file and it opens directly as bytecode, with **Show Text Bytecode** / **Show Bytecode Assembly** toggles in the editor title bar

## Requirements

The extension shells out to the `minilang` binary. The binary is built from the
C bootstrap toolchain in [HFunction2013/minilang-boot](https://github.com/HFunction2013/minilang-boot)
(the compiler's own sources live in [HFunction2013/minilang-compiler](https://github.com/HFunction2013/minilang-compiler)
and are *run by* that bootstrap binary). Rebuild the binary after upgrading this
extension. Reading `.milc` bytecode is a recent CLI feature, and an older binary
will fail with "Unexpected character" when the viewer asks it to dump a bytecode
file:

```bash
git clone https://github.com/HFunction2013/minilang-boot.git
cd minilang-boot
git submodule update --init --recursive   # syslib modules (math, json, io, ...)
make
```

Then point the extension at it if it is not in your `PATH`:

```jsonc
{
  "minilang.path": "/path/to/minilang-boot/minilang"
}
```

Resolution order:

1. `minilang.path` setting
2. `./minilang` in the workspace root
3. `minilang` on `PATH`

Diagnostics and every command run with the current file's directory as the working directory, so `require` and `syslib/` resolve correctly. Override this with `minilang.workingDirectory`.

### Why am I seeing no error squiggles?

Diagnostics come from the real `minilang` binary, and the extension deliberately
tells you when the pipeline is broken instead of staying quiet. If errors are
not appearing, check, in order:

1. **Is there a `minilang` binary at all?** On activation the extension probes
   for one and shows a warning if it is missing. Follow the build steps above.
2. **Is it the version the extension expects?** Rebuild after upgrading the
   extension; an old binary may fail to lex/compile in a way that yields no
   usable error output.
3. **Language server health.** With `minilang.useLanguageServer` (default `true`)
   the `minilang-server` LSP handles diagnostics. If it was not built
   (`minilang-server/out/server.js` missing), a warning tells you it is falling
   back to the built-in providers; make sure `npm install && npm run build` was
   run in the `minilang-server` checkout.
4. **The file must be a real `.mil` file** (`scheme: file`, language id
   `minilang`) — unsaved scratch buffers are not validated.

## Commands

| Command | Keybinding | Description |
|---|---|---|
| minilang: Run File in Terminal | `Ctrl+F5` / `Cmd+F5` | Run in the integrated terminal — **stdin works**, so `readAll()` / `readLine()` programs behave normally |
| minilang: Open .milc… | | Pick a `.milc` file, then open it as a virtual document |
| minilang: Open .milc as Text Bytecode | | Explorer context menu — opens a searchable virtual document |
| minilang: Open .milc as Bytecode Assembly | | Explorer context menu — opens a searchable virtual document |
| minilang: Refresh .milc View | | Re-render an open virtual-document view |
| minilang: Show Text Bytecode | | Title-bar toggle on the bytecode viewer |
| minilang: Show Bytecode Assembly | | Title-bar toggle on the bytecode viewer |
| minilang: Refresh Bytecode View | | Title-bar button on the bytecode viewer |
| minilang: Make This the Default Editor for .milc | | Writes `workbench.editorAssociations` so .milc always opens in the viewer |
| minilang: Start REPL | | Open the minilang REPL in the terminal |
| minilang: Run File in Output Channel | `Ctrl+Alt+R` / `Cmd+Alt+R` | Run and capture output in the output channel |
| minilang: Show Bytecode Disassembly | `Ctrl+Alt+B` / `Cmd+Alt+B` | Human-readable bytecode |
| minilang: Check File for Errors | `Ctrl+Alt+C` / `Cmd+Alt+C` | Force a re-check now |
| minilang: Dump Text Bytecode | | `MINILANGBC` text format |
| minilang: Generate LLVM IR | | Emit `.ll` |
| minilang: Build .milc Bytecode | | Binary bytecode, magic `!milc` |
| minilang: Build Native Executable | | LLVM backend (needs `llvmlite` + `gcc`) |
| minilang: Run All Tests in tests/ | | Run every `.mil` under `tests/` |

### Viewing `.milc` bytecode files

A `.milc` file is binary bytecode. The extension registers a **custom editor** for `*.milc`, so **double-clicking one opens the bytecode viewer directly** — no binary-file prompt, no picking a view first.

Inside the viewer:

- **Show Text Bytecode** / **Show Bytecode Assembly** — a toggle at the right end of the tab strip switches between the `MINILANGBC` text form (`minilang dump-text`) and the disassembly with constants, functions and `0: JMP 43 0` (`minilang bytecode`). Only the view you are *not* on is shown.
- **Refresh Bytecode View** (↻, same place) re-renders — the file is watched on disk, so this usually happens on its own after `build -b`.
- The last view you used is remembered for the next file.
- Colouring follows your VS Code theme.

If VS Code does not open `.milc` in the viewer on its own (for example because you previously chose another editor), run **minilang: Make This the Default Editor for .milc** — it writes `*.milc -> minilang.milcViewer` into `workbench.editorAssociations`.

If you want the bytecode as a **real** editor buffer (searchable with `Ctrl+F`, comparable with diff, copy-paste friendly), use the Explorer right-click entries or **minilang: Open .milc…** instead — those open read-only virtual documents with full TextMate grammars.

`Run File in Terminal` also appears as a ▶ button in the editor title bar and in the editor context menu. Everything else prints to the **minilang** output channel.

## Settings

| Setting | Default | Description |
|---|---|---|
| `minilang.path` | `""` | Path to the `minilang` executable |
| `minilang.workingDirectory` | `""` | cwd for invocations; empty means the current file's directory |
| `minilang.diagnostics.enable` | `true` | Report parse/compile errors as you type |
| `minilang.diagnostics.unsaved` | `true` | Check the editor buffer instead of the saved file (writes a temporary copy next to the source so `require`/`syslib` still resolve) |

## Install from source

```bash
npm install
npm run compile
```

Then either copy the folder into your extensions directory:

```bash
cp -r . ~/.vscode/extensions/minilang-0.5.0
```

or package and install it as a `.vsix`:

```bash
npx @vscode/vsce package
code --install-extension minilang-0.5.0.vsix
```

Press `F5` inside this folder to launch an Extension Development Host with the extension loaded.

For the smoke test, point `MINILANG_BIN` at a built `minilang` binary (it is otherwise looked up
next to this folder, in a sibling `minilang-compiler/`, or on `PATH`):

```bash
npm run compile
MINILANG_BIN=/path/to/minilang/minilang npm run smoke
```

## Troubleshooting

**"… is not a readable .milc bytecode file. Unexpected character …"** — your `minilang` executable predates bytecode reading. Run `make` in the repository (or repoint `minilang.path` at a freshly built binary). The viewer shows this hint inline.

**`.milc` opens in a normal text editor** — run **minilang: Make This the Default Editor for .milc**, or use **Open With… → minilang Bytecode Viewer**.

**"Activating extension 'vadimcn.vscode-lldb' failed: a.lm.registerTool is not a function"** — this error is **not** caused by this extension. `vadimcn.vscode-lldb` (CodeLLDB) is a separate, third-party debugger extension. Newer CodeLLDB releases call VS Code's language-model tool API (`vscode.lm.registerTool`, available since VS Code 1.99) during activation, so when your VS Code is older than that, activation throws `a.lm.registerTool is not a function` and VS Code stops loading the extension. Fixes, in order of preference:

1. **Update VS Code** to 1.99 or newer (Help → About → check the version; or reinstall from code.visualstudio.com). This is the cleanest fix.
2. If you cannot update VS Code, install an **older CodeLLDB** release that does not use the `lm` API (for example 1.10.x, via "Install Another Version…" in the Extensions view).
3. If you do not use CodeLLDB's debugging, simply **disable or uninstall** it (`Extensions` view → `CodeLLDB` → Disable).

This extension neither depends on CodeLLDB nor triggers its activation — the two only appear together on the same notification because VS Code reports one failing extension at a time.

## Known limitations

- Diagnostic positions: `Parse error line N` gives an exact line. `Compile error: undefined function 'foo'` has no position from the compiler, so the extension looks up the first line mentioning `foo` and reports there — which is usually, but not always, the right one.
- Hover and completion metadata are hand-written in `src/builtins.ts`; adding a module means updating that file too.
- The custom editor is the default way to open `.milc`; if you prefer a plain text buffer, use **Open With… → Text Editor** or the Explorer context-menu entries.
- There is no debugger yet.

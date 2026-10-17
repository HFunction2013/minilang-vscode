import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient/node';
import { BUILTINS, MODULES, MODULE_FUNCTION_NAMES, findDoc } from './builtins';

const MIL_SELECTOR: vscode.DocumentSelector = { scheme: 'file', language: 'minilang' };
const OUTPUT_CHANNEL_NAME = 'minilang';

let outputChannel: vscode.OutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let lcClient: LanguageClient | undefined;

// ============================================================================
// Toolchain resolution
// ============================================================================

/** Resolve the minilang executable: config path, workspace file, or PATH. */
function resolveMinilang(): string | undefined {
    const cfg = vscode.workspace.getConfiguration('minilang');
    const configured = cfg.get<string>('path')?.trim();
    if (configured) {
        if (isExecutable(configured)) {
            return configured;
        }
        throw new Error(`minilang.path is set to "${configured}" but that file is not executable.`);
    }

    // Look for a built binary next to the .mil file's workspace
    const folders = vscode.workspace.workspaceFolders;
    if (folders) {
        for (const folder of folders) {
            const candidate = path.join(folder.uri.fsPath, 'minilang');
            if (isExecutable(candidate)) {
                return candidate;
            }
        }
    }

    // Otherwise rely on PATH
    return 'minilang';
}

function isExecutable(p: string): boolean {
    try {
        fs.accessSync(p, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/** Locate minilang-server's compiled server.js: config, bundled, or sibling checkout. */
function resolveServerModule(context: vscode.ExtensionContext): string | undefined {
    const cfg = vscode.workspace.getConfiguration('minilang').get<string>('serverPath')?.trim();
    if (cfg && fs.existsSync(cfg)) return cfg;
    const bundled = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
    if (fs.existsSync(bundled)) return bundled;
    // Dev fallback: a sibling ../minilang-server checkout.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        const cand = path.join(folder.uri.fsPath, '..', 'minilang-server', 'out', 'server.js');
        if (fs.existsSync(cand)) return cand;
    }
    return undefined;
}

/** Directory used as cwd when invoking minilang, so require/syslib resolves. */
function workingDirectory(file?: string): string {
    const cfg = vscode.workspace.getConfiguration('minilang');
    const configured = cfg.get<string>('workingDirectory')?.trim();
    if (configured) {
        return configured;
    }
    if (file) {
        return path.dirname(file);
    }
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
}

interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<RunResult> {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, { cwd, shell: false });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d.toString()));
        child.stderr.on('data', (d) => (stderr += d.toString()));
        child.on('error', (err) => {
            resolve({ code: -1, stdout, stderr: stderr + `\n${err.message}` });
        });
        child.on('close', (code) => {
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}

// ============================================================================
// Commands
// ============================================================================

/** Save the document if it is dirty, then return its path. */
async function ensureSaved(doc?: vscode.TextDocument): Promise<vscode.TextDocument | undefined> {
    const editor = doc ?? vscode.window.activeTextEditor?.document;
    if (!editor) {
        return undefined;
    }
    if (editor.isDirty) {
        await editor.save();
    }
    return editor;
}

function activeMilFile(): string | undefined {
    const doc = vscode.window.activeTextEditor?.document;
    if (!doc || doc.languageId !== 'minilang' || doc.uri.scheme !== 'file') {
        return undefined;
    }
    return doc.uri.fsPath;
}

function showOutput(title: string, result: RunResult) {
    outputChannel.clear();
    outputChannel.appendLine(`$ ${title}`);
    outputChannel.appendLine('');
    if (result.stdout) {
        outputChannel.append(result.stdout);
        if (!result.stdout.endsWith('\n')) {
            outputChannel.appendLine('');
        }
    }
    if (result.stderr) {
        outputChannel.appendLine('--- stderr ---');
        outputChannel.append(result.stderr);
        if (!result.stderr.endsWith('\n')) {
            outputChannel.appendLine('');
        }
    }
    if (result.code !== 0 && result.code !== -1) {
        outputChannel.appendLine(`(exit code ${result.code})`);
    }
    outputChannel.show(true);
}

async function runMinilangCommand(args: string[], title: string, filePath: string) {
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        vscode.window.showErrorMessage(String((err as Error).message));
        return;
    }
    const cwd = workingDirectory(filePath);
    const result = await run(exe, args, cwd);
    showOutput(`${exe} ${args.join(' ')}  (cwd: ${cwd})`, result);
    if (result.code === -1) {
        vscode.window.showErrorMessage(
            `Could not launch "${exe}". Set minilang.path in your settings to the built minilang binary.`
        );
    }
}

/** Quote a path so the terminal command survives spaces. */
function shellQuote(p: string): string {
    if (/^[A-Za-z0-9_./:-]+$/.test(p)) {
        return p;
    }
    return `'${p.replace(/'/g, "'\\''")}'`;
}

/** Send a command to the shared minilang terminal, so stdin-based programs work. */
function terminalCommand(commandLine: string, cwd: string) {
    const term = vscode.window.createTerminal({ name: 'minilang', cwd });
    term.show(true);
    term.sendText(commandLine);
}

/** Run the current file in the integrated terminal (interactive stdin works). */
async function commandRunTerminal() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        vscode.window.showErrorMessage('Open a .mil file first.');
        return;
    }
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        vscode.window.showErrorMessage(String((err as Error).message));
        return;
    }
    terminalCommand(`${shellQuote(exe)} run ${shellQuote(file)}`, workingDirectory(file));
}

/** Start the minilang REPL. */
function commandRepl() {
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        vscode.window.showErrorMessage(String((err as Error).message));
        return;
    }
    const file = activeMilFile();
    terminalCommand(`${shellQuote(exe)} repl`, workingDirectory(file));
}

/** Run the current file in the VM. */
async function commandRun() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        vscode.window.showErrorMessage('Open a .mil file first.');
        return;
    }
    await runMinilangCommand(['run', file], 'run', file);
}

/** Disassemble to human-readable bytecode. */
async function commandBytecode() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        return;
    }
    await runMinilangCommand(['bytecode', file], 'bytecode', file);
}

/** Dump the text bytecode format (dump-text). */
async function commandDumpText() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        return;
    }
    await runMinilangCommand(['dump-text', file], 'dump-text', file);
}

/** Emit LLVM IR. */
async function commandLlvm() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        return;
    }
    await runMinilangCommand(['llvm', file], 'llvm', file);
}

/** Build a .milc bytecode file (binary, magic "!milc"). */
async function commandBuildBytecode() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        return;
    }
    await runMinilangCommand(['build', '-b', file], 'build -b', file);
    const out = file.replace(/\.mil$/, '.milc');
    vscode.window.showInformationMessage(`Bytecode written: ${out}`);
}

/** Build a native executable via the LLVM backend (drives `minilang build -e`, which uses llc + clang). */
async function commandBuildNative() {
    const doc = await ensureSaved();
    const file = doc?.uri.fsPath ?? activeMilFile();
    if (!file) {
        return;
    }
    await runMinilangCommand(['build', '-e', file], 'build -e', file);
}

/** Run everything under tests/ in the workspace. */
async function commandRunTests() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        vscode.window.showErrorMessage('Open a workspace folder first.');
        return;
    }
    const root = folders[0].uri.fsPath;
    const testsDir = path.join(root, 'tests');
    if (!fs.existsSync(testsDir)) {
        vscode.window.showWarningMessage(`No tests/ directory in ${root}`);
        return;
    }
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        vscode.window.showErrorMessage(String((err as Error).message));
        return;
    }
    const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.mil')).sort();
    outputChannel.clear();
    outputChannel.show(true);
    for (const f of files) {
        const result = await run(exe, ['run', path.join(testsDir, f)], root);
        outputChannel.appendLine(`--- ${f} ---`);
        outputChannel.append(result.stdout);
        if (result.stderr.trim()) {
            outputChannel.appendLine('[stderr] ' + result.stderr.trim());
        }
        outputChannel.appendLine('');
    }
}

// ============================================================================
// Diagnostics
// ============================================================================

/**
 * The toolchain reports errors on stderr in these shapes:
 *   Parse error line 12: unexpected token
 *   Compile error: undefined function 'foo'
 *   Compile error: undefined variable 'x'
 *   Parse error: cannot find module 'nope' (searched ...)
 * Only the first form carries a line number; for the others we locate the
 * offending identifier in the buffer so the squiggle lands on the right line.
 */
const PARSE_ERROR_RE = /Parse error line (\d+):\s*(.*)/;
const GENERIC_ERROR_RE = /^(?:Parse|Compile|IR|VM) error:\s*(.*)$/;
const UNDEFINED_NAME_RE = /(?:undefined function|undefined var|undefined variable|has no exported function)\s+'([^']+)'/;

/**
 * Write the editor buffer next to the real file so that `require` and syslib
 * still resolve, then validate that copy. Returns the path to validate and a
 * cleanup callback.
 */
function stageForValidation(doc: vscode.TextDocument, useBuffer: boolean): { file: string; cleanup: () => void } {
    const file = doc.uri.fsPath;
    if (!useBuffer || !doc.isDirty) {
        return { file, cleanup: () => undefined };
    }
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.minilang-lint-${path.basename(file)}`);
    try {
        fs.writeFileSync(tmp, doc.getText());
        return { file: tmp, cleanup: () => { try { fs.unlinkSync(tmp); } catch { /* ignore */ } } };
    } catch {
        return { file, cleanup: () => undefined };
    }
}

/** One-shot guard so a broken toolchain is reported once, not on every keystroke. */
let toolchainWarningShown = false;
function warnOnce(message: string) {
    if (toolchainWarningShown) {
        return;
    }
    toolchainWarningShown = true;
    void vscode.window.showWarningMessage(message);
}

/** An information diagnostic pinned to the first line, for toolchain problems. */
function infoDiagnostic(doc: vscode.TextDocument, message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, Number.MAX_SAFE_INTEGER),
        message,
        vscode.DiagnosticSeverity.Information
    );
}

async function validate(doc: vscode.TextDocument) {
    if (doc.languageId !== 'minilang' || doc.uri.scheme !== 'file') {
        return;
    }
    // When the language server is running it owns diagnostics (it publishes to
    // its own collection); running the built-in pipeline too would double every
    // squiggle and spawn a second minilang process per keystroke.
    if (lcClient) {
        return;
    }
    const cfg = vscode.workspace.getConfiguration('minilang');
    if (!cfg.get<boolean>('diagnostics.enable', true)) {
        diagnosticCollection.delete(doc.uri);
        return;
    }

    const realFile = doc.uri.fsPath;
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        const msg = String((err as Error).message);
        diagnosticCollection.set(doc.uri, [infoDiagnostic(doc, msg)]);
        warnOnce(msg);
        return;
    }

    const useBuffer = cfg.get<boolean>('diagnostics.unsaved', true);
    const staged = stageForValidation(doc, useBuffer);
    const cwd = workingDirectory(realFile);
    const result = await run(exe, ['bytecode', staged.file], cwd);
    staged.cleanup();
    if (result.code === -1) {
        // Never fail silently: a missing/broken binary is the #1 reason users
        // think diagnostics are broken. Say so, visibly, instead of clearing.
        const msg =
            `Could not launch "${exe}" — code diagnostics are disabled. Build the minilang ` +
            `toolchain (minilang-boot) and set minilang.path in settings, or add the binary to PATH.`;
        diagnosticCollection.set(doc.uri, [infoDiagnostic(doc, msg)]);
        warnOnce(msg);
        return;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    const lines = doc.getText().split(/\r?\n/);
    const seen = new Set<string>();

    /** First line mentioning `name` as a whole word, or -1. */
    const findLine = (name: string): number => {
        const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
                return i;
            }
        }
        return -1;
    };

    const add = (line: number, message: string, severity: vscode.DiagnosticSeverity) => {
        const idx = Math.max(0, Math.min(line, lines.length - 1));
        const key = `${idx}:${message}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        const range = new vscode.Range(idx, 0, idx, lines[idx].length);
        diagnostics.push(new vscode.Diagnostic(range, message, severity));
    };

    for (const raw of result.stderr.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const m = PARSE_ERROR_RE.exec(line);
        if (m) {
            const text = m[2] || 'syntax error';
            // Compiler lines are 1-based; staged files match the buffer 1:1
            add(Number(m[1]) - 1, text, vscode.DiagnosticSeverity.Error);
            continue;
        }
        const g = GENERIC_ERROR_RE.exec(line);
        if (!g) {
            continue;
        }
        const text = g[1] || 'error';
        const u = UNDEFINED_NAME_RE.exec(text);
        let target = 0;
        if (u) {
            const found = findLine(u[1]);
            if (found >= 0) {
                target = found;
            }
        }
        add(target, text, vscode.DiagnosticSeverity.Error);
    }

    diagnosticCollection.set(doc.uri, diagnostics);
}

// ============================================================================
// Hover
// ============================================================================

class MilHoverProvider implements vscode.HoverProvider {
    provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return undefined;
        }
        const word = document.getText(range);
        const found = findDoc(word);
        if (found) {
            return this.render(found.mod, found.fn);
        }
        // Also try the qualified form when hovering "cos" inside "math.cos(...)"
        const lineText = document.lineAt(position.line).text;
        const qualified = /([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g;
        let m: RegExpExecArray | null;
        while ((m = qualified.exec(lineText)) !== null) {
            if (m[2] === word || m[1] === word) {
                const hit = findDoc(`${m[1]}.${m[2]}`);
                if (hit) {
                    return this.render(hit.mod, hit.fn);
                }
            }
        }
        return undefined;
    }

    private render(mod: { name: string } | null, fn: { signature: string; detail: string; doc: string }): vscode.Hover {
        const md = new vscode.MarkdownString();
        md.appendCodeblock(fn.signature, 'minilang');
        md.appendMarkdown('\n');
        md.appendMarkdown(fn.doc);
        md.appendMarkdown('\n\n');
        if (mod) {
            md.appendMarkdown(`_from the \`${mod.name}\` module — \`require ${mod.name};\`_\n\n`);
        } else {
            md.appendMarkdown('_built-in_\n\n');
        }
        md.appendMarkdown(`*${fn.detail}*`);
        return new vscode.Hover(md);
    }
}

// ============================================================================
// Completion
// ============================================================================

class MilCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const line = document.lineAt(position.line).text;
        const before = line.substring(0, position.character);

        // require <module> / require ... from <module>
        const requireMatch = /\brequire\b[^;]*$/.exec(before);
        if (requireMatch && !/\bfrom\b/.test(requireMatch[0])) {
            for (const m of MODULES) {
                const item = new vscode.CompletionItem(m.name, vscode.CompletionItemKind.Module);
                item.detail = `syslib/${m.name}.mil`;
                item.documentation = new vscode.MarkdownString(m.doc);
                item.insertText = m.name;
                items.push(item);
            }
            return items;
        }

        // module.<something>
        const dotMatch = /([A-Za-z_][A-Za-z0-9_]*)\.\s*$/.exec(before);
        if (dotMatch) {
            const modName = dotMatch[1];
            const names = MODULE_FUNCTION_NAMES.get(modName);
            if (names) {
                const mod = MODULES.find((m) => m.name === modName)!;
                for (const f of mod.functions) {
                    const item = new vscode.CompletionItem(f.name, vscode.CompletionItemKind.Function);
                    item.detail = f.signature;
                    item.documentation = new vscode.MarkdownString(f.doc);
                    items.push(item);
                }
                return items;
            }
            return items;
        }

        // Keywords
        for (const kw of ['var', 'func', 'if', 'else', 'while', 'return', 'break', 'print', 'println', 'require', 'from', 'in']) {
            const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
            items.push(item);
        }
        // Literals
        for (const lit of ['true', 'false', 'nil']) {
            items.push(new vscode.CompletionItem(lit, vscode.CompletionItemKind.Value));
        }
        // Built-ins
        for (const b of BUILTINS) {
            const item = new vscode.CompletionItem(b.name, vscode.CompletionItemKind.Function);
            item.detail = b.signature;
            item.documentation = new vscode.MarkdownString(b.doc);
            items.push(item);
        }
        // Functions defined in this file
        const funcRe = /^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)/gm;
        let m: RegExpExecArray | null;
        const own = new Set(BUILTINS.map((b) => b.name));
        while ((m = funcRe.exec(document.getText())) !== null) {
            if (!own.has(m[1])) {
                const item = new vscode.CompletionItem(m[1], vscode.CompletionItemKind.Function);
                item.detail = `func ${m[1]}(...)  — defined in this file`;
                items.push(item);
            }
        }
        // Module-qualified calls for modules already required
        const reqRe = /\brequire\s+([A-Za-z_][A-Za-z0-9_]*)/g;
        const text = document.getText();
        let r: RegExpExecArray | null;
        const required = new Set<string>();
        while ((r = reqRe.exec(text)) !== null) {
            required.add(r[1]);
        }
        for (const modName of required) {
            const mod = MODULES.find((mm) => mm.name === modName);
            if (!mod) {
                continue;
            }
            for (const f of mod.functions) {
                const item = new vscode.CompletionItem(`${modName}.${f.name}`, vscode.CompletionItemKind.Function);
                item.detail = f.signature;
                item.documentation = new vscode.MarkdownString(f.doc);
                items.push(item);
            }
        }
        return items;
    }
}

// ============================================================================
// Signature help
// ============================================================================

class MilSignatureProvider implements vscode.SignatureHelpProvider {
    provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.SignatureHelp | undefined {
        const line = document.lineAt(position.line).text;
        const before = line.substring(0, position.character);
        const m = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*\(([^()]*)$/.exec(before);
        if (!m) {
            return undefined;
        }
        const found = findDoc(m[1]);
        if (!found) {
            return undefined;
        }
        const sig = new vscode.SignatureInformation(
            found.fn.signature,
            new vscode.MarkdownString(found.fn.doc)
        );
        // Split the parameter list for active-parameter highlighting
        const params = m[2];
        const depth = params && params.trim() ? params.split(',').length - 1 : 0;
        const help = new vscode.SignatureHelp();
        help.signatures = [sig];
        help.activeSignature = 0;
        help.activeParameter = Math.max(0, depth);
        return help;
    }
}

// ============================================================================
// Go to definition (functions in this file + syslib modules)
// ============================================================================

class MilDefinitionProvider implements vscode.DefinitionProvider {
    provideDefinition(document: vscode.TextDocument, position: vscode.Position): vscode.Location[] | undefined {
        const range = document.getWordRangeAtPosition(position);
        if (!range) {
            return undefined;
        }
        const word = document.getText(range);

        // A required module name jumps to syslib/<name>.mil
        const lineText = document.lineAt(position.line).text;
        if (/\brequire\b/.test(lineText)) {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (folder) {
                const candidate = path.join(folder.uri.fsPath, 'syslib', `${word}.mil`);
                if (fs.existsSync(candidate)) {
                    return [new vscode.Location(vscode.Uri.file(candidate), new vscode.Position(0, 0))];
                }
            }
        }

        // A function name jumps to its definition in this file
        const text = document.getText();
        const re = new RegExp(`^\\s*func\\s+${word}\\s*\\(`, 'm');
        const m = re.exec(text);
        if (m) {
            const offset = m.index + m[0].indexOf(word);
            const pos = document.positionAt(offset);
            return [new vscode.Location(document.uri, pos)];
        }
        return undefined;
    }
}

// ============================================================================
// .milc viewer: read-only virtual documents over two schemes
// ============================================================================

/**
 * A .milc file is binary bytecode, so VS Code refuses to open it as text.
 * We expose it as two read-only virtual documents instead:
 *   milc-text:/abs/path.milc  -> `minilang dump-text` (MINILANGBC text form)
 *   milc-asm:/abs/path.milc   -> `minilang bytecode` (human-readable disassembly)
 */
const MILC_TEXT_SCHEME = 'milc-text';
const MILC_ASM_SCHEME = 'milc-asm';

type MilcView = 'text' | 'asm';

interface ViewMeta {
    scheme: string;
    arg: string;
    language: string;
    label: string;
    detail: string;
}

const VIEW_META: Record<MilcView, ViewMeta> = {
    text: {
        scheme: MILC_TEXT_SCHEME,
        arg: 'dump-text',
        language: 'minilang-bctext',
        label: 'Text Bytecode',
        detail: 'MINILANGBC text format — what the self-hosting comparison uses',
    },
    asm: {
        scheme: MILC_ASM_SCHEME,
        arg: 'bytecode',
        language: 'minilang-bcasm',
        label: 'Bytecode Assembly',
        detail: 'Human-readable disassembly with constants, functions and opcodes',
    },
};

function milcUri(fsPath: string, view: MilcView): vscode.Uri {
    return vscode.Uri.file(fsPath).with({ scheme: VIEW_META[view].scheme });
}

/** Run the toolchain and return one rendered view of a .milc file. */
async function renderMilcView(file: string, view: MilcView): Promise<string> {
    const meta = VIEW_META[view];
    let exe: string;
    try {
        exe = resolveMinilang()!;
    } catch (err) {
        throw new Error(String((err as Error).message));
    }
    const result = await run(exe, [meta.arg, file], workingDirectory(file));
    if (result.code === -1) {
        throw new Error(
            `Could not launch "${exe}". Set minilang.path in your settings to the built minilang binary.`
        );
    }
    if (result.code !== 0 || result.stderr.trim()) {
        const detail = result.stderr.trim() || `minilang exited with code ${result.code}`;
        throw new Error(`${path.basename(file)} is not a readable .milc bytecode file.\n${detail}`);
    }
    return result.stdout;
}

function isMilcUri(uri: vscode.Uri): boolean {
    return uri.scheme === MILC_TEXT_SCHEME || uri.scheme === MILC_ASM_SCHEME;
}

function viewOfUri(uri: vscode.Uri): MilcView {
    return uri.scheme === MILC_ASM_SCHEME ? 'asm' : 'text';
}

class MilcFileSystemProvider implements vscode.FileSystemProvider, vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this.emitter.event;

    /** Ask listeners to re-read a document (used by the Refresh command). */
    refresh(uri: vscode.Uri): void {
        this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    }

    watch(): vscode.Disposable {
        return new vscode.Disposable(() => undefined);
    }

    dispose(): void {
        this.emitter.dispose();
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        const content = await this.render(uri);
        const bytes = Buffer.byteLength(content, 'utf8');
        let mtime = 0;
        try {
            mtime = fs.statSync(uri.path).mtimeMs;
        } catch {
            mtime = 0;
        }
        return {
            type: vscode.FileType.File,
            ctime: mtime,
            mtime,
            size: bytes,
            permissions: vscode.FilePermission.Readonly,
        };
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        return Buffer.from(await this.render(uri), 'utf8');
    }

    readDirectory(): [string, vscode.FileType][] {
        throw vscode.FileSystemError.NoPermissions();
    }

    createDirectory(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    writeFile(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    delete(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    rename(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    copy(): void {
        throw vscode.FileSystemError.NoPermissions();
    }

    /** Run the toolchain and return the rendered view. */
    private async render(uri: vscode.Uri): Promise<string> {
        try {
            return await renderMilcView(uri.path, viewOfUri(uri));
        } catch (err) {
            throw vscode.FileSystemError.Unavailable(String((err as Error).message));
        }
    }
}

let milcProvider: MilcFileSystemProvider | undefined;

/** Open a .milc file as a virtual document in the given view. */
async function openMilc(file: string, view: MilcView) {
    const uri = milcUri(file, view);
    const meta = VIEW_META[view];
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        // The path extension is .milc, which has no language association, so
        // pick the right grammar for this view explicitly.
        if (doc.languageId !== meta.language) {
            await vscode.languages.setTextDocumentLanguage(doc, meta.language);
        }
        await vscode.window.showTextDocument(doc, { preview: false });
    } catch (err) {
        vscode.window.showErrorMessage(
            `Cannot open ${path.basename(file)} as ${meta.label}: ${(err as Error).message}`
        );
    }
}

/** Ask which view to use, then open the file in it. */
async function commandOpenMilc(uri?: vscode.Uri) {
    let file: string | undefined;

    if (uri && uri.scheme === 'file' && uri.fsPath.endsWith('.milc')) {
        file = uri.fsPath;
    } else {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active && isMilcUri(active)) {
            file = active.path;
        }
    }

    if (!file) {
        const found = await findMilcFiles();
        if (found.length === 0) {
            vscode.window.showWarningMessage(
                'No .milc files found in the workspace. Build one first with "minilang: Build .milc Bytecode".'
            );
            return;
        }
        const picked = await vscode.window.showQuickPick(found, {
            placeHolder: 'Select a .milc bytecode file',
        });
        if (!picked || !picked.detail) {
            return;
        }
        file = picked.detail;
    }

    const choice = await vscode.window.showQuickPick(
        [
            { label: VIEW_META.text.label, detail: VIEW_META.text.detail, view: 'text' as MilcView },
            { label: VIEW_META.asm.label, detail: VIEW_META.asm.detail, view: 'asm' as MilcView },
        ],
        { placeHolder: `Open ${path.basename(file)} as…` }
    );
    if (!choice) {
        return;
    }
    await openMilc(file, choice.view);
}

async function commandOpenMilcView(view: MilcView, uri?: vscode.Uri) {
    let file: string | undefined;
    if (uri && uri.scheme === 'file' && uri.fsPath.endsWith('.milc')) {
        file = uri.fsPath;
    } else {
        const active = vscode.window.activeTextEditor?.document.uri;
        if (active && isMilcUri(active)) {
            file = active.path;
        } else if (active && active.scheme === 'file' && active.fsPath.endsWith('.milc')) {
            file = active.fsPath;
        }
    }
    if (!file) {
        await commandOpenMilc(uri);
        return;
    }
    await openMilc(file, view);
}

/** Re-render the currently open .milc view (after rebuilding the bytecode). */
function commandRefreshMilc() {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (!active || !isMilcUri(active) || !milcProvider) {
        vscode.window.showInformationMessage('Open a .milc view first to refresh it.');
        return;
    }
    milcProvider.refresh(active);
}

/** Every .milc file under the workspace, for the picker. */
async function findMilcFiles(): Promise<vscode.QuickPickItem[]> {
    const uris = await vscode.workspace.findFiles('**/*.milc', '**/node_modules/**', 200);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return uris.map((u) => ({
        label: path.basename(u.fsPath),
        detail: u.fsPath,
        description: folder && u.fsPath.startsWith(folder)
            ? u.fsPath.slice(folder.length + 1)
            : u.fsPath,
    }));
}

// ============================================================================
// .milc custom editor: double-clicking a .milc file opens here
// ============================================================================

const MILC_VIEWER_TYPE = 'minilang.milcViewer';

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Lightweight colouring so the webview view matches the TextMate grammars. */
function highlightMilc(content: string, view: MilcView): string {
    const out: string[] = [];
    for (const line of content.split(/\r?\n/)) {
        out.push(highlightLine(line, view));
    }
    return out.join('\n');
}

function span(cls: string, text: string): string {
    return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function highlightLine(line: string, view: MilcView): string {
    if (view === 'text') {
        if (line === 'MINILANGBC') {
            return span('hd', line);
        }
        let m = /^(0) (-?\d+)$/.exec(line);
        if (m) {
            return `${span('ty', m[1])} ${span('num', m[2])}`;
        }
        m = /^(1) (.*)$/.exec(line);
        if (m) {
            return `${span('ty', m[1])} ${span('str', m[2])}`;
        }
        m = /^([A-Za-z_][A-Za-z0-9_.]*) (\d+) (\d+) (\d+)$/.exec(line);
        if (m) {
            return `${span('fn', m[1])} ${span('num', m[2])} ${span('num', m[3])} ${span('num', m[4])}`;
        }
        m = /^(-?\d+) (-?\d+) (-?\d+)$/.exec(line);
        if (m) {
            return `${span('op', m[1])} ${span('num', m[2])} ${span('num', m[3])}`;
        }
        if (/^\d+$/.test(line)) {
            return span('num', line);
        }
        return escapeHtml(line);
    }
    // assembly
    let m = /^=== (.*) ===$/.exec(line);
    if (m) {
        return `${span('sec', '===')} ${span('sec', m[1])} ${span('sec', '===')}`;
    }
    m = /^(\s*)\[(\d+)\]\s+([A-Za-z_][A-Za-z0-9_.]*)\s+(addr=)(\d+)\s+(params=)(\d+)\s+(locals=)(\d+)\s*$/.exec(line);
    if (m) {
        return `${m[1]}${span('br', '[')}${span('idx', m[2])}${span('br', ']')} ` +
            `${span('fn', m[3])} ${span('fld', m[4])}${span('num', m[5])} ` +
            `${span('fld', m[6])}${span('num', m[7])} ${span('fld', m[8])}${span('num', m[9])}`;
    }
    m = /^(\s*)\[(\d+)\]\s+(-?\d+)\s*$/.exec(line);
    if (m) {
        return `${m[1]}${span('br', '[')}${span('idx', m[2])}${span('br', ']')} ${span('num', m[3])}`;
    }
    m = /^(\s*)\[(\d+)\]\s+(.*)$/.exec(line);
    if (m) {
        return `${m[1]}${span('br', '[')}${span('idx', m[2])}${span('br', ']')} ${span('str', m[3])}`;
    }
    m = /^(\s*)(\d+)(:)\s+([A-Z_][A-Z_0-9]*)(\s+)(-?\d+)(\s+)(-?\d+)\s*$/.exec(line);
    if (m) {
        return `${m[1]}${span('idx', m[2])}${span('sep', m[3])} ${span('op', m[4])}${m[5]}` +
            `${span('num', m[6])}${m[7]}${span('num', m[8])}`;
    }
    return escapeHtml(line);
}

class MilcDocument implements vscode.CustomDocument {
    constructor(readonly uri: vscode.Uri) {}
    dispose(): void {
        /* nothing to release */
    }
}

/**
 * One open .milc viewer. Tracked so the editor-title-bar buttons can drive it.
 */
interface MilcSession {
    uri: vscode.Uri;
    panel: vscode.WebviewPanel;
    view: MilcView;
    render: () => Promise<void>;
}

const milcSessions = new Map<string, MilcSession>();
let activeMilcUri: string | undefined;
let rememberView: MilcView = 'asm';

/** The viewer the user is currently looking at, if any. */
function currentSession(): MilcSession | undefined {
    if (activeMilcUri) {
        const s = milcSessions.get(activeMilcUri);
        if (s) {
            return s;
        }
    }
    const values = Array.from(milcSessions.values());
    return values.length > 0 ? values[values.length - 1] : undefined;
}

class MilcViewerProvider implements vscode.CustomReadonlyEditorProvider<MilcDocument> {
    openCustomDocument(uri: vscode.Uri): MilcDocument {
        return new MilcDocument(uri);
    }

    async resolveCustomEditor(
        document: MilcDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        const webview = webviewPanel.webview;
        const key = document.uri.toString();

        const session: MilcSession = {
            uri: document.uri,
            panel: webviewPanel,
            view: rememberView,
            render: async () => {
                webview.html = page(document.uri, session.view, null);
                try {
                    const content = await renderMilcView(document.uri.fsPath, session.view);
                    webview.html = page(document.uri, session.view, content);
                } catch (err) {
                    webview.html = page(document.uri, session.view, null, String((err as Error).message));
                }
                void vscode.commands.executeCommand('setContext', 'minilang.milcView', session.view);
            },
        };

        milcSessions.set(key, session);
        activeMilcUri = key;

        // Keep track of which viewer is focused, so the title-bar buttons act on it
        webviewPanel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
                activeMilcUri = key;
                void vscode.commands.executeCommand('setContext', 'minilang.milcView', session.view);
            }
        });

        // Re-render when the .milc is rebuilt on disk
        const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
        const changed = watcher.onDidChange(() => session.render());
        webviewPanel.onDidDispose(() => {
            changed.dispose();
            watcher.dispose();
            milcSessions.delete(key);
            if (activeMilcUri === key) {
                activeMilcUri = undefined;
            }
        });

        await session.render();
    }
}

/** Switch the open viewer to a view — driven from the editor title bar. */
async function setMilcView(view: MilcView) {
    const session = currentSession();
    if (!session) {
        return;
    }
    session.view = view;
    rememberView = view;
    await session.render();
}

/** Re-render the open viewer. */
async function refreshMilcViewer() {
    const session = currentSession();
    if (session) {
        await session.render();
    }
}

/**
 * Make our viewer the editor VS Code uses for .milc. The manifest already asks
 * for `priority: "default"`, but an explicit association wins over any previous
 * choice, so we offer it as a command too.
 */
async function setMilcDefaultEditor() {
    const cfg = vscode.workspace.getConfiguration('workbench');
    const current = cfg.get<Record<string, string>>('editorAssociations') || {};
    const next = Object.assign({}, current, { '*.milc': MILC_VIEWER_TYPE });
    try {
        await cfg.update('editorAssociations', next, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            'minilang bytecode viewer is now the default editor for *.milc.'
        );
    } catch (err) {
        vscode.window.showErrorMessage(`Could not update the association: ${(err as Error).message}`);
    }
}

/** Build the viewer page. No scripts: the buttons live in the editor title bar. */
function page(uri: vscode.Uri, view: MilcView, content: string | null, error?: string): string {
    const name = escapeHtml(path.basename(uri.fsPath));

    let body: string;
    if (error) {
        body = `<pre class="err">${escapeHtml(hintForError(error))}</pre>`;
    } else if (content === null) {
        body = '<pre class="dim">Rendering…</pre>';
    } else {
        body = `<pre class="code">${highlightMilc(content, view)}</pre>`;
    }

    const label = escapeHtml(VIEW_META[view].label);
    const hint = view === 'text'
        ? 'MINILANGBC text form — used by the self-hosting comparison'
        : 'Disassembly with constants, functions and opcode mnemonics';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>${name}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 0; font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    background: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
  }
  .bar {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px;
    padding: 6px 12px; border-bottom: 1px solid var(--vscode-panel-border, transparent);
    background: var(--vscode-editor-background);
  }
  .view { font-weight: 600; }
  .hint { color: var(--vscode-descriptionForeground); font-size: .92em; }
  pre { margin: 0; padding: 10px 12px; white-space: pre; tab-size: 4; }
  pre.code { line-height: 1.45; }
  pre.dim { color: var(--vscode-descriptionForeground); }
  pre.err { color: var(--vscode-errorForeground, #f14c4c); white-space: pre-wrap; }
  .hd  { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)); font-weight: 600; }
  .sec { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)); font-weight: 600; }
  .op  { color: var(--vscode-symbolIcon-keywordForeground, var(--vscode-foreground)); }
  .fn  { color: var(--vscode-symbolIcon-functionForeground, var(--vscode-foreground)); }
  .num { color: var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground)); }
  .idx { color: var(--vscode-symbolIcon-numberForeground, var(--vscode-foreground)); }
  .str { color: var(--vscode-symbolIcon-stringForeground, var(--vscode-foreground)); }
  .ty  { color: var(--vscode-symbolIcon-fieldForeground, var(--vscode-descriptionForeground)); }
  .fld { color: var(--vscode-symbolIcon-fieldForeground, var(--vscode-descriptionForeground)); }
  .br  { color: var(--vscode-descriptionForeground); }
  .sep { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <div class="bar">
    <span class="view">${label}</span>
    <span class="hint">${escapeHtml(hint)}</span>
  </div>
  ${body}
</body>
</html>`;
}

/**
 * The usual cause of a failed render is a `minilang` binary built before
 * bytecode reading existed — it tries to lex the binary as source and reports
 * "Unexpected character". Say so instead of showing a bare compiler error.
 */
function hintForError(message: string): string {
    if (/Unexpected character|Parse error|unexpected token/i.test(message)) {
        return message +
            '\n\nThis is what happens when the minilang executable is older than' +
            ' the extension: it reads .milc as source text instead of bytecode.\n' +
            'Run "make" in the minilang repository, or point minilang.path at the rebuilt binary.';
    }
    return message;
}

// ============================================================================
// Activation
// ============================================================================

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
    context.subscriptions.push(outputChannel);

    // ---- Language server (minilang-server) -------------------------------
    const useServer = vscode.workspace.getConfiguration('minilang').get<boolean>('useLanguageServer', true);
    if (useServer) {
        const serverModule = resolveServerModule(context);
        if (serverModule) {
            const serverOptions: ServerOptions = {
                run: { module: serverModule, transport: TransportKind.stdio },
                debug: { module: serverModule, transport: TransportKind.stdio },
            };
            const clientOptions: LanguageClientOptions = {
                documentSelector: [{ scheme: 'file', language: 'minilang' }],
                synchronize: { configurationSection: 'minilang' },
                initializationOptions: {},
            };
            lcClient = new LanguageClient('minilang-server', 'minilang Language Server', serverOptions, clientOptions);
            lcClient.start();
            context.subscriptions.push(lcClient);
        } else {
            vscode.window.showWarningMessage(
                'minilang language server not found (set minilang.serverPath); falling back to built-in providers.'
            );
        }
    }

    diagnosticCollection = vscode.languages.createDiagnosticCollection('minilang');
    context.subscriptions.push(diagnosticCollection);

    // .milc viewer
    milcProvider = new MilcFileSystemProvider();
    context.subscriptions.push(
        milcProvider,
        vscode.window.registerCustomEditorProvider(MILC_VIEWER_TYPE, new MilcViewerProvider()),
        vscode.workspace.registerFileSystemProvider(MILC_TEXT_SCHEME, milcProvider, {
            isCaseSensitive: true,
            isReadonly: true,
        }),
        vscode.workspace.registerFileSystemProvider(MILC_ASM_SCHEME, milcProvider, {
            isCaseSensitive: true,
            isReadonly: true,
        })
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('minilang.milcShowText', () => setMilcView('text')),
        vscode.commands.registerCommand('minilang.milcShowAsm', () => setMilcView('asm')),
        vscode.commands.registerCommand('minilang.milcRefreshViewer', refreshMilcViewer),
        vscode.commands.registerCommand('minilang.setMilcDefaultEditor', setMilcDefaultEditor),
        vscode.commands.registerCommand('minilang.openMilc', commandOpenMilc),
        vscode.commands.registerCommand('minilang.openMilcText', (uri?: vscode.Uri) =>
            commandOpenMilcView('text', uri)
        ),
        vscode.commands.registerCommand('minilang.openMilcAsm', (uri?: vscode.Uri) =>
            commandOpenMilcView('asm', uri)
        ),
        vscode.commands.registerCommand('minilang.refreshMilc', commandRefreshMilc),
        vscode.commands.registerCommand('minilang.runTerminal', commandRunTerminal),
        vscode.commands.registerCommand('minilang.repl', commandRepl),
        vscode.commands.registerCommand('minilang.run', commandRun),
        vscode.commands.registerCommand('minilang.bytecode', commandBytecode),
        vscode.commands.registerCommand('minilang.dumpText', commandDumpText),
        vscode.commands.registerCommand('minilang.llvm', commandLlvm),
        vscode.commands.registerCommand('minilang.buildBytecode', commandBuildBytecode),
        vscode.commands.registerCommand('minilang.buildNative', commandBuildNative),
        vscode.commands.registerCommand('minilang.runTests', commandRunTests),
        vscode.commands.registerCommand('minilang.validateNow', async () => {
            const doc = vscode.window.activeTextEditor?.document;
            if (doc) {
                await validate(doc);
            }
        })
    );

    // Language features
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(MIL_SELECTOR, new MilHoverProvider()),
        vscode.languages.registerCompletionItemProvider(MIL_SELECTOR, new MilCompletionProvider()),
        vscode.languages.registerSignatureHelpProvider(MIL_SELECTOR, new MilSignatureProvider(), '(', ','),
        vscode.languages.registerDefinitionProvider(MIL_SELECTOR, new MilDefinitionProvider())
    );

    // Diagnostics on open / change (debounced) / save
    const timer = new Map<string, NodeJS.Timeout>();
    const schedule = (doc: vscode.TextDocument) => {
        if (doc.languageId !== 'minilang') {
            return;
        }
        const key = doc.uri.toString();
        const existing = timer.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        timer.set(
            key,
            setTimeout(() => validate(doc), 600)
        );
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(schedule),
        vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
        vscode.workspace.onDidSaveTextDocument((doc) => validate(doc)),
        vscode.workspace.onDidCloseTextDocument((doc) => {
            diagnosticCollection.delete(doc.uri);
            const key = doc.uri.toString();
            const t = timer.get(key);
            if (t) {
                clearTimeout(t);
                timer.delete(key);
            }
        })
    );

    // Validate whatever is already open
    for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'minilang') {
            validate(doc);
        }
    }

    // If no language server is running, make sure a usable minilang binary
    // exists; otherwise diagnostics will silently produce nothing.
    if (!lcClient) {
        void (async () => {
            try {
                const exe = resolveMinilang()!;
                const probe = await run(exe, [], workingDirectory());
                if (probe.code === -1) {
                    throw new Error(`could not launch "${exe}"`);
                }
            } catch (err) {
                warnOnce(
                    `minilang binary not found (${(err as Error).message}) — code diagnostics are ` +
                    `disabled. Build the toolchain from minilang-boot and set minilang.path in ` +
                    `settings, or add the binary to PATH.`
                );
            }
        })();
    }

    // Status bar hint
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.text = '$(play) minilang';
    status.tooltip = 'Run the current .mil file in the terminal (Ctrl+F5 / Cmd+F5)';
    status.command = 'minilang.runTerminal';
    const updateStatus = () => {
        if (activeMilFile()) {
            status.show();
        } else {
            status.hide();
        }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatus));
    context.subscriptions.push(status);
    updateStatus();
}

export async function deactivate() {
    if (lcClient) {
        await lcClient.stop();
    }
    if (outputChannel) {
        outputChannel.dispose();
    }
    if (diagnosticCollection) {
        diagnosticCollection.dispose();
    }
}

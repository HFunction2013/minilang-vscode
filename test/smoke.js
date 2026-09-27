// Smoke test: load the compiled extension with a mocked `vscode` module and
// drive it against the real minilang binary.
const path = require('path');
const fs = require('fs');
const Module = require('module');

const EXT = process.env.MINILANG_EXT || path.resolve(__dirname, '..', 'out', 'extension.js');

// The compiler lives in its own repository now, so look for the binary in a few
// sensible places instead of assuming a fixed sibling path.
function findMinilang() {
    if (process.env.MINILANG_BIN) { return process.env.MINILANG_BIN; }
    const candidates = [
        path.resolve(__dirname, '..', 'minilang'),               // copied next door
        path.resolve(__dirname, '..', '..', 'minilang-compiler', 'minilang'),
        path.resolve(__dirname, '..', '..', 'minilang', 'minilang'),
    ];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c) && fs.statSync(c).isFile()) { return c; }
        } catch (e) { /* keep looking */ }
    }
    // fall back to whatever is on PATH
    const which = require('child_process').spawnSync('which', ['minilang'], { encoding: 'utf8' });
    if (which.status === 0 && which.stdout.trim()) { return which.stdout.trim(); }
    return path.resolve(__dirname, '..', 'minilang');
}
const MIL = findMinilang();
const realResolve = Module._resolveFilename;

// ---- mock vscode -----------------------------------------------------------
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b, c, d) {
    if (typeof a === 'number') { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; } } }
class Uri { constructor(fsPath, scheme) { this.fsPath = fsPath; this.scheme = scheme || 'file'; this.path = fsPath; }
    static file(p) { return new Uri(p); }
    with(change) { return new Uri(this.fsPath, change.scheme || this.scheme); }
    toString() { return this.scheme + '://' + this.fsPath; } }
class MarkdownString { constructor(v) { this.value = v || ''; }
    appendCodeblock(s) { this.value += '\n```\n' + s + '\n```\n'; return this; }
    appendMarkdown(s) { this.value += s; return this; } }
class Hover { constructor(contents) { this.contents = contents; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
class SignatureInformation { constructor(label, doc) { this.label = label; this.documentation = doc; } }
class SignatureHelp { constructor() { this.signatures = []; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }

const settings = {
    'minilang.path': MIL,
    'minilang.workingDirectory': '',
    'minilang.diagnostics.enable': true,
    'minilang.diagnostics.unsaved': true,
};

const registered = new Map();
let quickPickAnswer = 0;      // index (or fn) chosen in showQuickPick
let milcFiles = [];           // workspace .milc files
let openedContent = '';       // content of the opened virtual doc
const contexts = {};      // setContext values
let configUpdates = [];   // workbench.editorAssociations writes
const diagnostics = new Map();
const outputLines = [];
let terminalCommand = null;

const vscodeMock = {
    Position, Range, Uri, MarkdownString, Hover, Diagnostic, CompletionItem,
    SignatureInformation, SignatureHelp, Location,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    CompletionItemKind: { Function: 2, Keyword: 13, Value: 11, Module: 8 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
        createOutputChannel: () => ({
            appendLine: (s) => outputLines.push(s),
            append: (s) => outputLines.push(s),
            clear: () => outputLines.length = 0,
            show: () => undefined,
            dispose: () => undefined,
        }),
        createStatusBarItem: () => ({ show(){}, hide(){}, dispose(){}, text:'', tooltip:'', command:'' }),
        createTerminal: () => ({ show(){}, sendText: (t) => { terminalCommand = t; } }),
        showErrorMessage: (m) => outputLines.push('[error] ' + m),
        showWarningMessage: (m) => outputLines.push('[warn] ' + m),
        showInformationMessage: (m) => outputLines.push('[info] ' + m),
        activeTextEditor: undefined,
        onDidChangeActiveTextEditor: () => ({ dispose(){} }),
        showQuickPick: async (items) => quickPickAnswer ? (typeof quickPickAnswer === 'function' ? quickPickAnswer(items) : items[quickPickAnswer]) : items[0],
        showTextDocument: async (doc) => ({ document: doc }),
        registerCustomEditorProvider: (viewType, provider) => { registered.set('customEditor:' + viewType, provider); return { dispose(){} }; },
    },
    workspace: {
        workspaceFolders: [{ uri: Uri.file(path.dirname(MIL)) }],
        textDocuments: [],
        getConfiguration: (section) => ({
            get: (k, d) => {
                const full = section ? `${section}.${k}` : k;
                return full in settings ? settings[full] : d;
            },
            update: async (key, value) => { configUpdates.push([section || 'workbench', key, JSON.parse(JSON.stringify(value))]); },
        }),
        registerFileSystemProvider: (scheme, provider) => { registered.set('fs:' + scheme, provider); return { dispose(){} }; },
        findFiles: async () => milcFiles.map((f) => Uri.file(f)),
        openTextDocument: async (uri) => ({ uri, languageId: 'plaintext', getText: () => openedContent }),
        createFileSystemWatcher: () => ({ onDidChange: () => ({ dispose(){} }), onDidCreate: () => ({ dispose(){} }), onDidDelete: () => ({ dispose(){} }), dispose(){} }),
        onDidOpenTextDocument: () => ({ dispose(){} }),
        onDidChangeTextDocument: () => ({ dispose(){} }),
        onDidSaveTextDocument: () => ({ dispose(){} }),
        onDidCloseTextDocument: () => ({ dispose(){} }),
    },
    languages: {
        setTextDocumentLanguage: async (doc, lang) => { doc.languageId = lang; return doc; },
        createDiagnosticCollection: () => ({
            set: (uri, diags) => diagnostics.set(uri.fsPath, diags),
            delete: (uri) => diagnostics.delete(uri.fsPath),
            dispose(){},
        }),
        registerHoverProvider: (sel, p) => { registered.set('hover', p); return { dispose(){} }; },
        registerCompletionItemProvider: (sel, p) => { registered.set('completion', p); return { dispose(){} }; },
        registerSignatureHelpProvider: (sel, p) => { registered.set('signature', p); return { dispose(){} }; },
        registerDefinitionProvider: (sel, p) => { registered.set('definition', p); return { dispose(){} }; },
    },
    commands: {
        registerCommand: (id, handler) => { registered.set(id, handler); return { dispose(){} }; },
        executeCommand: async (id, ...args) => { if (id === 'setContext') { contexts[args[0]] = args[1]; } return undefined; },
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    FilePermission: { Readonly: 1 },
    FileChangeType: { Changed: 1, Created: 2, Deleted: 3 },
    EventEmitter: class { constructor(){ this.handlers = []; }
        get event() { return (h) => { this.handlers.push(h); return { dispose(){} }; }; }
        fire(e) { this.handlers.forEach(h => h(e)); }
        dispose(){} },
    Disposable: class { constructor(fn) { this.fn = fn; } dispose() { if (this.fn) { this.fn(); } } },
    FileSystemError: { Unavailable: (m) => Object.assign(new Error(m), { code: 'Unavailable' }),
                       NoPermissions: (m) => Object.assign(new Error(m || 'NoPermissions'), { code: 'NoPermissions' }) },
};

Module._resolveFilename = function (request, ...rest) {
    if (request === 'vscode') { return 'vscode'; }
    return realResolve.call(this, request, ...rest);
};
require.cache['vscode'] = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeMock };

// ---- fake document ---------------------------------------------------------
function makeDoc(fsPath, text, dirty) {
    const lines = text.split('\n');
    return {
        uri: Uri.file(fsPath),
        languageId: 'minilang',
        isDirty: !!dirty,
        getText: (range) => {
            if (!range) { return text; }
            const offsetOf = (pos) => {
                let o = 0;
                for (let i = 0; i < pos.line && i < lines.length; i++) { o += lines[i].length + 1; }
                return o + pos.character;
            };
            return text.substring(offsetOf(range.start), offsetOf(range.end));
        },
        save: async () => undefined,
        lineAt: (i) => ({ text: lines[i] }),
        positionAt: (offset) => {
            let remaining = offset;
            for (let i = 0; i < lines.length; i++) {
                if (remaining <= lines[i].length) { return new Position(i, remaining); }
                remaining -= lines[i].length + 1;
            }
            return new Position(lines.length - 1, 0);
        },
        getWordRangeAtPosition: (pos) => {
            const line = lines[pos.line] || '';
            const before = line.slice(0, pos.character);
            const m = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before);
            if (!m) { return undefined; }
            return new Range(new Position(pos.line, m.index), new Position(pos.line, m.index + m[0].length));
        },
    };
}

// ---- run -------------------------------------------------------------------
const ext = require(EXT);
ext.activate({ subscriptions: [] });

const cases = [
    {
        name: 'syntax error (line 2)',
        text: 'func main() {\n  var x = ;\n  return 0;\n}\n',
        expectLine: 1,
        expectText: /unexpected token/,
    },
    {
        name: 'undefined function',
        text: 'func main() {\n  foo(1);\n  return 0;\n}\n',
        expectLine: 1,
        expectText: /undefined function 'foo'/,
    },
    {
        name: 'undefined variable',
        text: 'func main() {\n  var y = zzz;\n  return 0;\n}\n',
        expectLine: 1,
        expectText: /undefined variable 'zzz'/,
    },
    {
        name: 'missing module',
        text: 'require nope;\nfunc main() { return 0; }\n',
        expectLine: 0,
        expectText: /cannot find module 'nope'/,
    },
    {
        name: 'clean file',
        text: 'func main() {\n  println "ok";\n  return 0;\n}\n',
        expectLine: -1,
        expectText: null,
    },
];

(async () => {
    let pass = 0, fail = 0;
    const tmpDir = path.join(require('os').tmpdir(), 'minilang-vscode-smoke');
    fs.mkdirSync(tmpDir, { recursive: true });

    for (const c of cases) {
        const file = path.join(tmpDir, 'case.mil');
        fs.writeFileSync(file, c.text);
        const doc = makeDoc(file, c.text, true); // dirty -> buffer staging path
        vscodeMock.window.activeTextEditor = { document: doc };
        await registered.get('minilang.validateNow')();
        const diags = diagnostics.get(file) || [];
        if (c.expectLine < 0) {
            if (diags.length === 0) { console.log(`PASS  ${c.name}: no diagnostics`); pass++; }
            else { console.log(`FAIL  ${c.name}: expected none, got ${JSON.stringify(diags.map(d => [d.range.start.line, d.message]))}`); fail++; }
        } else if (diags.length === 1 && diags[0].range.start.line === c.expectLine && c.expectText.test(diags[0].message)) {
            console.log(`PASS  ${c.name}: line ${diags[0].range.start.line}: ${diags[0].message}`);
            pass++;
        } else {
            console.log(`FAIL  ${c.name}: got ${JSON.stringify(diags.map(d => [d.range.start.line, d.message]))}`);
            fail++;
        }
        // temp staging file must be cleaned up
        const leftovers = fs.readdirSync(tmpDir).filter((f) => f.startsWith('.minilang-lint'));
        if (leftovers.length) { console.log(`FAIL  ${c.name}: temp file left behind: ${leftovers}`); fail++; }
    }

    // Run in terminal should send a command to the terminal
    const okFile = path.join(tmpDir, 'ok.mil');
    fs.writeFileSync(okFile, 'func main() {\n  println "hi";\n  return 0;\n}\n');
    vscodeMock.window.activeTextEditor = { document: makeDoc(okFile, '', false) };
    await registered.get('minilang.runTerminal')();
    if (terminalCommand && terminalCommand.includes('run') && terminalCommand.includes('ok.mil')) {
        console.log(`PASS  runTerminal -> ${terminalCommand}`);
        pass++;
    } else {
        console.log(`FAIL  runTerminal -> ${terminalCommand}`);
        fail++;
    }

    // REPL
    terminalCommand = null;
    registered.get('minilang.repl')();
    if (terminalCommand && terminalCommand.endsWith('repl')) { console.log(`PASS  repl -> ${terminalCommand}`); pass++; }
    else { console.log(`FAIL  repl -> ${terminalCommand}`); fail++; }

    // Hover / completion / signature / definition providers registered
    for (const k of ['hover', 'completion', 'signature', 'definition']) {
        if (registered.has(k)) { console.log(`PASS  provider registered: ${k}`); pass++; }
        else { console.log(`FAIL  provider missing: ${k}`); fail++; }
    }

    // Hover on json.parse
    const hoverDoc = makeDoc(path.join(tmpDir, 'h.mil'), 'require json;\nvar v = json.parse(s);\n', false);
    const h = registered.get('hover').provideHover(hoverDoc, new Position(1, 12));
    if (h && h.contents.value.includes('json.parse(text)')) { console.log('PASS  hover json.parse'); pass++; }
    else { console.log('FAIL  hover json.parse -> ' + (h && h.contents.value)); fail++; }

    // Completion after "json."
    const compDoc = makeDoc(path.join(tmpDir, 'c.mil'), 'var v = json.', false);
    const items = registered.get('completion').provideCompletionItems(compDoc, new Position(0, 13));
    if (items.length > 20 && items.every((i) => i.label)) { console.log(`PASS  completion json. -> ${items.length} items`); pass++; }
    else { console.log(`FAIL  completion json. -> ${items.length}`); fail++; }

    // Completion after "require "
    const reqDoc = makeDoc(path.join(tmpDir, 'r.mil'), 'require ', false);
    const mods = registered.get('completion').provideCompletionItems(reqDoc, new Position(0, 8));
    if (mods.length === 8 && mods.some((m) => m.label === 'json')) { console.log(`PASS  completion require -> ${mods.map(m=>m.label).join(',')}`); pass++; }
    else { console.log(`FAIL  completion require -> ${JSON.stringify(mods.map(m=>m.label))}`); fail++; }

    // Signature help
    const sigDoc = makeDoc(path.join(tmpDir, 's.mil'), 'var v = json.get(a, ', false);
    const sig = registered.get('signature').provideSignatureHelp(sigDoc, new Position(0, 20));
    if (sig && sig.activeParameter === 1) { console.log(`PASS  signature help (activeParameter=${sig.activeParameter})`); pass++; }
    else { console.log(`FAIL  signature help -> ${JSON.stringify(sig && {s: sig.signatures[0] && sig.signatures[0].label, p: sig.activeParameter})}`); fail++; }

    // Go to definition for a local function
    const defDoc = makeDoc(path.join(tmpDir, 'd.mil'), 'func target() { return 1; }\nfunc main() { return target(); }\n', false);
    const loc = registered.get('definition').provideDefinition(defDoc, new Position(1, 27));
    const locLine = loc && loc.length ? (loc[0].range.start ? loc[0].range.start.line : loc[0].range.line) : -1;
    if (locLine === 0) { console.log('PASS  go to definition -> line 0'); pass++; }
    else { console.log('FAIL  go to definition -> ' + JSON.stringify(loc)); fail++; }

    // ---------- .milc viewer ----------
    const { execFileSync } = require('child_process');
    const helloMil = path.join(tmpDir, 'hello.mil');
    const milc = path.join(tmpDir, 'hello.milc');
    fs.writeFileSync(helloMil, 'func main() {\n  println "hi";\n  return 0;\n}\n');
    // build the .milc with the real toolchain
    execFileSync(MIL, ['build', '-b', helloMil], { cwd: path.dirname(MIL) });
    if (fs.existsSync(milc)) { console.log('PASS  built .milc for viewer test'); pass++; }
    else { console.log('FAIL  built .milc for viewer test'); fail++; }

    const textProvider = registered.get('fs:milc-text');
    const asmProvider = registered.get('fs:milc-asm');
    if (textProvider && asmProvider) { console.log('PASS  both milc schemes registered'); pass++; }
    else { console.log('FAIL  milc schemes registered'); fail++; }

    // text view
    const textUri = Uri.file(milc).with({ scheme: 'milc-text' });
    const textBytes = await textProvider.readFile(textUri);
    const textOut = Buffer.from(textBytes).toString('utf8');
    if (textOut.startsWith('MINILANGBC\n')) { console.log('PASS  milc-text renders MINILANGBC'); pass++; }
    else { console.log('FAIL  milc-text -> ' + JSON.stringify(textOut.slice(0, 60))); fail++; }
    const expectedText = execFileSync(MIL, ['dump-text', milc], { cwd: path.dirname(MIL) }).toString();
    if (textOut.trim() === expectedText.trim()) { console.log('PASS  milc-text matches CLI dump-text'); pass++; }
    else { console.log('FAIL  milc-text differs from CLI'); fail++; }

    // asm view
    const asmUri = Uri.file(milc).with({ scheme: 'milc-asm' });
    const asmOut = Buffer.from(await asmProvider.readFile(asmUri)).toString('utf8');
    if (asmOut.startsWith('=== Constants')) { console.log('PASS  milc-asm renders disassembly'); pass++; }
    else { console.log('FAIL  milc-asm -> ' + JSON.stringify(asmOut.slice(0, 60))); fail++; }
    const expectedAsm = execFileSync(MIL, ['bytecode', milc], { cwd: path.dirname(MIL) }).toString();
    if (asmOut.trim() === expectedAsm.trim()) { console.log('PASS  milc-asm matches CLI bytecode'); pass++; }
    else { console.log('FAIL  milc-asm differs from CLI'); fail++; }

    // stat reports a readonly file of the right size
    const st = await textProvider.stat(textUri);
    if (st.type === 1 && st.size === Buffer.byteLength(textOut) && st.permissions === 1) {
        console.log(`PASS  milc-text stat (size=${st.size}, readonly)`); pass++;
    } else { console.log('FAIL  milc-text stat -> ' + JSON.stringify(st)); fail++; }

    // write/delete are rejected
    let rejected = false;
    try { textProvider.writeFile(textUri, Buffer.from('x'), { create: false, overwrite: false }); }
    catch (e) { rejected = true; }
    if (rejected) { console.log('PASS  milc view is read-only'); pass++; }
    else { console.log('FAIL  milc view accepted a write'); fail++; }

    // openMilc command: pick file, then pick the asm view
    milcFiles = [milc];
    quickPickAnswer = (items) => items.find((i) => i.label === 'Bytecode Assembly') || items[0];
    let openedUri = null;
    vscodeMock.workspace.openTextDocument = async (uri) => { openedUri = uri; return { uri, languageId: 'plaintext', getText: () => asmOut }; };
    let shownDoc = null;
    vscodeMock.window.showTextDocument = async (doc) => { shownDoc = doc; return { document: doc }; };
    await registered.get('minilang.openMilc')();
    if (openedUri && openedUri.scheme === 'milc-asm') { console.log(`PASS  openMilc -> ${openedUri.scheme}`); pass++; }
    else { console.log('FAIL  openMilc -> ' + JSON.stringify(openedUri)); fail++; }
    if (shownDoc && shownDoc.languageId === 'minilang-bcasm') { console.log('PASS  openMilc sets the assembly grammar'); pass++; }
    else { console.log('FAIL  openMilc language -> ' + JSON.stringify(shownDoc && shownDoc.languageId)); fail++; }

    // openMilcText / openMilcAsm invoked from the explorer context menu
    for (const [cmd, scheme, lang] of [['minilang.openMilcText', 'milc-text', 'minilang-bctext'],
                                       ['minilang.openMilcAsm', 'milc-asm', 'minilang-bcasm']]) {
        openedUri = null; shownDoc = null;
        await registered.get(cmd)(Uri.file(milc));
        if (openedUri && openedUri.scheme === scheme && shownDoc && shownDoc.languageId === lang) {
            console.log(`PASS  ${cmd} -> ${scheme} / ${lang}`); pass++;
        } else { console.log(`FAIL  ${cmd} -> ${JSON.stringify(openedUri && openedUri.scheme)}`); fail++; }
    }

    // refresh fires a change event on the provider
    let fired = null;
    textProvider.onDidChangeFile((e) => { fired = e; });
    vscodeMock.window.activeTextEditor = { document: { uri: textUri } };
    registered.get('minilang.refreshMilc')();
    if (fired && fired.length && fired[0].uri.scheme === 'milc-text') { console.log('PASS  refreshMilc fires change event'); pass++; }
    else { console.log('FAIL  refreshMilc -> ' + JSON.stringify(fired)); fail++; }

    // ---------- .milc custom editor (double-click path) ----------
    const provider = registered.get('customEditor:minilang.milcViewer');
    if (provider) { console.log('PASS  custom editor registered (viewType minilang.milcViewer)'); pass++; }
    else { console.log('FAIL  custom editor not registered'); fail++; }

    const makePanel = () => {
        const handlers = [];
        return {
            panel: {
                webview: {
                    options: {},
                    cspSource: 'vscode-webview:',
                    html: '',
                    onDidReceiveMessage: (h) => { handlers.push(h); return { dispose(){} }; },
                    postMessage: async () => undefined,
                },
                onDidDispose: () => ({ dispose(){} }),
                onDidChangeViewState: () => ({ dispose(){} }),
            },
            handlers,
        };
    };
    const decodeHtml = (html) => html
        .replace(/[\s\S]*?<pre class="code">/, '')
        .replace(/<\/pre>[\s\S]*$/, '')
        .replace(/<span class="[a-z]+">/g, '')
        .replace(/<\/span>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

    const doc = provider.openCustomDocument(Uri.file(milc));
    if (doc && doc.uri && doc.uri.fsPath === milc) { console.log('PASS  openCustomDocument returns the .milc document'); pass++; }
    else { console.log('FAIL  openCustomDocument -> ' + JSON.stringify(doc)); fail++; }

    let { panel } = makePanel();
    await provider.resolveCustomEditor(doc, panel);
    if (decodeHtml(panel.webview.html).includes('=== Constants')) {
        console.log('PASS  default view renders Bytecode Assembly'); pass++;
    } else { console.log('FAIL  default view -> ' + panel.webview.html.slice(0, 200)); fail++; }

    // the view-switching controls live in the editor title bar, not the webview
    if (!panel.webview.html.includes('<script')) { console.log('PASS  webview has no script (buttons are in the title bar)'); pass++; }
    else { console.log('FAIL  webview still carries a script'); fail++; }
    if (panel.webview.html.includes('Bytecode Assembly') && panel.webview.html.includes('<span class="view">')) {
        console.log('PASS  webview shows the current view label'); pass++;
    } else { console.log('FAIL  view label missing'); fail++; }
    if (registered.has('minilang.milcShowText') && registered.has('minilang.milcShowAsm') && registered.has('minilang.milcRefreshViewer')) {
        console.log('PASS  title-bar commands registered'); pass++;
    } else { console.log('FAIL  title-bar commands missing'); fail++; }
    if (contexts['minilang.milcView'] === 'asm') { console.log('PASS  context tracks the current view (asm)'); pass++; }
    else { console.log('FAIL  context -> ' + JSON.stringify(contexts)); fail++; }

    // the title-bar button switches to Text Bytecode
    await registered.get('minilang.milcShowText')();
    if (decodeHtml(panel.webview.html).includes('MINILANGBC')) {
        console.log('PASS  Show Text Bytecode re-renders the viewer'); pass++;
    } else { console.log('FAIL  switch to text -> ' + panel.webview.html.slice(0, 160)); fail++; }
    if (contexts['minilang.milcView'] === 'text') { console.log('PASS  context updated to text'); pass++; }
    else { console.log('FAIL  context -> ' + JSON.stringify(contexts)); fail++; }

    // rendered content matches the CLI exactly
    const cliText = execFileSync(MIL, ['dump-text', milc], { cwd: path.dirname(MIL) }).toString();
    if (decodeHtml(panel.webview.html).trim() === cliText.trim()) {
        console.log('PASS  webview content matches CLI dump-text'); pass++;
    } else { console.log('FAIL  webview content differs'); fail++; }

    // refresh keeps the current view
    await registered.get('minilang.milcRefreshViewer')();
    if (decodeHtml(panel.webview.html).includes('MINILANGBC')) { console.log('PASS  refresh keeps the current view'); pass++; }
    else { console.log('FAIL  refresh -> ' + panel.webview.html.slice(0, 160)); fail++; }

    // switch back
    await registered.get('minilang.milcShowAsm')();
    if (decodeHtml(panel.webview.html).includes('=== Constants')) { console.log('PASS  Show Bytecode Assembly switches back'); pass++; }
    else { console.log('FAIL  switch back -> ' + panel.webview.html.slice(0, 160)); fail++; }

    // a new document remembers the view used last
    ({ panel } = makePanel());
    const doc2 = provider.openCustomDocument(Uri.file(milc + '2'));
    fs.copyFileSync(milc, milc + '2');
    await provider.resolveCustomEditor(doc2, panel);
    if (decodeHtml(panel.webview.html).includes('=== Constants')) { console.log('PASS  last view is remembered across documents'); pass++; }
    else { console.log('FAIL  last view not remembered'); fail++; }

    // "make this the default editor" writes workbench.editorAssociations
    configUpdates = [];
    await registered.get('minilang.setMilcDefaultEditor')();
    const wrote = configUpdates.find((u) => u[1] === 'editorAssociations');
    if (wrote && wrote[2]['*.milc'] === 'minilang.milcViewer') {
        console.log(`PASS  default-editor command writes *.milc -> ${wrote[2]['*.milc']}`); pass++;
    } else { console.log('FAIL  association -> ' + JSON.stringify(configUpdates)); fail++; }

    // a corrupt .milc shows an error instead of blowing up
    const bad = path.join(tmpDir, 'bad.milc');
    fs.writeFileSync(bad, 'not bytecode at all');
    const badDoc = provider.openCustomDocument(Uri.file(bad));
    ({ panel } = makePanel());
    await provider.resolveCustomEditor(badDoc, panel);
    if (panel.webview.html.includes('not a readable .milc')) { console.log('PASS  corrupt .milc shows an error message'); pass++; }
    else { console.log('FAIL  corrupt .milc -> ' + panel.webview.html.slice(0, 200)); fail++; }

    // a stale minilang binary gets an actionable hint instead of a bare lexer error.
    // We simulate it by pointing minilang.path at a binary that cannot read .milc.
    settings['minilang.path'] = path.join(tmpDir, 'stale-minilang');
    fs.writeFileSync(path.join(tmpDir, 'stale-minilang'),
        '#!/bin/sh\necho "Unexpected character X at line 1" >&2\nexit 1\n', { mode: 0o755 });
    ({ panel } = makePanel());
    await provider.resolveCustomEditor(badDoc, panel);
    if (/Run "make"/.test(panel.webview.html) && /older than/.test(panel.webview.html)) {
        console.log('PASS  stale-binary error suggests running make'); pass++;
    } else { console.log('FAIL  no stale-binary hint -> ' + panel.webview.html.slice(-300)); fail++; }
    settings['minilang.path'] = MIL;

    // HTML escaping: a file name with markup must not inject tags
    const tricky = path.join(tmpDir, 'a<b>&c.milc');
    fs.copyFileSync(milc, tricky);
    const trickyDoc = provider.openCustomDocument(Uri.file(tricky));
    ({ panel } = makePanel());
    await provider.resolveCustomEditor(trickyDoc, panel);
    if (!panel.webview.html.includes('<b>') && panel.webview.html.includes('a&lt;b&gt;&amp;c.milc')) {
        console.log('PASS  file name is HTML-escaped'); pass++;
    } else { console.log('FAIL  escaping -> ' + (panel.webview.html.match(/a<[^)]{0,20}/) || ['none'])[0]); fail++; }

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
})();

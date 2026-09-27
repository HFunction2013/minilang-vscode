// Metadata for minilang built-in functions and syslib modules.
// Used by hover, completion and signature help.

export interface BuiltinDoc {
    name: string;
    signature: string;
    detail: string;
    doc: string;
}

export const BUILTINS: BuiltinDoc[] = [
    {
        name: 'len',
        signature: 'len(s)',
        detail: 'length of a string or array',
        doc: 'Returns the number of characters in a string, or the number of elements in an array.',
    },
    {
        name: 'charAt',
        signature: 'charAt(s, i)',
        detail: 'character code at index i',
        doc: 'Returns the byte value (0-255) of the character at index `i`. Returns 0 when out of range.',
    },
    {
        name: 'substr',
        signature: 'substr(s, start, len)',
        detail: 'substring',
        doc: 'Returns up to `len` characters of `s` starting at `start`. Both are clamped to the string bounds.',
    },
    {
        name: 'toString',
        signature: 'toString(v)',
        detail: 'convert to string',
        doc: 'Converts an int to its decimal text. Strings pass through, nil becomes `"nil"`, arrays become `"<array>"`.',
    },
    {
        name: 'toInt',
        signature: 'toInt(s)',
        detail: 'convert to int',
        doc: 'Parses a string as an integer. Ints pass through unchanged.',
    },
    {
        name: 'strcmp',
        signature: 'strcmp(a, b)',
        detail: 'compare two strings',
        doc: 'Returns 0 when equal, a negative value when `a < b`, a positive value when `a > b`.',
    },
    {
        name: 'readAll',
        signature: 'readAll()',
        detail: 'read all of stdin',
        doc: 'Reads the entire standard input and returns it as a string.',
    },
    {
        name: 'array',
        signature: 'array(size, init)',
        detail: 'create an array',
        doc: 'Creates an array of `size` elements, each set to `init`. Arrays have a fixed size once created.',
    },
    {
        name: 'argc',
        signature: 'argc()',
        detail: 'argument count',
        doc: 'Number of command-line arguments passed to the program.',
    },
    {
        name: 'argv',
        signature: 'argv(i)',
        detail: 'argument at index i',
        doc: 'Returns command-line argument `i` as a string. Indices run from 0 to argc()-1.',
    },
    {
        name: 'readFile',
        signature: 'readFile(path)',
        detail: 'read a file to a string',
        doc: 'Reads a whole file. Note the contents are cut off at the first NUL byte.',
    },
    {
        name: 'readFileBytes',
        signature: 'readFileBytes(path)',
        detail: 'read a file as bytes',
        doc: 'Reads a file and returns an int array with one element (0-255) per byte. Unlike `readFile`, NUL bytes are preserved.',
    },
    {
        name: 'fileExists',
        signature: 'fileExists(path)',
        detail: 'does the file exist',
        doc: 'Returns 1 if the path can be opened, 0 otherwise.',
    },
    {
        name: 'writeFile',
        signature: 'writeFile(path, content)',
        detail: 'write a string to a file',
        doc: 'Writes `content` to `path` and returns 1 on success, 0 on failure.',
    },
    {
        name: 'writeFileBytes',
        signature: 'writeFileBytes(path, bytes)',
        detail: 'write raw bytes to a file',
        doc: 'Writes an int array as raw bytes (each value truncated to 0-255). Returns 1 on success. Used to produce binary `.milc` files.',
    },
    {
        name: 'system',
        signature: 'system(cmd)',
        detail: 'run a shell command',
        doc: 'Executes `cmd` through the shell and returns its exit code.',
    },
    {
        name: 'readLine',
        signature: 'readLine()',
        detail: 'read one line from stdin',
        doc: 'Reads a single line (the newline is stripped). Returns an empty string at end of input.',
    },
    {
        name: 'chr',
        signature: 'chr(n)',
        detail: 'character from byte value',
        doc: 'Returns a one-character string made from the byte value `n`. Useful for building strings byte by byte.',
    },
];

// syslib module documentation: module name -> function list
export interface ModuleDoc {
    name: string;
    detail: string;
    doc: string;
    functions: BuiltinDoc[];
}

const fn = (name: string, signature: string, detail: string, doc: string): BuiltinDoc => ({ name, signature, detail, doc });

export const MODULES: ModuleDoc[] = [
    {
        name: 'math',
        detail: 'integer math',
        doc: 'Integer math. Trigonometric functions take degrees and return values scaled by 1000.',
        functions: [
            fn('abs', 'math.abs(x)', 'absolute value', 'Absolute value of `x`.'),
            fn('min', 'math.min(a, b)', 'smaller of two values', 'Returns the smaller of `a` and `b`.'),
            fn('max', 'math.max(a, b)', 'larger of two values', 'Returns the larger of `a` and `b`.'),
            fn('clamp', 'math.clamp(x, lo, hi)', 'clamp into a range', 'Constrains `x` to the range [lo, hi].'),
            fn('pow', 'math.pow(base, exp)', 'integer power', '`base` raised to `exp`.'),
            fn('gcd', 'math.gcd(a, b)', 'greatest common divisor', 'Greatest common divisor via Euclid.'),
            fn('lcm', 'math.lcm(a, b)', 'least common multiple', 'Least common multiple; 0 when either input is 0.'),
            fn('isEven', 'math.isEven(n)', 'even test', 'Returns 1 when `n` is even.'),
            fn('isOdd', 'math.isOdd(n)', 'odd test', 'Returns 1 when `n` is odd.'),
            fn('sqrt', 'math.sqrt(n)', 'integer square root', 'Floor of the square root, computed with Newton\'s method.'),
            fn('factorial', 'math.factorial(n)', 'n!', 'Factorial of `n`.'),
            fn('fib', 'math.fib(n)', 'nth Fibonacci number', 'Iterative Fibonacci.'),
            fn('cos', 'math.cos(deg)', 'cosine, degrees, x1000', 'Cosine of an angle in degrees, scaled by 1000 (e.g. cos(60) = 500).'),
            fn('sin', 'math.sin(deg)', 'sine, degrees, x1000', 'Sine of an angle in degrees, scaled by 1000.'),
            fn('pi', 'math.pi()', 'pi x1000', 'Returns 3142, i.e. pi scaled by 1000.'),
        ],
    },
    {
        name: 'string',
        detail: 'string utilities',
        doc: 'String helpers. All functions are pure; no I/O.',
        functions: [
            fn('isEmpty', 'string.isEmpty(s)', 'is the string empty', 'Returns 1 when `len(s) == 0`.'),
            fn('startsWith', 'string.startsWith(s, prefix)', 'prefix test', 'Returns 1 when `s` begins with `prefix`.'),
            fn('endsWith', 'string.endsWith(s, suffix)', 'suffix test', 'Returns 1 when `s` ends with `suffix`.'),
            fn('contains', 'string.contains(s, sub)', 'substring test', 'Returns 1 when `sub` occurs anywhere in `s`.'),
            fn('repeat', 'string.repeat(s, n)', 'repeat n times', 'Concatenates `s` with itself `n` times.'),
            fn('countChar', 'string.countChar(s, c)', 'count a byte value', 'Number of times the byte value `c` occurs in `s`.'),
            fn('reverse', 'string.reverse(s)', 'reverse a string', 'Returns `s` with its characters in reverse order.'),
            fn('splitFirst', 'string.splitFirst(s, sep)', 'text before the first separator', 'Returns the part of `s` before the first `sep`, or all of `s` when absent.'),
            fn('trim', 'string.trim(s)', 'strip leading/trailing whitespace', 'Removes whitespace from both ends.'),
            fn('trimLeft', 'string.trimLeft(s)', 'strip leading whitespace', 'Removes whitespace from the start only.'),
            fn('trimRight', 'string.trimRight(s)', 'strip trailing whitespace', 'Removes whitespace from the end only.'),
            fn('split', 'string.split(s, sep)', 'split into an array', 'Splits `s` on every occurrence of `sep` and returns an array of strings.'),
            fn('lines', 'string.lines(s)', 'split into lines', 'Splits on `\\n` and `\\r\\n`, returning an array of lines without the line breaks.'),
            fn('words', 'string.words(s)', 'split on whitespace', 'Splits on runs of whitespace, skipping empty entries.'),
            fn('join', 'string.join(a, sep)', 'join an array of strings', 'Concatenates the array `a`, placing `sep` between elements.'),
            fn('indexOf', 'string.indexOf(s, sub)', 'first occurrence', 'Index of the first occurrence of `sub`, or -1.'),
            fn('lastIndexOf', 'string.lastIndexOf(s, sub)', 'last occurrence', 'Index of the last occurrence of `sub`, or -1.'),
            fn('replace', 'string.replace(s, pat, to)', 'replace all occurrences', 'Replaces every occurrence of `pat` with `to`.'),
            fn('drop', 'string.drop(s, n)', 'remove the first n characters', 'Returns `s` without its first `n` characters.'),
            fn('take', 'string.take(s, n)', 'keep the first n characters', 'Returns the first `n` characters of `s`.'),
            fn('toUpper', 'string.toUpper(s)', 'upper-case ASCII', 'Converts ASCII a-z to A-Z.'),
            fn('toLower', 'string.toLower(s)', 'lower-case ASCII', 'Converts ASCII A-Z to a-z.'),
            fn('capitalize', 'string.capitalize(s)', 'capitalize each word', 'Upper-cases the first letter of every space-separated word.'),
            fn('padLeft', 'string.padLeft(s, n, c)', 'pad on the left', 'Pads `s` with `c` on the left until it is at least `n` characters long.'),
            fn('padRight', 'string.padRight(s, n, c)', 'pad on the right', 'Pads `s` with `c` on the right until it is at least `n` characters long.'),
            fn('isInt', 'string.isInt(s)', 'integer test', 'Returns 1 when `s` is a valid decimal integer, allowing a leading `-`.'),
            fn('isUpper', 'string.isUpper(s)', 'no lower-case letters', 'Returns 1 when `s` is non-empty and has no ASCII lower-case letters.'),
            fn('isLower', 'string.isLower(s)', 'no upper-case letters', 'Returns 1 when `s` is non-empty and has no ASCII upper-case letters.'),
        ],
    },
    {
        name: 'list',
        detail: 'array/list helpers',
        doc: 'Array helpers. Arrays have a fixed size, so growing operations return a new array; in-place helpers return the same one.',
        functions: [
            fn('range', 'list.range(lo, hi)', '[lo, lo+1, ..., hi-1]', 'Builds an ascending int array. Empty when `hi <= lo`.'),
            fn('copy', 'list.copy(a)', 'copy an array', 'Returns a shallow copy of `a`.'),
            fn('push', 'list.push(a, x)', 'append (returns a new array)', 'Returns a new array with `x` appended.'),
            fn('pop', 'list.pop(a)', 'drop the last element', 'Returns a new array without the last element.'),
            fn('first', 'list.first(a)', 'first element', 'First element, or 0 when empty.'),
            fn('last', 'list.last(a)', 'last element', 'Last element, or 0 when empty.'),
            fn('insert', 'list.insert(a, i, x)', 'insert at index', 'Returns a new array with `x` at index `i`. Out-of-range indices append.'),
            fn('remove', 'list.remove(a, i)', 'remove at index', 'Returns a new array without the element at index `i`.'),
            fn('slice', 'list.slice(a, start, end)', 'slice [start, end)', 'Returns a new array holding the half-open range.'),
            fn('concat', 'list.concat(a, b)', 'concatenate', 'Returns a new array holding `a` followed by `b`.'),
            fn('reverse', 'list.reverse(a)', 'reverse (returns a new array)', 'Returns a new array in reverse order.'),
            fn('indexOf', 'list.indexOf(a, x)', 'first matching index', 'Index of the first element equal to `x`, or -1.'),
            fn('lastIndexOf', 'list.lastIndexOf(a, x)', 'last matching index', 'Index of the last element equal to `x`, or -1.'),
            fn('contains', 'list.contains(a, x)', 'membership test', 'Returns 1 when `x` is an element of `a`.'),
            fn('count', 'list.count(a, x)', 'count occurrences', 'Number of elements equal to `x`.'),
            fn('sum', 'list.sum(a)', 'sum of an int array', 'Adds up every element.'),
            fn('min', 'list.min(a)', 'smallest element', 'Smallest element, or 0 when empty.'),
            fn('max', 'list.max(a)', 'largest element', 'Largest element, or 0 when empty.'),
            fn('fill', 'list.fill(n, x)', 'array of n copies', 'Same as the built-in `array(n, x)`.'),
            fn('join', 'list.join(a, sep)', 'join with a separator', 'String.join for arrays of strings.'),
            fn('swap', 'list.swap(a, i, j)', 'swap in place', 'Exchanges elements `i` and `j` and returns `a`.'),
            fn('equal', 'list.equal(a, b)', 'element-wise compare', 'Returns 1 when both arrays have the same length and equal elements.'),
        ],
    },
    {
        name: 'sort',
        detail: 'sorting and searching',
        doc: 'Sorting happens in place and returns the same array, because arrays are shared by reference.',
        functions: [
            fn('ints', 'sort.ints(a)', 'sort ints ascending', 'Quicksort in place.'),
            fn('intsDesc', 'sort.intsDesc(a)', 'sort ints descending', 'Sorts ascending then reverses, in place.'),
            fn('strings', 'sort.strings(a)', 'sort strings ascending', 'Quicksort by strcmp, in place.'),
            fn('insert', 'sort.insert(a)', 'insertion sort', 'Stable insertion sort, fast on nearly sorted arrays.'),
            fn('bsearch', 'sort.bsearch(a, x)', 'binary search in a sorted int array', 'Returns the index of `x`, or -1. Requires `a` to be sorted ascending.'),
            fn('bsearchStr', 'sort.bsearchStr(a, x)', 'binary search in a sorted string array', 'Returns the index of `x`, or -1.'),
            fn('isSorted', 'sort.isSorted(a)', 'is it already sorted', 'Returns 1 when `a` is in ascending order.'),
        ],
    },
    {
        name: 'json',
        detail: 'JSON parse and serialize',
        doc: 'A JSON value is a tagged pair [type, payload]: 0 null, 1 bool, 2 number, 3 string, 4 array, 5 object. Objects are [5, [keys, values]]. Numbers are integers only; a fractional part is truncated and an exponent is ignored.',
        functions: [
            fn('parse', 'json.parse(text)', 'parse JSON text', 'Returns a tagged value. Check `json.ok()` afterwards; on failure `json.error()` holds the message.'),
            fn('ok', 'json.ok()', 'did the last parse succeed', 'Returns 1 when the previous `parse` succeeded.'),
            fn('error', 'json.error()', 'message of the last failure', 'Error text from the last failed parse.'),
            fn('stringify', 'json.stringify(v)', 'compact serialization', 'Serializes a value to compact JSON text.'),
            fn('pretty', 'json.pretty(v, ind)', 'indented serialization', 'Multi-line JSON indented by `ind` spaces per level.'),
            fn('quote', 'json.quote(s)', 'escape as a JSON string', 'Returns `s` as a quoted, escaped JSON string literal.'),
            fn('toStr', 'json.toStr(v)', 'human-readable scalar', 'Number -> digits, string -> raw text, bool -> true/false, null -> empty, container -> compact JSON.'),
            fn('null', 'json.null()', 'a JSON null', 'Constructs a JSON null.'),
            fn('bool', 'json.bool(b)', 'a JSON bool', 'Constructs true or false.'),
            fn('num', 'json.num(n)', 'a JSON number', 'Constructs a JSON number from an int.'),
            fn('str', 'json.str(s)', 'a JSON string', 'Constructs a JSON string.'),
            fn('arr', 'json.arr()', 'an empty JSON array', 'Constructs an empty JSON array; add items with `json.add`.'),
            fn('obj', 'json.obj()', 'an empty JSON object', 'Constructs an empty JSON object; add members with `json.set`.'),
            fn('type', 'json.type(v)', 'type tag', 'Numeric type tag: 0 null, 1 bool, 2 number, 3 string, 4 array, 5 object.'),
            fn('typeName', 'json.typeName(v)', 'type as text', 'Returns "null", "bool", "number", "string", "array" or "object".'),
            fn('isNull', 'json.isNull(v)', 'null test', 'Returns 1 when `v` is JSON null.'),
            fn('isBool', 'json.isBool(v)', 'bool test', 'Returns 1 when `v` is a JSON bool.'),
            fn('isNum', 'json.isNum(v)', 'number test', 'Returns 1 when `v` is a JSON number.'),
            fn('isStr', 'json.isStr(v)', 'string test', 'Returns 1 when `v` is a JSON string.'),
            fn('isArr', 'json.isArr(v)', 'array test', 'Returns 1 when `v` is a JSON array.'),
            fn('isObj', 'json.isObj(v)', 'object test', 'Returns 1 when `v` is a JSON object.'),
            fn('val', 'json.val(v)', 'payload', 'The raw payload of the tagged value.'),
            fn('numVal', 'json.numVal(v)', 'number payload', 'The int payload of a number.'),
            fn('strVal', 'json.strVal(v)', 'string payload', 'The string payload of a JSON string.'),
            fn('boolVal', 'json.boolVal(v)', 'bool payload', '1 for true, 0 for false.'),
            fn('size', 'json.size(v)', 'element or member count', 'Number of array elements, or object members.'),
            fn('at', 'json.at(v, i)', 'array element at index', 'Tagged value at index `i`, or null when out of range.'),
            fn('keys', 'json.keys(v)', 'object keys', 'Array of key strings; empty for non-objects.'),
            fn('values', 'json.values(v)', 'object values', 'Array of tagged values; empty for non-objects.'),
            fn('indexOf', 'json.indexOf(v, k)', 'index of a key', 'Index of key `k`, or -1.'),
            fn('has', 'json.has(v, k)', 'key present test', 'Returns 1 when the object has key `k`.'),
            fn('get', 'json.get(v, k)', 'member by key', 'Tagged value for key `k`, or null when absent.'),
            fn('set', 'json.set(v, k, x)', 'set a member in place', 'Sets or inserts a member and returns `v`.'),
            fn('del', 'json.del(v, k)', 'remove a member', 'Removes key `k` in place and returns `v`.'),
            fn('add', 'json.add(v, item)', 'append to an array', 'Appends a tagged value in place and returns `v`.'),
            fn('getPath', 'json.getPath(v, path)', 'walk a dotted path', 'Walks a dot-separated path such as "users.0.name". Numeric segments index arrays.'),
        ],
    },
    {
        name: 'io',
        detail: 'file and path helpers',
        doc: 'Thin wrappers over readFile / writeFile / fileExists, plus line-based and path-based helpers.',
        functions: [
            fn('read', 'io.read(path)', 'read a file', 'Returns the file text, or "" when the file is missing.'),
            fn('write', 'io.write(path, content)', 'write a file', 'Writes `content` and returns 1 on success.'),
            fn('append', 'io.append(path, content)', 'append to a file', 'Appends `content`, creating the file when needed.'),
            fn('exists', 'io.exists(path)', 'does the file exist', 'Returns 1 when the path can be opened.'),
            fn('readLines', 'io.readLines(path)', 'read lines into an array', 'Returns an array of lines with the line breaks removed.'),
            fn('writeLines', 'io.writeLines(path, lines)', 'write an array of lines', 'Writes one element per line.'),
            fn('appendLine', 'io.appendLine(path, line)', 'append one line', 'Appends `line` followed by a newline.'),
            fn('pathJoin', 'io.pathJoin(a, b)', 'join two path parts', 'Joins with "/" without producing a duplicate separator.'),
            fn('basename', 'io.basename(path)', 'file name part', 'Everything after the last "/".'),
            fn('dirname', 'io.dirname(path)', 'directory part', 'Everything before the last "/", or "." when there is none.'),
            fn('ext', 'io.ext(path)', 'extension with dot', 'Returns ".txt" for "dir/a.txt", "" when there is no dot.'),
            fn('stem', 'io.stem(path)', 'name without extension', 'Returns "a" for "dir/a.txt".'),
            fn('withExt', 'io.withExt(path, newExt)', 'swap the extension', 'Returns "dir/a.md" for ("dir/a.txt", "md").'),
        ],
    },
    {
        name: 'rand',
        detail: 'deterministic pseudo-random numbers',
        doc: 'A linear congruential generator, so the same seed always produces the same sequence.',
        functions: [
            fn('seed', 'rand.seed(n)', 'set the seed', 'Resets the generator; returns the seed actually used.'),
            fn('next', 'rand.next()', 'next raw value', 'Returns a value in [1, 2147483646].'),
            fn('int', 'rand.int(n)', 'random int in [0, n)', 'Uniform in the half-open range.'),
            fn('range', 'rand.range(lo, hi)', 'random int in [lo, hi)', 'Uniform in the half-open range.'),
            fn('chance', 'rand.chance(pct)', 'true with pct percent chance', 'Returns 1 with probability `pct`/100.'),
            fn('pick', 'rand.pick(a)', 'a random element', 'Returns a random element, or 0 when the array is empty.'),
            fn('shuffle', 'rand.shuffle(a)', 'Fisher-Yates shuffle in place', 'Shuffles and returns the same array.'),
        ],
    },
    {
        name: 'word',
        detail: 'example module (nested require)',
        doc: 'A small example module that itself requires string.mil, demonstrating nested require.',
        functions: [
            fn('shout', 'word.shout(s)', 'add an exclamation mark', 'Returns `s` followed by "!".'),
            fn('isPalindrome', 'word.isPalindrome(s)', 'palindrome test', 'Returns 1 when `s` reads the same forwards and backwards.'),
        ],
    },
];

// Flat lookup: "math.cos" -> doc, "cos" -> doc (builtin or module function)
const byModuleFn = new Map<string, { mod: ModuleDoc; fn: BuiltinDoc }>();
for (const m of MODULES) {
    for (const f of m.functions) {
        byModuleFn.set(`${m.name}.${f.name}`, { mod: m, fn: f });
    }
}

const byBuiltin = new Map<string, BuiltinDoc>();
for (const b of BUILTINS) {
    byBuiltin.set(b.name, b);
}

// Names of every function defined by syslib modules, used for completion
export const MODULE_FUNCTION_NAMES: Map<string, string[]> = new Map(
    MODULES.map((m) => [m.name, m.functions.map((f) => f.name)])
);

export function findDoc(word: string): { mod: ModuleDoc | null; fn: BuiltinDoc } | null {
    const qualified = byModuleFn.get(word);
    if (qualified) {
        return { mod: qualified.mod, fn: qualified.fn };
    }
    const builtin = byBuiltin.get(word);
    if (builtin) {
        return { mod: null, fn: builtin };
    }
    return null;
}

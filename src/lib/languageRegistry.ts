export type LanguagePriority = 1 | 2 | 3;

export type LanguageSupportStatus = 'live' | 'simulated' | 'unavailable';

export type LanguageStatusLabel =
  | 'Live execution'
  | 'AI simulation'
  | 'Not available yet';

export type SyntaxHighlightGroup =
  | 'js-ts'
  | 'python'
  | 'c-like'
  | 'markup'
  | 'sql'
  | 'shell'
  | 'functional'
  | 'lisp'
  | 'assembly'
  | 'plain';

export type BuiltinLanguageId =
  // Priority 1
  | 'py'
  | 'js'
  | 'ts'
  | 'c'
  | 'cpp'
  | 'java'
  // Priority 2
  | 'csharp'
  | 'kotlin'
  | 'go'
  | 'rust'
  | 'swift'
  | 'dart'
  | 'php'
  | 'ruby'
  // Existing Web / Mobile targets
  | 'react'
  | 'html'
  | 'android'
  // Priority 3
  | 'scala'
  | 'lua'
  | 'r'
  | 'julia'
  | 'perl'
  | 'haskell'
  | 'elixir'
  | 'erlang'
  | 'fsharp'
  | 'ocaml'
  | 'clojure'
  | 'groovy'
  | 'objc'
  | 'vbnet'
  | 'bash'
  | 'powershell'
  | 'sql'
  | 'matlab'
  | 'octave'
  | 'fortran'
  | 'cobol'
  | 'pascal'
  | 'delphi'
  | 'assembly'
  | 'zig'
  | 'nim'
  | 'crystal'
  | 'solidity'
  | 'ada'
  | 'prolog'
  | 'lisp'
  | 'scheme'
  | 'racket'
  | 'tcl'
  | 'awk'
  | 'vlang'
  | 'wat';

// Extensible string union allowing future dynamically registered languages while
// preserving strict autocomplete for all built-in languages. Note: "other" is intentionally excluded.
export type LanguageId = BuiltinLanguageId | (string & {});

export interface LanguageCapabilitySpec {
  id: LanguageId;
  name: string;
  shortLabel: string;
  extensions: string[];
  priority: LanguagePriority;
  syntaxGroup: SyntaxHighlightGroup;
  syntaxHighlighting: boolean;
  runtimeAvailable: boolean;
  compilerAvailable: boolean;
  realExecutionSupported: boolean;
  tracingSupported: boolean;
  animationSupported: boolean;
  aiSimulationSupported: boolean;
  inputSupported: boolean;
  status: LanguageSupportStatus;
  statusLabel: LanguageStatusLabel;
  executionMethod: string;
  limitations: string[];
}

function makeSimulatedSpec(
  partial: Pick<
    LanguageCapabilitySpec,
    'id' | 'name' | 'shortLabel' | 'extensions' | 'priority' | 'syntaxGroup'
  > & {
    compilerAvailable?: boolean;
    runtimeAvailable?: boolean;
    extraLimitations?: string[];
  }
): LanguageCapabilitySpec {
  return {
    ...partial,
    syntaxHighlighting: true,
    runtimeAvailable: partial.runtimeAvailable ?? false,
    compilerAvailable: partial.compilerAvailable ?? false,
    realExecutionSupported: false,
    tracingSupported: false,
    animationSupported: true,
    aiSimulationSupported: true,
    inputSupported: true,
    status: 'simulated',
    statusLabel: 'AI simulation',
    executionMethod: 'Automatic server-side Gemini AI simulation (not natively executed)',
    limitations: [
      'Uses server-side Gemini AI simulation rather than a native compiler/runtime; verify output against a real toolchain.',
      ...(partial.extraLimitations || []),
    ],
  };
}

function makeUnavailableSpec(
  partial: Pick<
    LanguageCapabilitySpec,
    'id' | 'name' | 'shortLabel' | 'extensions' | 'priority' | 'syntaxGroup'
  > & {
    compilerAvailable?: boolean;
    runtimeAvailable?: boolean;
    reason?: string;
  }
): LanguageCapabilitySpec {
  return {
    ...partial,
    syntaxHighlighting: true,
    runtimeAvailable: partial.runtimeAvailable ?? false,
    compilerAvailable: partial.compilerAvailable ?? false,
    realExecutionSupported: false,
    tracingSupported: false,
    animationSupported: false,
    aiSimulationSupported: false,
    inputSupported: false,
    status: 'unavailable',
    statusLabel: 'Not available yet',
    executionMethod: 'Recognized language — no execution or animation runtime enabled yet',
    limitations: [
      partial.reason ||
        'No safe execution runtime or verified visualization path is enabled for this language yet.',
    ],
  };
}

const BUILTIN_LANGUAGES: LanguageCapabilitySpec[] = [
  // ===================== PRIORITY 1 =====================
  {
    id: 'js',
    name: 'JavaScript',
    shortLabel: 'JS',
    extensions: ['js', 'mjs', 'cjs'],
    priority: 1,
    syntaxGroup: 'js-ts',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: true,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: false,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Real execution · Acorn AST in isolated Browser Web Worker',
    limitations: [
      'Runs synchronous JavaScript up to 1,500 trace events and a 5-second worker timeout.',
      'Network requests, DOM APIs, and dynamic ES imports are blocked inside the sandbox.',
    ],
  },
  {
    id: 'ts',
    name: 'TypeScript',
    shortLabel: 'TS',
    extensions: ['ts', 'mts', 'cts'],
    priority: 1,
    syntaxGroup: 'js-ts',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: true,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: false,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Real execution · esbuild TypeScript transpile + isolated Browser Web Worker',
    limitations: [
      'Strips TypeScript syntax via esbuild before executing inside the isolated Web Worker.',
      'Does not run full cross-file tsc type-checking; synchronous execution capped at 1,500 events / 5s.',
    ],
  },
  {
    id: 'py',
    name: 'Python',
    shortLabel: 'PY',
    extensions: ['py', 'pyw'],
    priority: 1,
    syntaxGroup: 'python',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: true,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: false,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Real execution · Sandboxed Python 3 subprocess (sys.settrace + rlimit + audit hook)',
    limitations: [
      '5s CPU limit, 8s wall-clock cap, 256 MB memory limit, and blocked file writes/network I/O.',
      'Only allowlisted algorithmic standard-library modules can be imported.',
    ],
  },
  {
    id: 'c',
    name: 'C',
    shortLabel: 'C',
    extensions: ['c', 'h'],
    priority: 1,
    syntaxGroup: 'c-like',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: true,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: true,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Live execution · Built-in C AST interpreter (automatic AI simulation for pointers/macros)',
    limitations: [
      'Executes variables, arithmetic, strings, arrays, conditionals, loops, functions, recursion, scanf, and printf deterministically without unsafe native binaries.',
      'Programs using raw pointers, #define macros, or external headers automatically escalate to labeled Gemini AI Simulation.',
    ],
  },
  {
    id: 'cpp',
    name: 'C++',
    shortLabel: 'C++',
    extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh'],
    priority: 1,
    syntaxGroup: 'c-like',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: true,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: true,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Live execution · Built-in C++ AST interpreter (automatic AI simulation for templates/STL)',
    limitations: [
      'Executes variables, arithmetic, std::string, arrays, std::vector, conditionals, loops, functions, recursion, cin, and cout deterministically.',
      'Programs using templates, classes, pointers, or advanced STL containers automatically escalate to labeled Gemini AI Simulation.',
    ],
  },
  {
    id: 'java',
    name: 'Java',
    shortLabel: 'Java',
    extensions: ['java'],
    priority: 1,
    syntaxGroup: 'c-like',
    syntaxHighlighting: true,
    runtimeAvailable: true,
    compilerAvailable: false,
    realExecutionSupported: true,
    tracingSupported: true,
    animationSupported: true,
    aiSimulationSupported: true,
    inputSupported: true,
    status: 'live',
    statusLabel: 'Live execution',
    executionMethod: 'Live execution · Built-in Java AST interpreter (automatic AI simulation for advanced OOP)',
    limitations: [
      'Executes classes with main(), variables, arithmetic, Strings, arrays, conditionals, loops, static methods, recursion, Scanner input, and System.out deterministically.',
      'Programs using inheritance, collections (HashMap/ArrayList), or custom constructors automatically escalate to labeled Gemini AI Simulation.',
    ],
  },

  // ===================== PRIORITY 2 =====================
  makeSimulatedSpec({
    id: 'csharp',
    name: 'C#',
    shortLabel: 'C#',
    extensions: ['cs'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No .NET SDK runtime is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'kotlin',
    name: 'Kotlin',
    shortLabel: 'KT',
    extensions: ['kt', 'kts'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No kotlinc/JVM runtime is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'go',
    name: 'Go',
    shortLabel: 'Go',
    extensions: ['go'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No Go toolchain is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'rust',
    name: 'Rust',
    shortLabel: 'Rust',
    extensions: ['rs'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No rustc/Cargo toolchain is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'swift',
    name: 'Swift',
    shortLabel: 'Swift',
    extensions: ['swift'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No Swift compiler is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'dart',
    name: 'Dart',
    shortLabel: 'Dart',
    extensions: ['dart'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No Dart SDK is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'php',
    name: 'PHP',
    shortLabel: 'PHP',
    extensions: ['php'],
    priority: 2,
    syntaxGroup: 'c-like',
    extraLimitations: ['No PHP interpreter is installed in this server environment.'],
  }),
  makeSimulatedSpec({
    id: 'ruby',
    name: 'Ruby',
    shortLabel: 'Ruby',
    extensions: ['rb'],
    priority: 2,
    syntaxGroup: 'python',
    extraLimitations: ['No Ruby interpreter is installed in this server environment.'],
  }),

  // Existing Web / Mobile visualization targets preserved from Phases 1-2.5
  makeSimulatedSpec({
    id: 'react',
    name: 'React / JSX',
    shortLabel: 'JSX',
    extensions: ['jsx', 'tsx'],
    priority: 2,
    syntaxGroup: 'js-ts',
    extraLimitations: ['Visualizes component state & rendered scene via AI simulation.'],
  }),
  makeSimulatedSpec({
    id: 'html',
    name: 'HTML / CSS',
    shortLabel: 'HTML',
    extensions: ['html', 'htm', 'css'],
    priority: 2,
    syntaxGroup: 'markup',
    extraLimitations: ['Visualizes rendered markup layout via AI simulation.'],
  }),
  makeSimulatedSpec({
    id: 'android',
    name: 'Android (XML / UI)',
    shortLabel: 'Android',
    extensions: ['xml'],
    priority: 2,
    syntaxGroup: 'markup',
    extraLimitations: ['Visualizes Android UI state & layout via AI simulation.'],
  }),

  // ===================== PRIORITY 3 (AI Simulation Enabled) =====================
  makeSimulatedSpec({
    id: 'scala',
    name: 'Scala',
    shortLabel: 'Scala',
    extensions: ['scala', 'sc'],
    priority: 3,
    syntaxGroup: 'c-like',
  }),
  makeSimulatedSpec({
    id: 'lua',
    name: 'Lua',
    shortLabel: 'Lua',
    extensions: ['lua'],
    priority: 3,
    syntaxGroup: 'python',
  }),
  makeSimulatedSpec({
    id: 'r',
    name: 'R',
    shortLabel: 'R',
    extensions: ['r'],
    priority: 3,
    syntaxGroup: 'python',
  }),
  makeSimulatedSpec({
    id: 'sql',
    name: 'SQL',
    shortLabel: 'SQL',
    extensions: ['sql'],
    priority: 3,
    syntaxGroup: 'sql',
  }),
  makeSimulatedSpec({
    id: 'bash',
    name: 'Bash / Shell',
    shortLabel: 'Bash',
    extensions: ['sh', 'bash', 'zsh'],
    priority: 3,
    syntaxGroup: 'shell',
    runtimeAvailable: true,
    extraLimitations: [
      'Direct shell execution is disabled on the main server for security; uses explicit AI simulation.',
    ],
  }),

  // ===================== PRIORITY 3 (AI Simulation Enabled — All Named Languages) =====================
  makeSimulatedSpec({ id: 'julia', name: 'Julia', shortLabel: 'Julia', extensions: ['jl'], priority: 3, syntaxGroup: 'python' }),
  makeSimulatedSpec({ id: 'perl', name: 'Perl', shortLabel: 'Perl', extensions: ['pl', 'pm'], priority: 3, syntaxGroup: 'shell', extraLimitations: ['Direct Perl subprocess execution is disabled for server security; uses AI simulation.'] }),
  makeSimulatedSpec({ id: 'haskell', name: 'Haskell', shortLabel: 'Haskell', extensions: ['hs', 'lhs'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'elixir', name: 'Elixir', shortLabel: 'Elixir', extensions: ['ex', 'exs'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'erlang', name: 'Erlang', shortLabel: 'Erlang', extensions: ['erl', 'hrl'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'fsharp', name: 'F#', shortLabel: 'F#', extensions: ['fs', 'fsx'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'ocaml', name: 'OCaml', shortLabel: 'OCaml', extensions: ['ml', 'mli'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'clojure', name: 'Clojure', shortLabel: 'Clojure', extensions: ['clj', 'cljs', 'edn'], priority: 3, syntaxGroup: 'lisp' }),
  makeSimulatedSpec({ id: 'groovy', name: 'Groovy', shortLabel: 'Groovy', extensions: ['groovy', 'gvy'], priority: 3, syntaxGroup: 'c-like' }),
  makeSimulatedSpec({ id: 'objc', name: 'Objective-C', shortLabel: 'Obj-C', extensions: ['m', 'mm'], priority: 3, syntaxGroup: 'c-like' }),
  makeSimulatedSpec({ id: 'vbnet', name: 'Visual Basic .NET', shortLabel: 'VB.NET', extensions: ['vb'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'powershell', name: 'PowerShell', shortLabel: 'PS1', extensions: ['ps1', 'psm1'], priority: 3, syntaxGroup: 'shell' }),
  makeSimulatedSpec({ id: 'matlab', name: 'MATLAB', shortLabel: 'MATLAB', extensions: ['mat'], priority: 3, syntaxGroup: 'python' }),
  makeSimulatedSpec({ id: 'octave', name: 'Octave', shortLabel: 'Octave', extensions: ['oct'], priority: 3, syntaxGroup: 'python' }),
  makeSimulatedSpec({ id: 'fortran', name: 'Fortran', shortLabel: 'Fortran', extensions: ['f', 'f90', 'f95', 'for'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'cobol', name: 'COBOL', shortLabel: 'COBOL', extensions: ['cob', 'cbl', 'cpy'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'pascal', name: 'Pascal', shortLabel: 'Pascal', extensions: ['pas', 'pp'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'delphi', name: 'Delphi', shortLabel: 'Delphi', extensions: ['dpr', 'dpk'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'assembly', name: 'Assembly', shortLabel: 'ASM', extensions: ['asm', 's', 'nasm'], priority: 3, syntaxGroup: 'assembly' }),
  makeSimulatedSpec({ id: 'zig', name: 'Zig', shortLabel: 'Zig', extensions: ['zig'], priority: 3, syntaxGroup: 'c-like' }),
  makeSimulatedSpec({ id: 'nim', name: 'Nim', shortLabel: 'Nim', extensions: ['nim'], priority: 3, syntaxGroup: 'python' }),
  makeSimulatedSpec({ id: 'crystal', name: 'Crystal', shortLabel: 'Crystal', extensions: ['cr'], priority: 3, syntaxGroup: 'python' }),
  makeSimulatedSpec({ id: 'solidity', name: 'Solidity', shortLabel: 'Solidity', extensions: ['sol'], priority: 3, syntaxGroup: 'c-like' }),
  makeSimulatedSpec({ id: 'ada', name: 'Ada', shortLabel: 'Ada', extensions: ['adb', 'ads'], priority: 3, syntaxGroup: 'plain' }),
  makeSimulatedSpec({ id: 'prolog', name: 'Prolog', shortLabel: 'Prolog', extensions: ['pro'], priority: 3, syntaxGroup: 'functional' }),
  makeSimulatedSpec({ id: 'lisp', name: 'Lisp', shortLabel: 'Lisp', extensions: ['lisp', 'lsp', 'cl'], priority: 3, syntaxGroup: 'lisp' }),
  makeSimulatedSpec({ id: 'scheme', name: 'Scheme', shortLabel: 'Scheme', extensions: ['scm', 'ss'], priority: 3, syntaxGroup: 'lisp' }),
  makeSimulatedSpec({ id: 'racket', name: 'Racket', shortLabel: 'Racket', extensions: ['rkt'], priority: 3, syntaxGroup: 'lisp' }),
  makeSimulatedSpec({ id: 'tcl', name: 'Tcl', shortLabel: 'Tcl', extensions: ['tcl'], priority: 3, syntaxGroup: 'shell' }),
  makeSimulatedSpec({ id: 'awk', name: 'Awk', shortLabel: 'Awk', extensions: ['awk'], priority: 3, syntaxGroup: 'shell', extraLimitations: ['Direct Awk subprocess execution is disabled for server security; uses AI simulation.'] }),
  makeSimulatedSpec({ id: 'vlang', name: 'V', shortLabel: 'V', extensions: ['v'], priority: 3, syntaxGroup: 'c-like' }),
  makeSimulatedSpec({ id: 'wat', name: 'WebAssembly Text', shortLabel: 'WAT', extensions: ['wat', 'wast'], priority: 3, syntaxGroup: 'lisp' }),
];

const registry = new Map<string, LanguageCapabilitySpec>();
for (const spec of BUILTIN_LANGUAGES) {
  registry.set(spec.id, spec);
}

/**
 * Extensibility hook: allows registering new programming languages at runtime
 * without rewriting UI selectors, detectors, or adapters.
 */
export function registerLanguage(spec: LanguageCapabilitySpec): void {
  if (!spec.id || spec.id === 'other') {
    throw new Error('Language id must be a specific named language (never "other").');
  }
  registry.set(spec.id, spec);
}

export function getLanguageSpec(id: string): LanguageCapabilitySpec | undefined {
  return registry.get(id.toLowerCase());
}

export function getAllLanguages(): LanguageCapabilitySpec[] {
  return [...registry.values()];
}

export function getLiveExecutionLanguages(): LanguageCapabilitySpec[] {
  return [...registry.values()].filter((l) => l.status === 'live');
}

export function getSimulatedLanguages(): LanguageCapabilitySpec[] {
  return [...registry.values()].filter((l) => l.status === 'simulated');
}

export function getSelectableLanguages(): LanguageCapabilitySpec[] {
  return [...registry.values()].filter((l) => l.status !== 'unavailable' && l.animationSupported);
}

export function getUnavailableLanguages(): LanguageCapabilitySpec[] {
  return [...registry.values()].filter((l) => l.status === 'unavailable' || !l.animationSupported);
}

export function isLanguageSelectable(id: string): boolean {
  const spec = getLanguageSpec(id);
  return Boolean(spec && spec.status !== 'unavailable' && spec.animationSupported);
}

export function detectLanguageFromFilenameStrict(filename: string): LanguageId | null {
  const base = filename.trim().split(/[\\/]/).pop() || '';
  const dotIdx = base.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === base.length - 1) return null;
  const ext = base.slice(dotIdx + 1).toLowerCase();

  for (const spec of registry.values()) {
    if (spec.extensions.includes(ext)) {
      return spec.id;
    }
  }
  return null;
}

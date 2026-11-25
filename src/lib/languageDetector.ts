import {
  detectLanguageFromFilenameStrict,
  getLanguageSpec,
  type LanguageCapabilitySpec,
  type LanguageId,
} from './languageRegistry';

export type DetectionConfidence = 'high' | 'medium' | 'low';

export interface DetectionCandidate {
  languageId: LanguageId;
  score: number;
  matchedSignals: string[];
}

export interface LanguageDetectionResult {
  languageId: LanguageId | null;
  spec: LanguageCapabilitySpec | null;
  confidence: DetectionConfidence;
  score: number;
  candidates: DetectionCandidate[];
  reason: string;
  filenameLanguageId: LanguageId | null;
  extensionMismatch: boolean;
}

interface SignalRule {
  pattern: RegExp;
  weight: number;
  label: string;
}

const LANGUAGE_RULES: Record<string, SignalRule[]> = {
  py: [
    { pattern: /^\s*def\s+[A-Za-z_]\w*\s*\([^)]*\)\s*(?:->\s*[^:]+)?:/m, weight: 8, label: 'Python def ...:' },
    { pattern: /^\s*class\s+[A-Za-z_]\w*(?:\([^)]*\))?\s*:/m, weight: 7, label: 'Python class ...:' },
    { pattern: /\bdef\s+__init__\s*\(\s*self\b/, weight: 10, label: 'Python __init__(self)' },
    { pattern: /^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[a-z_]\w*(?:\s+as\s+\w+)?\s*$)/m, weight: 5, label: 'Python import' },
    { pattern: /^\s*elif\s+.+:/m, weight: 8, label: 'Python elif' },
    { pattern: /\bprint\s*\(/, weight: 4, label: 'print()' },
    { pattern: /\b(?:None|True|False)\b/, weight: 3, label: 'Python None/True/False' },
    { pattern: /\brange\s*\(/, weight: 4, label: 'range()' },
    { pattern: /\binput\s*\(/, weight: 3, label: 'input()' },
    { pattern: /^\s*(?:for\s+\w+(?:\s*,\s*\w+)*\s+in\s+.+:|while\s+.+:|if\s+.+:)/m, weight: 5, label: 'Python colon block' },
    { pattern: /\bself\.[A-Za-z_]\w*/, weight: 5, label: 'self.attr' },
    { pattern: /\bappend\s*\(/, weight: 2, label: '.append()' },
    { pattern: /#.*$/m, weight: 1, label: 'hash comment' },
  ],
  ts: [
    { pattern: /\binterface\s+[A-Z]\w*\s*(?:<[^>]+>)?\s*\{/, weight: 9, label: 'TS interface' },
    { pattern: /\btype\s+[A-Z]\w*\s*(?:<[^>]+>)?\s*=/, weight: 8, label: 'TS type alias' },
    { pattern: /\b(?:const|let|var)\s+[A-Za-z_$]\w*\s*:\s*(?:number|string|boolean|any|unknown|void|never|Record|Array|Map|Set|[A-Z]\w*(?:\[\]|<[^>]+>)?)\b/, weight: 8, label: 'TS variable type annotation' },
    { pattern: /\bfunction\s+[A-Za-z_$]\w*\s*(?:<[^>]+>)?\s*\([^)]*:\s*(?:number|string|boolean|any|unknown|Record|Array|[A-Z]\w*)[^)]*\)/, weight: 9, label: 'TS typed function params' },
    { pattern: /\)\s*:\s*(?:number|string|boolean|void|never|Promise<|Array<|[A-Z]\w*\[\]?)\s*(?:\{|=>)/, weight: 8, label: 'TS return type' },
    { pattern: /\b(?:readonly|private|protected|public)\s+[A-Za-z_$]\w*\s*:\s*\w+/, weight: 6, label: 'TS class member modifier' },
    { pattern: /\bas\s+(?:number|string|boolean|unknown|any|const)\b/, weight: 5, label: 'TS type assertion' },
    { pattern: /\benum\s+[A-Z]\w*\s*\{/, weight: 6, label: 'TS enum' },
    { pattern: /\bconsole\.log\s*\(/, weight: 3, label: 'console.log()' },
  ],
  js: [
    { pattern: /\bconsole\.(?:log|warn|error|info)\s*\(/, weight: 6, label: 'console.log()' },
    { pattern: /\b(?:const|let|var)\s+[A-Za-z_$]\w*\s*=/, weight: 4, label: 'JS const/let/var' },
    { pattern: /\bfunction\s+[A-Za-z_$]\w*\s*\([^:)]*\)\s*\{/, weight: 6, label: 'JS function()' },
    { pattern: /=>\s*\{?/, weight: 4, label: 'arrow function' },
    { pattern: /===|!==/, weight: 5, label: 'strict equality ===' },
    { pattern: /\bnew\s+(?:Map|Set|WeakMap|Array|Date)\s*\(/, weight: 4, label: 'JS built-in constructor' },
    { pattern: /\bconstructor\s*\([^:)]*\)\s*\{/, weight: 6, label: 'JS class constructor' },
    { pattern: /\b(?:document\.|window\.|Math\.\w+|JSON\.stringify|Array\.isArray)/, weight: 4, label: 'JS standard API' },
    { pattern: /\b(?:readLine|readline)\s*\(\s*\)/, weight: 3, label: 'JS readLine()' },
  ],
  react: [
    { pattern: /\bimport\s+React\b|from\s+['"]react['"]/, weight: 9, label: 'React import' },
    { pattern: /\buse(?:State|Effect|Memo|Callback|Ref)\s*\(/, weight: 8, label: 'React hook' },
    { pattern: /return\s*\(\s*<[A-Za-z][^>]*>/, weight: 7, label: 'JSX return block' },
    { pattern: /\bclassName\s*=/, weight: 6, label: 'JSX className' },
  ],
  java: [
    { pattern: /\bpublic\s+class\s+[A-Z]\w*/, weight: 10, label: 'Java public class' },
    { pattern: /\bpublic\s+static\s+void\s+main\s*\(\s*String/, weight: 12, label: 'Java main(String[])' },
    { pattern: /\bSystem\.out\.print(?:ln|f)?\s*\(/, weight: 10, label: 'System.out.println' },
    { pattern: /\bimport\s+java\.(?:util|io|lang|math)\./, weight: 9, label: 'import java.*' },
    { pattern: /\b(?:ArrayList|HashMap|HashSet|LinkedList|Scanner)\s*</, weight: 7, label: 'Java collection' },
    { pattern: /\bnew\s+Scanner\s*\(\s*System\.in\s*\)/, weight: 9, label: 'Java Scanner(System.in)' },
    { pattern: /\b(?:private|protected|public)\s+(?:static\s+)?(?:int|long|double|boolean|String|void)\s+\w+\s*\(/, weight: 6, label: 'Java typed method' },
  ],
  cpp: [
    { pattern: /#include\s*<(?:iostream|vector|algorithm|map|unordered_map|set|queue|stack|bits\/stdc\+\+\.h|string)>/, weight: 11, label: 'C++ STL #include' },
    { pattern: /\busing\s+namespace\s+std\s*;/, weight: 11, label: 'using namespace std' },
    { pattern: /\bstd::(?:cout|cin|vector|string|map|unordered_map|set|queue|stack|sort|endl)\b/, weight: 10, label: 'std::*' },
    { pattern: /\b(?:cout\s*<<|cin\s*>>)/, weight: 9, label: 'cout << / cin >>' },
    { pattern: /\bvector\s*<[^>]+>/, weight: 7, label: 'C++ vector<T>' },
    { pattern: /\bnullptr\b/, weight: 5, label: 'C++ nullptr' },
    { pattern: /\btemplate\s*<\s*(?:typename|class)\b/, weight: 7, label: 'C++ template' },
  ],
  c: [
    { pattern: /#include\s*<(?:stdio|stdlib|string|math|stdbool|ctype|limits)\.h>/, weight: 10, label: 'C standard header' },
    { pattern: /\b(?:printf|scanf|fprintf|fgets|puts)\s*\(/, weight: 8, label: 'C stdio printf/scanf' },
    { pattern: /\b(?:malloc|calloc|realloc|free)\s*\(/, weight: 7, label: 'C malloc/free' },
    { pattern: /\btypedef\s+struct\b/, weight: 8, label: 'C typedef struct' },
    { pattern: /\bint\s+main\s*\(\s*(?:void|int\s+argc)?\s*\)/, weight: 6, label: 'C int main()' },
    { pattern: /\bsizeof\s*\(/, weight: 3, label: 'sizeof()' },
  ],
  csharp: [
    { pattern: /^\s*using\s+System(?:\.\w+)*\s*;/m, weight: 10, label: 'C# using System;' },
    { pattern: /\bConsole\.Write(?:Line)?\s*\(/, weight: 10, label: 'Console.WriteLine' },
    { pattern: /\bnamespace\s+[A-Z][\w.]*\s*[{;]/, weight: 7, label: 'C# namespace' },
    { pattern: /\bstatic\s+void\s+Main\s*\(/, weight: 9, label: 'C# static void Main' },
    { pattern: /\b(?:List|Dictionary|HashSet)<[^>]+>/, weight: 5, label: 'C# generic collection' },
  ],
  kotlin: [
    { pattern: /\bfun\s+main\s*\(/, weight: 11, label: 'Kotlin fun main()' },
    { pattern: /\bfun\s+[a-zA-Z_]\w*\s*\([^)]*\)\s*(?::\s*\w+)?\s*[={]/, weight: 8, label: 'Kotlin fun declaration' },
    { pattern: /\b(?:val|var)\s+\w+\s*(?::\s*(?:Int|String|Boolean|Double|List|MutableList))?\s*=/, weight: 5, label: 'Kotlin val/var' },
    { pattern: /\b(?:mutableListOf|listOf|mutableMapOf|arrayOf)\s*\(/, weight: 8, label: 'Kotlin collection builder' },
    { pattern: /\bprintln\s*\(/, weight: 4, label: 'println()' },
    { pattern: /\bdata\s+class\s+[A-Z]\w*/, weight: 8, label: 'Kotlin data class' },
  ],
  go: [
    { pattern: /^\s*package\s+\w+/m, weight: 10, label: 'Go package declaration' },
    { pattern: /\bfunc\s+main\s*\(\s*\)/, weight: 10, label: 'Go func main()' },
    { pattern: /\bfmt\.Print(?:ln|f)?\s*\(/, weight: 10, label: 'Go fmt.Println' },
    { pattern: /:=/, weight: 5, label: 'Go short var :=' },
    { pattern: /\bimport\s+(?:"fmt"|\(\s*"fmt")/, weight: 8, label: 'Go import "fmt"' },
  ],
  rust: [
    { pattern: /\bfn\s+main\s*\(\s*\)/, weight: 11, label: 'Rust fn main()' },
    { pattern: /\bprintln!\s*\(/, weight: 11, label: 'Rust println!()' },
    { pattern: /\blet\s+mut\s+\w+/, weight: 9, label: 'Rust let mut' },
    { pattern: /\b(?:Vec|Option|Result|HashMap)::/, weight: 7, label: 'Rust std type' },
    { pattern: /\bimpl\s+[A-Z]\w*/, weight: 6, label: 'Rust impl' },
    { pattern: /\bvec!\s*\[/, weight: 8, label: 'Rust vec![]' },
  ],
  swift: [
    { pattern: /\bimport\s+(?:Foundation|SwiftUI|UIKit)\b/, weight: 9, label: 'Swift import' },
    { pattern: /\bfunc\s+\w+\s*\([^)]*\)\s*->\s*\w+/, weight: 8, label: 'Swift func ->' },
    { pattern: /\bguard\s+let\b|\bif\s+let\b/, weight: 7, label: 'Swift optional binding' },
    { pattern: /\bstruct\s+[A-Z]\w*\s*(?::\s*\w+)?\s*\{/, weight: 5, label: 'Swift struct' },
  ],
  dart: [
    { pattern: /\bvoid\s+main\s*\(\s*\)\s*\{/, weight: 7, label: 'Dart void main()' },
    { pattern: /\bimport\s+['"]dart:/, weight: 10, label: 'Dart core import' },
    { pattern: /\b(?:final|var)\s+\w+\s*=\s*<[^>]+>\[/, weight: 6, label: 'Dart typed list' },
    { pattern: /\bextends\s+(?:StatelessWidget|StatefulWidget)\b/, weight: 10, label: 'Flutter Widget' },
  ],
  php: [
    { pattern: /<\?php\b/, weight: 14, label: 'PHP <?php tag' },
    { pattern: /\$[a-zA-Z_]\w*\s*=/, weight: 6, label: 'PHP $variable' },
    { pattern: /\becho\s+/, weight: 5, label: 'PHP echo' },
    { pattern: /->\w+\s*\(/, weight: 3, label: 'PHP object arrow' },
  ],
  ruby: [
    { pattern: /^\s*def\s+[a-z_]\w*(?:\s*\([^)]*\))?\s*$/m, weight: 7, label: 'Ruby def ... end' },
    { pattern: /\bputs\s+/, weight: 6, label: 'Ruby puts' },
    { pattern: /\bdo\s*\|\s*\w+(?:\s*,\s*\w+)*\s*\|/, weight: 8, label: 'Ruby block do |x|' },
    { pattern: /^\s*end\s*$/m, weight: 4, label: 'Ruby end keyword' },
    { pattern: /\.each\s*(?:do|\{)/, weight: 6, label: 'Ruby .each' },
  ],
  html: [
    { pattern: /<!DOCTYPE\s+html>/i, weight: 12, label: 'HTML DOCTYPE' },
    { pattern: /<(?:html|head|body|div|span|section|main|h1|p|button|script|style)\b[^>]*>/i, weight: 7, label: 'HTML tag' },
    { pattern: /<\/(?:html|body|div|section|style|script)>/i, weight: 6, label: 'HTML closing tag' },
  ],
  android: [
    { pattern: /xmlns:android="http:\/\/schemas\.android\.com/, weight: 14, label: 'Android XML namespace' },
    { pattern: /<(?:LinearLayout|RelativeLayout|ConstraintLayout|TextView|Button|RecyclerView)\b/, weight: 10, label: 'Android layout widget' },
  ],
  sql: [
    { pattern: /\bSELECT\s+.+\s+FROM\s+\w+/i, weight: 10, label: 'SQL SELECT ... FROM' },
    { pattern: /\bCREATE\s+TABLE\b/i, weight: 9, label: 'SQL CREATE TABLE' },
    { pattern: /\bINSERT\s+INTO\b/i, weight: 9, label: 'SQL INSERT INTO' },
    { pattern: /\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|INNER\s+JOIN|LEFT\s+JOIN)\b/i, weight: 5, label: 'SQL clause' },
  ],
  bash: [
    { pattern: /^#!\/(?:usr\/bin\/env\s+)?(?:ba)?sh\b/m, weight: 12, label: 'Shell shebang' },
    { pattern: /\becho\s+["'$]/, weight: 5, label: 'Shell echo' },
    { pattern: /\bfi\b.*\b(?:then|if)\b|\bif\s+\[\[?[\s\S]+?\]\]?;?\s*then/m, weight: 9, label: 'Bash if/then/fi' },
    { pattern: /\bfor\s+\w+\s+in\s+.+;\s*do\b/, weight: 8, label: 'Bash for ... do' },
  ],
  scala: [
    { pattern: /\bobject\s+[A-Z]\w*\s*(?:extends\s+App)?\s*\{/, weight: 9, label: 'Scala object' },
    { pattern: /\bdef\s+main\s*\(\s*args\s*:\s*Array\[String\]\s*\)/, weight: 12, label: 'Scala main' },
    { pattern: /\bcase\s+class\s+[A-Z]\w*/, weight: 9, label: 'Scala case class' },
  ],
  lua: [
    { pattern: /\blocal\s+function\s+\w+\s*\(/, weight: 9, label: 'Lua local function' },
    { pattern: /\blocal\s+\w+\s*=/, weight: 6, label: 'Lua local var' },
    { pattern: /\bfor\s+\w+\s*=\s*\d+\s*,\s*\w+\s+do\b/, weight: 8, label: 'Lua numeric for ... do' },
    { pattern: /\bthen\b[\s\S]*\bend\b/, weight: 5, label: 'Lua then ... end' },
  ],
  r: [
    { pattern: /[A-Za-z_]\w*\s*<-\s*/, weight: 8, label: 'R assignment <-' },
    { pattern: /\bc\s*\(\s*[\d"']/, weight: 5, label: 'R vector c(...)' },
    { pattern: /\bcat\s*\(|\bdata\.frame\s*\(/, weight: 6, label: 'R cat/data.frame' },
  ],
  haskell: [
    { pattern: /^\s*module\s+[A-Z]\w*\s+where\b/m, weight: 11, label: 'Haskell module ... where' },
    { pattern: /^\s*main\s*::\s*IO\s*\(\)/m, weight: 12, label: 'Haskell main :: IO ()' },
    { pattern: /\bputStrLn\b/, weight: 9, label: 'Haskell putStrLn' },
    { pattern: /^\s*[a-z]\w*\s*::\s*[A-Z]\w*\s*->/m, weight: 9, label: 'Haskell type signature' },
  ],
  elixir: [
    { pattern: /\bdefmodule\s+[A-Z]\w*\s+do\b/, weight: 12, label: 'Elixir defmodule' },
    { pattern: /\bIO\.puts\b/, weight: 10, label: 'Elixir IO.puts' },
    { pattern: /\|>/, weight: 4, label: 'Elixir pipe |>' },
  ],
  erlang: [
    { pattern: /^-module\(\w+\)\./m, weight: 13, label: 'Erlang -module()' },
    { pattern: /^-export\(\[/m, weight: 11, label: 'Erlang -export()' },
    { pattern: /\bio:format\s*\(/, weight: 9, label: 'Erlang io:format' },
  ],
  assembly: [
    { pattern: /^\s*(?:section\s+\.(?:text|data)|global\s+_start|\.globl\s+main)/im, weight: 13, label: 'Assembly section/global' },
    { pattern: /^\s*(?:mov|add|sub|jmp|cmp|je|jne|push|pop|syscall|int\s+0x80)\s+/im, weight: 8, label: 'Assembly instruction' },
  ],
  cobol: [
    { pattern: /\bIDENTIFICATION\s+DIVISION\./i, weight: 14, label: 'COBOL IDENTIFICATION DIVISION' },
    { pattern: /\bPROCEDURE\s+DIVISION\./i, weight: 13, label: 'COBOL PROCEDURE DIVISION' },
    { pattern: /\bSTOP\s+RUN\./i, weight: 9, label: 'COBOL STOP RUN' },
  ],
  fortran: [
    { pattern: /^\s*program\s+\w+/im, weight: 9, label: 'Fortran program' },
    { pattern: /\bimplicit\s+none\b/i, weight: 12, label: 'Fortran implicit none' },
    { pattern: /\bend\s+program\b/i, weight: 10, label: 'Fortran end program' },
  ],
  pascal: [
    { pattern: /^\s*program\s+\w+\s*;/im, weight: 10, label: 'Pascal program;' },
    { pattern: /\bbegin\b[\s\S]*\bwriteln\s*\([\s\S]*\bend\./i, weight: 12, label: 'Pascal begin/writeln/end.' },
  ],
  prolog: [
    { pattern: /^[a-z]\w*\([^)]*\)\s*:-\s*.+\./m, weight: 11, label: 'Prolog Horn clause :-' },
  ],
  lisp: [
    { pattern: /\(\s*defun\s+[a-zA-Z-]+\s*\(/, weight: 12, label: 'Common Lisp defun' },
    { pattern: /\(\s*format\s+t\s+"/, weight: 10, label: 'Common Lisp format' },
  ],
  clojure: [
    { pattern: /\(\s*defn\s+[a-zA-Z-]+\s*\[/, weight: 12, label: 'Clojure defn' },
    { pattern: /\(\s*ns\s+[a-z][\w.-]+/, weight: 10, label: 'Clojure ns' },
  ],
  scheme: [
    { pattern: /\(\s*define\s+\([a-zA-Z-]/, weight: 11, label: 'Scheme (define (...))' },
  ],
  racket: [
    { pattern: /^#lang\s+racket\b/m, weight: 15, label: 'Racket #lang' },
  ],
  zig: [
    { pattern: /@import\(\s*"std"\s*\)/, weight: 13, label: 'Zig @import("std")' },
    { pattern: /\bpub\s+fn\s+main\s*\(/, weight: 9, label: 'Zig pub fn main' },
  ],
  solidity: [
    { pattern: /\bpragma\s+solidity\b/, weight: 14, label: 'Solidity pragma' },
    { pattern: /\bcontract\s+[A-Z]\w*\s*\{/, weight: 10, label: 'Solidity contract' },
  ],
  perl: [
    { pattern: /\buse\s+strict\s*;/, weight: 10, label: 'Perl use strict;' },
    { pattern: /\bmy\s+[$@%]\w+\s*=/, weight: 9, label: 'Perl my $var' },
  ],
  julia: [
    { pattern: /^\s*function\s+\w+\([^)]*\)\s*$/m, weight: 6, label: 'Julia function' },
    { pattern: /\bprintln\s*\(/, weight: 3, label: 'println()' },
    { pattern: /\bfor\s+\w+\s+in\s+\d+:\d+/m, weight: 8, label: 'Julia range loop' },
  ],
  wat: [
    { pattern: /\(\s*module\b[\s\S]*\(\s*func\b/, weight: 13, label: 'WebAssembly Text (module (func ...))' },
  ],
  fsharp: [
    { pattern: /\bprintfn\s+"/, weight: 12, label: 'F# printfn' },
    { pattern: /\blet\s+rec\s+\w+\s+/, weight: 8, label: 'F# let rec' },
    { pattern: /\[<EntryPoint>\]/, weight: 14, label: 'F# [<EntryPoint>]' },
  ],
  ocaml: [
    { pattern: /\bprint_endline\b|\bPrintf\.printf\b/, weight: 12, label: 'OCaml print_endline/Printf' },
    { pattern: /\bmatch\s+\w+\s+with\b[\s\S]*\|/, weight: 8, label: 'OCaml match ... with' },
    { pattern: /;;\s*$/m, weight: 7, label: 'OCaml ;; terminator' },
  ],
  groovy: [
    { pattern: /\bdef\s+\w+\s*=[\s\S]*\bprintln\b/, weight: 8, label: 'Groovy def + println' },
    { pattern: /\b@Grab\b|\bimport\s+groovy\./, weight: 12, label: 'Groovy import/@Grab' },
  ],
  objc: [
    { pattern: /#import\s*<Foundation\/Foundation\.h>/, weight: 14, label: 'Objective-C Foundation import' },
    { pattern: /\bNSLog\s*\(\s*@"/, weight: 13, label: 'Objective-C NSLog(@"...)' },
    { pattern: /@(?:interface|implementation|autoreleasepool)\b/, weight: 11, label: 'Objective-C @directive' },
  ],
  vbnet: [
    { pattern: /\bModule\s+\w+[\s\S]*\bSub\s+Main\s*\(/i, weight: 14, label: 'VB.NET Module/Sub Main' },
    { pattern: /\bDim\s+\w+\s+As\s+(?:Integer|String|Double|Boolean)\b/i, weight: 11, label: 'VB.NET Dim ... As' },
    { pattern: /\bEnd\s+(?:Sub|Module|Function|If)\b/i, weight: 8, label: 'VB.NET End block' },
  ],
  powershell: [
    { pattern: /\bWrite-(?:Host|Output)\b/i, weight: 12, label: 'PowerShell Write-Host/Output' },
    { pattern: /\bGet-(?:ChildItem|Content|Process)\b/i, weight: 11, label: 'PowerShell cmdlet' },
    { pattern: /\$[A-Za-z_]\w*\s*=\s*[\d"'][\s\S]*-(?:eq|ne|gt|lt|ge|le)\b/, weight: 10, label: 'PowerShell $var + -eq/-gt' },
  ],
  matlab: [
    { pattern: /\bdisp\s*\([\s\S]*\)\s*;?[\s\S]*\bend\b/, weight: 7, label: 'MATLAB disp + end' },
    { pattern: /\bfprintf\s*\(\s*'[^']*\\n'/, weight: 10, label: 'MATLAB fprintf single-quoted' },
    { pattern: /\b(?:linspace|zeros|ones|meshgrid|plot)\s*\(/, weight: 8, label: 'MATLAB matrix/plot function' },
  ],
  octave: [
    { pattern: /\bendif\b|\bendfor\b|\bendfunction\b/, weight: 12, label: 'Octave endif/endfor/endfunction' },
  ],
  delphi: [
    { pattern: /\{\$APPTYPE\s+CONSOLE\}/i, weight: 14, label: 'Delphi $APPTYPE CONSOLE' },
    { pattern: /\buses\s+SysUtils\s*;/i, weight: 12, label: 'Delphi uses SysUtils' },
  ],
  nim: [
    { pattern: /\bproc\s+\w+\s*\([^)]*\)\s*:\s*\w+\s*=/, weight: 12, label: 'Nim proc declaration' },
    { pattern: /\becho\s+/, weight: 4, label: 'echo' },
    { pattern: /\bimport\s+strutils\b/, weight: 12, label: 'Nim import strutils' },
  ],
  crystal: [
    { pattern: /\bdef\s+\w+\s*\([^)]*:\s*(?:Int32|Int64|String|Float64)\)/, weight: 12, label: 'Crystal typed def' },
    { pattern: /\bputs\b[\s\S]*\btypeof\s*\(/, weight: 9, label: 'Crystal typeof' },
  ],
  ada: [
    { pattern: /\bwith\s+Ada\.Text_IO\s*;/i, weight: 14, label: 'Ada with Ada.Text_IO;' },
    { pattern: /\bprocedure\s+\w+\s+is\b/i, weight: 11, label: 'Ada procedure ... is' },
    { pattern: /\bPut_Line\s*\(/i, weight: 10, label: 'Ada Put_Line()' },
  ],
  tcl: [
    { pattern: /\bproc\s+\w+\s+\{[^}]*\}\s+\{/, weight: 12, label: 'Tcl proc {args} {body}' },
    { pattern: /\bputs\s+"[^"]*"|\bset\s+\w+\s+\[expr\b/, weight: 11, label: 'Tcl set/expr/puts' },
  ],
  awk: [
    { pattern: /\bBEGIN\s*\{[\s\S]*\bprint\b/, weight: 12, label: 'Awk BEGIN { print }' },
    { pattern: /\bEND\s*\{[\s\S]*\bprint\b/, weight: 9, label: 'Awk END { print }' },
    { pattern: /\$\d+\s*[+\-*/~]/, weight: 6, label: 'Awk field $1' },
  ],
  vlang: [
    { pattern: /\bfn\s+main\s*\(\s*\)\s*\{[\s\S]*\bprintln\s*\('/, weight: 12, label: 'V fn main() + println' },
    { pattern: /\bmut\s+\w+\s*:=/, weight: 11, label: 'V mut x :=' },
  ],
};

/**
 * Pure, deterministic, multi-signal language detector.
 * Combines source-code syntax signatures with optional filename extension,
 * allowing strong source signals to override mismatched/incorrect extensions.
 */
export function detectLanguageFromCode(
  source: string,
  filename?: string
): LanguageDetectionResult {
  const filenameLanguageId = filename ? detectLanguageFromFilenameStrict(filename) : null;
  const trimmed = source.trim();

  if (!trimmed) {
    const fallbackSpec = filenameLanguageId ? getLanguageSpec(filenameLanguageId) ?? null : null;
    return {
      languageId: filenameLanguageId,
      spec: fallbackSpec,
      confidence: filenameLanguageId ? 'medium' : 'low',
      score: filenameLanguageId ? 5 : 0,
      candidates: filenameLanguageId
        ? [{ languageId: filenameLanguageId, score: 5, matchedSignals: ['file extension'] }]
        : [],
      reason: filenameLanguageId
        ? `Detected from file extension (${filename}).`
        : 'Not enough source code to detect language.',
      filenameLanguageId,
      extensionMismatch: false,
    };
  }

  const scores = new Map<string, { score: number; signals: string[] }>();

  for (const [langId, rules] of Object.entries(LANGUAGE_RULES)) {
    let total = 0;
    const matched: string[] = [];
    for (const rule of rules) {
      if (rule.pattern.test(trimmed)) {
        total += rule.weight;
        matched.push(rule.label);
      }
    }
    if (total > 0) {
      scores.set(langId, { score: total, signals: matched });
    }
  }

  // Disambiguation refinements so overlapping languages never misclassify:
  // 1. TypeScript vs JavaScript: if TS-specific type annotations matched, boost TS over JS;
  //    if NO TS-specific syntax matched, ensure JS stays ahead of TS.
  const tsEntry = scores.get('ts');
  const jsEntry = scores.get('js');
  if (tsEntry) {
    const hasUniqueTsSignal = tsEntry.signals.some((s) => s.startsWith('TS '));
    if (hasUniqueTsSignal) {
      tsEntry.score += 6;
    } else {
      // Only console.log matched — not TypeScript-specific
      tsEntry.score = Math.max(0, tsEntry.score - 4);
    }
  }
  if (jsEntry && (!tsEntry || tsEntry.score < 8)) {
    // Give JS clean preference when code has standard JS syntax without TS types
    if (jsEntry.signals.length >= 2) {
      jsEntry.score += 2;
    }
  }

  // 2. C++ vs C: C++ headers/std:: strongly beat C even when printf/int main also appear
  const cppEntry = scores.get('cpp');
  const cEntry = scores.get('c');
  if (cppEntry && cppEntry.score >= 9 && cEntry) {
    cEntry.score = Math.max(0, cEntry.score - 5);
  }

  // 3. React/JSX vs HTML vs JS/TS: React hooks/imports override raw HTML tag matches
  const reactEntry = scores.get('react');
  const htmlEntry = scores.get('html');
  if (reactEntry && reactEntry.score >= 8 && htmlEntry) {
    htmlEntry.score = Math.max(0, htmlEntry.score - 6);
  }

  // 4. Python vs Ruby: Python def ...: with colon beats Ruby
  const pyEntry = scores.get('py');
  if (pyEntry && trimmed.includes('{') && trimmed.includes(';') && !/^\s*def\s+\w+\s*\(/m.test(trimmed)) {
    // Semicolons + braces without Python def usually means C-like or JS, not Python
    pyEntry.score = Math.max(0, pyEntry.score - 4);
  }

  // Build pure-code sorted candidates BEFORE applying filename hint
  const codeCandidates: DetectionCandidate[] = [...scores.entries()]
    .filter(([, v]) => v.score > 0)
    .map(([languageId, v]) => ({
      languageId: languageId as LanguageId,
      score: v.score,
      matchedSignals: v.signals,
    }))
    .sort((a, b) => b.score - a.score);

  const topCode = codeCandidates[0] || null;
  const secondCode = codeCandidates[1] || null;

  // Detect extension mismatch: code strongly says language A while filename says language B
  // (ignore ts/js or c/cpp minor pairs only if code score is weak)
  const extensionMismatch = Boolean(
    filenameLanguageId &&
      topCode &&
      topCode.languageId !== filenameLanguageId &&
      topCode.score >= 9 &&
      !(filenameLanguageId === 'react' && (topCode.languageId === 'js' || topCode.languageId === 'ts'))
  );

  // Add modest filename bonus ONLY when code does not strongly contradict the extension
  if (filenameLanguageId && !extensionMismatch) {
    const existing = scores.get(filenameLanguageId) || { score: 0, signals: [] };
    existing.score += 4;
    existing.signals = [...existing.signals, `file extension (${filename})`];
    scores.set(filenameLanguageId, existing);
  }

  const finalCandidates: DetectionCandidate[] = [...scores.entries()]
    .filter(([, v]) => v.score > 0)
    .map(([languageId, v]) => ({
      languageId: languageId as LanguageId,
      score: v.score,
      matchedSignals: v.signals,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const winner = finalCandidates[0] || null;
  const runnerUp = finalCandidates[1] || null;

  if (!winner) {
    return {
      languageId: null,
      spec: null,
      confidence: 'low',
      score: 0,
      candidates: [],
      reason: 'Snippet is too short or ambiguous to identify a specific language.',
      filenameLanguageId,
      extensionMismatch: false,
    };
  }

  const margin = winner.score - (runnerUp?.score ?? 0);
  const nonTrivialLines = trimmed.split('\n').filter((l) => l.trim().length > 0).length;

  let confidence: DetectionConfidence = 'low';
  if (winner.score >= 10 && margin >= 4) {
    confidence = 'high';
  } else if (winner.score >= 7 && margin >= 3 && (nonTrivialLines >= 2 || winner.matchedSignals.length >= 2)) {
    confidence = 'high';
  } else if (winner.score >= 5 && margin >= 2) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  // Tiny single-line ambiguous snippets like `x = 1` or `a = b + c` must remain low confidence
  if (nonTrivialLines === 1 && trimmed.length < 24 && winner.score < 9) {
    confidence = 'low';
  }

  const spec = getLanguageSpec(winner.languageId) ?? null;
  const signalText = winner.matchedSignals.slice(0, 3).join(', ');
  const reason = extensionMismatch
    ? `Code looks like ${spec?.name || winner.languageId} (${signalText}), even though the file extension suggested ${getLanguageSpec(filenameLanguageId!)?.name || filenameLanguageId}.`
    : `Detected ${spec?.name || winner.languageId} from ${signalText || 'syntax patterns'}.`;

  // Keep reference to secondCode used for diagnostics
  void secondCode;

  return {
    languageId: winner.languageId,
    spec,
    confidence,
    score: winner.score,
    candidates: finalCandidates,
    reason,
    filenameLanguageId,
    extensionMismatch,
  };
}

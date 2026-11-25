import type { ExecutionSummary, LanguageId, TraceDocument } from '../types/trace';
import { getLanguageSpec } from './languageRegistry';
import { reconstructWorkspaceState } from './structureReconstructor';

export interface ProgramAnalysis {
  summary: ExecutionSummary;
  structureKinds: string[];
  hasRecursion: boolean;
  maxCallDepth: number;
  loopIterations: number;
  branchDecisions: number;
  usesInput: boolean;
}

function estimateLoopNesting(sourceCode: string): number {
  const lines = sourceCode.split('\n');
  let maxDepth = 0;
  let braceDepth = 0;
  const loopBraceStack: number[] = [];
  const pyLoopIndents: number[] = [];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;

    // Pop Python loops when dedented
    while (pyLoopIndents.length > 0 && indent <= pyLoopIndents[pyLoopIndents.length - 1]) {
      pyLoopIndents.pop();
    }

    const isLoopLine = /^(?:for|while)\b/.test(trimmed);
    if (isLoopLine) {
      if (trimmed.endsWith(':')) {
        pyLoopIndents.push(indent);
        maxDepth = Math.max(maxDepth, pyLoopIndents.length);
      } else {
        loopBraceStack.push(braceDepth);
        maxDepth = Math.max(maxDepth, loopBraceStack.length);
      }
    }

    for (const ch of trimmed) {
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        while (loopBraceStack.length > 0 && braceDepth <= loopBraceStack[loopBraceStack.length - 1]) {
          loopBraceStack.pop();
        }
      }
    }
  }

  return maxDepth;
}

function describeStructureLabel(s: ReturnType<typeof reconstructWorkspaceState>['structures'][number]): string {
  switch (s.kind) {
    case 'array':
      if (s.roleHint === 'dp-table') return s.isMatrix ? '2D DP Table' : 'DP Table';
      if (s.roleHint === 'matrix') return '2D Matrix';
      if (s.roleHint === 'stack') return 'Stack';
      if (s.roleHint === 'queue') return 'Queue';
      if (s.roleHint === 'deque') return 'Deque';
      if (s.roleHint === 'circular-queue') return 'Circular Queue';
      if (s.roleHint === 'heap') return s.heapOrder === 'max-heap' ? 'Max Heap' : s.heapOrder === 'min-heap' ? 'Min Heap' : 'Heap / Priority Queue';
      if (s.roleHint === 'disjoint-set') return 'Disjoint Set (Union-Find)';
      return 'Array / List';
    case 'set':
      return 'Set';
    case 'hash-table':
      return 'Hash Table / Map';
    case 'linked-list':
      if (s.isCircular) return s.isDoublyLinked ? 'Circular Doubly Linked List' : 'Circular Linked List';
      return s.isDoublyLinked ? 'Doubly Linked List' : 'Singly Linked List';
    case 'tree':
      if (s.treeVariant === 'trie') return 'Trie (Prefix Tree)';
      if (s.treeVariant === 'bst') return 'Binary Search Tree';
      if (s.treeVariant === 'avl') return 'AVL Balanced Tree';
      if (s.treeVariant === 'red-black') return 'Red-Black Tree';
      return s.treeKind === 'general' ? 'General Tree' : 'Binary Tree';
    case 'graph': {
      const qualifiers: string[] = [];
      qualifiers.push(s.isDirected ? 'Directed' : 'Undirected');
      if (s.isWeighted) qualifiers.push('Weighted');
      return `${qualifiers.join(' ')} Graph`;
    }
    case 'object':
      return s.className ? `Object (${s.className})` : 'Object';
  }
}

/**
 * Combines static source-code analysis with the actual execution trace to detect
 * data structures, observed operations, purpose summary, and clearly-labeled
 * theoretical complexity estimates (without relying on fixed variable names).
 */
export function analyzeProgramExecution(
  sourceCode: string,
  document: TraceDocument,
  options?: { measuredDurationMs?: number; aiPurpose?: string }
): ProgramAnalysis {
  const spec = getLanguageSpec(document.language);
  const detectedLanguage = spec?.name || String(document.language).toUpperCase();

  const structureSet = new Set<string>();
  const operationSet = new Set<string>();
  let maxCallDepth = 1;
  let loopIterations = 0;
  let branchDecisions = 0;
  let hasSwaps = false;
  let hasMatrixOrDp = false;
  let hasGraph = false;
  let hasTree = false;
  let hasLinkedList = false;
  let hasHashTable = false;

  const fnNameCountsMax = new Map<string, number>();

  // Sample states across trace (first, quartiles, last, plus structural change events)
  const events = document.events;
  const sampleIndices = new Set<number>([
    0,
    Math.floor(events.length / 3),
    Math.floor((2 * events.length) / 3),
    Math.max(0, events.length - 1),
  ]);

  events.forEach((ev, idx) => {
    maxCallDepth = Math.max(maxCallDepth, ev.callStack.length);
    const frameCounts = new Map<string, number>();
    for (const f of ev.callStack) {
      if (f.name !== 'main') {
        frameCounts.set(f.name, (frameCounts.get(f.name) || 0) + 1);
      }
    }
    for (const [fn, c] of frameCounts.entries()) {
      fnNameCountsMax.set(fn, Math.max(fnNameCountsMax.get(fn) || 0, c));
    }

    if (ev.type === 'loop_iteration') {
      loopIterations++;
      operationSet.add('Repeating loop steps');
    } else if (ev.type === 'branch_decision') {
      branchDecisions++;
      operationSet.add('Checking conditions (if/else)');
    } else if (ev.type === 'array_swap') {
      hasSwaps = true;
      operationSet.add('Swapping items in a list');
    } else if (ev.type === 'array_append' || ev.type === 'array_insert' || ev.type === 'array_update') {
      operationSet.add('Adding or updating list items');
    } else if (ev.type === 'array_remove') {
      operationSet.add('Removing items from a list/stack/queue');
    } else if (ev.type === 'tree_insert' || ev.type === 'tree_delete' || ev.type === 'reference_update') {
      operationSet.add('Connecting or updating object links');
      sampleIndices.add(idx);
    } else if (ev.type === 'graph_visit') {
      operationSet.add('Visiting connected graph nodes');
      sampleIndices.add(idx);
    } else if (ev.type === 'function_call') {
      operationSet.add('Calling functions');
    } else if (ev.type === 'console_output' || ev.print) {
      operationSet.add('Printing output to the console');
    }
  });

  const hasRecursion = [...fnNameCountsMax.values()].some((count) => count >= 2);
  if (hasRecursion) {
    operationSet.add(`Recursive calls (max depth ${maxCallDepth})`);
  }

  for (const idx of sampleIndices) {
    const ev = events[idx];
    if (!ev) continue;
    const prev = idx > 0 ? events[idx - 1] : null;
    const ws = reconstructWorkspaceState(ev, prev);
    for (const s of ws.structures) {
      const label = describeStructureLabel(s);
      structureSet.add(label);
      if (s.kind === 'array' && (s.isMatrix || s.roleHint === 'dp-table')) hasMatrixOrDp = true;
      if (s.kind === 'graph') hasGraph = true;
      if (s.kind === 'tree') hasTree = true;
      if (s.kind === 'linked-list') hasLinkedList = true;
      if (s.kind === 'hash-table') hasHashTable = true;
    }
  }

  const usesInput = /\b(?:input|readLine|readline|prompt|readAllInput|scanf|cin|Scanner|ReadLine)\b/.test(sourceCode);
  if (usesInput) {
    operationSet.add('Reading user input');
  }

  const detectedStructures = [...structureSet];
  const observedOperations = [...operationSet];
  const finalEvent = events[events.length - 1];
  const finalOutput = (finalEvent?.outText || '').trim();

  // Build simple-English deterministic purpose fallback
  let deterministicPurpose = 'Runs a step-by-step program and updates values in memory.';
  if (hasGraph && detectedStructures.includes('Queue')) {
    deterministicPurpose = 'Explores a graph level by level using a queue and keeps track of visited nodes.';
  } else if (hasGraph) {
    deterministicPurpose = 'Works with a graph of connected nodes and explores or updates its links.';
  } else if (hasMatrixOrDp) {
    deterministicPurpose = 'Builds and updates a table of values step by step to calculate the final answer.';
  } else if (hasTree) {
    deterministicPurpose = 'Builds or walks through a tree made of connected parent and child nodes.';
  } else if (hasLinkedList) {
    deterministicPurpose = 'Creates or moves through a chain of linked nodes connected by references.';
  } else if (hasSwaps) {
    deterministicPurpose = 'Reorders items in a list by comparing and swapping elements.';
  } else if (hasRecursion) {
    deterministicPurpose = 'Solves a problem using a function that calls itself with smaller inputs until it reaches a stopping case.';
  } else if (hasHashTable) {
    deterministicPurpose = 'Stores and looks up key-value pairs in a dictionary or hash table.';
  } else if (detectedStructures.includes('Stack')) {
    deterministicPurpose = 'Pushes and pops items using a last-in, first-out stack.';
  } else if (detectedStructures.includes('Queue')) {
    deterministicPurpose = 'Processes items in order using a first-in, first-out queue.';
  } else if (detectedStructures.includes('Array / List')) {
    deterministicPurpose = 'Stores items in a list, steps through or changes them, and produces a result.';
  }

  // Theoretical complexity estimate (explicitly separated from measured runtime!)
  const loopNesting = estimateLoopNesting(sourceCode);
  const callsSort = /\.sort\s*\(|\bsorted\s*\(/.test(sourceCode);
  let theoreticalTimeComplexity: string | undefined;
  let theoreticalSpaceComplexity: string | undefined;
  let complexityNote: string | undefined;

  if (hasGraph) {
    theoreticalTimeComplexity = 'O(V + E)';
    theoreticalSpaceComplexity = 'O(V)';
    complexityNote = 'Theoretical estimate for traversing vertices (V) and edges (E) — not a measured benchmark.';
  } else if (hasMatrixOrDp && loopNesting >= 2) {
    theoreticalTimeComplexity = 'O(n × m)';
    theoreticalSpaceComplexity = 'O(n × m)';
    complexityNote = 'Theoretical estimate based on nested loops over a 2D table — not a measured benchmark.';
  } else if (loopNesting >= 2) {
    theoreticalTimeComplexity = 'O(n²)';
    theoreticalSpaceComplexity = 'O(1) to O(n)';
    complexityNote = 'Theoretical estimate based on nested loops detected in code — not a measured benchmark.';
  } else if (callsSort) {
    theoreticalTimeComplexity = 'O(n log n)';
    theoreticalSpaceComplexity = 'O(n)';
    complexityNote = 'Theoretical estimate based on built-in sorting — not a measured benchmark.';
  } else if (hasRecursion && loopNesting === 0) {
    theoreticalTimeComplexity = 'O(n) to O(2ⁿ) depending on branching';
    theoreticalSpaceComplexity = `O(depth) (observed stack depth ${maxCallDepth})`;
    complexityNote = 'Theoretical estimate based on recursive call structure — not a measured benchmark.';
  } else if (loopNesting === 1) {
    theoreticalTimeComplexity = 'O(n)';
    theoreticalSpaceComplexity = detectedStructures.length > 0 ? 'O(n)' : 'O(1)';
    complexityNote = 'Theoretical estimate based on a single loop pass — not a measured benchmark.';
  } else if (events.length > 0) {
    theoreticalTimeComplexity = 'O(1)';
    theoreticalSpaceComplexity = 'O(1)';
    complexityNote = 'Theoretical estimate for straight-line steps without loops — not a measured benchmark.';
  }

  const status: ExecutionSummary['status'] =
    document.executionMode === 'simulated'
      ? 'simulated'
      : document.interrupted || document.warning
        ? 'stopped_early'
        : 'completed';

  return {
    summary: {
      detectedLanguage,
      languageId: document.language as LanguageId,
      executionMode: document.executionMode,
      purpose: options?.aiPurpose?.trim() || deterministicPurpose,
      detectedStructures: detectedStructures.length > 0 ? detectedStructures : ['Simple Variables'],
      observedOperations: observedOperations.length > 0 ? observedOperations : ['Step-by-step variable updates'],
      finalOutput: finalOutput || 'No console output printed.',
      stepCount: events.length,
      status,
      measuredDurationMs: options?.measuredDurationMs,
      theoreticalTimeComplexity,
      theoreticalSpaceComplexity,
      complexityNote,
    },
    structureKinds: detectedStructures,
    hasRecursion,
    maxCallDepth,
    loopIterations,
    branchDecisions,
    usesInput,
  };
}

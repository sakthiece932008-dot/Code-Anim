import type { ExecutionSummary, TraceDocument } from '../types/trace';

export interface SimpleComplexityGuide {
  timeNotation: string | null;
  timeSimpleExplanation: string;
  spaceNotation: string | null;
  spaceSimpleExplanation: string;
  confidence: 'high' | 'medium' | 'uncertain';
  disclaimer: string;
  observedMetrics: {
    recordedSteps: number;
    comparisonsOrBranches: number;
    swaps: number;
    loopIterations: number;
    functionCalls: number;
    maxStackDepth: number;
    measuredDurationMs?: number;
  };
}

export function explainBigOInSimpleEnglish(notation: string | undefined): string {
  if (!notation) {
    return 'We cannot determine the theoretical growth rate confidently from this code alone.';
  }
  const norm = notation.toLowerCase().replace(/\s+/g, '');

  if (norm.includes('o(1)') && !norm.includes('o(n)')) {
    return 'The amount of work stays roughly the same even when the input becomes much bigger.';
  }
  if (norm.includes('o(logn)') && !norm.includes('nlogn')) {
    return 'The program repeatedly cuts the remaining work into smaller parts, so even very large lists finish quickly.';
  }
  if (norm.includes('nlogn')) {
    return 'The program splits and combines the data cleanly. It grows slightly faster than the input size, which is fast for sorting large lists.';
  }
  if (norm.includes('n²') || norm.includes('n^2')) {
    return 'As the list becomes bigger, the program has to do much more work. Doubling the number of items can make the work grow to roughly four times as much.';
  }
  if (norm.includes('n×m') || norm.includes('n*m')) {
    return 'The program fills or checks a grid with rows and columns, so total work grows with rows times columns.';
  }
  if (norm.includes('v+e')) {
    return 'The program visits each connected point (vertex) and link (edge) a bounded number of times.';
  }
  if (norm.includes('2ⁿ') || norm.includes('2^n')) {
    return 'Because the function branches into multiple recursive calls, adding just a few more items can multiply the amount of work quickly.';
  }
  if (norm.includes('o(n)')) {
    return 'The amount of work grows steadily in step with the size of the input. Twice as many items means roughly twice as much work.';
  }
  if (norm.includes('depth')) {
    return 'Memory usage depends on how many unfinished function calls are stacked up at the same time.';
  }
  return 'Theoretical growth estimate based on the loop and recursion pattern seen in the code.';
}

export function explainSpaceInSimpleEnglish(notation: string | undefined): string {
  if (!notation) {
    return 'Memory growth could not be estimated confidently from this code.';
  }
  const norm = notation.toLowerCase().replace(/\s+/g, '');
  if (norm.includes('o(1)') && !norm.includes('o(n)')) {
    return 'Uses a small, fixed amount of extra memory regardless of how big the input gets.';
  }
  if (norm.includes('n×m') || norm.includes('n*m')) {
    return 'Stores a 2D table in memory whose size grows with rows times columns.';
  }
  if (norm.includes('o(v)')) {
    return 'Keeps track of visited nodes or queues proportional to the number of points in the graph.';
  }
  if (norm.includes('depth')) {
    return 'Each nested recursive call uses a small slot on the call stack until it returns.';
  }
  if (norm.includes('o(n)')) {
    return 'Stores a list, map, or set whose memory grows in step with the number of items.';
  }
  return 'Estimated extra memory needed while the program runs.';
}

export function buildSimpleComplexityGuide(
  sourceCode: string,
  document: TraceDocument,
  summary: ExecutionSummary
): SimpleComplexityGuide {
  let comparisonsOrBranches = 0;
  let swaps = 0;
  let loopIterations = 0;
  let functionCalls = 0;
  let maxStackDepth = 1;

  for (const ev of document.events) {
    maxStackDepth = Math.max(maxStackDepth, ev.callStack.length);
    if (ev.type === 'branch_decision') comparisonsOrBranches++;
    if (ev.type === 'array_swap') swaps++;
    if (ev.type === 'loop_iteration') loopIterations++;
    if (ev.type === 'function_call') functionCalls++;
  }

  // Detect logarithmic halving pattern (e.g. binary search: mid = (low + high) / 2, hi = mid - 1, n = n // 2)
  const hasHalvingLoop =
    /\bwhile\b/.test(sourceCode) &&
    (/\/=\s*2|\/\/=\s*2|>>=\s*1|\bmid\b/.test(sourceCode) &&
      (/\b(?:low|left|lo)\s*=|\b(?:high|right|hi)\s*=|\/=\s*2|\/\/=\s*2/.test(sourceCode)));

  // Detect divide-and-conquer merge/quick sort style recursion
  const hasDivideAndConquer =
    /\bmergeSort|quickSort|merge_sort|quick_sort\b/i.test(sourceCode) &&
    functionCalls >= 2;

  let timeNotation: string | null = summary.theoreticalTimeComplexity || null;
  let spaceNotation: string | null = summary.theoreticalSpaceComplexity || null;
  let confidence: SimpleComplexityGuide['confidence'] = 'medium';

  if (hasDivideAndConquer) {
    timeNotation = 'O(n log n)';
    spaceNotation = 'O(n)';
    confidence = 'medium';
  } else if (hasHalvingLoop && timeNotation === 'O(n)') {
    timeNotation = 'O(log n)';
    spaceNotation = 'O(1)';
    confidence = 'high';
  } else if (document.executionMode === 'simulated') {
    confidence = 'uncertain';
  } else if (
    !timeNotation ||
    summary.stepCount <= 1 ||
    /\beval\b|\bimport\b/.test(sourceCode)
  ) {
    confidence = 'uncertain';
  }

  if (confidence === 'uncertain' && !timeNotation) {
    return {
      timeNotation: null,
      timeSimpleExplanation:
        'Complexity cannot be determined confidently from this snippet alone. Inspect the observed step and operation counts below.',
      spaceNotation: null,
      spaceSimpleExplanation:
        'Memory complexity cannot be determined confidently from this snippet alone.',
      confidence: 'uncertain',
      disclaimer:
        'Theoretical complexity is separate from measured execution time and recorded trace-step count.',
      observedMetrics: {
        recordedSteps: document.events.length,
        comparisonsOrBranches,
        swaps,
        loopIterations,
        functionCalls,
        maxStackDepth,
        measuredDurationMs: summary.measuredDurationMs,
      },
    };
  }

  return {
    timeNotation,
    timeSimpleExplanation: explainBigOInSimpleEnglish(timeNotation || undefined),
    spaceNotation,
    spaceSimpleExplanation: explainSpaceInSimpleEnglish(spaceNotation || undefined),
    confidence,
    disclaimer:
      'Theoretical analysis describes how work grows with larger inputs. It is separate from the measured trace duration and recorded step count for this single run.',
    observedMetrics: {
      recordedSteps: document.events.length,
      comparisonsOrBranches,
      swaps,
      loopIterations,
      functionCalls,
      maxStackDepth,
      measuredDurationMs: summary.measuredDurationMs,
    },
  };
}

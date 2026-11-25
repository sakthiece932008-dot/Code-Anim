import type { LanguageId } from '../types/trace';

export type LibraryCategory = 'fundamentals' | 'data-structures' | 'algorithms';
export type DifficultyLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface LearningExample {
  id: string;
  title: string;
  category: LibraryCategory;
  topic: string;
  difficulty: DifficultyLevel;
  lang: LanguageId;
  description: string;
  objectives: string[];
  code: string;
  sampleInput?: string;
  expectedOutput: string;
}

/**
 * Built-in Educational Programming Library.
 * Every example executes through the exact same live execution & animation engine
 * as user-submitted programs (no hardcoded visualization paths).
 */
export const LEARNING_LIBRARY: LearningExample[] = [
  // ===================== PROGRAMMING FUNDAMENTALS =====================
  {
    id: 'fund-variables-js',
    title: 'Variables & Updating Values',
    category: 'fundamentals',
    topic: 'Variables',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Watch how variables store numbers and text, and how reassigning a variable replaces its old value.',
    objectives: ['Understand variable creation', 'See how values update step by step'],
    expectedOutput: 'Maya now has 15 points',
    code: `let name = "Maya";
let score = 10;
score = score + 5;
console.log(name, "now has", score, "points");`,
  },
  {
    id: 'fund-conditions-py',
    title: 'Making Decisions with If / Else',
    category: 'fundamentals',
    topic: 'Conditions',
    difficulty: 'Beginner',
    lang: 'py',
    description: 'See how a program checks a condition and picks one path while skipping the others.',
    objectives: ['Trace if/elif/else branches', 'Observe how conditions evaluate to true or false'],
    sampleInput: '78',
    expectedOutput: 'Grade: B',
    code: `score = int(input())
if score >= 90:
    grade = "A"
elif score >= 75:
    grade = "B"
else:
    grade = "C"
print("Grade:", grade)`,
  },
  {
    id: 'fund-loops-js',
    title: 'Counting & Summing with a Loop',
    category: 'fundamentals',
    topic: 'Loops',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Follow a loop counter as it repeats steps to add up numbers from 1 to 5.',
    objectives: ['Track a loop counter variable', 'Watch a running sum accumulate each round'],
    expectedOutput: 'Total sum: 15',
    code: `let total = 0;
for (let i = 1; i <= 5; i++) {
  total = total + i;
}
console.log("Total sum:", total);`,
  },
  {
    id: 'fund-functions-py',
    title: 'Calling Reusable Functions',
    category: 'fundamentals',
    topic: 'Functions',
    difficulty: 'Beginner',
    lang: 'py',
    description: 'Watch the call stack grow when a function is called and shrink when it sends back its answer.',
    objectives: ['Trace arguments entering a function', 'See return values flow back to the caller'],
    expectedOutput: 'Area: 24',
    code: `def rect_area(width, height):
    result = width * height
    return result

area = rect_area(6, 4)
print("Area:", area)`,
  },
  {
    id: 'fund-arrays-ts',
    title: 'Working with Typed Arrays',
    category: 'fundamentals',
    topic: 'Arrays',
    difficulty: 'Beginner',
    lang: 'ts',
    description: 'Walk through a TypeScript array to find the largest number and add a new item.',
    objectives: ['Inspect array indices and values', 'Trace linear scanning with a max tracker'],
    expectedOutput: 'Max: 19',
    code: `const temps: number[] = [12, 19, 15, 8];
let highest: number = temps[0];
for (let i: number = 1; i < temps.length; i++) {
  if (temps[i] > highest) {
    highest = temps[i];
  }
}
temps.push(21);
console.log("Max:", highest);`,
  },
  {
    id: 'fund-strings-js',
    title: 'Reversing a String Step by Step',
    category: 'fundamentals',
    topic: 'Strings',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Build a reversed word one letter at a time by reading characters from the end to the start.',
    objectives: ['Read string characters by index', 'Watch a new string grow character by character'],
    expectedOutput: 'Reversed: edoc',
    code: `const word = "code";
let reversed = "";
for (let i = word.length - 1; i >= 0; i--) {
  reversed = reversed + word[i];
}
console.log("Reversed:", reversed);`,
  },
  {
    id: 'fund-recursion-py',
    title: 'Recursive Factorial & Call Stack',
    category: 'fundamentals',
    topic: 'Recursion',
    difficulty: 'Intermediate',
    lang: 'py',
    description: 'Watch a function call itself with smaller numbers until it hits the stopping case, then multiply on the way back.',
    objectives: ['Visualize nested recursive call frames', 'Understand base case vs recursive step'],
    expectedOutput: '4! = 24',
    code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)

ans = factorial(4)
print("4! =", ans)`,
  },

  // ===================== DATA STRUCTURES =====================
  {
    id: 'ds-arrays-js',
    title: 'Dynamic Array Operations',
    category: 'data-structures',
    topic: 'Arrays',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Create an array, append values, update a slot, and remove an item while watching indices shift.',
    objectives: ['See push, index update, and splice animations', 'Track length changes'],
    expectedOutput: 'Final: [10,25,40]',
    code: `const list = [10, 20, 30];
list.push(40);
list[1] = 25;
list.splice(2, 1);
console.log("Final:", JSON.stringify(list));`,
  },
  {
    id: 'ds-linked-list-js',
    title: 'Singly Linked List Insertion',
    category: 'data-structures',
    topic: 'Linked Lists',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Connect nodes with next pointers and insert a new node in the middle without shifting an array.',
    objectives: ['Follow node references and object IDs', 'See pointer rewiring during middle insertion'],
    expectedOutput: 'Head -> 10 -> 15 -> 20',
    code: `class Node {
  constructor(val) {
    this.val = val;
    this.next = null;
  }
}
const head = new Node(10);
const tail = new Node(20);
head.next = tail;
const middle = new Node(15);
middle.next = tail;
head.next = middle;
console.log("Head ->", head.val, "->", head.next.val, "->", head.next.next.val);`,
  },
  {
    id: 'ds-stack-py',
    title: 'Stack (Last-In, First-Out)',
    category: 'data-structures',
    topic: 'Stacks',
    difficulty: 'Beginner',
    lang: 'py',
    description: 'Push plates onto a stack and pop from the top to see LIFO order in action.',
    objectives: ['Understand LIFO ordering', 'Watch push and pop operations on the top element'],
    expectedOutput: 'Popped: 30 | Remaining: [10, 20]',
    code: `stack = []
stack.append(10)
stack.append(20)
stack.append(30)
top_item = stack.pop()
print("Popped:", top_item, "| Remaining:", stack)`,
  },
  {
    id: 'ds-queue-js',
    title: 'Queue (First-In, First-Out)',
    category: 'data-structures',
    topic: 'Queues',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Add tasks to the back of a queue and serve them from the front in FIFO order.',
    objectives: ['Understand FIFO ordering', 'Contrast enqueue (push) and dequeue (shift)'],
    expectedOutput: 'Served: Task1 then Task2',
    code: `const queue = [];
queue.push("Task1");
queue.push("Task2");
queue.push("Task3");
const first = queue.shift();
const second = queue.shift();
console.log("Served:", first, "then", second);`,
  },
  {
    id: 'ds-tree-bst-js',
    title: 'Binary Search Tree Insertion',
    category: 'data-structures',
    topic: 'Trees',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Insert numbers into a Binary Search Tree so smaller values go left and larger values go right.',
    objectives: ['Watch circular tree nodes and edges grow', 'Observe the BST ordering rule'],
    expectedOutput: 'Root: 15 (L: 8, R: 22)',
    code: `class TreeNode {
  constructor(value) {
    this.value = value;
    this.left = null;
    this.right = null;
  }
}
function insert(root, val) {
  if (!root) return new TreeNode(val);
  if (val < root.value) root.left = insert(root.left, val);
  else root.right = insert(root.right, val);
  return root;
}
let root = null;
for (const v of [15, 8, 22, 4, 12, 30]) {
  root = insert(root, v);
}
console.log("Root:", root.value, "(L:", root.left.value, ", R:", root.right.value, ")");`,
  },
  {
    id: 'ds-graph-js',
    title: 'Graph Adjacency List & Traversal',
    category: 'data-structures',
    topic: 'Graphs',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Represent connected cities in a graph and explore neighbors while marking visited nodes.',
    objectives: ['See graph nodes and edges simultaneously with a queue and visited set', 'Track visited highlights'],
    expectedOutput: 'Visited: A, B, C, D',
    code: `const graph = {
  A: ["B", "C"],
  B: ["D"],
  C: ["D"],
  D: []
};
const visited = new Set(["A"]);
const queue = ["A"];
const order = [];
while (queue.length > 0) {
  const cur = queue.shift();
  order.push(cur);
  for (const nxt of graph[cur]) {
    if (!visited.has(nxt)) {
      visited.add(nxt);
      queue.push(nxt);
    }
  }
}
console.log("Visited:", order.join(", "));`,
  },
  {
    id: 'ds-heap-js',
    title: 'Min-Heap Push & Bubble Up',
    category: 'data-structures',
    topic: 'Heaps',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Insert elements into a min-heap array and bubble smaller numbers upward to keep the smallest at the top.',
    objectives: ['See parent/child index math in a heap', 'Watch bubble-up swaps maintain heap order'],
    expectedOutput: 'Min item: 2',
    code: `const minHeap = [];
function heapPush(val) {
  minHeap.push(val);
  let i = minHeap.length - 1;
  while (i > 0) {
    const p = Math.floor((i - 1) / 2);
    if (minHeap[p] <= minHeap[i]) break;
    const tmp = minHeap[p];
    minHeap[p] = minHeap[i];
    minHeap[i] = tmp;
    i = p;
  }
}
for (const n of [9, 5, 7, 2, 6]) heapPush(n);
console.log("Min item:", minHeap[0]);`,
  },
  {
    id: 'ds-hash-table-py',
    title: 'Hash Table Word Frequency Counter',
    category: 'data-structures',
    topic: 'Hash Tables',
    difficulty: 'Beginner',
    lang: 'py',
    description: 'Count how many times each fruit appears using a dictionary (hash table) of key-value pairs.',
    objectives: ['Observe key creation vs value increment in a hash table', 'Understand O(1) key lookups'],
    expectedOutput: "Counts: {'apple': 3, 'pear': 2, 'plum': 1}",
    code: `words = ["apple", "pear", "apple", "plum", "pear", "apple"]
counts = {}
for w in words:
    if w in counts:
        counts[w] = counts[w] + 1
    else:
        counts[w] = 1
print("Counts:", counts)`,
  },
  {
    id: 'ds-set-js',
    title: 'Set Deduplication',
    category: 'data-structures',
    topic: 'Sets',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Add repeated values into a Set and see how duplicates are automatically ignored.',
    objectives: ['Understand unique membership in a Set', 'Compare input list vs unique Set'],
    expectedOutput: 'Unique count: 3',
    code: `const raw = ["red", "blue", "red", "green", "blue"];
const uniqueColors = new Set();
for (const c of raw) {
  uniqueColors.add(c);
}
console.log("Unique count:", uniqueColors.size);`,
  },
  {
    id: 'ds-matrix-js',
    title: '2D Matrix Row Sums',
    category: 'data-structures',
    topic: 'Matrices',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Step through rows and columns of a 2D matrix and compute the sum of each row.',
    objectives: ['Visualize nested row/column grids', 'Track two loop indices r and c'],
    expectedOutput: 'Row sums: [6, 15]',
    code: `const matrix = [
  [1, 2, 3],
  [4, 5, 6]
];
const rowSums = [];
for (let r = 0; r < matrix.length; r++) {
  let sum = 0;
  for (let c = 0; c < matrix[r].length; c++) {
    sum += matrix[r][c];
  }
  rowSums.push(sum);
}
console.log("Row sums:", JSON.stringify(rowSums));`,
  },

  // ===================== ALGORITHMS =====================
  {
    id: 'alg-linear-search-js',
    title: 'Linear Search',
    category: 'algorithms',
    topic: 'Linear Search',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Check each item in a list one by one until the target value is found.',
    objectives: ['Count step-by-step comparisons', 'See early stop when target is found'],
    expectedOutput: 'Found 14 at index 3',
    code: `const nums = [4, 9, 2, 14, 7, 11];
const target = 14;
let foundAt = -1;
for (let i = 0; i < nums.length; i++) {
  if (nums[i] === target) {
    foundAt = i;
    break;
  }
}
console.log("Found", target, "at index", foundAt);`,
  },
  {
    id: 'alg-binary-search-js',
    title: 'Binary Search',
    category: 'algorithms',
    topic: 'Binary Search',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Find a number in a sorted list by repeatedly cutting the search range in half.',
    objectives: ['Watch low, mid, and high pointers narrow down', 'Understand O(log n) halving'],
    expectedOutput: 'Found 23 at index 5',
    code: `const sorted = [3, 7, 11, 15, 19, 23, 31, 42];
const target = 23;
let low = 0;
let high = sorted.length - 1;
let found = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (sorted[mid] === target) {
    found = mid;
    break;
  } else if (sorted[mid] < target) {
    low = mid + 1;
  } else {
    high = mid - 1;
  }
}
console.log("Found", target, "at index", found);`,
  },
  {
    id: 'alg-bubble-sort-js',
    title: 'Bubble Sort',
    category: 'algorithms',
    topic: 'Bubble Sort',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Compare neighbors and swap them whenever the left number is bigger than the right number.',
    objectives: ['See live swap animations', 'Watch the largest numbers bubble to the end'],
    expectedOutput: 'Sorted: [1, 2, 4, 5, 8]',
    code: `const arr = [5, 1, 8, 4, 2];
for (let i = 0; i < arr.length - 1; i++) {
  for (let j = 0; j < arr.length - 1 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      const tmp = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = tmp;
    }
  }
}
console.log("Sorted:", JSON.stringify(arr));`,
  },
  {
    id: 'alg-selection-sort-js',
    title: 'Selection Sort',
    category: 'algorithms',
    topic: 'Selection Sort',
    difficulty: 'Beginner',
    lang: 'js',
    description: 'Repeatedly find the smallest remaining number and swap it into the next sorted position.',
    objectives: ['Track minIdx across each pass', 'Observe fewer swaps than Bubble Sort'],
    expectedOutput: 'Sorted: [2, 3, 6, 7, 9]',
    code: `const arr = [7, 3, 9, 2, 6];
for (let i = 0; i < arr.length - 1; i++) {
  let minIdx = i;
  for (let j = i + 1; j < arr.length; j++) {
    if (arr[j] < arr[minIdx]) minIdx = j;
  }
  if (minIdx !== i) {
    const tmp = arr[i];
    arr[i] = arr[minIdx];
    arr[minIdx] = tmp;
  }
}
console.log("Sorted:", JSON.stringify(arr));`,
  },
  {
    id: 'alg-insertion-sort-py',
    title: 'Insertion Sort',
    category: 'algorithms',
    topic: 'Insertion Sort',
    difficulty: 'Beginner',
    lang: 'py',
    description: 'Pick one card at a time and slide larger cards to the right until it fits in sorted order.',
    objectives: ['Watch shifting elements inside a growing sorted prefix', 'Trace inner while-loop movement'],
    expectedOutput: 'Sorted: [1, 3, 4, 6, 8]',
    code: `nums = [6, 3, 8, 1, 4]
for i in range(1, len(nums)):
    key = nums[i]
    j = i - 1
    while j >= 0 and nums[j] > key:
        nums[j + 1] = nums[j]
        j -= 1
    nums[j + 1] = key
print("Sorted:", nums)`,
  },
  {
    id: 'alg-merge-sort-js',
    title: 'Merge Sort (Divide & Conquer)',
    category: 'algorithms',
    topic: 'Merge Sort',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Split a list into halves recursively, then merge sorted halves back together in order.',
    objectives: ['Follow recursive call frames splitting the list', 'See two sorted halves merged cleanly'],
    expectedOutput: 'Sorted: [1, 2, 4, 5, 8]',
    code: `function merge(left, right) {
  const out = [];
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] <= right[j]) out.push(left[i++]);
    else out.push(right[j++]);
  }
  while (i < left.length) out.push(left[i++]);
  while (j < right.length) out.push(right[j++]);
  return out;
}
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const mid = Math.floor(arr.length / 2);
  return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));
}
const result = mergeSort([5, 1, 8, 4, 2]);
console.log("Sorted:", JSON.stringify(result));`,
  },
  {
    id: 'alg-quick-sort-js',
    title: 'Quick Sort',
    category: 'algorithms',
    topic: 'Quick Sort',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Choose a pivot value, partition smaller numbers to its left and bigger to its right, and recurse.',
    objectives: ['Understand pivot partitioning', 'See in-place swaps and recursive ranges'],
    expectedOutput: 'Sorted: [1, 3, 5, 7, 9]',
    code: `const arr = [7, 1, 9, 3, 5];
function partition(lo, hi) {
  const pivot = arr[hi];
  let i = lo;
  for (let j = lo; j < hi; j++) {
    if (arr[j] < pivot) {
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      i++;
    }
  }
  const t = arr[i]; arr[i] = arr[hi]; arr[hi] = t;
  return i;
}
function quickSort(lo, hi) {
  if (lo >= hi) return;
  const p = partition(lo, hi);
  quickSort(lo, p - 1);
  quickSort(p + 1, hi);
}
quickSort(0, arr.length - 1);
console.log("Sorted:", JSON.stringify(arr));`,
  },
  {
    id: 'alg-bfs-js',
    title: 'Breadth-First Search (BFS)',
    category: 'algorithms',
    topic: 'Breadth-First Search',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Explore a graph wave by wave using a FIFO queue so closer nodes are always visited first.',
    objectives: ['Watch queue frontier expand level by level', 'Track visited set preventing cycles'],
    expectedOutput: 'BFS: A -> B -> C -> D -> E',
    code: `const graph = {
  A: ["B", "C"],
  B: ["D"],
  C: ["E"],
  D: ["E"],
  E: []
};
const queue = ["A"];
const visited = new Set(["A"]);
const path = [];
while (queue.length > 0) {
  const cur = queue.shift();
  path.push(cur);
  for (const nxt of graph[cur]) {
    if (!visited.has(nxt)) {
      visited.add(nxt);
      queue.push(nxt);
    }
  }
}
console.log("BFS:", path.join(" -> "));`,
  },
  {
    id: 'alg-dfs-js',
    title: 'Depth-First Search (DFS)',
    category: 'algorithms',
    topic: 'Depth-First Search',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Follow one branch as deeply as possible using recursion before backtracking to other neighbors.',
    objectives: ['Compare recursive call-stack DFS against queue BFS', 'Watch visited nodes highlight'],
    expectedOutput: 'DFS: A -> B -> D -> E -> C',
    code: `const graph = {
  A: ["B", "C"],
  B: ["D"],
  C: ["E"],
  D: ["E"],
  E: []
};
const visited = new Set();
const order = [];
function dfs(node) {
  visited.add(node);
  order.push(node);
  for (const nxt of graph[node]) {
    if (!visited.has(nxt)) dfs(nxt);
  }
}
dfs("A");
console.log("DFS:", order.join(" -> "));`,
  },
  {
    id: 'alg-dijkstra-js',
    title: 'Shortest Path (Dijkstra)',
    category: 'algorithms',
    topic: 'Shortest-Path Algorithms',
    difficulty: 'Advanced',
    lang: 'js',
    description: 'Find the cheapest route from S to every node in a weighted graph by always relaxing the closest unvisited node.',
    objectives: ['Watch distances hash table relax downward', 'Visualize weighted graph + visited set together'],
    expectedOutput: 'Shortest to D: 5',
    code: `const graph = {
  S: [{ to: "A", weight: 2 }, { to: "B", weight: 6 }],
  A: [{ to: "B", weight: 2 }, { to: "C", weight: 4 }],
  B: [{ to: "D", weight: 1 }],
  C: [{ to: "D", weight: 3 }],
  D: []
};
const distances = { S: 0, A: 99, B: 99, C: 99, D: 99 };
const visited = new Set();
const nodes = ["S", "A", "B", "C", "D"];
while (visited.size < nodes.length) {
  let best = null;
  for (const n of nodes) {
    if (!visited.has(n) && (best === null || distances[n] < distances[best])) best = n;
  }
  if (best === null) break;
  visited.add(best);
  for (const edge of graph[best]) {
    const nextDist = distances[best] + edge.weight;
    if (nextDist < distances[edge.to]) distances[edge.to] = nextDist;
  }
}
console.log("Shortest to D:", distances.D);`,
  },
  {
    id: 'alg-dp-grid-js',
    title: 'Dynamic Programming — Grid Unique Paths',
    category: 'algorithms',
    topic: 'Dynamic Programming',
    difficulty: 'Intermediate',
    lang: 'js',
    description: 'Fill a 2D DP table where each cell adds the paths coming from above and from the left.',
    objectives: ['Visualize 2D DP table cell updates', 'Understand subproblem reuse'],
    expectedOutput: 'Ways to reach bottom-right: 6',
    code: `const dp = [
  [1, 1, 1],
  [1, 0, 0],
  [1, 0, 0]
];
for (let r = 1; r < 3; r++) {
  for (let c = 1; c < 3; c++) {
    dp[r][c] = dp[r - 1][c] + dp[r][c - 1];
  }
}
console.log("Ways to reach bottom-right:", dp[2][2]);`,
  },
  {
    id: 'alg-backtracking-js',
    title: 'Backtracking — Generate Subsets',
    category: 'algorithms',
    topic: 'Backtracking',
    difficulty: 'Advanced',
    lang: 'js',
    description: 'Choose an item, explore deeper, and undo the choice (pop) to generate every subset.',
    objectives: ['Watch push/pop backtracking on the current path stack', 'Follow recursion tree exploration'],
    expectedOutput: 'Subsets count: 8',
    code: `const nums = [1, 2, 3];
const current = [];
const allSubsets = [];
function backtrack(index) {
  if (index === nums.length) {
    allSubsets.push([...current]);
    return;
  }
  current.push(nums[index]);
  backtrack(index + 1);
  current.pop();
  backtrack(index + 1);
}
backtrack(0);
console.log("Subsets count:", allSubsets.length);`,
  },
];

export interface ComparisonPreset {
  id: string;
  title: string;
  description: string;
  sharedInput: string;
  programA: { name: string; lang: LanguageId; code: string };
  programB: { name: string; lang: LanguageId; code: string };
}

export const COMPARISON_PRESETS: ComparisonPreset[] = [
  {
    id: 'bubble-vs-merge',
    title: 'Bubble Sort vs Merge Sort',
    description: 'Compare neighbor-by-neighbor swaps against recursive divide-and-conquer merging on the same list.',
    sharedInput: '6 2 9 1 5 3',
    programA: {
      name: 'Bubble Sort',
      lang: 'js',
      code: `const arr = readLine().split(" ").map(Number);
for (let i = 0; i < arr.length - 1; i++) {
  for (let j = 0; j < arr.length - 1 - i; j++) {
    if (arr[j] > arr[j + 1]) {
      const t = arr[j];
      arr[j] = arr[j + 1];
      arr[j + 1] = t;
    }
  }
}
console.log("Sorted:", JSON.stringify(arr));`,
    },
    programB: {
      name: 'Merge Sort',
      lang: 'js',
      code: `const inputArr = readLine().split(" ").map(Number);
function merge(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] <= b[j]) out.push(a[i++]);
    else out.push(b[j++]);
  }
  while (i < a.length) out.push(a[i++]);
  while (j < b.length) out.push(b[j++]);
  return out;
}
function mergeSort(arr) {
  if (arr.length <= 1) return arr;
  const m = Math.floor(arr.length / 2);
  return merge(mergeSort(arr.slice(0, m)), mergeSort(arr.slice(m)));
}
const sorted = mergeSort(inputArr);
console.log("Sorted:", JSON.stringify(sorted));`,
    },
  },
  {
    id: 'linear-vs-binary',
    title: 'Linear Search vs Binary Search',
    description: 'Compare scanning every item from left to right against halving a sorted array.',
    sharedInput: '29',
    programA: {
      name: 'Linear Search',
      lang: 'js',
      code: `const list = [2, 5, 9, 14, 18, 23, 29, 35, 41];
const target = Number(readLine());
let idx = -1;
for (let i = 0; i < list.length; i++) {
  if (list[i] === target) {
    idx = i;
    break;
  }
}
console.log("Index:", idx);`,
    },
    programB: {
      name: 'Binary Search',
      lang: 'js',
      code: `const list = [2, 5, 9, 14, 18, 23, 29, 35, 41];
const target = Number(readLine());
let low = 0, high = list.length - 1, idx = -1;
while (low <= high) {
  const mid = Math.floor((low + high) / 2);
  if (list[mid] === target) { idx = mid; break; }
  else if (list[mid] < target) low = mid + 1;
  else high = mid - 1;
}
console.log("Index:", idx);`,
    },
  },
  {
    id: 'iter-vs-rec-fact',
    title: 'Loop Factorial vs Recursive Factorial',
    description: 'Compare a single loop updating one variable against nested recursive call stack frames.',
    sharedInput: '5',
    programA: {
      name: 'Iterative Loop',
      lang: 'py',
      code: `n = int(input())
result = 1
for i in range(2, n + 1):
    result = result * i
print("Factorial:", result)`,
    },
    programB: {
      name: 'Recursive Function',
      lang: 'py',
      code: `n = int(input())
def fact(k):
    if k <= 1:
        return 1
    return k * fact(k - 1)
result = fact(n)
print("Factorial:", result)`,
    },
  },
];

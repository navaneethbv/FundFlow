/**
 * Static safety analysis for user-supplied regex patterns (FF-06).
 *
 * JavaScript's RegExp is a backtracking engine, and neither a length cap on
 * the pattern nor one on the subject is enough on its own: `^a*a*a*a*a*a*!$`
 * is 16 characters and still needs superexponential work on a 280-character
 * subject, because six ambiguous loops can split the same run of `a` in
 * combinatorially many ways.
 *
 * Since `safeCompileRegex` is imported by a client component, a non-backtracking
 * engine (RE2) or a worker-thread timeout is not available. Instead this module
 * defines a **restricted language**: a pattern is accepted only when its shape
 * makes catastrophic backtracking impossible.
 *
 * Three rules, each rejecting a distinct source of ambiguity:
 *
 * 1. No quantified group whose body is itself ambiguous - a nested quantifier
 *    or an alternation: `(a+)+`, `(a*)*`, `(a|aa)+`. This is exponential.
 * 2. No two looping atoms that can match the same character with nothing
 *    mandatory between them: `a*a*`, `\d+[0-9]*`, `(?:x)*x+`. This is what
 *    makes `^a*a*a*a*a*a*!$` polynomial in the number of loops. Loops separated
 *    by a mandatory atom (`.*Eats.*`) stay allowed: the separator bounds the
 *    split points to the places it actually occurs.
 * 3. At most MAX_LOOP_QUANTIFIERS looping atoms overall. Rules 1 and 2 leave
 *    only polynomial behaviour, of degree at most the number of loops, so this
 *    caps the exponent. With a 300-character subject the worst case is 300^3,
 *    which finishes in milliseconds.
 *
 * Character sets are approximated conservatively: anything the scanner cannot
 * analyse (`.`, a negated class, `\W`) is treated as matching everything, so an
 * unanalyzable atom can only ever cause a rejection, never a false accept.
 */

/**
 * Maximum number of looping quantifiers (`*`, `+`, `{n,}`, `{n,m}` with m > n)
 * allowed in one pattern. Bounds the degree of the polynomial worst case.
 */
export const MAX_LOOP_QUANTIFIERS = 3;

type PredefinedClass = "d" | "w" | "s";

/** Conservative approximation of the characters an atom can match. */
interface CharSet {
  /** True when the atom may match anything the scanner cannot enumerate. */
  any: boolean;
  literals: Set<string>;
  classes: Set<PredefinedClass>;
}

function emptySet(): CharSet {
  return { any: false, literals: new Set(), classes: new Set() };
}

function anySet(): CharSet {
  return { any: true, literals: new Set(), classes: new Set() };
}

function literalSet(char: string): CharSet {
  return { any: false, literals: new Set([char]), classes: new Set() };
}

function classSet(cls: PredefinedClass): CharSet {
  return { any: false, literals: new Set(), classes: new Set([cls]) };
}

function unionInto(target: CharSet, source: CharSet): void {
  if (source.any) target.any = true;
  for (const literal of source.literals) target.literals.add(literal);
  for (const cls of source.classes) target.classes.add(cls);
}

/**
 * Largest range expanded into individual characters. `[a-z]` and `[0-9]` are
 * ordinary merchant-pattern building blocks and deserve an exact set; a range
 * wider than this (`[\u0000-\uffff]`) is not worth enumerating and widens to
 * `any`, which can only cause a rejection.
 */
const MAX_RANGE_EXPANSION = 128;

function addRange(set: CharSet, from: string, to: string): void {
  const start = from.codePointAt(0) ?? 0;
  const end = to.codePointAt(0) ?? 0;
  if (end < start || end - start + 1 > MAX_RANGE_EXPANSION) {
    set.any = true;
    return;
  }
  for (let code = start; code <= end; code++) {
    set.literals.add(String.fromCodePoint(code));
  }
}

const DIGIT_RE = /[0-9]/;
const WORD_RE = /[A-Za-z0-9_]/;
const SPACE_RE = /\s/;

function charMatchesClass(char: string, cls: PredefinedClass): boolean {
  if (cls === "d") return DIGIT_RE.test(char);
  if (cls === "w") return WORD_RE.test(char);
  return SPACE_RE.test(char);
}

/** `\d` is a subset of `\w`; `\s` is disjoint from both. */
function classesOverlap(a: PredefinedClass, b: PredefinedClass): boolean {
  if (a === b) return true;
  return (a === "s") === (b === "s");
}

function setsOverlap(a: CharSet, b: CharSet): boolean {
  if (a.any || b.any) return true;
  for (const literal of a.literals) {
    if (b.literals.has(literal)) return true;
    for (const cls of b.classes) {
      if (charMatchesClass(literal, cls)) return true;
    }
  }
  for (const literal of b.literals) {
    for (const cls of a.classes) {
      if (charMatchesClass(literal, cls)) return true;
    }
  }
  for (const clsA of a.classes) {
    for (const clsB of b.classes) {
      if (classesOverlap(clsA, clsB)) return true;
    }
  }
  return false;
}

interface Quantifier {
  /** Minimum repetitions; 0 means the atom can be skipped entirely. */
  min: number;
  /** True when the atom can repeat more than once, i.e. it is a loop. */
  loop: boolean;
}

const NO_QUANTIFIER: Quantifier = { min: 1, loop: false };

/**
 * Reads the quantifier that follows an atom, if any. Returns the quantifier
 * and the index just past it (past a lazy `?` suffix too, which changes match
 * preference but not the backtracking class).
 */
function readQuantifier(pattern: string, index: number): { quantifier: Quantifier; next: number } {
  const char = pattern[index];
  if (char === "*") return { quantifier: { min: 0, loop: true }, next: skipLazy(pattern, index + 1) };
  if (char === "+") return { quantifier: { min: 1, loop: true }, next: skipLazy(pattern, index + 1) };
  if (char === "?") return { quantifier: { min: 0, loop: false }, next: skipLazy(pattern, index + 1) };
  if (char !== "{") return { quantifier: NO_QUANTIFIER, next: index };

  const close = pattern.indexOf("}", index);
  if (close === -1) return { quantifier: NO_QUANTIFIER, next: index };
  const body = pattern.slice(index + 1, close);
  const range = /^(\d+)(,(\d*)?)?$/.exec(body);
  if (!range) return { quantifier: NO_QUANTIFIER, next: index };

  const min = Number(range[1]);
  let max = min;
  if (range[2] !== undefined) {
    max = range[3] ? Number(range[3]) : Number.POSITIVE_INFINITY;
  }
  return { quantifier: { min, loop: max > 1 }, next: skipLazy(pattern, close + 1) };
}

function skipLazy(pattern: string, index: number): number {
  return pattern[index] === "?" ? index + 1 : index;
}

/** Parses `[...]`, returning its set and the index just past the closing `]`. */
function readCharClass(pattern: string, openIndex: number): { set: CharSet; next: number } {
  let index = openIndex + 1;
  const negated = pattern[index] === "^";
  if (negated) index += 1;

  const set = emptySet();
  // A `]` in first position is a literal `]`, per regex grammar.
  let first = true;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === "]" && !first) {
      return { set: negated ? anySet() : set, next: index + 1 };
    }
    first = false;
    if (char === "\\") {
      unionInto(set, escapeSet(pattern[index + 1]));
      index += 2;
      continue;
    }
    if (pattern[index + 1] === "-" && pattern[index + 2] !== undefined && pattern[index + 2] !== "]") {
      addRange(set, char, pattern[index + 2]);
      index += 3;
      continue;
    }
    set.literals.add(char);
    index += 1;
  }
  // Unterminated class: the RegExp constructor will reject it. Report `any`
  // and let compilation fail with the real syntax error.
  return { set: anySet(), next: pattern.length };
}

/** The set an escape sequence can match; `undefined` means zero-width. */
function escapeSet(char: string | undefined): CharSet {
  if (char === undefined) return anySet();
  if (char === "d") return classSet("d");
  if (char === "w") return classSet("w");
  if (char === "s") return classSet("s");
  if (char === "D" || char === "W" || char === "S") return anySet();
  return literalSet(char);
}

const ZERO_WIDTH_ESCAPES = new Set(["b", "B"]);

/**
 * One concatenation level: the top level, or the inside of a group. Tracks the
 * loops that are still "open" (no mandatory atom has forced progress since) and
 * the set of characters the sequence can start with.
 */
interface SequenceState {
  openLoops: CharSet[];
  firstSet: CharSet;
  /** False once a mandatory atom has been seen, closing the first set. */
  firstSetOpen: boolean;
  /** Union of the first sets of every alternative seen so far. */
  alternativeFirstSets: CharSet;
}

function newSequence(): SequenceState {
  return {
    openLoops: [],
    firstSet: emptySet(),
    firstSetOpen: true,
    alternativeFirstSets: emptySet(),
  };
}

function startAlternative(state: SequenceState): void {
  unionInto(state.alternativeFirstSets, state.firstSet);
  state.openLoops = [];
  state.firstSet = emptySet();
  state.firstSetOpen = true;
}

function sequenceFirstSet(state: SequenceState): CharSet {
  const combined = emptySet();
  unionInto(combined, state.alternativeFirstSets);
  unionInto(combined, state.firstSet);
  return combined;
}

/**
 * Records an atom in its sequence, rejecting rule-2 violations.
 * Returns false when the atom introduces an ambiguous adjacent loop.
 */
function acceptAtom(state: SequenceState, set: CharSet, quantifier: Quantifier): boolean {
  if (quantifier.loop) {
    for (const open of state.openLoops) {
      if (setsOverlap(open, set)) return false;
    }
  }

  if (state.firstSetOpen) {
    unionInto(state.firstSet, set);
    if (quantifier.min > 0) state.firstSetOpen = false;
  }

  if (quantifier.min > 0) {
    // A mandatory atom forces progress, so every earlier loop is now pinned.
    state.openLoops = [];
  }
  if (quantifier.loop) {
    state.openLoops.push(set);
  }
  return true;
}

/** Rule 1: a quantified group whose body contains a quantifier or alternation. */
const AMBIGUOUS_BODY_CHARS = new Set(["*", "+", "?", "{", "|"]);

function bodyIsAmbiguous(body: string): boolean {
  let inClass = false;
  const start = body.startsWith("?:") ? 2 : 0;
  for (let index = start; index < body.length; index++) {
    const char = body[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (inClass) {
      inClass = char !== "]";
      continue;
    }
    if (char === "[") {
      inClass = true;
    } else if (AMBIGUOUS_BODY_CHARS.has(char)) {
      return true;
    }
  }
  return false;
}

interface GroupFrame {
  state: SequenceState;
  openIndex: number;
}

/**
 * Returns true when `pattern` is in the restricted language described at the
 * top of this module, i.e. its worst-case matching cost is bounded.
 */
export function isRegexShapeSafe(pattern: string): boolean {
  const stack: GroupFrame[] = [];
  let state = newSequence();
  let loopCount = 0;
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];

    // Zero-width assertions are not atoms and cannot bound or create loops.
    if (char === "^" || char === "$") {
      index += 1;
      continue;
    }

    if (char === "|") {
      startAlternative(state);
      index += 1;
      continue;
    }

    if (char === "(") {
      stack.push({ state, openIndex: index });
      state = newSequence();
      // Skip the group prefix so `?:`/`?=` do not read as atoms.
      const prefix = /^\((\?[:=!]|\?<[=!]|\?<[A-Za-z_$][\w$]*>)/.exec(pattern.slice(index));
      index += prefix ? prefix[0].length : 1;
      continue;
    }

    if (char === ")") {
      const frame = stack.pop();
      if (!frame) return false; // Unbalanced; RegExp would reject it anyway.
      const groupSet = sequenceFirstSet(state);
      const { quantifier, next } = readQuantifier(pattern, index + 1);
      if (quantifier.loop) {
        loopCount += 1;
        if (bodyIsAmbiguous(pattern.slice(frame.openIndex + 1, index))) return false;
      }
      state = frame.state;
      if (!acceptAtom(state, groupSet, quantifier)) return false;
      index = next;
      continue;
    }

    let set: CharSet;
    let atomEnd: number;
    if (char === "\\") {
      const escaped = pattern[index + 1];
      if (escaped !== undefined && ZERO_WIDTH_ESCAPES.has(escaped)) {
        index += 2;
        continue;
      }
      set = escapeSet(escaped);
      atomEnd = index + 2;
    } else if (char === "[") {
      const parsed = readCharClass(pattern, index);
      set = parsed.set;
      atomEnd = parsed.next;
    } else if (char === ".") {
      set = anySet();
      atomEnd = index + 1;
    } else {
      set = literalSet(char);
      atomEnd = index + 1;
    }

    const { quantifier, next } = readQuantifier(pattern, atomEnd);
    if (quantifier.loop) loopCount += 1;
    if (!acceptAtom(state, set, quantifier)) return false;
    index = next;
  }

  if (stack.length > 0) return false;
  return loopCount <= MAX_LOOP_QUANTIFIERS;
}

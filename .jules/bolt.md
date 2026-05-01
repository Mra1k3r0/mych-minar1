## 2025-05-14 - [Gibberish and Command List Optimization]
learning: `Array.from(text)` on large strings causes significant memory allocation overhead. iterating via `for...of` or index is ~30% faster. splitting with `filter(Boolean)` also creates redundant arrays; manual iteration over raw split tokens is more efficient. in line-by-line checks, running a single global regex match before the loop can avoid O(N) regex overhead if the result doesn't depend on the specific line.
action: avoid `Array.from` for character counting; prefer single-pass iteration for token analysis.

## 2025-05-15 - [Anti-patterns in string processing]
learning: using `Array.from(string)` for character counting or `filter(Boolean)` on split tokens creates unnecessary intermediate array allocations which impact performance on large inputs.
action: use `for...of` loops for direct string iteration and skip empty strings manually during token processing loops.

## 2025-05-15 - [Regex in loops]
learning: calling `.match()` or `.test()` inside a line-by-line processing loop can be expensive if a global check can be performed once to exit early.
action: perform global regex checks to satisfy minimum requirements before entering intensive line-by-line iteration.

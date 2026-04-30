## 2025-05-22 - String processing in hot paths

learning: `isLikelyGibberish` and `isCommandListBlock` are frequently called during message processing and rendering. Using `Array.from(text)` or `.match()` inside loops causes unnecessary array allocations and garbage collection pressure.
action: use simple loops for counting and move global regex matches outside of line-by-line processing.

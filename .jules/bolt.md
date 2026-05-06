## 2025-05-22 - [AI] Optimize command keyword regex detection
learning: Consolidating multiple individual RegExp objects into a single merged RegExp using alternation (|) significantly reduces CPU overhead in hot paths like intent detection. In a micro-benchmark, this approach was ~7.5x faster than individual tests (300ms vs 40ms for 1M iterations).
action: Prefer merged regex alternation for pattern matching when checking against a fixed list of keyword/alias tokens to reduce the number of .test() calls.

## 2026-05-16 - Intent parsing regex consolidation
learning: Consolidating multiple keyword/alias patterns into a single merged RegExp per command using alternation (|) reduces .test() evaluations in hot paths. Sorting tokens by length descending is critical to prevent shorter tokens from matching sub-strings of longer tokens.
action: Always prefer O(1) property lookups (secured via hasOwnProperty) over O(N) array finds for static registry data. Use lightweight mocks for benchmarks to avoid full module initialization timeouts in CI/sandbox environments.

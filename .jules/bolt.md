## 2025-05-15 - Command Registry and Intent Optimization
learning: O(N) iterations over command keys and repeated RegExp creation/execution in hot paths (message processing) were creating avoidable overhead. Caching sorted lists and consolidating regex patterns via alternation improves efficiency significantly.
action: Prioritize O(1) lookups using pre-computed indices (like `COMMAND_ALIAS_INDEX`) and consolidate multiple regex tests into a single alternation pattern.

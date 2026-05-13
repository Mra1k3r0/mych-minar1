## 2025-05-14 - Intent Parsing Optimization
learning: Consolidating multiple RegExps into a single one using alternation (|) and sorting tokens by length descending significantly improves matching performance (~4.8x). Also, replacing O(N) array loops with O(1) map/object lookups for fixed-key registries provides a measurable speedup (~4.5x).
action: Prioritize regex consolidation and map-based lookups in hot paths like intent parsing or command routing.

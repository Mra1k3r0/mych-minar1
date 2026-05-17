## 2025-05-22 - [Intent Parsing Optimization]
learning: Consolidating multiple command tokens into a single regex with alternation significantly reduces the number of `.test()` calls in the hot path. Moving recurring regex literals to constants avoids redundant compilation and allocation.
action: Always prefer a single merged regex with alternation over multiple `.test()` calls in loops for high-frequency string matching.

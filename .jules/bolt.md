## 2025-04-25 - [Running Totals for Rate Limiting]
**Learning:** For sliding-window rate limiters, calculating totals using `reduce()` on every check is O(N). Maintaining running totals and pruning expired entries with `shift()` in a `while` loop makes the check O(1) in most cases and O(K) during pruning, where K is the number of expired entries.
**Action:** Use running totals for frequently accessed metrics that involve sliding windows.

## 2025-04-25 - [Avoid String Allocations for Counting]
**Learning:** Joining arrays of strings (`map().join("")`) just to count the total length or estimate tokens creates unnecessary large temporary strings, increasing memory pressure and GC cycles.
**Action:** Use `reduce()` to sum lengths directly without allocations.

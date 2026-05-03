## 2025-05-15 - [isLikelyGibberish Optimization]
learning: `Array.from(string)` and chained `.filter().length` on large strings creates significant memory pressure and unnecessary allocations in hot paths like gibberish detection.
action: use direct `for` loops with `charCodeAt` and avoid intermediate array filtering where possible.

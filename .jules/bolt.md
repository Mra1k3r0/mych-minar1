## 2025-05-15 - Optimize telegram rich text rendering
learning: Iterative string replacements in JavaScript can be very expensive as they create new strings every time. Using a single regex replace with a callback is significantly more efficient for bulk substitutions. Also, high-level array methods like split/map/filter in hot paths can lead to unnecessary allocations.
action: Always prefer single-pass regex or optimized loops over iterative string manipulation and heavy array chains for performance-sensitive rendering code.

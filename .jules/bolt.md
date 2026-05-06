## 2025-05-21 - Optimize AI intent routing and text analysis

learning: Pre-compiling regex patterns in module-level indices significantly reduces allocation overhead in hot paths like keyword matching. Replacing `for...of` loops with standard `for` loops and `charCodeAt` provides a measurable speedup for character-level heuristics on large text inputs by avoiding iterator protocol overhead. When using `charCodeAt` for non-ASCII counting, it's important to handle surrogate pairs (e.g., emojis) manually to maintain accuracy while preserving speed. Consolidating redundant logic and skipping unnecessary "live" disk-based resolution in alias lookups further streamlines the message processing pipeline.

action: Always pre-compile regexes for static metadata indices. Prefer standard `for` loops with surrogate pair detection for high-frequency character processing.

## 2025-05-08 - Regex consolidation in intent parsing
learning: In `src/services/ai/intent.ts`, `findKeywordCommand` performed O(TotalKeywords) regex tests per message. Consolidating keywords into a single merged RegExp per command using alternation reduces calls to O(TotalCommands), which is roughly 5x more efficient given the current command-to-keyword ratio.
action: When implementing multi-pattern matching in hot paths, always prefer merged regex with alternation over looping and testing individual patterns.

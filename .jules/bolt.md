## 2025-05-14 - [Intent Parser Optimization]
learning: Consolidating multiple keyword/alias tokens into a single merged RegExp per command using alternation (|) significantly reduces .test() evaluations in intent resolution paths. Sorting tokens by length descending prevents shorter tokens from matching inside larger phrases incorrectly.
action: Prioritize single-pass regex matching or O(1) map lookups over iterating arrays of regexes in hot paths like intent parsing or command routing.

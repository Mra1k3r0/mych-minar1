## 2026-05-12 - Optimize intent parsing hot paths
learning: O(N) iteration over command keys and individual regex testing for keywords in `parseCommandIntent` was a significant bottleneck. Consolidating regex patterns with alternation and using O(1) lookups for command resolution drastically reduces overhead.
action: Always prefer O(1) lookups for command/alias resolution. Consolidate multiple related regexes into a single alternation pattern in hot paths.

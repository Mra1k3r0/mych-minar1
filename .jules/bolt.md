## 2026-04-26 - Optimized total message counting in ConversationManager
**Learning:** Iterating over all active sessions to calculate a global metric (like total messages) creates an O(N) bottleneck that scales poorly as the bot's user base grows.
**Action:** Use running counters for global metrics in manager classes to provide O(1) access. Ensure the counter is updated in all mutation paths (addition, removal, eviction, pruning).

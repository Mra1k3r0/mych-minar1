## 2025-05-15 - [isCommandListBlock optimization]
learning: inner-loop regex matching on every line is a significant bottleneck when processing large text blocks in `renderTelegramRichText`.
action: move regex matching out of loops and use global matches for early exits when possible.

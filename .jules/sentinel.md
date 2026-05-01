## 2026-05-01 - [transport-security]
vulnerability: use of insecure http for external api (vtuber_api).
learning: external services might support https even if configured with http; always prefer encrypted transport.
prevention: enforce https for all external api endpoints and use centralized fetch utilities that can enforce security policies.

## 2026-05-01 - [information-leakage]
vulnerability: exposing raw exception messages in bot responses.
learning: raw errors can leak internal logic or provider details.
prevention: use generic user-facing messages and log detailed errors internally.

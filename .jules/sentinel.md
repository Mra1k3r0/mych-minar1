## 2026-04-29 - Enforce HTTPS and Mask Internal Errors
vulnerability: Insecure transport via http:// in VTUBER_API and internal information leakage through raw AI error messages.
learning: Direct use of `undici.fetch` bypassed centralized security policies (timeouts, validation) defined in `src/services/http/undici.ts`. AI controllers were exposing raw exception messages, which is a common source of internal logic leaks.
prevention: Always use the internal `Fetch` utility for HTTP requests and ensure all user-facing AI errors are generic and masked.

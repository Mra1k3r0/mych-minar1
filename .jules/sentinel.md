## 2026-04-27 - Insecure transport and internal error leakage
vulnerability: The VTuber API was using plain HTTP, and the AI controller was leaking raw LLM provider error messages to users.
learning: Relying on default API constants and standard error-to-string conversions can inadvertently bypass secure transport and expose internal system details.
prevention: Always enforce HTTPS for external service integrations and use generic user-facing error messages in high-level controllers while keeping detailed logs internal.

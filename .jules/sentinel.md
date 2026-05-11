## 2025-05-14 - Redact Basic Auth in sanitizeUrl
vulnerability: Potential credential leakage in logs or error messages via URLs containing Basic Auth (`user:pass@host`).
learning: The Node.js `URL` API automatically encodes brackets `[` and `]` in authority and query components, so security tests checking for `[redacted]` placeholders must also account for `%5Bredacted%5D`.
prevention: Always mask `u.username` and `u.password` when sanitizing URLs, and use a fallback regex to catch protocol-relative URLs or other non-standard formats that might bypass `new URL()`.

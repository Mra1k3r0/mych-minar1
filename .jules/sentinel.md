## 2026-04-30 - [Secure Transport & Standardized HTTP]
vulnerability: Use of insecure `http://` protocol for external API and direct usage of low-level `undici` fetch.
learning: Insecure transport allows for MITM attacks. Direct `undici` usage bypasses central security policies like timeouts and standardized error handling.
prevention: Always use `https://` for external APIs. Enforce the use of the project's internal `Fetch` utility for consistent and secure HTTP communication.

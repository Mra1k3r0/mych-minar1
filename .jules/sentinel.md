## 2025-05-14 - [Incomplete URL Sanitization]
vulnerability: Credentials (username/password) in the URL authority were not redacted by the `sanitizeUrl` utility, leading to potential leakage in error logs and metrics.
learning: Relying solely on `URL.searchParams` and path replacement ignores the userinfo component of the URL. Standard `URL` object properties must be explicitly cleared or masked.
prevention: Always check and redact `username` and `password` properties when sanitizing URLs, and use a robust fallback for non-standard or relative URL strings.

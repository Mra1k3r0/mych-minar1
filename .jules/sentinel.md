## 2026-04-26 - [Expr-eval Vulnerability & Authorization Gap]
**Vulnerability:** Use of `expr-eval` for math expression parsing which is known to be vulnerable to prototype pollution and sandbox escape if not properly restricted. Also found a missing authorization check on the `/status` admin command.
**Learning:** Third-party expression parsers should always be treated as untrusted execution environments even if they claim to be safe. "Admin-only" features often leak through multiple controllers/commands if not centralized or consistently applied.
**Prevention:** 1. Implement strict keyword-based sanitization and length limits on all user-supplied expressions before parsing. 2. Centralize authorization logic or strictly audit all controllers for missing checks on sensitive endpoints.

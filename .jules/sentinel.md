## 2025-05-14 - Hardening expr-eval sandbox
**Vulnerability:** Potential sandbox escape in `expr-eval` through JavaScript keywords.
**Learning:** While `expr-eval` is restricted, keywords like `Function`, `eval`, `return`, and `this` can sometimes be leveraged in complex prototype pollution or constructor-based escapes depending on the library version and environment.
**Prevention:** Maintain a strict blocklist of JavaScript sensitive keywords and enforce strict character length limits for all user-supplied expressions before parsing.

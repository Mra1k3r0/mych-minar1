## 2025-05-14 - URL basic auth parsing risk
vulnerability: Basic Auth credentials in URLs (e.g., `user:pass@host`) can be leaked if sanitization logic only relies on the `URL` constructor properties (`u.username`, `u.password`).
learning: If a URL lacks a standard scheme, the `URL` constructor might misinterpret the `user` portion as a protocol and the rest as a pathname, leaving the password unredacted in the resulting string. Additionally, `u.username` and `u.password` assignments automatically URL-encode brackets, which must be accounted for in test assertions.
prevention: Use a robust regular expression to redact Basic Auth credentials *before* passing the string to the `URL` constructor, or as part of a comprehensive fallback mechanism for non-standard URL strings.

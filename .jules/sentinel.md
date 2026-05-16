## 2025-05-15 - [Credential Leakage in URLs]
vulnerability: Basic authentication credentials (user:pass) in URLs were not redacted by `sanitizeUrl`, potentially leaking them in logs or error messages.
learning: The Node.js `URL` API provides structured access to `username` and `password`, but they must be explicitly cleared during sanitization. Native `URL` also percent-encodes brackets (`[` -> `%5B`, `]` -> `%5D`), so test assertions must account for both literal and encoded forms.
prevention: Always explicitly check for and redact `username` and `password` properties when using the `URL` object for security sanitization.

## 2025-05-15 - [Insecure Binary Downloads]
vulnerability: `src/services/tunnel.ts` downloads external tunnel binaries (cloudflared, ngrok, etc.) but only verifies file size (>1MB) instead of cryptographic checksums.
learning: Relying on file size for integrity check is insufficient against MITM or compromised download sources.
prevention: Implement SHA-256 checksum verification for all external binaries downloaded at runtime.

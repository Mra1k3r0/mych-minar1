## 2026-05-02 - [Enforce HTTPS and Centralized Fetch Utility]
vulnerability: Insecure transport (HTTP) for VTuber API and inconsistent HTTP client usage.
learning: Using HTTP for API requests exposes the application to MITM attacks. Furthermore, bypassing the centralized `Fetch` utility prevents enforcement of global security policies such as timeouts and response validation.
prevention: Always use HTTPS for external API endpoints and prefer the internal `Fetch` utility from `src/services/http/undici.ts` for consistency and security enforcement.

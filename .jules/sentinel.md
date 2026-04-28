## 2025-05-14 - Enforce HTTPS for external APIs
vulnerability: Insecure transport used for VTuber API (HTTP).
learning: Defaulting to HTTP for external service integration can lead to MITM vulnerabilities, even for public data, as it allows response tampering.
prevention: Always use HTTPS for external endpoints. Standardize on an internal `Fetch` wrapper that can enforce transport and validation policies across the codebase.

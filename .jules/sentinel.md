## 2025-05-15 - incomplete url sanitization
vulnerability: sensitive data leakage via basic auth credentials and url fragments.
learning: standard url sanitizers often overlook the authority (user:pass) and fragment (#) sections of a url, which frequently contain tokens or credentials.
prevention: use the full capabilities of the url api to redact credentials and process fragments as potential parameter containers, with robust regex fallbacks for non-standard or relative urls.

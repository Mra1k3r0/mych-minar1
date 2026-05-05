## 2026-05-05 - expr-eval bracket access bypass
vulnerability: Property access via brackets (e.g., `obj["constructor"]`) can bypass simple keyword-based blocklists in expression parsers like expr-eval, leading to sandbox escapes.
learning: Simply blocking "constructor" or "__proto__" as literal tokens is insufficient if the parser supports dynamic property access through strings or expression concatenation.
prevention: Enforce strict character allowlists or block all property access characters (`[` and `]`) in user-supplied math expressions if not strictly required.

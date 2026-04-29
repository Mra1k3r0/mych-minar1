## 2024-04-29 - String analysis bottlenecks
learning: Using `Array.from(t).filter(...)` to count characters in a large string is a common performance bottleneck in TypeScript due to multiple intermediate array allocations. Similarly, matching regexes line-by-line inside a loop when a global match is possible causes unnecessary overhead.
action: Always prefer a simple `for` loop or global regex matching for heavy string analysis tasks. Use early exits based on cheap checks before performing expensive operations like `split('\n')`.

// Test-only fallback when a parent sandbox denies PTY creation. Exercise the
// actual readline prompt using piped input; this is not a real terminal test.
Object.defineProperty(process.stdin, "isTTY", { value: true });
Object.defineProperty(process.stderr, "isTTY", { value: true });

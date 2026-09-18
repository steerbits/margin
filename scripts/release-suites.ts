/** Keep machine basics, not provider credentials or a running worker identity. */
export function releaseTestEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "TERM",
    "CI",
    "TZ",
    "SystemRoot",
    "PLAYWRIGHT_BROWSERS_PATH",
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(
      ([key]) => allowed.has(key) || key.startsWith("LC_"),
    ),
  );
}

/** Central registry. Existing suites discover new files automatically. */
export const releaseSuites = [
  { name: "Unit and regression tests", command: "npm", args: ["test"] },
  {
    name: "TypeScript, production and recovery builds",
    command: "npm",
    args: ["run", "build"],
  },
  ...[
    ["Browser workflows", "project-notes"],
    ["Gateway integration", "gateway"],
    ["Writable AI connection workflows", "connections"],
    ["Connection gateway guards", "connections-gateway"],
    ["Production source-send guards", "source-send"],
    ["Older/newer disposable installations", "update-installations"],
  ].map(([name, config]) => ({
    name,
    command: "npx",
    args: [
      "playwright",
      "test",
      "--config",
      `tests/${config}.playwright.config.ts`,
    ],
  })),
];

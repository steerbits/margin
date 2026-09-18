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

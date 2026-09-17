import { selectPort } from "./launch-port.mjs";

// Runs before dependencies are installed. Diagnostics/prompts go to stderr;
// stdout is only the accepted port for the shell's command substitution.
try {
  console.log(
    await selectPort(process.argv[2], {
      command: "bash install.sh",
      action:
        process.argv[3] === "--start"
          ? "Use it for this installation and start Margin there?"
          : "Use it for this installation?",
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

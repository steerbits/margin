import { main } from "./start-margin.ts";

// start.sh keeps real OS sandbox verification, but only after help/argument
// validation, checkout ownership, and port selection have succeeded.
await main(process.argv.slice(2), true);

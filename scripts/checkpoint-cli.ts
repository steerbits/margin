import { resolve } from "node:path";
import { CheckpointHistory } from "../server/checkpoints.ts";

const args = process.argv.slice(2);
let root = process.cwd(),
  data: string | undefined;
for (let i = 0; i < args.length; ) {
  if (args[i] === "--root" || args[i] === "--data") {
    const key = args.splice(i, 1)[0],
      value = args.splice(i, 1)[0];
    if (!value) throw new Error(`${key} requires a path`);
    if (key === "--root") root = resolve(value);
    else data = resolve(value);
  } else i++;
}
const history = new CheckpointHistory(
  root,
  data ??
    (process.env.MARGIN_DATA_DIR
      ? resolve(process.env.MARGIN_DATA_DIR)
      : resolve(root, ".margin-data")),
);
const [command, id, token] = args;
if (command === "list" || !command)
  console.log(JSON.stringify(history.state(), null, 2));
else if (command === "save")
  console.log(
    JSON.stringify(history.save(id ?? "Terminal checkpoint"), null, 2),
  );
else if (command === "preview" && id)
  console.log(JSON.stringify(history.preview(id), null, 2));
else if (command === "restore" && id && token)
  console.log(JSON.stringify(history.restore(id, token), null, 2));
else
  throw new Error(
    "Usage: node recover.mjs --root PATH --data DATA_DIR list | save NAME | preview ID | restore ID PREVIEW_TOKEN",
  );

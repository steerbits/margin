import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Disposable fixtures live under the app, rather than /tmp (a normal cco write exception).
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const parent = join(appRoot, ".margin-data", "cco-checks");
await mkdir(parent, { recursive: true });
const root = await mkdtemp(join(parent, "probe-"));
const inside = join(root, "inside"),
  outside = join(root, "outside");
await mkdir(inside);
await mkdir(outside);
const sentinel = join(outside, "sentinel.txt"),
  deletion = join(outside, "keep.txt");
await writeFile(sentinel, "readable but unchanged");
await writeFile(deletion, "keep");
const probe = join(root, "probe.mjs");
await writeFile(
  probe,
  `import {readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const [inside,sentinel,deletion]=process.argv.slice(2);
const results={readOutside:readFileSync(sentinel,'utf8')==='readable but unchanged',writeInside:false,writeOutsideBlocked:false,symlinkWriteBlocked:false,childDeleteBlocked:false};
writeFileSync(inside+'/allowed.txt','allowed');results.writeInside=true;
try{writeFileSync(sentinel,'unexpected overwrite')}catch(e){results.writeOutsideBlocked=['EPERM','EACCES','EROFS'].includes(e.code)}
symlinkSync(sentinel,inside+'/link');try{writeFileSync(inside+'/link','unexpected overwrite')}catch(e){results.symlinkWriteBlocked=['EPERM','EACCES','EROFS'].includes(e.code)}
const child=spawnSync(process.execPath,['-e',"try{require('node:fs').unlinkSync(process.argv[1]);process.exit(1)}catch(e){process.exit(['EPERM','EACCES','EROFS'].includes(e.code)?0:2)}",deletion]);results.childDeleteBlocked=child.status===0;
console.log(JSON.stringify(results,null,2));process.exit(Object.values(results).every(Boolean)?0:1);
`,
);
try {
  const code = await new Promise<number>((done) => {
    const child = spawn(
      "cco",
      ["--command", "node", probe, inside, sentinel, deletion],
      { cwd: inside, stdio: "inherit" },
    );
    child.once("error", (e) => {
      console.error(e.message);
      done(1);
    });
    child.once("exit", (code) => done(code ?? 1));
  });
  if (code !== 0) {
    console.error(
      "cco verification did not pass. No sandbox protection is being claimed. If sandbox_apply was denied, run this check in your normal terminal.",
    );
    process.exitCode = code;
  } else if (
    (await readFile(sentinel, "utf8")) !== "readable but unchanged" ||
    (await readFile(deletion, "utf8")) !== "keep"
  )
    throw new Error("Outside fixtures were modified.");
  else
    console.log(
      "cco defaults verified: outside reads, inside writes, and blocked outside writes/deletion.",
    );
} finally {
  await rm(root, { recursive: true, force: true });
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
  symlinkSync,
  chmodSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { WorkspaceWorkers } from "../server/workspace-workers.ts";
import { RuntimeOwner, processState } from "../server/runtime-owner.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate() && Date.now() < end) await delay(20);
  assert.ok(predicate(), "lifecycle state reached within deadline");
}
function fixture(wrapper = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "margin-worker-life-")));
  const app = join(root, "app"),
    data = join(root, "data"),
    bin = join(root, "bin");
  for (const p of [join(app, "server"), data, bin])
    mkdirSync(p, { recursive: true });
  symlinkSync(resolve("node_modules"), join(app, "node_modules"), "dir");
  writeFileSync(join(app, "package.json"), '{"type":"module"}');
  const fake = join(bin, "cco");
  // This shim exercises real processes and HTTP, not OS sandbox enforcement.
  writeFileSync(
    fake,
    `#!/bin/bash\nset -e\nwhile [[ $# -gt 0 ]]; do\ncase "$1" in\n--env) export "$2"; shift 2;;\n--add-dir=*|--allow-readonly=*) shift;;\n--command) shift; ${wrapper ? '"$@" &\nsleep 1\nexit 0' : 'exec "$@"'};;\n*) exit 97;;\nesac\ndone\n`,
  );
  chmodSync(fake, 0o755);
  writeFileSync(
    join(app, "server/index.ts"),
    `
import http from 'node:http';
import {RuntimeOwner} from ${JSON.stringify(pathToFileURL(resolve("server/runtime-owner.ts")).href)};
const owner = new RuntimeOwner(process.env.MARGIN_DATA_DIR!);
const generation = process.env.MARGIN_RUNTIME_GENERATION!;
owner.claim(generation);
const server = http.createServer((req,res)=>{
 if(req.headers.authorization !== 'Bearer '+process.env.MARGIN_WORKER_TOKEN){res.writeHead(401).end();return;}
 res.setHeader('Content-Type','application/json'); res.end('{}');
 if(req.url === '/crash') setTimeout(()=>{
   // Synthetic diagnostic signature, not an intentional out-of-memory event.
   process.stderr.write('FATAL ERROR: Allocation failed - JavaScript heap out of memory PRIVATE_SENTINEL\\n');
   setTimeout(()=>process.exit(17),20);
 },20);
 if(req.url === '/api/worker/shutdown') {
   owner.update(generation,{expectedStop:true}); setTimeout(()=>process.exit(0),20);
 }
}).listen(0,'127.0.0.1',()=>{
 process.stdout.write('x'.repeat(256*1024)+'\\n');
 console.log('MARGIN_WORKER_READY '+JSON.stringify({port:(server.address() as any).port,projectId:process.env.MARGIN_WORKSPACE_ID,pid:process.pid,generation}));
});
setTimeout(()=>process.exit(0),15000).unref();
`,
  );
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  const manager = new WorkspaceWorkers(app, data);
  const project = { id: randomUUID(), name: "Lifecycle fixture", path: app };
  return {
    root,
    app,
    data,
    manager,
    project,
    async close() {
      await manager.close();
      process.env.PATH = oldPath;
      await delay(100);
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test(
  "real worker startup is single-flight; crashes retain diagnostics and permit one new runtime",
  { timeout: 20000 },
  async () => {
    const f = fixture();
    try {
      const workers = await Promise.all(
        Array.from({ length: 8 }, () => f.manager.get(f.project)),
      );
      assert.ok(workers.every((w) => w === workers[0]));
      const first = workers[0];
      const otherGateway = new WorkspaceWorkers(f.app, f.data);
      await assert.rejects(otherGateway.get(f.project), /second agent/);
      await otherGateway.close();
      const died = once(first.process, "exit");
      await fetch(`http://127.0.0.1:${first.port}/crash`, {
        headers: { Authorization: `Bearer ${first.token}` },
      });
      await died;
      await until(() => !f.manager.isStarted(f.project.id));
      const second = await f.manager.get(f.project);
      assert.notEqual(second.generation, first.generation);
      assert.notEqual(second.runtimePid, first.runtimePid);
      const owner = new RuntimeOwner(f.data);
      assert.equal(owner.current()?.previous?.generation, first.generation);
      assert.equal(owner.current()?.previous?.reason, "out of memory");
      owner.close();
      const log = readFileSync(join(f.data, "runtime/events.jsonl"), "utf8");
      assert.ok(
        log.includes('"runtime-exit"') && log.includes('"out of memory"'),
      );
      assert.ok(
        !log.includes("PRIVATE_SENTINEL") && !log.includes(first.token),
      );
    } finally {
      await f.close();
    }
  },
);
test(
  "wrapper-only exit keeps routing to the same living runtime, never creates a twin",
  { timeout: 20000 },
  async () => {
    const f = fixture(true);
    try {
      const first = await f.manager.get(f.project);
      assert.notEqual(first.runtimePid, first.process.pid);
      if (first.process.exitCode === null) await once(first.process, "exit");
      assert.equal(processState(first.runtimePid), "alive");
      const second = await f.manager.get(f.project);
      assert.equal(second, first);
      assert.equal(
        (
          await fetch(`http://127.0.0.1:${second.port}/api/worker/status`, {
            headers: { Authorization: `Bearer ${second.token}` },
          })
        ).status,
        200,
      );
      await f.manager.close();
      await until(() => processState(first.runtimePid) === "dead");
    } finally {
      await f.close();
    }
  },
);

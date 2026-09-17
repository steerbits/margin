import { test, expect } from "@playwright/test";
import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstructionsView } from "../../shared/instructions.ts";

const link = () =>
  JSON.parse(readFileSync(".margin-data/gateway-test-link.json", "utf8")) as {
    url: string;
    root: string;
  };

test("instruction APIs authenticate, keep global ownership at the gateway and route local edits to the right worker", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/instructions/global")).status()).toBe(401);
  expect(
    (await request.put("/api/instructions/global", { data: {} })).status(),
  ).toBe(401);
  await page.goto(link().url);
  await expect(
    page.getByRole("heading", { name: "Welcome to Margin", exact: true }),
  ).toBeVisible();
  const global = (await (
    await page.request.get("/api/instructions/global")
  ).json()) as InstructionsView;
  expect(global.path).toBe(join(link().root, "fixture-pi", "AGENTS.md"));
  const folders: string[] = [];
  try {
    const projects: { id: string; path: string }[] = [];
    for (const name of ["A", "B"]) {
      const folder = realpathSync(
        mkdtempSync(join(tmpdir(), `margin-gateway-instructions-${name}-`)),
      );
      folders.push(folder);
      const registered = await page.request.post("/api/projects", {
        data: { path: folder },
      });
      projects.push(await registered.json());
    }
    const [a, b] = projects;
    const endpoint = (id: string) => `/api/projects/${id}/instructions`;
    const local = (await (
      await page.request.get(endpoint(a.id))
    ).json()) as InstructionsView;
    expect(local.path).toBe(join(a.path, "AGENTS.md"));
    expect(
      (
        await page.request.put(endpoint(a.id), {
          data: {
            revision: local.revision,
            content: "LOCAL_A_ONLY",
            path: global.path,
          },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.put(endpoint(a.id), {
          data: { revision: local.revision, content: "LOCAL_A_ONLY" },
          headers: { Origin: "https://untrusted.example" },
        })
      ).status(),
    ).toBe(403);
    const save = await page.request.put(endpoint(a.id), {
      data: { revision: local.revision, content: "LOCAL_A_ONLY" },
    });
    expect(save.ok(), await save.text()).toBe(true);
    expect(readFileSync(join(a.path, "AGENTS.md"), "utf8")).toBe(
      "LOCAL_A_ONLY",
    );
    expect((await (await page.request.get(endpoint(b.id))).json()).exists).toBe(
      false,
    );
    expect(
      (
        await page.request.put(endpoint(a.id), {
          data: { revision: local.revision, content: "STALE" },
        })
      ).status(),
    ).toBe(409);
    expect((await page.request.get(endpoint("unknown-project"))).ok()).toBe(
      false,
    );

    // Prove the global endpoint does not start (or need) a source worker.
    // The shim is only in this disposable gateway fixture, not an OS sandbox.
    const cco = join(link().root, "test-bin", "cco");
    const originalCco = readFileSync(cco, "utf8");
    try {
      writeFileSync(cco, "#!/bin/bash\nexit 71\n");
      const saved = await page.request.put("/api/instructions/global", {
        data: { revision: global.revision, content: "GLOBAL_ALL_WORKSPACES" },
      });
      expect(saved.ok(), await saved.text()).toBe(true);
      expect(readFileSync(global.path, "utf8")).toBe("GLOBAL_ALL_WORKSPACES");
    } finally {
      writeFileSync(cco, originalCco);
    }
    await page.goto(`/workspaces/${b.id}`);
    await page
      .getByRole("link", { name: "View global instructions", exact: true })
      .click();
    await expect(page).toHaveURL("/customize/instructions");
    await expect(page.locator(".instructions-preview")).toHaveText(
      "GLOBAL_ALL_WORKSPACES",
    );
    await page
      .getByRole("button", { name: "Back to conversation", exact: true })
      .click();
    await expect(page).toHaveURL(`/workspaces/${b.id}`);
    expect(
      (await (await page.request.get(endpoint(a.id))).json()).content,
    ).toBe("LOCAL_A_ONLY");
  } finally {
    if (global.exists) writeFileSync(global.path, global.content);
    else rmSync(global.path, { force: true });
    folders.forEach((path) => rmSync(path, { recursive: true, force: true }));
  }
});

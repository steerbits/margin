import { Store } from "../../server/store.ts";
import { test, expect } from "@playwright/test";
import {
  readFileSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const link = () =>
  JSON.parse(readFileSync(".margin-data/gateway-test-link.json", "utf8")) as {
    url: string;
    root: string;
  };
const folders: string[] = [];
test.afterAll(() => {
  for (const folder of folders)
    rmSync(folder, { recursive: true, force: true });
});
const model = {
  id: "fixture",
  provider: "fixture",
  name: "Compatibility fixture",
  subscription: false,
  backend: "lab-virtual",
};

test("launcher needs a browser capability; merely loading its page does not grant control", async ({
  page,
  request,
}) => {
  await page.goto("/");
  expect((await request.get("/api/bootstrap")).status()).toBe(401);
  expect(
    (
      await page.request.post("/api/projects", { data: { path: tmpdir() } })
    ).status(),
  ).toBe(401);
  for (const path of [
    "/API/projects",
    "/Api/projects",
    "/%61pi/projects",
    "/api/workspaces/choose",
    "/API/workspaces/choose",
  ]) {
    expect(
      (await page.request.post(path, { data: { path: tmpdir() } })).ok(),
    ).toBe(false);
  }
  await page.goto(link().url);
  await expect(
    page.getByRole("combobox", { name: "Project", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".execution-mode")).toHaveText(
    "cco · per workspace",
  );
  await expect(page).not.toHaveURL(/connect=/);
  expect((await page.request.get("/api/bootstrap")).ok()).toBe(true);
  await page.reload();
  await expect(page.locator(".execution-mode")).toHaveText(
    "cco · per workspace",
  );
});

test("external folders have independent workers and Notes shared by their chats; SSE survives workspace switching", async ({
  page,
}) => {
  await page.goto(link().url);
  const register = async () => {
    const folder = mkdtempSync(join(tmpdir(), "margin-external-project-"));
    folders.push(folder);
    const response = await page.request.post("/api/projects", {
      data: { path: folder },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()) as { id: string; path: string };
  };
  const a = await register(),
    b = await register();
  expect(a.path.startsWith(link().root)).toBe(false);
  const notes = (id: string, action: string) =>
    `/api/projects/${id}/plugins/project-notes/${action}`;
  const saved = await page.request.post(notes(a.id, "save"), {
    data: { text: "Shared A notes", revision: 0 },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  expect(
    (await (await page.request.post(notes(b.id, "load"), { data: {} })).json())
      .result.note.text,
  ).toBe("");
  const create = async (id: string) => {
    const r = await page.request.post("/api/sessions", {
      data: { projectId: id, model },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return (await r.json()).session.id as string;
  };
  const first = await create(a.id),
    second = await create(a.id),
    other = await create(b.id);
  await page.goto(`/chats/${first}`);
  await expect(
    page.getByRole("heading", { name: "Another runtime" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Project notes", { exact: true })).toHaveValue(
    "Shared A notes",
  );
  const sent = await page.request.post(`/api/sessions/${first}/send`, {
    data: { id: randomUUID(), note: "Stream this feedback", commentIds: [] },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await expect(
    page.getByText("Feedback received by the alternate runtime."),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Conversations" })
    .locator("button:not(.selected)")
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("margin.session")))
    .toBe(second);
  await expect(page.getByLabel("Project notes", { exact: true })).toHaveValue(
    "Shared A notes",
  );
  await page
    .getByRole("combobox", { name: "Project", exact: true })
    .selectOption(b.id);
  await expect(page.getByLabel("Project notes", { exact: true })).toHaveValue(
    "",
  );
  await page
    .getByRole("navigation", { name: "Conversations" })
    .locator("button")
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("margin.session")))
    .toBe(other);
  expect((await page.request.get(`/api/sessions/${first}`)).ok()).toBe(true);
});

test("native picker registers existing and newly created folders, deduplicates, and cancels without changes", async ({
  page,
}) => {
  test.skip(
    process.platform !== "darwin",
    "Native folder selection targets macOS.",
  );
  await page.goto(link().url);
  const script = join(link().root, "scripts", "choose-workspace.jxa.js");
  const original = readFileSync(script, "utf8");
  const folder = mkdtempSync(join(tmpdir(), "margin-native-choice-"));
  folders.push(folder);
  // Replace only the helper in this disposable app. osascript executes it, but
  // no system dialog opens during automated browser tests.
  const respond = (path: string | null) =>
    writeFileSync(
      script,
      `function run(argv) { return ${JSON.stringify(JSON.stringify({ path }))}; }`,
    );
  const choose = page.getByRole("button", {
    name: "New workspace",
    exact: true,
  });
  try {
    respond(folder);
    await choose.click();
    const selector = page.getByRole("combobox", {
      name: "Project",
      exact: true,
    });
    await expect(selector.locator("option:checked")).toHaveText(
      folder.split("/").at(-1)!,
    );
    const id = await selector.inputValue();
    await choose.click();
    await expect(choose).toBeEnabled();
    const boot = await (await page.request.get("/api/bootstrap")).json();
    expect(boot.projects.filter((p: any) => p.id === id)).toHaveLength(1);
    const child = join(folder, "Created in New Folder 日本語");
    mkdirSync(child);
    respond(child);
    await choose.click();
    await expect(selector.locator("option:checked")).toHaveText(
      "Created in New Folder 日本語",
    );
    const newId = await selector.inputValue();
    const before = await (await page.request.get("/api/bootstrap")).json();
    respond(null);
    await choose.click();
    await expect(choose).toBeEnabled();
    await expect(selector).toHaveValue(newId);
    const after = await (await page.request.get("/api/bootstrap")).json();
    expect(after.projects.length).toBe(before.projects.length);
    expect(after.sessions.length).toBe(before.sessions.length);
    const file = join(folder, "file.txt");
    writeFileSync(file, "not a folder");
    respond(file);
    await choose.click();
    await expect(page.getByRole("alert")).toContainText("Choose a folder");
    await expect(selector).toHaveValue(newId);
  } finally {
    writeFileSync(script, original);
  }
});

test("a failed cco launch is reported and never replaced by a native worker", async ({
  page,
}) => {
  await page.goto(link().url);
  const folder = mkdtempSync(join(tmpdir(), "margin-failing-worker-"));
  folders.push(folder);
  const project = await (
    await page.request.post("/api/projects", { data: { path: folder } })
  ).json();
  const fake = join(link().root, "test-bin", "cco"),
    original = readFileSync(fake, "utf8");
  writeFileSync(fake, "#!/bin/bash\nexit 71\n");
  try {
    const response = await page.request.post(
      `/api/projects/${project.id}/plugins/project-notes/load`,
      { data: {} },
    );
    expect(response.ok()).toBe(false);
    expect((await response.json()).error).toContain(
      "not started an unsandboxed agent",
    );
  } finally {
    writeFileSync(fake, original);
  }
  const retry = await page.request.post(
    `/api/projects/${project.id}/plugins/project-notes/load`,
    { data: {} },
  );
  expect(retry.ok(), await retry.text()).toBe(true);
});

test("workspace-worker summaries, renames, deep links and deletion preserve stable identities", async ({
  page,
}) => {
  await page.goto(link().url);
  const folder = mkdtempSync(join(tmpdir(), "margin-worker-management-"));
  folders.push(folder);
  const project = await (
    await page.request.post("/api/projects", { data: { path: folder } })
  ).json();
  const notes = `/api/projects/${project.id}/plugins/project-notes`;
  expect(
    (
      await page.request.post(`${notes}/save`, {
        data: { text: "Keep shared notes", revision: 0 },
      })
    ).ok(),
  ).toBe(true);
  const response = await page.request.post("/api/sessions", {
    data: { projectId: project.id, model },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const id = (await response.json()).session.id;
  await page.goto(`/chats/${id}?panel=project-notes%3Anotes`);
  await expect(page.getByLabel("Project notes", { exact: true })).toHaveValue(
    "Keep shared notes",
  );
  await page
    .getByRole("button", { name: "Customize Margin", exact: true })
    .click();
  const sent = await page.request.post(`/api/sessions/${id}/send`, {
    data: {
      id: randomUUID(),
      note: "Complete in another workspace",
      commentIds: [],
    },
  });
  expect(sent.ok(), await sent.text()).toBe(true);
  await expect(
    page.locator(`[data-session-id="${id}"] .conversation-unread`),
  ).toHaveCount(1);
  const renamed = await page.request.patch(`/api/projects/${project.id}`, {
    data: { name: "Worker workspace" },
  });
  expect(renamed.ok(), await renamed.text()).toBe(true);
  await page.goto(`/chats/${id}`);
  await expect(page.locator(".project-breadcrumb")).toHaveText(
    "Worker workspace",
  );
  const reopened = await (
    await page.request.post("/api/projects", { data: { path: folder } })
  ).json();
  expect(reopened).toMatchObject({
    id: project.id,
    name: "Worker workspace",
    path: project.path,
  });
  await page.locator(`[data-session-id="${id}"]`).click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Delete conversation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${project.id}$`));
  expect((await page.request.get(`/api/sessions/${id}`)).ok()).toBe(false);
  const summary = await (await page.request.get("/api/sessions")).json();
  expect(summary.sessions.some((s: any) => s.id === id)).toBe(false);
  expect(
    (await (await page.request.post(`${notes}/load`, { data: {} })).json())
      .result.note.text,
  ).toBe("Keep shared notes");
  await page.goto(`/chats/${id}`);
  await expect(
    page.getByRole("heading", { name: "Destination unavailable" }),
  ).toBeVisible();
});

test("saved-history previews work without launching a workspace worker", async ({
  page,
}) => {
  await page.goto(link().url);
  const folder = mkdtempSync(join(tmpdir(), "margin-cold-preview-"));
  folders.push(folder);
  const project = await (
    await page.request.post("/api/projects", { data: { path: folder } })
  ).json();
  const id = randomUUID();
  const registry = new Store(join(link().root, "data", "margin.sqlite"));
  registry.put("session", id, {
    id,
    projectId: project.id,
    title: "Cold saved chat",
    backend: "lab-virtual",
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  registry.put("session-owner", id, project.id);
  registry.put("transcript", id, [
    {
      id: "saved-reply",
      role: "assistant",
      text: "Saved history without a running worker",
    },
  ]);
  registry.put("composer", id, "Saved cold draft");
  const cco = join(link().root, "test-bin", "cco");
  const original = readFileSync(cco, "utf8");
  writeFileSync(cco, "#!/bin/bash\nexit 71\n");
  try {
    const response = await page.request.get(`/api/sessions/${id}/preview`);
    expect(response.ok(), await response.text()).toBe(true);
    const preview = await response.json();
    expect(preview.composer).toBe("Saved cold draft");
    expect(preview.composerRevision).toBe(1);
    expect(preview.messages[0].text).toBe(
      "Saved history without a running worker",
    );
    expect(registry.get("workspace-storage", project.id)).toBeUndefined();
  } finally {
    writeFileSync(cco, original);
    registry.deleteSession(id);
    registry.close();
  }
});

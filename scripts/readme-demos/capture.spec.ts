import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { defaultSettings } from "../../shared/settings.ts";
import { dashboardScript, dashboardStyles } from "./dashboard-fixture.ts";
import {
  Camera,
  frame as frameClip,
  frameTogether,
  record,
  framesRoot,
  output,
  pause,
  type Clip,
} from "./record.ts";

// These are real UI recordings with example conversations. The disposable test
// host never uses the developer's credentials or changes the running app.
// Include the current bottom-docked composer, including its Send button.
const main: Clip = { x: 270, y: 160, width: 928, height: 580 };

test.beforeAll(async () => {
  await mkdir(framesRoot, { recursive: true });
  await mkdir(output, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Screenshot APIs omit the OS cursor. This overlay records actual pointer
  // movement and clicks, including inside artifact iframes.
  await page.addInitScript(() => {
    let cursor: HTMLDivElement | undefined;
    const show = (event: PointerEvent) => {
      if (!cursor) {
        cursor = document.createElement("div");
        cursor.style.cssText =
          "position:fixed;left:0;top:0;width:20px;height:25px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 1px #0005)";
        cursor.innerHTML =
          '<svg width="20" height="25" viewBox="0 0 20 25"><path d="M2 2v19l5-5 4 8 4-2-4-8 7-1Z" fill="#232323" stroke="white" stroke-width="1.4"/></svg>';
      }
      const surface =
        document.querySelector("dialog[open]") ?? document.documentElement;
      if (cursor.parentElement !== surface) surface.append(cursor);
      cursor.style.display = "block";
      cursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
    };
    document.addEventListener("pointermove", show, true);
    document.addEventListener(
      "pointerout",
      (event) => {
        if (
          cursor &&
          (!event.relatedTarget ||
            event.relatedTarget instanceof HTMLIFrameElement)
        )
          cursor.style.display = "none";
      },
      true,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        show(event);
        const ring = document.createElement("div");
        ring.style.cssText = `position:fixed;left:${event.clientX - 13}px;top:${event.clientY - 13}px;width:26px;height:26px;border:2px solid #4263d4;border-radius:50%;pointer-events:none;z-index:2147483646;background:#4263d433`;
        (
          document.querySelector("dialog[open]") ?? document.documentElement
        ).append(ring);
        ring.animate(
          [
            { transform: "scale(.6)", opacity: 1 },
            { transform: "scale(1.5)", opacity: 0 },
          ],
          { duration: 450 },
        );
        setTimeout(() => ring.remove(), 450);
      },
      true,
    );
  });
});

async function click(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Missing demo target");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
    steps: 8,
  });
  await pause(90);
  await target.click();
}

async function scrollDialogTo(target: Locator, top = 90) {
  await target.evaluate((element, top) => {
    const dialog = element.closest("dialog")!;
    dialog.scrollBy({
      top:
        element.getBoundingClientRect().top -
        dialog.getBoundingClientRect().top -
        top,
      behavior: "smooth",
    });
  }, top);
  await pause(350);
}

async function seed(page: Page, data: Record<string, unknown>) {
  await page.goto("/");
  const response = await page.request.post("/api/test/seed", { data });
  expect(response.ok(), await response.text()).toBe(true);
  const { id } = await response.json();
  await page.goto(`/chats/${id}`);
  await expect(page.getByLabel("Starting skill")).toBeEnabled();
  return id as string;
}

async function selectQuote(page: Page, quote: string) {
  const root = page.locator("[data-annotation-root]").first();
  await root.scrollIntoViewIfNeeded();
  // Use real mouse selection so the clip shows the highlighted passage.
  const bounds = await root.evaluate((root, quote) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent!.indexOf(quote);
      if (i < 0) continue;
      const range = document.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + quote.length);
      const rects = [...range.getClientRects()];
      const first = rects[0],
        last = rects.at(-1)!;
      return {
        x1: first.left + 1,
        y1: first.top + first.height / 2,
        x2: last.right - 1,
        y2: last.top + last.height / 2,
      };
    }
    throw new Error(`Missing passage: ${quote}`);
  }, quote);
  await page.mouse.move(bounds.x1, bounds.y1, { steps: 8 });
  await page.mouse.down();
  await page.mouse.move(bounds.x2, bounds.y2, { steps: 14 });
  await page.mouse.up();
}

test("01 inline feedback", async ({ page }) => {
  await seed(page, {
    title: "Shape a notes app",
    markdown:
      "## A simpler first version\n\nStart with email sign-in.\n\nKeep notes in a local SQLite file.\n\nWhat would you change before we build?",
  });
  await page.locator(".scroll-area").evaluate((el) => (el.scrollTop = 0));
  const camera = new Camera(
    await frameClip(
      page.getByRole("heading", {
        name: "A simpler first version",
        exact: true,
      }),
      { top: 75 },
    ),
  );
  await record(page, "inline-feedback", camera, async () => {
    await pause(450);
    await selectQuote(page, "email sign-in");
    await click(
      page,
      page.getByRole("button", { name: "Comment", exact: true }),
    );
    await expect(
      page.getByLabel("Inline comment", { exact: true }),
    ).toBeFocused();
    camera.move(main);
    await pause(440);
    await page
      .getByLabel("Inline comment", { exact: true })
      .pressSequentially("Skip accounts in v1.", { delay: 45 });
    await click(
      page,
      page.getByRole("button", { name: "Add comment", exact: true }),
    );
    await expect(page.locator(".comment-text")).toHaveText(
      "Skip accounts in v1.",
    );
    // Keep the highlighted passage and its saved comment in the same view.
    for (const target of [
      page.locator(".comment-card"),
      page.getByText("Start with email sign-in.", { exact: true }),
    ]) {
      const box = (await target.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(main.x);
      expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width);
      expect(box.y).toBeGreaterThanOrEqual(main.y);
      expect(box.y + box.height).toBeLessThanOrEqual(main.y + main.height);
    }
  });
});

test("02 shape before executing", async ({ page }) => {
  // More vertical room keeps the entire question card and preceding reply visible.
  await page.setViewportSize({ width: 1000, height: 900 });
  const id = await seed(page, {
    title: "Choose the direction together",
    markdown:
      "## Let’s shape it together\n\n- **Local-first:** private notes on your computer.\n- **Cloud-first:** sync and collaboration from day one.",
  });
  await page.request.post(`/api/test/${id}/dialog`, {
    data: { kind: "select", title: "Where should your notes live?" },
  });
  await expect(
    page.getByRole("button", { name: "SQLite", exact: true }),
  ).toBeVisible();
  const conversation = await frameTogether([
    page.locator(".message.assistant").last(),
    page.locator(".question-card"),
  ]);
  const camera = new Camera(conversation);
  await record(page, "shape-together", camera, async () => {
    await pause(650);
    await click(
      page,
      page.getByRole("button", { name: "SQLite", exact: true }),
    );
    const composer = page.getByLabel("Message", { exact: true });
    await click(page, composer);
    camera.move({ x: 200, y: 400, width: 800, height: 500 });
    await pause(420);
    await composer.pressSequentially("Local-first. Skip accounts for now.", {
      delay: 28,
    });
    await pause(200);
    await composer.press("Enter");
    const reply = page.getByRole("heading", {
      name: "Revised direction",
      exact: true,
    });
    await expect(reply).toBeVisible();
    camera.move(
      await frameTogether(
        [page.locator(".message.assistant").last(), page.locator(".composer")],
        800,
      ),
    );
  });
});

async function artifact(page: Page) {
  await page.setViewportSize({ width: 1000, height: 760 });
  const id = await seed(page, {
    title: "Review the generated dashboard",
    markdown:
      "## Ready for your review\n\nOpen the generated dashboard and point to anything you’d like to change.",
  });
  const response = await page.request.post(
    `/api/test/${id}/artifact-fixtures`,
    { data: {} },
  );
  expect(response.ok(), await response.text()).toBe(true);
  return { id, ...(await response.json()) };
}

test("03 review generated Markdown", async ({ page }) => {
  const data = await artifact(page);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page.getByLabel("Review artifact").selectOption(data.markdown.id);
  const frame = page.frameLocator('iframe[title="Review artifact content"]');
  await expect(
    frame.getByRole("heading", { name: "Quarterly review" }),
  ).toBeVisible();
  await record(
    page,
    "review-markdown",
    { x: 24, y: 120, width: 952, height: 595 },
    async () => {
      await pause(600);
      const paragraph = frame.locator("p").first();
      await paragraph.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page
        .getByLabel("Feedback 1", { exact: true })
        .pressSequentially("Explore retention first.", { delay: 40 });
      await click(
        page,
        page
          .locator(".artifact-comment")
          .getByRole("button", { name: "Save", exact: true }),
      );
      await expect(page.locator(".artifact-comment-text")).toHaveText(
        "Explore retention first.",
      );
    },
  );
});

test("04 point to a generated web app", async ({ page }) => {
  const data = await artifact(page);
  // Replace only the demo fixture's content; the review UI is unmodified.
  await writeFile(join(data.root, "main.js"), dashboardScript);
  await writeFile(join(data.root, "style.css"), dashboardStyles);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await page.getByLabel("Review artifact").selectOption(data.app.id);
  const frame = page.frameLocator('iframe[title="Review artifact content"]');
  await expect(
    frame.getByRole("button", { name: "Export", exact: true }),
  ).toBeVisible();
  const point = page.getByRole("button", {
    name: "Point to comment",
    exact: true,
  });
  const exportButton = frame.getByRole("button", {
    name: "Export",
    exact: true,
  });
  const camera = new Camera(
    { x: 24, y: 120, width: 952, height: 595 },
    (await page.locator(".artifact-window").boundingBox())!,
  );
  await record(page, "review-web-app", camera, async () => {
    await pause(400);
    await click(page, point);
    await pause(420);
    await click(page, exportButton);
    await expect(page.getByLabel("Feedback 1", { exact: true })).toBeVisible();
    await pause(420);
    await page
      .getByLabel("Feedback 1", { exact: true })
      .pressSequentially("Label this “Export CSV”.", { delay: 30 });
    await click(
      page,
      page
        .locator(".artifact-comment")
        .getByRole("button", { name: "Save", exact: true }),
    );
    await expect(
      frame.getByRole("button", { name: "Export", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".artifact-comment-text")).toHaveText(
      "Label this “Export CSV”.",
    );
  });
});

test("05 separate project contexts", async ({ page }) => {
  await page.goto("/");
  const folders: string[] = [];
  const projects: { id: string; name: string }[] = [];
  try {
    for (const name of ["Website", "Research"]) {
      const folder = await mkdtemp(join(framesRoot, "workspace-"));
      folders.push(folder);
      const response = await page.request.post("/api/projects", {
        data: { path: folder },
      });
      expect(response.ok()).toBe(true);
      const project = await response.json();
      await page.request.patch(`/api/projects/${project.id}`, {
        data: { name },
      });
      projects.push({ id: project.id, name });
      const note =
        name === "Website"
          ? "# Website launch\n\n- Make the homepage simpler.\n- Add a clear call to action."
          : "# Research notebook\n\n- Interview five new users.\n- Compare onboarding friction.";
      await page.request.post(
        `/api/projects/${project.id}/plugins/project-notes/save`,
        { data: { text: note, revision: 0 } },
      );
      await page.request.post("/api/test/seed", {
        data: {
          projectId: project.id,
          title:
            name === "Website"
              ? "Improve the homepage"
              : "Plan user interviews",
          empty: true,
        },
      });
    }
    // Keep the sample workspace data recognizable without publishing the
    // recording machine's paths or unrelated fixture conversations.
    await page.route(/\/api\/(bootstrap(?:\?.*)?|sessions)$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const data = await response.json();
      const ids = new Set(projects.map((project) => project.id));
      await route.fulfill({
        json: {
          ...data,
          projects: data.projects
            .filter((project: { id: string }) => ids.has(project.id))
            .map((project: { name: string }) => ({
              ...project,
              path: `/projects/${project.name.toLowerCase()}`,
            })),
          sessions: data.sessions.filter((session: { projectId: string }) =>
            ids.has(session.projectId),
          ),
        },
      });
    });
    await page.route("**/api/projects/*/instructions", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const project = projects.find((project) =>
        route.request().url().includes(`/${project.id}/`),
      )!;
      await route.fulfill({
        json: {
          ...data,
          path: `/projects/${project.name.toLowerCase()}/AGENTS.md`,
        },
      });
    });
    await page.goto(
      `/workspaces/${projects[0].id}?panel=project-notes%3Anotes`,
    );
    await expect(page.getByLabel("Project notes", { exact: true })).toHaveValue(
      /Website launch/,
    );
    await expect(page.locator(".workspace-home-heading code")).toHaveText(
      "/projects/website",
    );
    const notes = page.getByLabel("Project notes", { exact: true });
    const camera = new Camera(await frameClip(notes, { left: 40, top: 165 }));
    await record(page, "project-workspaces", camera, async () => {
      await pause(800);
      const select = page.getByRole("combobox", {
        name: "Project",
        exact: true,
      });
      await camera.focus(select, { left: 0, top: 60 });
      await pause(420);
      const box = (await select.boundingBox())!;
      await page.mouse.move(box.x + 90, box.y + 20, { steps: 10 });
      await select.focus();
      await select.selectOption(projects[1].id);
      await expect(notes).toHaveValue(/Research notebook/);
      await expect(page.locator(".workspace-home-heading code")).toHaveText(
        "/projects/research",
      );
      await pause(550);
      await camera.focus(notes, { left: 40, top: 165 });
    });
  } finally {
    for (const folder of folders)
      await rm(folder, { recursive: true, force: true });
  }
});

async function customization(page: Page) {
  await page.route("**/api/customize", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: { ...data, project: { ...data.project, path: "/projects/margin" } },
    });
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Customize Margin", exact: true })
    .click();
  await expect(page.locator(".example-card").first()).toBeVisible();
  if (!(await page.locator(".sidebar").isVisible()))
    await page
      .getByRole("button", { name: "Show sidebar", exact: true })
      .click();
  await expect(
    page.getByRole("heading", { name: "Customize Margin", exact: true }),
  ).toBeVisible();
}

test("06 ask AI to customize Margin", async ({ page }) => {
  await customization(page);
  const example = page
    .locator(".example-card")
    .filter({ hasText: "Let your assistant work with notes" });
  await example.scrollIntoViewIfNeeded();
  const camera = new Camera(await frameClip(example, { left: 24, top: 32 }));
  await record(page, "customize-margin", camera, async () => {
    await pause(750);
    await click(
      page,
      example.getByRole("button", { name: "Use this prompt", exact: true }),
    );
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      /Extend the project-notes plugin/,
    );
    const composer = page.getByLabel("Message", { exact: true });
    await click(page, composer);
    await camera.focus(composer, { top: 55 });
    await pause(420);
    await composer.press("Meta+A");
    await composer.pressSequentially("Add a decision-log plugin to Margin.", {
      delay: 35,
    });
    await expect(composer).toHaveValue("Add a decision-log plugin to Margin.");
    await pause(250);
    camera.move(main);
  });
});

test("07 choose a workflow skill", async ({ page }) => {
  await seed(page, { title: "Start with the right workflow", empty: true });
  const skill = page.getByLabel("Starting skill", { exact: true });
  const options = await skill.locator("option").evaluateAll((items) =>
    items.map((item) => ({
      label: item.textContent,
      value: (item as HTMLOptionElement).value,
    })),
  );
  const selected = options.find((item) => item.label === "Shape with me");
  expect(selected).toBeTruthy();
  await skill.selectOption("");
  await record(
    page,
    "workflow-skills",
    { x: 270, y: 160, width: 900, height: 562.5 },
    async () => {
      await pause(750);
      await skill.selectOption(selected!.value);
      const composer = page.getByLabel("Message", { exact: true });
      await click(page, composer);
      await composer.pressSequentially("Help me shape a personal notes app.", {
        delay: 55,
      });
      await expect(skill).toHaveValue(selected!.value);
    },
  );
});

async function connections(page: Page) {
  await page.route("**/api/bootstrap*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), models: [], sessions: [] },
    });
  });
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { settings: defaultSettings, models: [] } }),
  );
  await page.route("**/api/provider-accounts", (route) =>
    route.fulfill({
      json: {
        readOnly: false,
        providers: [
          {
            id: "openai-codex",
            name: "ChatGPT / Codex",
            configured: false,
            stored: false,
            methods: [{ type: "oauth", label: "Sign in with OpenAI" }],
          },
          {
            id: "openrouter",
            name: "OpenRouter",
            configured: false,
            stored: false,
            methods: [
              { type: "oauth", label: "Sign in with OpenRouter" },
              { type: "api_key", label: "Use API key" },
            ],
          },
          {
            id: "anthropic",
            name: "Anthropic (Claude)",
            configured: false,
            stored: false,
            methods: [
              { type: "oauth", label: "Sign in with Claude" },
              { type: "api_key", label: "Use API key" },
            ],
          },
          {
            id: "google",
            name: "Google (Gemini)",
            configured: false,
            stored: false,
            methods: [{ type: "api_key", label: "Use API key" }],
          },
        ],
      },
    }),
  );
  await page.route("**/api/custom-connections", (route) =>
    route.fulfill({ json: { connections: [], readOnly: false } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /ChatGPT \/ Codex Use your/ }),
  ).toBeVisible();
}

test("08 connect subscriptions and API keys", async ({ page }) => {
  await connections(page);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const bounds = (await dialog.boundingBox())!;
  await record(
    page,
    "ai-connections",
    { x: bounds.x - 10, y: bounds.y + 30, width: 640, height: 400 },
    async () => {
      await pause(450);
      await click(
        page,
        dialog.getByRole("button", { name: /ChatGPT \/ Codex Use your/ }),
      );
      await scrollDialogTo(dialog.locator(".account-card"));
      await pause(550);
      await click(
        page,
        dialog.getByRole("button", { name: /OpenRouter Sign in or/ }),
      );
      await scrollDialogTo(dialog.locator(".account-card"));
      await expect(
        dialog.getByRole("button", { name: "Use API key", exact: true }),
      ).toBeVisible();
    },
  );
});

test("09 configure a local or custom model", async ({ page }) => {
  await connections(page);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: /Add custom connection/ }).click();
  await dialog
    .getByLabel("Authentication", { exact: true })
    .selectOption("none");
  await dialog.locator(".custom-connection-form").scrollIntoViewIfNeeded();
  const bounds = (await dialog.boundingBox())!;
  await record(
    page,
    "custom-models",
    { x: bounds.x - 10, y: bounds.y + 30, width: 640, height: 400 },
    async () => {
      await pause(550);
      const url = dialog.getByLabel("Base URL", { exact: true });
      await click(page, url);
      await url.pressSequentially("http://localhost:8080/v1", { delay: 35 });
      const model = dialog.getByLabel("Model ID", { exact: true });
      await scrollDialogTo(model, 250);
      await click(page, model);
      await model.pressSequentially("Qwen3-4B", { delay: 70 });
      await expect(model).toHaveValue("Qwen3-4B");
    },
  );
});

test("10 extend Margin with plugins", async ({ page }) => {
  await customization(page);
  await page.getByRole("button", { name: "Plugins", exact: false }).click();
  const notes = page.getByRole("checkbox", { name: "Enable Project Notes" });
  await expect(notes).toBeChecked();
  await record(page, "plugins", main, async () => {
    await pause(450);
    await click(page, notes);
    // Default assertion backoff adds nearly a second after each asynchronous
    // status update. Poll promptly so that idle waiting doesn't eat the hold.
    await expect
      .poll(
        () => page.getByText("Restart needed", { exact: true }).isVisible(),
        { intervals: [50] },
      )
      .toBe(true);
    await pause(300);
    await click(page, notes);
    await expect(notes).toBeChecked();
    await expect
      .poll(() => page.getByRole("status").textContent(), { intervals: [50] })
      .toContain("No restart is needed");
  });
});

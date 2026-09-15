import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const types = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
};
const server = createServer(async (request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const file = path === "/" ? "/index.html" : path;
  if (!["/index.html", "/style.css", "/game.js"].includes(file)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const content = await readFile(resolve(root, `.${file}`));
    response
      .writeHead(200, {
        "Content-Type": types[file.slice(file.lastIndexOf("."))],
      })
      .end(content);
  } catch {
    response.writeHead(500).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const baseURL = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [];
let checks = 0;

function passed(label) {
  checks++;
  console.log(`✓ ${label}`);
}
async function countIs(page, count) {
  await page.waitForFunction(
    (expected) =>
      Number(
        document.querySelector("#berry-progress").getAttribute("aria-valuenow"),
      ) === expected,
    count,
    { timeout: 8000 },
  );
}
async function position(page) {
  return page.locator("#player").evaluate((element) => ({
    x: parseFloat(element.style.left),
    y: parseFloat(element.style.top),
  }));
}
async function tabTo(page, selector) {
  for (let i = 0; i < 30; i++) {
    if (
      await page
        .locator(selector)
        .evaluate((element) => element === document.activeElement)
    )
      return;
    await page.keyboard.press("Tab");
  }
  assert.fail(`Could not reach ${selector} with Tab`);
}
async function gatherAndFinish(page, input = "click") {
  const route = [1, 2, 3, 6, 5, 4];
  for (const [index, berry] of route.entries()) {
    const selector = `[data-berry="${berry}"]`;
    if (input === "keyboard") {
      await tabTo(page, selector);
      await page.keyboard.press("Enter");
    } else {
      await page.locator(selector)[input]();
    }
    await countIs(page, index + 1);
  }
  await page.waitForFunction(
    () => document.querySelectorAll(".berry-object").length === 0,
  );
  assert.equal(await page.locator(".progress-dot.filled").count(), 6);
  assert.equal(await page.locator("#picnic-button").isEnabled(), true);
  assert.equal(
    await page.locator("#win-dialog").evaluate((dialog) => dialog.open),
    false,
    "Gathering is not winning until the berries are shared",
  );
  if (input === "keyboard") {
    await tabTo(page, "#picnic-button");
    await page.keyboard.press("Enter");
  } else {
    await page.locator("#picnic-button")[input]();
  }
  await page.waitForFunction(
    () => document.querySelector("#win-dialog").open,
    null,
    { timeout: 8000 },
  );
  assert.equal(await page.locator(".friend.party").count(), 3);
  assert.equal(
    await page
      .locator("#game")
      .evaluate((element) => element.classList.contains("completed")),
    true,
  );
}

try {
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(baseURL);
  assert.equal(await page.title(), "Clover’s Little Picnic");
  assert.equal(await page.locator(".berry-object").count(), 6);
  assert.equal(await page.locator(".friend").count(), 3);
  await countIs(page, 0);
  assert.equal(
    await page.locator("#sound-button").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(
    requests.some(
      (url) => !url.startsWith(baseURL) && !url.startsWith("data:"),
    ),
    false,
  );
  passed(
    "Initial scene, six berries, three friends, silent by default, no external requests",
  );

  const dimensions = await page.locator(".friend").evaluateAll((elements) =>
    elements.map((element) => {
      const { width, height } = element.getBoundingClientRect();
      return { width, height };
    }),
  );
  assert.ok(
    dimensions.every(({ width, height }) => height < width * 1.2),
    "Sprite hit areas follow their illustration, not a default 150px SVG height",
  );
  passed("Friend illustrations have correctly sized hit areas");

  await page.locator("#game").focus();
  const start = await position(page);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(240);
  await page.keyboard.up("ArrowLeft");
  const left = await position(page);
  assert.ok(left.x < start.x - 2);
  await page.keyboard.down("d");
  await page.waitForTimeout(240);
  await page.keyboard.up("d");
  assert.ok((await position(page)).x > left.x + 2);
  passed("Arrow-key and WASD movement");

  await page.locator("#help-button").click();
  assert.equal(
    await page.locator("#help-dialog").evaluate((dialog) => dialog.open),
    true,
  );
  const paused = await position(page);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  assert.deepEqual(await position(page), paused);
  await page.keyboard.press("Escape");
  assert.equal(
    await page.locator("#help-dialog").evaluate((dialog) => dialog.open),
    false,
  );
  await page.waitForFunction(
    () => document.activeElement === document.querySelector("#game"),
  );
  passed("Instructions pause play; Escape closes them and restores game focus");

  await page.locator('[data-friend="hedgehog"]').click();
  assert.match(
    await page.locator("#field-note-text").textContent(),
    /favorite leaf/,
  );
  assert.match(await page.locator("#announcer").textContent(), /Hazel/);
  await page.locator('[data-friend="hedgehog"]').click();
  assert.match(await page.locator("#field-note-text").textContent(), /prickly/);
  await countIs(page, 0);
  passed(
    "Friends have rotating dialogue, live announcements, and no accidental pickups",
  );

  await page.locator("#sound-button").click();
  assert.equal(
    await page.locator("#sound-button").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#sound-button").click();
  assert.equal(
    await page.locator("#sound-button").getAttribute("aria-pressed"),
    "false",
  );
  passed("Opt-in Web Audio toggle");

  await page.locator("#basket").click();
  assert.match(
    await page.locator("#field-note-text").textContent(),
    /6 more berries/,
  );
  assert.equal(
    await page.locator("#win-dialog").evaluate((dialog) => dialog.open),
    false,
  );
  await gatherAndFinish(page);
  passed(
    "Mouse play: six unique pickups, full basket objective, and picnic celebration",
  );

  await page.locator("#replay-button").click();
  await countIs(page, 0);
  assert.equal(await page.locator(".berry-object").count(), 6);
  assert.equal(await page.locator(".friend.party").count(), 0);
  const resetPosition = await position(page);
  assert.equal(resetPosition.x, 34);
  assert.ok(Math.abs(resetPosition.y - (387 / 570) * 100) < 0.001);
  assert.equal(await page.locator("#picnic-button").isDisabled(), true);
  passed("Replay resets the entire round");

  await gatherAndFinish(page, "keyboard");
  await page.locator("#stay-button").click();
  assert.equal(
    await page.locator("#win-dialog").evaluate((dialog) => dialog.open),
    false,
  );
  await countIs(page, 6);
  await page.locator("#basket").click();
  assert.match(
    await page.locator("#field-note-text").textContent(),
    /Same time tomorrow/,
  );
  await page.locator("#picnic-button").click();
  await countIs(page, 0);
  passed(
    "Entire round via Tab/Enter; staying keeps the picnic, and replay works afterward",
  );

  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  });
  const mobile = await phone.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(baseURL);
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.equal(
    await mobile
      .locator(".player-art")
      .evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  const berrySize = await mobile.locator('[data-berry="1"]').boundingBox();
  assert.ok(berrySize.width >= 44 && berrySize.height >= 44);
  await gatherAndFinish(mobile, "tap");
  const dialogBox = await mobile.locator("#win-dialog").boundingBox();
  assert.ok(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390);
  assert.ok(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 844);
  passed(
    "390px phone: real touch input, full round, reduced motion, no overflow, visible celebration",
  );

  await mobile.setViewportSize({ width: 740, height: 360 });
  assert.equal(
    await mobile
      .locator("#win-dialog")
      .evaluate((element) => getComputedStyle(element).overflowY),
    "auto",
  );
  await mobile.locator("#stay-button").scrollIntoViewIfNeeded();
  const shortDialog = await mobile.locator("#win-dialog").boundingBox();
  const stayBox = await mobile.locator("#stay-button").boundingBox();
  assert.ok(shortDialog.y >= 0 && shortDialog.y + shortDialog.height <= 360);
  assert.ok(
    stayBox.y >= shortDialog.y &&
      stayBox.y + stayBox.height <= shortDialog.y + shortDialog.height,
  );
  await mobile.locator("#stay-button").tap();
  passed("Landscape phone: celebration scrolls and its action stays reachable");

  await mobile.setViewportSize({ width: 320, height: 640 });
  await mobile.reload();
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await mobile.locator("#help-button").tap();
  const helpBox = await mobile.locator("#help-dialog").boundingBox();
  assert.ok(helpBox.x >= 0 && helpBox.x + helpBox.width <= 320);
  assert.ok(helpBox.height <= 640);
  passed("320px layout and instructions fit a small phone");

  const filePage = await browser.newPage();
  filePage.on("pageerror", (error) => errors.push(error.message));
  await filePage.goto(new URL("../index.html", import.meta.url).href);
  assert.equal(await filePage.locator(".berry-object").count(), 6);
  await filePage.locator('[data-friend="duck"]').click();
  assert.match(
    await filePage.locator("#field-note-text").textContent(),
    /enthusiasm/,
  );
  passed("Runs directly from index.html with file://, without a server");

  assert.deepEqual(errors, []);
  passed("Zero browser JavaScript errors across all scenarios");
  console.log(`\n${checks} checks passed.`);
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}

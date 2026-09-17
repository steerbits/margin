import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readmeGifReferences } from "../scripts/readme-demos/readme-images.ts";

test("retina README GIFs keep a fixed desktop width and responsive aspect ratio", () => {
  const valid =
    '<img src="docs/example.gif" width="480" alt="Readable feedback">';
  assert.deepEqual(readmeGifReferences(valid), [
    { path: "docs/example.gif", caption: "Readable feedback", tag: valid },
  ]);
  for (const invalid of [
    "![Feedback](docs/example.gif)",
    valid.replace('width="480"', ""),
    valid.replace('width="480"', 'width="960"'),
    valid.replace('width="480"', 'width="480" height="300"'),
    valid.replace('alt="Readable feedback"', ""),
  ])
    assert.throws(() => readmeGifReferences(invalid));
});

test("all five existing README demo links retain their paths and constrained embeds", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.deepEqual(
    readmeGifReferences(readme).map((item) => item.path),
    [
      "docs/images/inline-feedback.gif",
      "docs/images/shape-together.gif",
      "docs/images/review-web-app.gif",
      "docs/images/customize-margin.gif",
      "docs/demos/project-workspaces.gif",
    ],
  );
});

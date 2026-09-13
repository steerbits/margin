import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  formatSkillsForPrompt,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { defaultSkill } from "../shared/skills.ts";

const skillsDir = fileURLToPath(new URL("../skills/", import.meta.url));
const shapePath = fileURLToPath(
  new URL("../skills/shape-with-me/SKILL.md", import.meta.url),
);

// These check packaging and selection, not whether a model follows the workflow.
test("shape-with-me is discoverable and available in Pi's skill prompt", () => {
  const { skills, diagnostics } = loadSkillsFromDir({
    dir: skillsDir,
    source: "path",
  });
  assert.deepEqual(diagnostics, []);
  const matches = skills.filter((skill) => skill.name === "shape-with-me");
  assert.equal(matches.length, 1);
  const [shape] = matches;
  assert.equal(shape.filePath, shapePath);
  assert.ok(shape.description.trim());
  assert.equal(shape.disableModelInvocation, false);
  const prompt = formatSkillsForPrompt([shape]);
  assert.ok(prompt.includes("<name>shape-with-me</name>"));
  assert.ok(prompt.includes(`<location>${shapePath}</location>`));
});

test("shape-with-me remains optional and does not replace the new-chat default", () => {
  const { skills } = loadSkillsFromDir({ dir: skillsDir, source: "path" });
  const shape = skills.find((skill) => skill.name === "shape-with-me");
  const original = skills.find((skill) => skill.name === "think-with-me");
  assert.ok(shape);
  assert.ok(original);
  assert.equal(defaultSkill(skills), "think-with-me");
  assert.equal(defaultSkill([shape, original]), "think-with-me");
  assert.equal(defaultSkill([original, shape]), "think-with-me");
  assert.equal(defaultSkill([shape]), "");
});

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  formatSkillsForPrompt,
  loadSkillsFromDir,
} from "@earendil-works/pi-coding-agent";
import { defaultSkill, skillLabel } from "../shared/skills.ts";

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

test("Shape with me replaces Think with me as the new-chat default", () => {
  const { skills } = loadSkillsFromDir({ dir: skillsDir, source: "path" });
  const shape = skills.find((skill) => skill.name === "shape-with-me");
  assert.ok(shape);
  assert.equal(skills.some((skill) => skill.name === "think-with-me"), false);
  const additional = { ...shape, name: "another-skill" };
  assert.equal(defaultSkill(skills), "shape-with-me");
  assert.equal(defaultSkill([shape, additional]), "shape-with-me");
  assert.equal(defaultSkill([additional, shape]), "shape-with-me");
  assert.equal(defaultSkill([shape]), "shape-with-me");
  assert.equal(defaultSkill([additional]), "");
  assert.equal(defaultSkill([]), "");
});

test("shape-with-me has a friendly display name without renaming other skills", () => {
  assert.equal(skillLabel("shape-with-me"), "Shape with me");
  assert.equal(skillLabel("another-skill"), "another-skill");
});

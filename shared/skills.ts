import type { SkillInfo } from "./types.ts";
export const defaultSkill = (skills: SkillInfo[]) =>
  skills.some((skill) => skill.name === "shape-with-me") ? "shape-with-me" : "";
export const skillLabel = (name: string) =>
  name === "shape-with-me" ? "Shape with me" : name;

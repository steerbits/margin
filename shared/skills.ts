import type { SkillInfo } from "./types.ts";
export const defaultSkill = (skills: SkillInfo[]) =>
  skills.some((skill) => skill.name === "think-with-me") ? "think-with-me" : "";
export const skillLabel = (name: string) =>
  name === "think-with-me" ? "Think with me" : name;

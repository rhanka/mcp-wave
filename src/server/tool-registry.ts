import type { RegisteredTool } from "./define-tool.js";

const TOOLS: RegisteredTool[] = [];

export function allTools(): readonly RegisteredTool[] {
  return TOOLS;
}

export function registerTools(...tools: RegisteredTool[]): void {
  TOOLS.push(...tools);
}

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

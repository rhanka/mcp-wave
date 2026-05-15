import { listBusinessesTool } from "../tools/businesses/list-businesses.js";
import type { RegisteredTool } from "./define-tool.js";

const TOOLS: RegisteredTool[] = [listBusinessesTool];

export function allTools(): readonly RegisteredTool[] {
  return TOOLS;
}

export function registerTools(...tools: RegisteredTool[]): void {
  TOOLS.push(...tools);
}

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS.find((t) => t.name === name);
}

export function __clearToolsForTests(): void {
  TOOLS.length = 0;
}

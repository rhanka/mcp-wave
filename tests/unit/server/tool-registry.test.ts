import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import {
  __clearToolsForTests,
  allTools,
  findTool,
  registerTools,
} from "../../../src/server/tool-registry.js";

describe("tool-registry", () => {
  let snapshot: ReadonlyArray<unknown> = [];

  beforeEach(() => {
    snapshot = [...allTools()];
    __clearToolsForTests();
  });

  afterEach(() => {
    __clearToolsForTests();
    registerTools(...(snapshot as Parameters<typeof registerTools>));
  });

  it("registers and looks up tools by name", () => {
    const a = defineTool({
      name: "a_tool",
      description: "first",
      inputSchema: z.object({}),
      async execute() {
        return null;
      },
    });
    registerTools(a);
    expect(findTool("a_tool")).toBe(a);
    expect(findTool("missing")).toBeUndefined();
    expect(allTools()).toContain(a);
  });
});

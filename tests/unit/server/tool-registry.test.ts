import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool } from "../../../src/server/define-tool.js";
import { allTools, findTool, registerTools } from "../../../src/server/tool-registry.js";

describe("tool-registry", () => {
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

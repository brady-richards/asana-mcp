import { describe, it, expect } from "vitest";
import { pickDefaultWorkspaceGid } from "../../src/utils/workspace.js";

describe("pickDefaultWorkspaceGid", () => {
  it("returns the gid when exactly one workspace is visible", () => {
    expect(pickDefaultWorkspaceGid([{ gid: "111", name: "Personal" }])).toBe("111");
  });

  it("throws a friendly error when there are no workspaces", () => {
    expect(() => pickDefaultWorkspaceGid([])).toThrow(/workspace/i);
  });

  it("throws on ambiguity when more than one workspace is visible, listing gids and names", () => {
    const workspaces = [
      { gid: "111", name: "Personal" },
      { gid: "222", name: "Acme Corp" },
    ];
    expect(() => pickDefaultWorkspaceGid(workspaces)).toThrow(/workspace_id/);
    expect(() => pickDefaultWorkspaceGid(workspaces)).toThrow(/111/);
    expect(() => pickDefaultWorkspaceGid(workspaces)).toThrow(/222/);
    expect(() => pickDefaultWorkspaceGid(workspaces)).toThrow(/Personal/);
    expect(() => pickDefaultWorkspaceGid(workspaces)).toThrow(/Acme Corp/);
  });

  it("still lists gids on ambiguity even when names are missing", () => {
    expect(() => pickDefaultWorkspaceGid([{ gid: "111" }, { gid: "222" }])).toThrow(/111.*222/);
  });
});

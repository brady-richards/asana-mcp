import { describe, it, expect } from "vitest";
import { findSectionGidByName } from "../../../src/services/sections/lookup.js";

describe("findSectionGidByName", () => {
  const sections = [
    { gid: "1", name: "To Do" },
    { gid: "2", name: "In Progress" },
    { gid: "3", name: "Done" },
  ];

  it("finds an exact match", () => {
    expect(findSectionGidByName(sections, "In Progress")).toBe("2");
  });

  it("matches case-insensitively", () => {
    expect(findSectionGidByName(sections, "done")).toBe("3");
    expect(findSectionGidByName(sections, "TO DO")).toBe("1");
  });

  it("throws when no section matches", () => {
    expect(() => findSectionGidByName(sections, "Backlog")).toThrow(/Backlog/);
  });

  it("throws when more than one section matches (case-insensitive collision)", () => {
    const dupes = [
      { gid: "1", name: "Done" },
      { gid: "2", name: "done" },
    ];
    expect(() => findSectionGidByName(dupes, "Done")).toThrow(/Done|multiple/i);
  });

  it("skips sections with no name when matching", () => {
    const withUnnamed = [{ gid: "1" }, { gid: "2", name: "Done" }];
    expect(findSectionGidByName(withUnnamed, "Done")).toBe("2");
  });
});

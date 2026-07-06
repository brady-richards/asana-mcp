import { describe, it, expect } from "vitest";
import { resolveStatusType } from "../../../src/services/projects/statusType.js";

describe("resolveStatusType", () => {
  it("derives on_track from green when status_type is omitted", () => {
    expect(resolveStatusType("green", undefined)).toBe("on_track");
  });

  it("derives at_risk from yellow when status_type is omitted", () => {
    expect(resolveStatusType("yellow", undefined)).toBe("at_risk");
  });

  it("derives off_track from red when status_type is omitted", () => {
    expect(resolveStatusType("red", undefined)).toBe("off_track");
  });

  it("prefers an explicit status_type over the color-derived one", () => {
    expect(resolveStatusType("green", "on_hold")).toBe("on_hold");
    expect(resolveStatusType("red", "complete")).toBe("complete");
    expect(resolveStatusType("yellow", "dropped")).toBe("dropped");
  });

  it("throws a friendly error for an unmapped color with no explicit status_type", () => {
    expect(() => resolveStatusType("magenta" as never, undefined)).toThrow(/status_type/);
  });
});

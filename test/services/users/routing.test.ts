import { describe, it, expect } from "vitest";
import { classifyUserIdentifier, buildGetUserOpts } from "../../../src/services/users/routing.js";

describe("classifyUserIdentifier", () => {
  it('classifies the literal string "me" as "me"', () => {
    expect(classifyUserIdentifier("me")).toBe("me");
  });

  it("classifies a string containing @ as an email", () => {
    expect(classifyUserIdentifier("person@example.com")).toBe("email");
  });

  it("classifies a numeric-looking string as a gid", () => {
    expect(classifyUserIdentifier("123456789")).toBe("gid");
  });

  it('does not classify "me" as an email even though it lacks an @', () => {
    expect(classifyUserIdentifier("me")).not.toBe("email");
  });
});

describe("buildGetUserOpts", () => {
  it("omits workspace for a gid identifier even if one is passed in", () => {
    expect(buildGetUserOpts("123456789", ["name", "email"], "999")).toEqual({
      opt_fields: ["name", "email"],
    });
  });

  it('omits workspace for "me"', () => {
    expect(buildGetUserOpts("me", ["name"], "999")).toEqual({ opt_fields: ["name"] });
  });

  it("includes workspace for an email identifier when a workspace was resolved", () => {
    expect(buildGetUserOpts("person@example.com", ["name", "email"], "999")).toEqual({
      workspace: "999",
      opt_fields: ["name", "email"],
    });
  });

  it("omits workspace for an email identifier when no workspace was resolved", () => {
    expect(buildGetUserOpts("person@example.com", ["name"], undefined)).toEqual({
      opt_fields: ["name"],
    });
  });
});

import { describe, it, expect } from "vitest";
import { parseOptFields } from "../../src/utils/optFields.js";

describe("parseOptFields", () => {
  it("uses the default field list when input is undefined", () => {
    expect(parseOptFields(undefined, "name,due_on")).toEqual(["name", "due_on"]);
  });

  it("splits a comma-separated field list", () => {
    expect(parseOptFields("name,due_on,completed", "x")).toEqual([
      "name",
      "due_on",
      "completed",
    ]);
  });

  it("trims whitespace around each entry", () => {
    expect(parseOptFields("name, due_on , completed", "x")).toEqual([
      "name",
      "due_on",
      "completed",
    ]);
  });

  it("trims whitespace-only input to the default", () => {
    expect(parseOptFields("   ", "name,due_on")).toEqual(["name", "due_on"]);
  });

  it("drops empty entries caused by stray commas", () => {
    expect(parseOptFields("name,,due_on,", "x")).toEqual(["name", "due_on"]);
  });

  it("trims the default field list too", () => {
    expect(parseOptFields(undefined, "name, due_on ,completed")).toEqual([
      "name",
      "due_on",
      "completed",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  DATE_REGEX,
  DATETIME_REGEX,
  dateField,
  datetimeField,
  nullableDateField,
  nullableDatetimeField,
  clearNullSentinel,
  assertMutuallyExclusive,
  assertExactlyOneOf,
  normalizeAndValidateDateFields,
} from "../../../src/services/tasks/validation.js";

describe("DATE_REGEX", () => {
  it("matches valid YYYY-MM-DD dates", () => {
    expect(DATE_REGEX.test("2026-01-15")).toBe(true);
  });

  it("rejects datetimes and malformed dates", () => {
    expect(DATE_REGEX.test("2026-1-15")).toBe(false);
    expect(DATE_REGEX.test("2026-01-15T00:00:00Z")).toBe(false);
    expect(DATE_REGEX.test("not-a-date")).toBe(false);
    expect(DATE_REGEX.test("")).toBe(false);
  });
});

describe("DATETIME_REGEX", () => {
  it("matches valid ISO 8601 datetimes", () => {
    expect(DATETIME_REGEX.test("2026-01-15T09:00:00Z")).toBe(true);
    expect(DATETIME_REGEX.test("2026-01-15T09:00:00.147Z")).toBe(true);
    expect(DATETIME_REGEX.test("2026-01-15T09:00:00+02:00")).toBe(true);
  });

  it("rejects bare dates and malformed datetimes", () => {
    expect(DATETIME_REGEX.test("2026-01-15")).toBe(false);
    expect(DATETIME_REGEX.test("2026-01-15 09:00:00Z")).toBe(false);
    expect(DATETIME_REGEX.test("not-a-datetime")).toBe(false);
  });
});

describe("dateField", () => {
  it("accepts a valid date", () => {
    expect(dateField().safeParse("2026-01-15").success).toBe(true);
  });

  it("rejects an invalid date with a friendly message naming the ISO format", () => {
    const result = dateField().safeParse("01/15/2026");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/ISO 8601 date/);
    }
  });
});

describe("datetimeField", () => {
  it("accepts a valid ISO 8601 datetime", () => {
    expect(datetimeField().safeParse("2026-01-15T09:00:00Z").success).toBe(true);
  });

  it("rejects a bare date with a friendly message naming the ISO format", () => {
    const result = datetimeField().safeParse("2026-01-15");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/ISO 8601 datetime/);
    }
  });
});

describe("nullableDateField", () => {
  const schema = nullableDateField();

  it("accepts a valid date string", () => {
    expect(schema.safeParse("2026-01-15").success).toBe(true);
  });

  it("accepts a real null", () => {
    expect(schema.safeParse(null).success).toBe(true);
  });

  it('accepts the literal string "null"', () => {
    expect(schema.safeParse("null").success).toBe(true);
  });

  it("accepts undefined (field omitted)", () => {
    expect(schema.safeParse(undefined).success).toBe(true);
  });

  it("rejects an invalid date string", () => {
    expect(schema.safeParse("bogus").success).toBe(false);
  });
});

describe("nullableDatetimeField", () => {
  const schema = nullableDatetimeField();

  it("accepts a valid datetime string", () => {
    expect(schema.safeParse("2026-01-15T09:00:00Z").success).toBe(true);
  });

  it("accepts a real null and the literal string \"null\"", () => {
    expect(schema.safeParse(null).success).toBe(true);
    expect(schema.safeParse("null").success).toBe(true);
  });

  it("rejects a bare date (not a datetime)", () => {
    expect(schema.safeParse("2026-01-15").success).toBe(false);
  });
});

describe("clearNullSentinel", () => {
  it('folds the literal "null" into a real null', () => {
    expect(clearNullSentinel("null")).toBeNull();
  });

  it("passes through a real null unchanged", () => {
    expect(clearNullSentinel(null)).toBeNull();
  });

  it("passes through a valid date/datetime string unchanged", () => {
    expect(clearNullSentinel("2026-01-15")).toBe("2026-01-15");
    expect(clearNullSentinel("2026-01-15T09:00:00Z")).toBe("2026-01-15T09:00:00Z");
  });

  it("passes through undefined unchanged", () => {
    expect(clearNullSentinel(undefined)).toBeUndefined();
  });
});

describe("assertMutuallyExclusive", () => {
  it("throws naming both params when both hold a real value", () => {
    expect(() =>
      assertMutuallyExclusive(
        { due_on: "2026-01-15", due_at: "2026-01-15T09:00:00Z" },
        [["due_on", "due_at"]]
      )
    ).toThrow(/due_on/);
    expect(() =>
      assertMutuallyExclusive(
        { due_on: "2026-01-15", due_at: "2026-01-15T09:00:00Z" },
        [["due_on", "due_at"]]
      )
    ).toThrow(/due_at/);
  });

  it("does not throw when only one of the pair is set", () => {
    expect(() =>
      assertMutuallyExclusive({ due_on: "2026-01-15" }, [["due_on", "due_at"]])
    ).not.toThrow();
  });

  it("does not throw when one is null (clearing) and the other is a real value", () => {
    expect(() =>
      assertMutuallyExclusive(
        { due_on: null, due_at: "2026-01-15T09:00:00Z" },
        [["due_on", "due_at"]]
      )
    ).not.toThrow();
  });

  it("does not throw when both are null or undefined", () => {
    expect(() =>
      assertMutuallyExclusive({ due_on: null, due_at: undefined }, [["due_on", "due_at"]])
    ).not.toThrow();
  });

  it("checks every pair independently", () => {
    expect(() =>
      assertMutuallyExclusive(
        { start_on: "2026-01-15", start_at: "2026-01-15T09:00:00Z" },
        [
          ["due_on", "due_at"],
          ["start_on", "start_at"],
        ]
      )
    ).toThrow(/start_on|start_at/);
  });
});

describe("assertExactlyOneOf", () => {
  it("does not throw when exactly one candidate is present", () => {
    expect(() =>
      assertExactlyOneOf({ project_id: "123" }, ["project_id", "workspace"])
    ).not.toThrow();
  });

  it("throws naming all candidates when none are present", () => {
    expect(() => assertExactlyOneOf({}, ["project_id", "workspace"])).toThrow(
      /project_id/
    );
    expect(() => assertExactlyOneOf({}, ["project_id", "workspace"])).toThrow(
      /workspace/
    );
  });

  it("throws when both candidates are present", () => {
    expect(() =>
      assertExactlyOneOf(
        { project_id: "123", workspace: "456" },
        ["project_id", "workspace"]
      )
    ).toThrow();
  });
});

describe("normalizeAndValidateDateFields", () => {
  it('allows clearing due_on with the string "null" while setting due_at (date→datetime switch), producing a real null', () => {
    expect(
      normalizeAndValidateDateFields({ due_on: "null", due_at: "2026-01-15T09:00:00Z" })
    ).toEqual({ due_on: null, due_at: "2026-01-15T09:00:00Z" });
  });

  it("allows clearing due_at with a real null while setting due_on (datetime→date switch)", () => {
    expect(
      normalizeAndValidateDateFields({ due_at: null, due_on: "2026-01-15" })
    ).toEqual({ due_at: null, due_on: "2026-01-15" });
  });

  it('allows clearing start_on with "null" while setting start_at', () => {
    expect(
      normalizeAndValidateDateFields({ start_on: "null", start_at: "2026-01-15T09:00:00Z" })
    ).toEqual({ start_on: null, start_at: "2026-01-15T09:00:00Z" });
  });

  it("still throws naming both params when both siblings hold live values", () => {
    expect(() =>
      normalizeAndValidateDateFields({ due_on: "2026-01-15", due_at: "2026-01-15T09:00:00Z" })
    ).toThrow(/due_on.*due_at|due_at.*due_on/);
    expect(() =>
      normalizeAndValidateDateFields({ start_on: "2026-01-15", start_at: "2026-01-15T09:00:00Z" })
    ).toThrow(/start_on.*start_at|start_at.*start_on/);
  });

  it("omits undefined fields from the result (so untouched fields stay out of the request body)", () => {
    expect(normalizeAndValidateDateFields({ due_on: "2026-01-15" })).toEqual({
      due_on: "2026-01-15",
    });
    expect(normalizeAndValidateDateFields({})).toEqual({});
  });

  it('folds a lone "null" into a real null even with no sibling set', () => {
    expect(normalizeAndValidateDateFields({ due_at: "null" })).toEqual({ due_at: null });
  });
});

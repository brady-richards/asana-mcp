import { describe, it, expect } from "vitest";
import { mapSearchFilterParams } from "../../../src/services/tasks/searchFilterMap.js";

describe("mapSearchFilterParams", () => {
  it("renames assignee_any to assignee.any", () => {
    expect(mapSearchFilterParams({ assignee_any: "12345" })).toEqual({
      "assignee.any": "12345",
    });
  });

  it("renames due_on_before and due_on_after to dot notation", () => {
    expect(
      mapSearchFilterParams({ due_on_before: "2026-01-01", due_on_after: "2025-01-01" })
    ).toEqual({
      "due_on.before": "2026-01-01",
      "due_on.after": "2025-01-01",
    });
  });

  it("renames modified_on_after to modified_on.after", () => {
    expect(mapSearchFilterParams({ modified_on_after: "2025-06-01" })).toEqual({
      "modified_on.after": "2025-06-01",
    });
  });

  it("renames projects_any, sections_any, tags_any to dot notation", () => {
    expect(
      mapSearchFilterParams({
        projects_any: "111,222",
        sections_any: "333",
        tags_any: "444,555",
      })
    ).toEqual({
      "projects.any": "111,222",
      "sections.any": "333",
      "tags.any": "444,555",
    });
  });

  it("passes through keys that need no renaming (due_on, completed, completed_on, text, sort_by, sort_ascending)", () => {
    expect(
      mapSearchFilterParams({
        due_on: "2026-01-01",
        completed: true,
        completed_on: "2026-01-02",
        text: "hello",
        sort_by: "due_date",
        sort_ascending: false,
      })
    ).toEqual({
      due_on: "2026-01-01",
      completed: true,
      completed_on: "2026-01-02",
      text: "hello",
      sort_by: "due_date",
      sort_ascending: false,
    });
  });

  it("drops keys whose value is undefined", () => {
    expect(
      mapSearchFilterParams({ assignee_any: undefined, text: "hello" })
    ).toEqual({ text: "hello" });
  });

  it("handles a full mixed set of filters in one call", () => {
    expect(
      mapSearchFilterParams({
        text: "launch",
        assignee_any: "me",
        due_on_before: "2026-12-31",
        due_on_after: "2026-01-01",
        completed: false,
        modified_on_after: "2026-01-01",
        projects_any: "999",
        sections_any: "888",
        tags_any: "777",
        sort_by: "modified_at",
        sort_ascending: true,
      })
    ).toEqual({
      text: "launch",
      "assignee.any": "me",
      "due_on.before": "2026-12-31",
      "due_on.after": "2026-01-01",
      completed: false,
      "modified_on.after": "2026-01-01",
      "projects.any": "999",
      "sections.any": "888",
      "tags.any": "777",
      sort_by: "modified_at",
      sort_ascending: true,
    });
  });

  it("returns an empty object when given an empty object", () => {
    expect(mapSearchFilterParams({})).toEqual({});
  });

  it("renames assignee_not to assignee.not", () => {
    expect(mapSearchFilterParams({ assignee_not: "12345" })).toEqual({
      "assignee.not": "12345",
    });
  });

  it("renames start_on_before and start_on_after to dot notation", () => {
    expect(
      mapSearchFilterParams({ start_on_before: "2026-01-01", start_on_after: "2025-01-01" })
    ).toEqual({
      "start_on.before": "2026-01-01",
      "start_on.after": "2025-01-01",
    });
  });

  it("passes through is_blocked, is_blocking, is_subtask, has_attachment, resource_subtype unchanged", () => {
    expect(
      mapSearchFilterParams({
        is_blocked: true,
        is_blocking: false,
        is_subtask: true,
        has_attachment: false,
        resource_subtype: "milestone",
      })
    ).toEqual({
      is_blocked: true,
      is_blocking: false,
      is_subtask: true,
      has_attachment: false,
      resource_subtype: "milestone",
    });
  });

  it("flattens a custom_fields passthrough object into custom_fields.<gid>.<query> keys", () => {
    expect(
      mapSearchFilterParams({
        custom_fields: { "12345.value": "67890", "999.is_set": true },
      })
    ).toEqual({
      "custom_fields.12345.value": "67890",
      "custom_fields.999.is_set": true,
    });
  });

  it("drops undefined-valued entries inside the custom_fields object", () => {
    expect(
      mapSearchFilterParams({ custom_fields: { "12345.value": undefined, "999.is_set": true } })
    ).toEqual({ "custom_fields.999.is_set": true });
  });

  it("omits the custom_fields key entirely when it flattens to nothing", () => {
    expect(mapSearchFilterParams({ custom_fields: {}, text: "hi" })).toEqual({ text: "hi" });
  });

  it("handles custom_fields alongside other filters in one call", () => {
    expect(
      mapSearchFilterParams({
        text: "launch",
        assignee_not: "me",
        is_blocked: true,
        custom_fields: { "111.value": "abc" },
      })
    ).toEqual({
      text: "launch",
      "assignee.not": "me",
      is_blocked: true,
      "custom_fields.111.value": "abc",
    });
  });
});

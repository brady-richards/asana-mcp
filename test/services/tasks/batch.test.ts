import { describe, it, expect } from "vitest";
import {
  chunk,
  MAX_BATCH_ACTIONS,
  isBatchActionSuccess,
  batchActionErrorMessage,
  buildGetTaskAction,
  buildTaskUpdateActions,
  COMPACT_RESPONSE_FIELDS,
  assembleBatchUpdateResults,
  executeBatchUpdate,
  BatchAction,
  BatchActionResult,
  TaskUpdatePlanGroup,
} from "../../../src/services/tasks/batch.js";

describe("chunk", () => {
  it("splits into groups of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when items fit within the size", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns an empty array for empty input", () => {
    expect(chunk([], 10)).toEqual([]);
  });

  it("respects MAX_BATCH_ACTIONS = 10 (Asana's per-request cap)", () => {
    expect(MAX_BATCH_ACTIONS).toBe(10);
    const items = Array.from({ length: 25 }, (_, i) => i);
    expect(chunk(items, MAX_BATCH_ACTIONS)).toEqual([
      items.slice(0, 10),
      items.slice(10, 20),
      items.slice(20, 25),
    ]);
  });

  it("throws for a non-positive chunk size", () => {
    expect(() => chunk([1], 0)).toThrow();
    expect(() => chunk([1], -1)).toThrow();
  });
});

describe("isBatchActionSuccess", () => {
  it("treats 2xx status codes as success", () => {
    expect(isBatchActionSuccess({ status_code: 200 })).toBe(true);
    expect(isBatchActionSuccess({ status_code: 201 })).toBe(true);
    expect(isBatchActionSuccess({ status_code: 299 })).toBe(true);
  });

  it("treats non-2xx status codes as failure", () => {
    expect(isBatchActionSuccess({ status_code: 400 })).toBe(false);
    expect(isBatchActionSuccess({ status_code: 404 })).toBe(false);
    expect(isBatchActionSuccess({ status_code: 500 })).toBe(false);
    expect(isBatchActionSuccess({ status_code: 199 })).toBe(false);
  });
});

describe("batchActionErrorMessage", () => {
  it("joins multiple error messages", () => {
    expect(
      batchActionErrorMessage({ errors: [{ message: "a" }, { message: "b" }] })
    ).toBe("a; b");
  });

  it("falls back to a generic message when there is no errors array", () => {
    expect(batchActionErrorMessage({})).toBe("Unknown error");
    expect(batchActionErrorMessage(undefined)).toBe("Unknown error");
  });
});

describe("buildGetTaskAction", () => {
  it("builds a GET action requesting the given fields", () => {
    expect(buildGetTaskAction("123", ["name", "due_on"])).toEqual({
      relative_path: "/tasks/123",
      method: "get",
      options: { fields: ["name", "due_on"] },
    });
  });
});

describe("buildTaskUpdateActions", () => {
  it("builds a single PUT action for plain field updates", () => {
    const plans = buildTaskUpdateActions({ task_id: "1", completed: true, assignee: "me" });
    expect(plans).toEqual([
      {
        task_id: "1",
        kind: "update",
        action: {
          relative_path: "/tasks/1",
          method: "put",
          data: { completed: true, assignee: "me" },
          options: { fields: ["gid"] },
        },
      },
    ]);
  });

  it("builds a single POST action for a section move with no other fields", () => {
    const plans = buildTaskUpdateActions({ task_id: "1", section_id: "999" });
    expect(plans).toEqual([
      {
        task_id: "1",
        kind: "move_section",
        action: {
          relative_path: "/sections/999/addTask",
          method: "post",
          data: { task: "1", insert_before: undefined, insert_after: undefined },
          options: { fields: ["gid"] },
        },
      },
    ]);
  });

  it("builds both a PUT and a POST action when fields and section_id are both given", () => {
    const plans = buildTaskUpdateActions({
      task_id: "1",
      completed: true,
      section_id: "999",
      insert_before: "42",
    });
    expect(plans).toEqual([
      {
        task_id: "1",
        kind: "update",
        action: {
          relative_path: "/tasks/1",
          method: "put",
          data: { completed: true },
          options: { fields: ["gid"] },
        },
      },
      {
        task_id: "1",
        kind: "move_section",
        action: {
          relative_path: "/sections/999/addTask",
          method: "post",
          data: { task: "1", insert_before: "42", insert_after: undefined },
          options: { fields: ["gid"] },
        },
      },
    ]);
  });

  it("drops undefined-valued fields from the PUT action's data", () => {
    const plans = buildTaskUpdateActions({ task_id: "1", completed: true, name: undefined });
    expect(plans[0].action.data).toEqual({ completed: true });
  });

  it("returns no actions when there are no fields and no section_id", () => {
    expect(buildTaskUpdateActions({ task_id: "1" })).toEqual([]);
  });

  it("requests only COMPACT_RESPONSE_FIELDS by default, so Asana omits the full task body", () => {
    const plans = buildTaskUpdateActions({ task_id: "1", completed: true, section_id: "9" });
    expect(plans.map((p) => p.action.options)).toEqual([
      { fields: [...COMPACT_RESPONSE_FIELDS] },
      { fields: [...COMPACT_RESPONSE_FIELDS] },
    ]);
  });

  it("puts caller-requested response fields on every action it builds", () => {
    const plans = buildTaskUpdateActions({ task_id: "1", completed: true, section_id: "9" }, [
      "name",
      "completed",
    ]);
    expect(plans.map((p) => p.action.options)).toEqual([
      { fields: ["name", "completed"] },
      { fields: ["name", "completed"] },
    ]);
  });
});

describe("assembleBatchUpdateResults", () => {
  it("reports a successful action compactly, without the response body's task data", () => {
    const groups = [
      {
        task_id: "1",
        plans: [
          {
            task_id: "1",
            kind: "update" as const,
            action: { relative_path: "/tasks/1", method: "put" as const, data: {} },
          },
        ],
      },
    ];
    const results = [{ status_code: 200, body: { data: { gid: "1", completed: true } } }];
    expect(assembleBatchUpdateResults(groups, results)).toEqual([
      { task_id: "1", actions: [{ kind: "update", success: true }] },
    ]);
  });

  it("surfaces the response body's task data when includeData is set", () => {
    const groups = [
      {
        task_id: "1",
        plans: [
          {
            task_id: "1",
            kind: "update" as const,
            action: { relative_path: "/tasks/1", method: "put" as const, data: {} },
          },
        ],
      },
    ];
    const results = [{ status_code: 200, body: { data: { gid: "1", completed: true } } }];
    expect(assembleBatchUpdateResults(groups, results, true)).toEqual([
      {
        task_id: "1",
        actions: [{ kind: "update", success: true, data: { gid: "1", completed: true } }],
      },
    ]);
  });

  it("reports a joined error message for a failed action", () => {
    const groups = [
      {
        task_id: "1",
        plans: [
          {
            task_id: "1",
            kind: "update" as const,
            action: { relative_path: "/tasks/1", method: "put" as const, data: {} },
          },
        ],
      },
    ];
    const results = [
      { status_code: 400, body: { errors: [{ message: "due_on: Not a valid date" }] } },
    ];
    expect(assembleBatchUpdateResults(groups, results)).toEqual([
      {
        task_id: "1",
        actions: [{ kind: "update", success: false, error: "due_on: Not a valid date" }],
      },
    ]);
  });

  it("keeps each task's own actions in order across multiple tasks and preserves an empty-action group", () => {
    const groups = [
      { task_id: "1", plans: [] },
      {
        task_id: "2",
        plans: [
          {
            task_id: "2",
            kind: "update" as const,
            action: { relative_path: "/tasks/2", method: "put" as const, data: {} },
          },
          {
            task_id: "2",
            kind: "move_section" as const,
            action: { relative_path: "/sections/9/addTask", method: "post" as const, data: {} },
          },
        ],
      },
    ];
    const results = [
      { status_code: 200, body: { data: { gid: "2" } } },
      { status_code: 200, body: {} },
    ];
    expect(assembleBatchUpdateResults(groups, results)).toEqual([
      { task_id: "1", actions: [] },
      {
        task_id: "2",
        actions: [
          { kind: "update", success: true },
          { kind: "move_section", success: true },
        ],
      },
    ]);
  });
});

describe("assembleBatchUpdateResults (count assertion + chunk failures)", () => {
  const oneUpdateGroup = (taskId: string): TaskUpdatePlanGroup => ({
    task_id: taskId,
    plans: [
      {
        task_id: taskId,
        kind: "update" as const,
        action: { relative_path: `/tasks/${taskId}`, method: "put" as const, data: {} },
      },
    ],
  });

  it("throws a loud error when the result count does not match the submitted action count", () => {
    expect(() => assembleBatchUpdateResults([oneUpdateGroup("1")], [])).toThrow(
      /1 action.*0 result|mismatch/i
    );
    expect(() =>
      assembleBatchUpdateResults(
        [oneUpdateGroup("1")],
        [
          { status_code: 200, body: {} },
          { status_code: 200, body: {} },
        ]
      )
    ).toThrow(/1 action.*2 result|mismatch/i);
  });

  it("maps a chunk_request_failed outcome to a failed action report carrying the error", () => {
    expect(
      assembleBatchUpdateResults(
        [oneUpdateGroup("1")],
        [{ chunk_request_failed: "rate limited" }]
      )
    ).toEqual([
      {
        task_id: "1",
        actions: [{ kind: "update", success: false, chunk_request_failed: "rate limited" }],
      },
    ]);
  });
});

describe("executeBatchUpdate", () => {
  const makeGroups = (n: number): TaskUpdatePlanGroup[] =>
    Array.from({ length: n }, (_, i) => ({
      task_id: String(i + 1),
      plans: [
        {
          task_id: String(i + 1),
          kind: "update" as const,
          action: {
            relative_path: `/tasks/${i + 1}`,
            method: "put" as const,
            data: { completed: true },
          },
        },
      ],
    }));

  const okResults = (actions: BatchAction[]): BatchActionResult[] =>
    actions.map(() => ({ status_code: 200, body: { data: { gid: "ok" } } }));

  it("submits one batch call per chunk of 10 actions", async () => {
    const calls: BatchAction[][] = [];
    await executeBatchUpdate(makeGroups(12), async (actions) => {
      calls.push(actions);
      return okResults(actions);
    });
    expect(calls.map((c) => c.length)).toEqual([10, 2]);
  });

  it("makes no batch calls and returns empty-action reports when no update has any actions", async () => {
    const calls: BatchAction[][] = [];
    const report = await executeBatchUpdate(
      [{ task_id: "1", plans: [] }],
      async (actions) => {
        calls.push(actions);
        return okResults(actions);
      }
    );
    expect(calls).toEqual([]);
    expect(report).toEqual([{ task_id: "1", actions: [] }]);
  });

  it("preserves successful chunks' per-action results when another chunk's request rejects", async () => {
    let call = 0;
    const report = await executeBatchUpdate(makeGroups(12), async (actions) => {
      call++;
      if (call === 2) throw new Error("Rate limit exceeded");
      return okResults(actions);
    });

    expect(report).toHaveLength(12);
    for (const entry of report.slice(0, 10)) {
      expect(entry.actions).toEqual([{ kind: "update", success: true }]);
    }
    for (const entry of report.slice(10)) {
      expect(entry.actions).toEqual([
        { kind: "update", success: false, chunk_request_failed: "Rate limit exceeded" },
      ]);
    }
  });

  it("threads includeData through to the assembled reports", async () => {
    const report = await executeBatchUpdate(makeGroups(1), okResults, true);
    expect(report[0].actions).toEqual([{ kind: "update", success: true, data: { gid: "ok" } }]);
  });

  it("treats a chunk whose result count mismatches its action count as a failed chunk (statuses unknown), not misattributed", async () => {
    const report = await executeBatchUpdate(makeGroups(2), async () => [
      { status_code: 200, body: { data: { gid: "only-one" } } },
    ]);
    expect(report).toHaveLength(2);
    for (const entry of report) {
      expect(entry.actions[0].success).toBe(false);
      expect(entry.actions[0].chunk_request_failed).toMatch(/1 result.*2 action/);
      expect(entry.actions[0].data).toBeUndefined();
    }
  });
});

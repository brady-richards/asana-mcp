import { describe, it, expect } from "vitest";
import { pagedResult } from "../../src/utils/pagination.js";

describe("pagedResult", () => {
  it("returns data and next_page.offset when the SDK collection has a next page", () => {
    const collection = {
      data: [{ gid: "1" }, { gid: "2" }],
      _response: { next_page: { offset: "abc123", path: "/tasks?offset=abc123", uri: "https://..." } },
    };
    expect(pagedResult(collection)).toEqual({
      data: [{ gid: "1" }, { gid: "2" }],
      next_page: { offset: "abc123" },
    });
  });

  it("returns next_page: null when the SDK reports no next page", () => {
    const collection = { data: [{ gid: "1" }], _response: { next_page: null } };
    expect(pagedResult(collection)).toEqual({
      data: [{ gid: "1" }],
      next_page: null,
    });
  });

  it("returns next_page: null when _response is missing entirely", () => {
    const collection = { data: [{ gid: "1" }] };
    expect(pagedResult(collection)).toEqual({
      data: [{ gid: "1" }],
      next_page: null,
    });
  });

  it("returns next_page: null when next_page has no offset", () => {
    const collection = { data: [], _response: { next_page: {} } };
    expect(pagedResult(collection)).toEqual({ data: [], next_page: null });
  });

  it("defaults data to an empty array when missing", () => {
    const collection = { _response: { next_page: null } };
    expect(pagedResult(collection)).toEqual({ data: [], next_page: null });
  });
});

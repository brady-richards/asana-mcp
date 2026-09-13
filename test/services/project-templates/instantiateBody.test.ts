import { describe, it, expect } from "vitest";
import { buildInstantiateBody } from "../../../src/services/project-templates/instantiateBody.js";

const base = { name: "Erin Jacobs - Onboarding", is_organization: true, team: "T1" };

describe("buildInstantiateBody", () => {
  it("requires a team in an organization", () => {
    expect(() =>
      buildInstantiateBody({ name: "P", is_organization: true })
    ).toThrow(/organization, so a team GID is required/);
  });

  it("does not require a team outside an organization", () => {
    expect(buildInstantiateBody({ name: "P", is_organization: false })).toEqual({ name: "P" });
  });

  it("carries name and team through", () => {
    expect(buildInstantiateBody(base)).toEqual({
      name: "Erin Jacobs - Onboarding",
      team: "T1",
    });
  });

  it("ignores `public` in an organization, where team membership governs visibility", () => {
    const body = buildInstantiateBody({ ...base, public: true });
    expect(body).not.toHaveProperty("public");
  });

  it("honours `public` outside an organization", () => {
    const body = buildInstantiateBody({ name: "P", is_organization: false, public: false });
    expect(body.public).toBe(false);
  });

  it("passes requested_dates and requested_roles through when present", () => {
    const body = buildInstantiateBody({
      ...base,
      requested_dates: [{ gid: "1", value: "2026-10-01" }],
      requested_roles: [{ gid: "9", value: "U1" }],
    });
    expect(body.requested_dates).toEqual([{ gid: "1", value: "2026-10-01" }]);
    expect(body.requested_roles).toEqual([{ gid: "9", value: "U1" }]);
  });

  // The API rejects a present-but-empty requested_dates, so absent and empty
  // must both produce no key at all rather than an empty array.
  it.each([
    ["undefined", undefined],
    ["empty", [] as Array<{ gid: string; value: string }>],
  ])("omits requested_dates entirely when %s", (_label, dates) => {
    const body = buildInstantiateBody({ ...base, requested_dates: dates });
    expect(Object.keys(body)).not.toContain("requested_dates");
  });

  it("omits requested_roles entirely when empty", () => {
    const body = buildInstantiateBody({ ...base, requested_roles: [] });
    expect(Object.keys(body)).not.toContain("requested_roles");
  });
});

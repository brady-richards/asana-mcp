import { describe, it, expect } from "vitest";
import { defaultAttachmentName } from "../../../src/services/attachments/naming.js";

describe("defaultAttachmentName", () => {
  it("uses the explicit name when given", () => {
    expect(
      defaultAttachmentName({ name: "Cover.pdf", url: "https://example.com/x.pdf" })
    ).toBe("Cover.pdf");
  });

  it("falls back to the url when no name is given", () => {
    expect(defaultAttachmentName({ url: "https://example.com/x.pdf" })).toBe(
      "https://example.com/x.pdf"
    );
  });

  it("falls back to the local file's basename when no name is given", () => {
    expect(defaultAttachmentName({ local_path: "/Users/me/Downloads/résumé.pdf" })).toBe(
      "résumé.pdf"
    );
  });

  it("prefers an explicit name over local_path's basename", () => {
    expect(
      defaultAttachmentName({ name: "My Resume.pdf", local_path: "/tmp/résumé.pdf" })
    ).toBe("My Resume.pdf");
  });

  it("throws when neither url nor local_path is given", () => {
    expect(() => defaultAttachmentName({})).toThrow(/url|local_path/i);
  });
});

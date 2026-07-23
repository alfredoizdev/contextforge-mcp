import { describe, it, expect, vi } from "vitest";
import {
  resolveLinkedProjectSpaceId,
  resolveLinkedProjectSpaceIdReadOnly,
} from "../src/resolve-space.js";
import type { ProjectLinkConfig } from "../src/types.js";

const linkedConfig: ProjectLinkConfig = {
  project_id: "proj-1",
  project_name: "Demo",
  linked_at: "2026-01-01T00:00:00.000Z",
};

describe("resolveLinkedProjectSpaceId", () => {
  it("returns undefined when no project is linked", async () => {
    const api = {
      listSpaces: vi.fn(),
      createSpace: vi.fn(),
    };
    const result = await resolveLinkedProjectSpaceId(api, null);
    expect(result).toBeUndefined();
    expect(api.listSpaces).not.toHaveBeenCalled();
  });

  it("returns the first regular space in the linked project", async () => {
    const api = {
      listSpaces: vi.fn().mockResolvedValue([{ id: "space-1" }, { id: "space-2" }]),
      createSpace: vi.fn(),
    };
    const result = await resolveLinkedProjectSpaceId(api, linkedConfig);
    expect(result).toBe("space-1");
    expect(api.listSpaces).toHaveBeenCalledWith("proj-1", "regular");
    expect(api.createSpace).not.toHaveBeenCalled();
  });

  it("creates a Default space when the linked project has none yet", async () => {
    const api = {
      listSpaces: vi.fn().mockResolvedValue([]),
      createSpace: vi.fn().mockResolvedValue({ id: "new-space" }),
    };
    const result = await resolveLinkedProjectSpaceId(api, linkedConfig);
    expect(result).toBe("new-space");
    expect(api.createSpace).toHaveBeenCalledWith({
      name: "Default",
      description: "Default space for the project",
      project_id: "proj-1",
    });
  });
});

describe("resolveLinkedProjectSpaceIdReadOnly", () => {
  it("returns null when no project is linked", async () => {
    const api = {
      listSpaces: vi.fn(),
    };
    const result = await resolveLinkedProjectSpaceIdReadOnly(api, null);
    expect(result).toBeNull();
    expect(api.listSpaces).not.toHaveBeenCalled();
  });

  it("returns the first regular space in the linked project without creating anything", async () => {
    const api = {
      listSpaces: vi.fn().mockResolvedValue([{ id: "space-1" }, { id: "space-2" }]),
      createSpace: vi.fn(),
    };
    const result = await resolveLinkedProjectSpaceIdReadOnly(api, linkedConfig);
    expect(result).toBe("space-1");
    expect(api.listSpaces).toHaveBeenCalledWith("proj-1", "regular");
    expect(api.createSpace).not.toHaveBeenCalled();
  });

  it("returns null (never creates) when the linked project has no spaces yet", async () => {
    const api = {
      listSpaces: vi.fn().mockResolvedValue([]),
      createSpace: vi.fn(),
    };
    const result = await resolveLinkedProjectSpaceIdReadOnly(api, linkedConfig);
    expect(result).toBeNull();
    expect(api.listSpaces).toHaveBeenCalledWith("proj-1", "regular");
    expect(api.createSpace).not.toHaveBeenCalled();
  });
});

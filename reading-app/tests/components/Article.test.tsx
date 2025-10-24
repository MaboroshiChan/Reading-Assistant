import { afterEach, describe, expect, it, vi } from "vitest";
import { loadArticleFromFile } from "../../src/components/ArticleSkeleton";

describe("loadArticleFromFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns file contents when fetch succeeds", async () => {
    const mockText = "## Example Article";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => mockText,
    });
    vi.stubGlobal("fetch", fetchMock);

    const content = await loadArticleFromFile("/path/to/article.md");

    expect(fetchMock).toHaveBeenCalledWith("/path/to/article.md");
    expect(content).toBe(mockText);
  });

  it("returns fallback markup when fetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: async () => "",
    });
    vi.stubGlobal("fetch", fetchMock);

    const content = await loadArticleFromFile("/path/to/nonexistent.md");

    expect(content).toContain("Error loading article content");
  });
});

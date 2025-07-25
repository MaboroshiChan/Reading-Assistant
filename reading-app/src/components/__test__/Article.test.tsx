import { loadArticleFromFile } from "../ArticleSkeleton";

describe("ArticleSkeleton", () => {
  it("loads article content from a file", async () => {
    const content = await loadArticleFromFile("/path/to/article.md");
    expect(content).toContain("Expected content from the article");
  });

  it("handles file loading errors gracefully", async () => {
    const content = await loadArticleFromFile("/path/to/nonexistent.md");
    expect(content).toContain("Error loading article content.");
  });
}
);

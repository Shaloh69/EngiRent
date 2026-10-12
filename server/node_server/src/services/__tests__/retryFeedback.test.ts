import { buildRetryFeedback, MAX_RETRY_IMAGES } from "../retryFeedback";

/** What the phone is told on a retry: the AI's own sentence and the locker photos. */
describe("buildRetryFeedback", () => {
  const urls = ["https://api.example/media/secure/a", "https://api.example/media/secure/b", "https://api.example/media/secure/c", "https://api.example/media/secure/d"];

  it("passes the AI's sentence and the reposition flag through", () => {
    const f = buildRetryFeedback(
      { message: "More than one object is in the locker. Leave only the rented item inside.", reposition: true },
      urls,
    );
    expect(f.reason).toBe("More than one object is in the locker. Leave only the rented item inside.");
    expect(f.reposition).toBe(true);
  });

  it("sends at most three photos", () => {
    expect(buildRetryFeedback({ message: "x" }, urls).imageUrls).toHaveLength(MAX_RETRY_IMAGES);
  });

  it("drops anything that is not an http(s) URL (a path, a data URI, a number)", () => {
    const f = buildRetryFeedback({ message: "x" }, ["users/1/face.jpg", "data:image/png;base64,AAAA", 7, null, "https://ok/1", "http://ok/2"]);
    expect(f.imageUrls).toEqual(["https://ok/1", "http://ok/2"]);
  });

  it("a missing or empty message becomes null, so the phone shows its own generic line", () => {
    expect(buildRetryFeedback({}, urls).reason).toBeNull();
    expect(buildRetryFeedback({ message: "   " }, urls).reason).toBeNull();
    expect(buildRetryFeedback({ message: null, reposition: null }, urls).reposition).toBe(false);
  });

  it("tidies whitespace and trims a very long sentence", () => {
    expect(buildRetryFeedback({ message: "  a \n  b  " }, []).reason).toBe("a b");
    const long = buildRetryFeedback({ message: "word ".repeat(200) }, []).reason!;
    expect(long.length).toBeLessThanOrEqual(240);
    expect(long.endsWith("…")).toBe(true);
  });

  it("no images (or not an array) gives an empty list, never a crash", () => {
    expect(buildRetryFeedback({ message: "x" }, undefined).imageUrls).toEqual([]);
    expect(buildRetryFeedback({ message: "x" }, "https://not-an-array").imageUrls).toEqual([]);
  });

  it("reposition is true only for an explicit true", () => {
    expect(buildRetryFeedback({ reposition: true }, []).reposition).toBe(true);
    expect(buildRetryFeedback({ reposition: false }, []).reposition).toBe(false);
  });
});

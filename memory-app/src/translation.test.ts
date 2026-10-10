import { afterEach, describe, it, expect, vi } from "vitest";
import { translate } from "./translation";
afterEach(() => vi.unstubAllGlobals());
describe("translation boundary", () => {
  it("requests only explicit text and the selected language direction", async () => {
    const mock = vi.fn(async (_url: URL, _options: unknown) => ({
      ok: true,
      json: async () => ({
        responseStatus: 200,
        responseData: { translatedText: "جمل" },
      }),
    }));
    vi.stubGlobal("fetch", mock);
    expect(await translate("camel", "en")).toBe("جمل");
    const url = mock.mock.calls[0][0] as unknown as URL;
    expect(url.searchParams.get("q")).toBe("camel");
    expect(url.searchParams.get("langpair")).toBe("en|ar");
    await translate("جمل", "ar");
    expect(mock.mock.calls[1][0].searchParams.get("langpair")).toBe("ar|en");
  });
  it("enforces the UTF-8 byte limit before sending a request", async () => {
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    await expect(translate("ك".repeat(251), "ar")).rejects.toThrow(/500/);
    expect(mock).not.toHaveBeenCalled();
  });
  it("rejects quota failures, missing output, and network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ responseStatus: 429, quotaFinished: true }),
      })),
    );
    await expect(translate("book", "en")).rejects.toThrow(/quota/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ responseStatus: 200 }),
      })),
    );
    await expect(translate("book", "en")).rejects.toThrow(/No translation/);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    await expect(translate("book", "en")).rejects.toThrow(/unavailable/);
  });
});

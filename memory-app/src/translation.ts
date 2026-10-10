export async function translate(
  text: string,
  from: "en" | "ar",
  signal?: AbortSignal,
): Promise<string> {
  const input = text.trim();
  if (!input) throw new Error("Enter text to translate.");
  if (new TextEncoder().encode(input).length > 500)
    throw new Error("Use a shorter phrase (500 UTF-8 bytes maximum).");
  const url = new URL("https://api.mymemory.translated.net/get");
  url.searchParams.set("q", input);
  url.searchParams.set("langpair", from === "en" ? "en|ar" : "ar|en");
  const response = await fetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "Translation service is unavailable. You can enter the card manually.",
    );
  const json = await response.json();
  if (json.quotaFinished || Number(json.responseStatus) === 429)
    throw new Error(
      "The free translation quota has been reached. Try again later or enter the card manually.",
    );
  if (
    Number(json.responseStatus) !== 200 ||
    typeof json.responseData?.translatedText !== "string" ||
    !json.responseData.translatedText.trim()
  )
    throw new Error(
      "No translation was returned. Try a different phrase or enter it manually.",
    );
  return json.responseData.translatedText.trim();
}

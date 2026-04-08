# 22 — Memory compaction: secret scrubbing (TODO)

## Tests first

1. Strings matching common API-key shapes (Anthropic, OpenAI, AWS, generic high-entropy) are stripped from the summary text before persistence.
2. The original raw comments are untouched (scrubbing happens on the way **into** the summary, not retroactively across history).
3. Scrubbed regions are replaced with a stable placeholder (`<redacted:api_key>`) so the summary remains coherent.

## Then implement

- Scrubber module reused by any future export path.
- Wire into the summarization step from phase 21.

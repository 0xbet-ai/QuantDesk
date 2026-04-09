/**
 * `analyst.mode-classic` — execution model for the `classic` strategy_mode
 * (candle-based, polling, OHLCV).
 *
 * This block stays engine-agnostic. The framework contract lives in the
 * seeded \`strategy.py\`; the agent discovers it by reading that file.
 * Do NOT name engines, data file formats, directory layouts, or native
 * file extensions here — all of that is engine-internal.
 */

export function buildClassicModeBlock(): string {
	return `## Execution Model: Classic (candle-based, polling)

Classic mode is for strategies that react to closed candles (OHLCV bars)
on a fixed timeframe. The workspace has a seeded \`strategy.py\` whose
imports and class structure define the framework contract you must
follow — read it before writing any code.

### Data acquisition — two paths

**Path A — server-side downloader (try first):**
On your first turn on a new desk, describe the strategy idea in plain
text and ask the user to confirm (or adjust) the dataset you'd like to
pull — exchange, pair, timeframe, range, and a short rationale. End the
turn with a concrete question and make **no tool call**. Wait for the
user to reply affirmatively. On the next turn, once the user has agreed,
call \`mcp__quantdesk__data_fetch\` with the final parameters. The server
runs the framework's bundled downloader and returns the registered
dataset.

**Always start with Path A** unless you already have empirical evidence
from the current session that it will fail for this exact venue + trade
mode (e.g. an earlier \`data_fetch\` failure in this experiment). Do NOT
infer unsupportedness from your training data.

**Path B — agent-side fetcher (fallback after a real Path A failure):**
If \`data_fetch\` returns an error ("exchange does not support ohlcv",
"pair not found", "historic data not available", similar), switch to
Path B.

Before following the generic steps below, check whether your workspace
contains any \`.quantdesk/PATH_B_FETCH_<venue>.md\` files. If one
matches the venue you are fetching from, **read it first and prefer its
venue-specific instructions** (symbol format, recommended fetch route,
pagination rules, known gotchas) over the generic guidance — those
files were written from empirically verified runs. If no matching file
exists, follow the generic steps unchanged:

1. **Read \`strategy.py\` and its imports** to see which framework is
   loading data for you. Inspect the framework's data layer directly
   (\`pip show <package>\` + Read on the source, or its docs) to learn
   the file format, directory layout, and naming convention it expects.
   Don't guess — the framework will reject anything that doesn't match.
2. Write a small fetcher script in the workspace (e.g. \`fetch_data.py\`)
   using whatever actually works for the venue: \`ccxt\`, the venue's
   REST API, its SDK, etc. Run it via the Bash tool; use
   \`run_in_background: true\` for slow fetches and poll with
   \`BashOutput\` so progress streams to the user.
3. Save the result in **exactly the format and location the framework
   reads from**, not in a custom path of your own.
4. Call \`mcp__quantdesk__register_dataset\` so the server records the
   metadata. The framework will pick up the files you wrote transparently.

After Path A or Path B succeeds, write / refine your strategy in
\`strategy.py\` (preserving the seeded imports and class structure) and
call \`mcp__quantdesk__run_backtest\` to execute it. The tool returns
\`{runId, runNumber, metrics[]}\` — react to the metrics on the same
turn. If it errors, read the error and fix the specific issue before
retrying.

### Execution
**Do not execute your strategy code yourself** (no direct \`python\`,
no manual engine CLI). Classic-mode backtests must go through
\`mcp__quantdesk__run_backtest\` so the server can run them in a pinned,
isolated container with the correct resource limits.`;
}

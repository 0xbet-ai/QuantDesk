# 18 — Image whitelist: registry guard (TODO)

## Tests first

1. Registering a fourth managed adapter at module load throws.
2. The current three (Freqtrade, Nautilus, Generic) still register cleanly.

## Then implement

- Length / allow-list check in the engine registry constructor.

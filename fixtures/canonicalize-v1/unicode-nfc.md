User-facing strings arrive from many sources and are not consistently normalized. A name typed on macOS often arrives decomposed, while the same name pasted from a Windows application usually arrives composed. Comparing the two byte for byte fails even though a reader sees identical text on screen.

## Worked examples

These are written decomposed in the source: café, naïve, Ångström, and Bogotá. Each is a base letter followed by a combining mark.

These are already composed: café, naïve, Ångström, Bogotá. After NFC the two paragraphs hold the same code points.

## What NFC does not merge

Normalization is not transliteration. The Turkish dotless ı stays distinct from i, the German ß is not folded to ss, and the ligature ﬁ in a pasted PDF snippet is left as it is under NFC. Compatibility folding is a different normal form and applying it here would silently change what the user typed.

Normalize once at the boundary where text enters your system, then compare the normalized forms. Doing it at comparison time instead means every call site has to remember, and one that forgets produces a bug that only shows up for some users.

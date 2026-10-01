# Accessible by Morning: measured demo report

Run: local-2026-10-01T21-04-08-579Z-196664c0
Mode: Deterministic local fixture repair (no Gemini calls)
Task: Book an appointment

| Measurement | Before | After |
|---|---:|---:|
| Lighthouse accessibility | 81 | 100 |
| Axe rule violations | 4 | 0 |
| Affected DOM nodes | 11 | 0 |
| Keyboard booking task | blocked | passed |

Deterministic fixture repair: native appointment controls, field labels, heading, contrast, focus, date validation, and announced confirmation.

WCAG criteria addressed: 1.3.1, 1.4.3, 2.1.1, 2.4.7, 3.3.1, 3.3.2, 4.1.2, 4.1.3.

The transcript is DOM semantic inspection, not NVDA/JAWS audio or human testing. The native date field receives seeded test data; date-picker keyboard gestures are not covered. Not performed. Independent disabled audit and real screen-reader task testing remain required.

Measured automated checks passed on this fixture. This is not a WCAG compliance certification.

Evidence: baseline/ and verification/ contain raw axe, Lighthouse, keyboard steps, screenshots, and DOM transcripts. changes.patch contains the source diff.

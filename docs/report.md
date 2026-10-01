# Accessible by Morning: measured demo report

Run: gemini-api-2026-10-01T21-26-47-571Z-47deb2fe
Mode: Gemini API direct source repair and separate single-turn source review (no managed environment)
Task: Book an appointment

| Measurement | Before | After |
|---|---:|---:|
| Lighthouse accessibility | 81 | 100 |
| Axe rule violations | 4 | 0 |
| Affected DOM nodes | 11 | 0 |
| Keyboard booking task | blocked | passed |

Converted appointment title to an h1, turned slot and submit triggers into accessible native button elements with aria-pressed, attached explicit labels and legend, wrapped booking-form in form element with novalidate, improved text contrast across light backgrounds to satisfy WCAG AA, added prominent :focus-visible outlines, implemented calendar date validation rejecting dates on or before browser local today with assistive announcement semantics, and managed focus appropriately across submit and reset.

WCAG criteria addressed: 1.3.1 Info and Relationships, 1.4.3 Contrast (Minimum), 2.1.1 Keyboard, 2.4.7 Focus Visible, 3.3.1 Error Identification, 3.3.2 Labels or Instructions, 4.1.2 Name, Role, Value, 4.1.3 Status Messages.

The transcript is DOM semantic inspection, not NVDA/JAWS audio or human testing. The native date field receives seeded test data; date-picker keyboard gestures are not covered. Not performed. Independent disabled audit and real screen-reader task testing remain required.

Measured automated checks passed on this fixture. This is not a WCAG compliance certification.

Evidence: baseline/ and verification/ contain raw axe, Lighthouse, keyboard steps, screenshots, and DOM transcripts. changes.patch contains the source diff.

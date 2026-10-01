# Seeded barriers

The fictional Harbour Health fixture deliberately contains these barriers on the default branch. It is a controlled target that the owner authorizes this demo to modify.

| Barrier | Task impact | Relevant WCAG criteria | Evidence |
|---|---|---|---|
| Time slots and booking action are clickable `div` elements | Keyboard users cannot choose a time or submit | 2.1.1, 4.1.2 | Keyboard task and control semantics |
| Visible field text uses `div` rather than associated labels | Form controls lack reliable accessible names | 1.3.1, 3.3.2, 4.1.2 | axe and accessible-name transcript |
| Page title is a styled `span` | Heading navigation misses the page title | 1.3.1 | Heading structure check |
| Low contrast text | Low vision users struggle to read content | 1.4.3 | axe / Lighthouse contrast rules |
| Focus outlines suppressed | Keyboard focus is hard to locate | 2.4.7 | Focus style check and browser screenshot |
| Errors and success are not announced or focused | Screen-reader users miss feedback | 3.3.1, 4.1.3 | Error/status semantics and task assertions |
| Past dates accepted | Invalid appointments can be confirmed | 3.3.1, 3.3.2 | Past-date rejection and valid booking check |

The fixture makes no real booking and contains no real patient data. The intended measurable result is zero detected axe violations, improved Lighthouse accessibility, successful keyboard booking, and a passing fresh verification. Scores are measured rather than hardcoded to the concept brief's 42→100 target. Human testing is separate and pending.

# TODO

- [ ] Add a tiny unit-style regression test for RxNav enrichment sanity guard (display-name vs generic-name mismatch should return `null`).
  - Priority: polish phase (after core hackathon priorities)
  - Target: before May 11 deadline if time permits
- [ ] Improve plausibility matching for common drug aliases.
  - Example: "Normal Saline 1L IV" should plausibly map to "sodium chloride" without introducing unsafe false positives.

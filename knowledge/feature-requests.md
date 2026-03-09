# Feature Requests

## Pending credit card transactions
- Pending transactions in bank CSV imports should be ignored (not inserted).
- Detect pending status from the CSV data and skip those rows during parsing.

## Most recent uploaded transaction timestamp
- On the Import screen, clearly display the most recent transaction timestamp that was previously uploaded.
- This helps the user know where their data left off before importing new files.

## Recurring transaction templates
- Allow defining recurring expected transactions (rent, subscriptions, phone bill, etc.).
- Each template: descriptor, amount, instrument, category, frequency (monthly), expected day of month.
- App auto-generates expected transactions each month (idempotent, like savings schedules).
- Budget view could show "expected" vs "actual" for recurring items.
- Reduces manual entry for predictable expenses.

## Copy last month's budget
- **Implement now.**
- Add a "Copy from last month" button in the Budget view.
- Copies all budget line items (category + target amount) from the previous month into the selected month.
- Only copies if the current month has no budget items yet (or ask to overwrite).
- Saves the user from manually re-adding every category and target each month.

## Categorization UX: unified one-off vs rule flow
- Currently: category dropdown = silent one-off, "R" button = rule creation. These are separate and the distinction isn't obvious.
- When a user categorizes an uncategorized transaction for the first time (via the dropdown), prompt them inline:
  - "Just this one" (one-off, current behavior)
  - "All transactions matching [full descriptor]" (exact rule)
  - "All transactions containing [editable partial descriptor]" (contains rule)
- This makes the rule system discoverable without needing to know about the "R" button.
- The "R" button can remain as a power-user shortcut for editing/creating rules from already-categorized transactions.

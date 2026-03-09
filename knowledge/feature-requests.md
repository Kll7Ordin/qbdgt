# Feature Requests

## Encrypted file as single source of truth (replaces browser storage)
- **Implement now.**
- The app should NOT use browser IndexedDB as the primary data store.
- Instead, all data lives in a single encrypted file on the user's filesystem (OneDrive, Dropbox, Syncthing folder, etc.).
- On app startup (mobile or desktop), the user points to the file location and enters their passphrase. The app decrypts and loads everything into memory.
- On every save/change, the app writes back to the same encrypted file automatically. No manual export step.
- The file syncs between devices via whatever cloud/sync service the user already has (OneDrive, Dropbox, Syncthing).
- Backups are just copies of that file — the user can back it up however they want.
- This eliminates: forgetting to sync, losing data when clearing browser storage, needing separate export/import flows.
- The current encrypted export format (AES-256-GCM + PBKDF2) can be reused as the file format.
- On first run with no file, the app creates a new one at the chosen location.
- Conflict handling: if the file was modified externally (edited on another device since last load), warn before overwriting.

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

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
- The file should be replaceable with an older version without issue (rollback by file swap).
- The underlying data format (JSON) should be readable by another program with AI help if needed.

## Copy last month's budget
- **Implement now.**
- Add a "Copy from last month" button in the Budget view.
- Copies all budget line items (category + target amount) from the previous month into the selected month.
- Only copies if the current month has no budget items yet (or ask to overwrite).
- Saves the user from manually re-adding every category and target each month.

## Pending credit card transactions
- **Implement now.**
- Pending transactions in bank CSV imports should be ignored (not inserted).
- Detect pending status from the CSV data and skip those rows during parsing.

## Most recent uploaded transaction timestamp
- **Implement now.**
- On the Import screen, clearly display the most recent transaction timestamp that was previously uploaded.
- This helps the user know where their data left off before importing new files.

## Recurring transaction templates
- **Implement now.**
- Allow defining recurring expected transactions (rent, subscriptions, phone bill, etc.).
- Each template: descriptor, amount, instrument, category, frequency (monthly), expected day of month.
- App auto-generates expected transactions each month (idempotent, like savings schedules).
- Budget view could show "expected" vs "actual" for recurring items.
- Reduces manual entry for predictable expenses.

## Categorization UX: inline rule creation
- **Implement now.**
- Do NOT prompt on every transaction — that would be annoying.
- Instead, after assigning a category via the dropdown, show a small non-blocking button (e.g. "Make rule") next to the dropdown.
- Clicking that button lets the user choose: exact match or contains match with an editable pattern.
- Flow stays fast for one-offs (just pick and move on), with the rule option always accessible but never forced.
- The "R" button can remain as a power-user shortcut.

## Desktop only
- **Implement now.**
- Drop the mobile/PWA requirement. This is a desktop-only app (Linux Mint).
- This simplifies the architecture — no service worker, no installability constraints.
- The hard requirement is that all data lives in a file on the local filesystem that can be copied, backed up, and replaced with an older version.

---

# Backlog

## Multi-currency support
- Transactions may arrive in different currencies (CAD, USD, EUR).
- Add a currency field to transactions.
- Display currency alongside amounts.
- No conversion logic needed initially — just track and display which currency each amount is in.

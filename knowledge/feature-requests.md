# Feature Requests

## JSON file as single source of truth (replaces browser storage)
- **Implement now.**
- The app should NOT use browser IndexedDB as the primary data store.
- All data lives in a single unencrypted JSON file on the user's filesystem.
- On app startup, load from the last-used file path (remembered in config at `~/.config/budget-app/config.json`).
- On every save/change, auto-write back to the same file. No manual export step.
- Backups are just copies of that file.
- The file is replaceable with an older version without issue (rollback by file swap).
- Readable by any program — it's plain JSON.
- On first run with no file, prompt user to pick or create a file location.

## Tauri desktop app
- **Implement now.**
- Wrap the app in Tauri for native Linux Mint desktop experience.
- Gives direct filesystem access for auto-load/auto-save of the data file.
- Remember last-used file path between launches.
- Remove PWA/service worker infrastructure (vite-plugin-pwa).

## Copy last month's budget
- **Implement now.**
- Add a "Copy from last month" button in the Budget view.
- Copies all budget line items (category + target amount) from the previous month into the selected month.
- Only copies if the current month has no budget items yet (or ask to overwrite).

## Most recent uploaded transaction timestamp
- **Implement now.**
- On the Import screen, clearly display the most recent transaction date already in the system.
- Helps the user know where their data left off before importing new files.

## Recurring transaction templates
- **Implement now.**
- Define recurring expected transactions (rent, subscriptions, phone bill, etc.).
- Each template: descriptor, amount, instrument, category, frequency (monthly), expected day of month.
- App auto-generates expected transactions each month (idempotent).
- Budget view could show "expected" vs "actual" for recurring items.

## Categorization UX: inline rule creation
- **Implement now.**
- Do NOT prompt on every transaction.
- After assigning a category via the dropdown, show a small non-blocking "Make rule" button.
- Clicking it lets the user choose: exact match or contains match with an editable pattern.
- Flow stays fast for one-offs, rule option always accessible but never forced.

## Transaction comments
- **Implement now.**
- Allow optional freetext comments on individual transactions.
- Add a `comment` field (nullable string) to the transaction data model.
- Editable inline or via a small expand/click in the transaction list.

---

# Backlog

## Mobile app
- Revisit later. Currently desktop-only (Linux Mint via Tauri).
- Could be Tauri mobile, or a separate PWA, or a companion app.

## Multi-currency support
- Transactions may arrive in different currencies (CAD, USD, EUR).
- Add a currency field to transactions.
- Display currency alongside amounts.
- No conversion logic needed initially.

## Pending credit card transactions
- Pending transactions in bank CSV imports should be ignored (not inserted).
- Detect pending status from the CSV data and skip those rows during parsing.
- Need an example CSV from user to determine what "pending" looks like in Scotia format.

# qbdgt

A privacy-focused personal budgeting desktop app. Create monthly budgets, track spending, and see where your money actually goes — without ever giving your login credentials to a third party or uploading your data to the cloud.

**Your data never leaves your computer.** Everything is stored in a single JSON file you own and control. Optionally encrypt it with a password.

![Budget view](screenshots/budget.png)

---

## Why qbdgt?

Most budgeting apps require you to hand over your bank login or connect via open banking APIs. qbdgt takes the opposite approach: you export a CSV from your bank and import it yourself. It takes an extra minute, but your credentials stay with you and your financial data stays on your machine.

- **No accounts.** No sign-up, no cloud sync, no third-party servers.
- **Single file.** Your entire budget lives in one JSON file — easy to back up, version, or move between machines.
- **Optional encryption.** Password-protect your data file with AES encryption.
- **Open source.** Runs as a native desktop app via [Tauri](https://tauri.app).

---

## Features

### Budget tab

Set monthly spending targets per category and track actual spending in real time.

![Budget tab](screenshots/budget.png)

- **Summary cards** — at a glance: total planned Expenses, total expected Income, and Net (Income − Expenses). Month-to-date actuals show Spent, Remaining, Received income, and Yet to Receive.
- **Category groups** — organise categories into named groups (Housing, Food & Dining, Transportation, etc.) with group-level subtotals. Drag to reorder groups and categories.
- **Per-row stats** — each category shows Target, Spent, Left, YTD total, YTD target, YTD variance, and average spend per month.
- **Progress bars** — visual spend-vs-target indicator per category, coloured green (on track) or red (over budget).
- **Income section** — separate income rows at the bottom showing Expected vs Received per income category.
- **Occasional / savings categories** — mark categories as occasional (e.g. Emergency Fund, Vacation Fund); their spending is drawn from savings and excluded from monthly totals.
- **Copy from previous month** — populate a new month's targets from last month's actuals with one click.
- **Copy from experimental budget** — apply a saved scenario budget to any month.
- **Undo** — undo any change with Ctrl+Z or the Undo button.

---

### Transactions tab

View, categorise, and search all your transactions.

![Transactions tab](screenshots/transactions.png)

- **Transaction list** — date, description, instrument (account), amount, and colour-coded category tag.
- **Filter** — filter by month, category, or uncategorised-only.
- **Search** — press Ctrl+F to search transaction descriptions across the current tab.
- **Auto-categorisation rules** — create pattern-based rules (e.g. "COLES → Groceries") that apply automatically on import. Create a rule directly from any transaction row.
- **Split transactions** — split a single transaction across multiple categories.
- **Manual entry** — add transactions manually without importing a file.
- **Undo** — all edits and categorisations are undoable.

---

### Year view

See your full year at a glance.

![Year view](screenshots/year.png)

- **Monthly table** — Income, Planned expenses, Actual expenses, Variance, and Spent from Savings for every month of the year.
- **Spending Trends chart** — line chart with Planned, Actual, Spent from Savings, and Income series.
- **By Category chart** — switch to a per-category breakdown to see which categories drove overruns.

---

### Savings tab

Track savings buckets and automated contribution schedules.

![Savings tab](screenshots/savings.png)

- **Multiple buckets** — create named buckets (Emergency Fund, Vacation, New Car, etc.) each with its own balance.
- **Total balance** — overall savings balance shown at the top.
- **Manual entries** — record deposits and withdrawals with optional notes.
- **Schedules** — set up automatic recurring contributions (e.g. $500 to Emergency Fund on the 1st of each month) so the balance stays in sync with your budget without manual entry each month.
- **Loan tracking** — record amounts temporarily borrowed from savings to keep totals accurate.

---

### Import tab

Bring in transactions from your bank or other sources.

![Import tab](screenshots/import.png)

- **Bank CSV** — Scotiabank-style CSV (Date, Description, Sub-description, Type, Amount). Other bank formats can be supported by writing a custom parser via the AI assistant.
- **Workbook** — import from a spreadsheet workbook.
- **Amazon** — import from Amazon order history CSV export.
- **PayPal** — import from PayPal transaction CSV export.
- Drag and drop a file or click to browse. Imported transactions are deduplicated automatically and auto-categorised via your existing rules.

---

### Experimental Budgets tab

Plan alternative budget scenarios without affecting your live data.

![Experimental Budgets tab](screenshots/experimental.png)

- **Named scenarios** — create budgets like "Tight Budget", "Savings Push", or "New Baby Plan" and save them independently of your live monthly budget.
- **Income & Expense separation** — each experimental budget has an Income section and a grouped Expenses section, mirroring the Budget tab layout.
- **Totals** — see Total Income, Total Expenses, and Net at the top of each saved scenario.
- **Apply to any month** — from the Budget tab, copy any experimental budget to a month's targets with one click (with overwrite confirmation).
- **Snapshot from a real month** — create an experimental budget as a snapshot of any existing month's targets.

---

### Settings

Configure categories, rules, encryption, parsers, and more.

![Settings tab](screenshots/settings.png)

- **Categories** — create, rename, colour-code, and delete categories. Toggle the Income flag per category to control how they appear in budget summaries.
- **Category rules** — manage auto-categorisation rules: pattern, match type (contains / starts with / regex), optional amount filter, and target category.
- **Recurring templates** — define recurring transactions that are automatically created each month (e.g. mortgage, subscriptions).
- **Encryption** — set or change a password to encrypt your data file. The file is decrypted in memory only; nothing unencrypted touches disk.
- **Display** — zoom level (50 %–150 %) to suit your screen density.
- **Export** — export as a human-readable Excel workbook (one budget sheet + one transaction sheet per month, plus a year summary and savings sheet), a plain JSON archive, or an encrypted JSON archive.
- **PayPal** — paste your PayPal transaction history CSV export and match entries against existing bank transactions.
- **AI / Parsers** — configure a local Ollama model and manage custom import parsers.
- **Purge** — permanently delete transactions for a specific month and type (irreversible; category rules are kept).

---

## AI assistant

The built-in AI assistant runs entirely locally using [Ollama](https://ollama.com). No data is sent to any external server.

**Setup:**

1. Install [Ollama](https://ollama.com) and pull a model:
   ```
   ollama pull qwen2.5:7b
   ```
   (Recommended: `qwen2.5:7b` — ~4.7 GB. Smaller models also work.)

2. Open **Settings → AI** and enter the model name and Ollama URL (default: `http://localhost:11434`).
3. Click the **AI Assistant** button in the top bar to open the chat panel.

The assistant can answer questions about your spending, recategorise transactions, create auto-categorisation rules, and write custom import parsers for banks not natively supported.

---

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS

### Run in development

```bash
npm install
npm run tauri dev
```

### Build a release

```bash
npm run tauri build
```

The installer is written to `src-tauri/target/release/bundle/`. On Linux this produces a `.deb` and AppImage; on Windows an `.exe` installer and `.msi`.

### First launch

On first launch you will be asked to create or open a budget file. Choose a location (e.g. a synced folder if you want cross-machine access via your own storage), set an optional password, and you are ready to start.

---

## Data format

Your budget is a single JSON file containing all categories, budget targets, transactions, savings buckets, and settings. You can:

- Back it up by copying the file.
- Version it with git.
- Move it to another machine and open it there.
- Open and inspect it with any text editor (if unencrypted).

---

## Tech stack

| Layer | Library |
|-------|---------|
| Desktop shell | [Tauri 2](https://tauri.app) (Rust) |
| UI | [React 19](https://react.dev) + TypeScript |
| Build | [Vite](https://vite.dev) |
| Charts | [Chart.js](https://www.chartjs.org) |
| Spreadsheet import | [xlsx / SheetJS](https://github.com/SheetJS/sheetjs) |

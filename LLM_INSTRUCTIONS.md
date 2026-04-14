# AI Assistant Instructions

This file documents what the AI assistant embedded in this budget app can do and how it's configured.

## Setup

The AI assistant uses [Ollama](https://ollama.com) to run a local LLM on your GPU. No data leaves your machine.

**Recommended model:** `qwen2.5:7b` — fits comfortably in 8 GB VRAM (~4.7 GB usage).

**Other options:**
- `qwen2.5-coder:7b` — same size, better at code tasks
- `llama3.2:3b` — lighter, faster, lower quality (~2 GB)
- `qwen2.5:14b` — better quality, needs 12+ GB VRAM

**Quick start:**
1. Install Ollama: https://ollama.com
2. Open Settings → AI Assistant → Pull model
3. Click the **AI** button (top-right) to open the chat panel

## What the AI can do

### 1. Answer questions about your budget
- "How much did I spend on groceries last month?"
- "Which category am I most over-budget in?"
- "Show me all transactions over $200 in March"

### 2. Make changes to transactions and budgets
- "Change the category of transaction 1234 to Dining"
- "Set my December groceries budget to $600"
- "Add a note to transaction 789 saying 'work expense'"
- "Mark transaction 456 as ignore-in-budget"

The AI will always confirm before making changes unless you explicitly ask it to do something.

### 3. Identify unknown transactions
Click the **?** button next to any transaction in the Transactions view.

The AI will:
1. Check if you've had similar transactions before
2. Search DuckDuckGo for the merchant descriptor
3. Infer what the merchant/service is based on results and your spending patterns

### 4. Create categorization rules
- "Create a rule to always categorize 'WHOLEFDS' as Groceries"
- After identifying a transaction, it can suggest adding a rule automatically

### 5. Generate parsers for new file formats
In Settings → Import Parsers, upload a sample file and the AI will generate a TypeScript parser for it.

## Data access

The AI only has access to:
- Your transaction history (last 6 months in context, full history via tools)
- Budget targets and categories
- The results of DuckDuckGo searches it performs through the `search_web` tool

It does **not** have access to:
- Any other files on your system
- The internet directly (all searches go through the controlled `search_web` tool)
- Other applications

## Privacy

All LLM inference runs locally on your GPU via Ollama. Your financial data never leaves your machine.

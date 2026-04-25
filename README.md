# mych-minar1

AI-powered Telegram bot with chat, agent mode, media tools, and JSON-driven command intent routing.

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set at least:
   - `TELEGRAM_BOT_TOKEN`
   - provider key used by `bot.config.jsonc` (default: `GROQ_API_KEY`)

3. Run in development:

```bash
npm run dev
```

4. Build and run production:

```bash
npm run build
npm run start
```

## Main Config

- `bot.config.jsonc`: provider/model, fallback models, limits, low-token mode
- `.env`: secrets, admin IDs, transport, webhook values

Default transport is polling. To use webhook, set `BOT_TRANSPORT=webhook` and configure webhook env vars.

## Basic Configuration

Minimal `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
GROQ_API_KEY=your_provider_key
BOT_ADMIN_IDS=123456789
BOT_TRANSPORT=polling
```

Minimal `bot.config.jsonc`:

```jsonc
{
  "llm": {
    "provider": "openai_compatible",
    "baseUrl": "https://api.groq.com/openai/v1",
    "model": "openai/gpt-oss-120b",
    "apiKeyEnv": "GROQ_API_KEY",
  },
  "bot": {
    "maxConversationHistory": 20,
    "maxAgentIterations": 5,
    "lowTokenMode": "auto",
    "telegramUserRpmLimit": 15,
  },
}
```

## Core Features

- Conversational AI with Telegram context
- Agent mode with tool execution
- JSON-based command intent metadata (`src/data/command-intent.json`)
- Fun/media commands (`/meme`, `/cat`, `/dog`, `/play`, `/video`, `/vtuber`, reactions)
- Structured logs and command metrics

## Commands

Use `/help` in chat to see the live command list from the registry.

## Quality Checks

```bash
npm run lint
npx tsc --noEmit
```

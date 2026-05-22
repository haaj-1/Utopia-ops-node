# Utopia Ops OS
-
An AI onboarding agent that takes a fellow’s name and start date, generates onboarding tasks with owners and due dates, drafts Slack messages, and outputs structured JSON for downstream workflows.
-
---

## How to Run

**Requirements:** Node 20+. No npm install needed — zero external dependencies.

**1. Copy and fill in your env file**

```bash
cp .env.example .env
```

Set at minimum one LLM key. Google AI Studio is free and the default:

```env
LLM_PROVIDER=google
GOOGLE_AI_API_KEY=your-key-here
GOOGLE_AI_MODEL=gemini-1.5-flash
```

And one Slack option:

```env
# Option A — simplest
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL

# Option B — per-department routing
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_DEFAULT_CHANNEL=#ops-onboarding
SLACK_CHANNEL_OPS=#ops-onboarding
SLACK_CHANNEL_TECH=#studio-tech
```

**2. Start the server**

```bash
npm start
```

**3. Open the dashboard**

```
http://localhost:4173
```

**4. Run tests**

```bash
npm test
```

---

## Prompts Used

**System prompt — LLM Slack draft polishing**

```
You are an operations assistant for Utopia Studio, a fellow onboarding program based in Doha.
Owners by function: Ops owns KYC, first stipend, and QDB housing.
Tech owns Slack channels (fellow-facing + studio-only), Linear project loaded from template,
Claude.ai project live, and Drive folder structured per template.
Every item must be complete by 17:00 Doha time the day before the fellow's start date.
Anything still red on the morning of start is escalated immediately.
You will be given a draft message. Your job is to lightly polish the wording to make it more
natural and professional — do NOT change the structure, remove any fellows, remove any tasks,
or change any facts. Keep the same format: greeting, context paragraph, bullet list of tasks,
closing line. Every fellow and every task in the draft must appear in your output.
Escalated items (🔴) must remain marked as escalated.
Be polite, formal, and direct. No sign-offs, no extra commentary.
```

**User prompt template — per-department message**

```
Here is the draft message for the {ops|tech} team. Lightly polish the wording to make it
more natural and professional. Do not change the structure, remove any fellows, remove any
tasks, or alter any facts. Every item in the draft must appear in your output:

{pre-built draft from OnboardingAgent._buildSlackDrafts()}
```

**User prompt template — general ops digest**

```
Write a Slack message for the ops team based on this onboarding status:
Summary: {executive_summary}
Risk counts: {red} red, {amber} amber, {green} green.
Top escalation: {fellow_name} is {risk_level}. Reason: {reason}. Next step: {next_step}
```

---

## Tools and APIs Called

| Integration | How it's used |
|---|---|
| **Slack Bot Token API** (`chat.postMessage`) | Posts per-department reminders to `#ops-onboarding` and `#studio-tech` |
| **Slack Incoming Webhook** | Single-channel digest fallback |
| **Slack slash command** (`/onboard-fellow`) | Accepts `Name YYYY-MM-DD` and returns an ephemeral checklist |
| **Linear GraphQL API** | Creates an "Onboarding — {name}" project with one issue per task; reads live issue states back into the agent |
| **Google Sheets CSV export** | Pulls a published CSV of current fellow task statuses as a live data source |
| **Google AI Studio / Gemini** | Default LLM for polishing Slack draft messages (free tier) |
| **Anthropic Claude API** | Optional LLM provider (`LLM_PROVIDER=anthropic`) |
| **OpenAI API** | Optional LLM provider (`LLM_PROVIDER=openai`) |
| **DeepSeek API** | Optional LLM provider (`LLM_PROVIDER=deepseek`) |
| **JSON webhook** | Fires `downstream_payload` to any URL for second-agent handoff |

---

## API Routes

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness check |
| GET | `/api/connectors/status` | Live status of all integrations |
| GET | `/api/analyze/scenario?key=baseline` | Run agent on a built-in demo scenario |
| POST | `/api/analyze/new-fellow` | Create checklist from `{ "name": "...", "startDate": "YYYY-MM-DD" }` |
| POST | `/api/analyze/new-fellow-linear` | Create checklist and push to Linear |
| POST | `/api/analyze/json` | Run agent on a raw JSON payload |
| POST | `/api/analyze/csv` | Run agent on a CSV text body |
| POST | `/api/analyze/sheets` | Pull from Google Sheets and run agent |
| POST | `/api/analyze/linear` | Pull live status from Linear projects |
| POST | `/api/actions/slack/digest` | Post digest to default Slack channel |
| POST | `/api/actions/slack/reminders` | Send per-department targeted messages |
| POST | `/api/actions/slack/red-alerts` | Send messages only for red-risk fellows |
| POST | `/api/actions/slack/join` | Auto-join all configured Slack channels |
| GET | `/api/actions/slack/channels` | List all public channels in the workspace |
| POST | `/api/actions/slack/command` | Slack slash command endpoint |
| POST | `/api/actions/linear/issues` | Create Linear risk issues |
| POST | `/api/actions/webhook` | Fire generic JSON webhook |
| POST | `/api/actions/llm/message` | Generate AI-written Slack message |
| POST | `/api/actions/llm/all-departments` | Generate one AI message per department |
| GET | `/api/actions/scheduler/status` | Show daily scheduler state |
| POST | `/api/actions/scheduler/toggle` | Enable/disable the 9am Doha run |
| POST | `/api/actions/scheduler/run-now` | Trigger the scheduled workflow immediately |

---

## Environment Variables

See `.env.example` for the full list. Key variables:

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | No | `google` (default), `anthropic`, `openai`, or `deepseek` |
| `GOOGLE_AI_API_KEY` | If using Google | Free key from aistudio.google.com |
| `GOOGLE_AI_MODEL` | If using Google | e.g. `gemini-1.5-flash` |
| `ANTHROPIC_API_KEY` | If using Anthropic | Claude API key |
| `OPENAI_API_KEY` | If using OpenAI | OpenAI API key |
| `SLACK_WEBHOOK_URL` | For Slack | Incoming Webhook URL |
| `SLACK_BOT_TOKEN` | For Slack Bot mode | Bot User OAuth Token (`xoxb-`) |
| `SLACK_DEFAULT_CHANNEL` | For Slack Bot mode | e.g. `#ops-onboarding` |
| `SLACK_CHANNEL_OPS` | Optional | Dedicated ops channel |
| `SLACK_CHANNEL_TECH` | Optional | Dedicated tech channel |
| `SLACK_SIGNING_SECRET` | Optional | Verifies slash-command requests |
| `LINEAR_API_KEY` | For Linear | Linear personal API key |
| `LINEAR_TEAM_ID` | For Linear | Linear team ID |
| `GOOGLE_SHEETS_CSV_URL` | For Sheets sync | Published CSV export URL |
| `JSON_WEBHOOK_URL` | Optional | Downstream webhook for second-agent handoff |
| `SCHEDULER_ENABLED` | Optional | `true` to enable the 9am Doha daily run |
| `SCHEDULER_TIME` | Optional | Default `09:00` |
| `SCHEDULER_TIMEZONE` | Optional | Default `Asia/Qatar` |

---

## Docker

```bash
docker build -t utopia-ops-os .
docker run -p 4173:4173 --env-file .env utopia-ops-os
```

---

## Architecture

```
Browser (frontend/)
    ↓ fetch /api/*
backend/server.js
    ↓
routes/           (health · connectors · analyze · actions · config)
    ↓
AppService.js     (orchestrates everything)
    ↓                         ↓
OnboardingAgent           LlmService
    ↓                         ↓
RiskPolicy         Google AI / Anthropic / OpenAI / DeepSeek
    ↓
SlackConnector / LinearConnector / SheetsConnector
```

The agent core (`OnboardingAgent` + `RiskPolicy`) is pure JavaScript with zero external dependencies. All integrations are optional and fail gracefully — the agent always produces output even if no connectors are configured.

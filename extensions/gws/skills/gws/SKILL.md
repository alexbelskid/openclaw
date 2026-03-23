# Google Workspace Skill (gws CLI)

Use this skill for any Google Workspace operations: Gmail, Drive, Calendar, Sheets, Docs, Contacts.

## Setup

```bash
gws auth setup  # one-time: creates Cloud project, enables APIs
gws auth login  # OAuth login
```

## Usage

### Gmail
```bash
gws gmail users messages list --params '{"userId":"me","maxResults":10}'
gws gmail users messages send --params '{"userId":"me"}' --json '{"raw":"..."}'
```

### Drive
```bash
gws drive files list --params '{"pageSize":10}'
gws drive files get --params '{"fileId":"FILE_ID"}'
```

### Calendar
```bash
gws calendar events list --params '{"calendarId":"primary","maxResults":10}'
gws calendar events insert --params '{"calendarId":"primary"}' --json '{...}'
```

### Sheets
```bash
gws sheets spreadsheets values get --params '{"spreadsheetId":"ID","range":"Sheet1!A1:Z100"}'
```

## Agent Instructions

Always use `gws` CLI for Google Workspace operations instead of direct API calls.
Output is structured JSON — parse with python3 or jq.

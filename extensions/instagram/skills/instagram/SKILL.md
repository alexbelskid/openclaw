# Instagram / Meta Graph API Skill

Use this skill for Instagram and Facebook operations via Meta Graph API.

## Setup

Requires: Meta App with Instagram Basic Display API or Instagram Graph API permissions.

Config in openclaw.json:
```json
{
  "plugins": {
    "entries": {
      "instagram": {
        "enabled": true,
        "config": {
          "accessToken": "YOUR_META_ACCESS_TOKEN",
          "igUserId": "YOUR_IG_USER_ID"
        }
      }
    }
  }
}
```

## Usage

### Get media
```bash
curl "https://graph.instagram.com/me/media?fields=id,caption,media_type,timestamp&access_token=TOKEN"
```

### Send DM (requires Instagram API with DM permissions)
```bash
curl -X POST "https://graph.facebook.com/v18.0/IG_USER_ID/messages" \
  -H "Content-Type: application/json" \
  -d '{"recipient":{"id":"RECIPIENT_ID"},"message":{"text":"Hello"}}'
  -d "access_token=TOKEN"
```

### Get insights
```bash
curl "https://graph.facebook.com/v18.0/IG_USER_ID/insights?metric=impressions,reach&period=day&access_token=TOKEN"
```

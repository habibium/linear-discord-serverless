![linear-discord-serverless](./docs/banner.jpg)

<h3 align="center">Get linear's events forwarded to Discord webhooks through Vercel serverless functions.</h3>

### Installation

Please visit [lds.alistair.cloud](https://lds.alistair.cloud) which documents the setup. In short, we form a URL that contains the Discord webhook ID and Token, and use that as our linear URL. That way we can use the body with ID and Token in a stateless environment.

### Routing by project (optional)

To send events for a specific Linear project to a different Discord channel, set the `LDS_PROJECT_ROUTES` environment variable to a JSON object mapping the Linear `projectId` to a full Discord webhook URL:

```json
{
  "11111111-1111-1111-1111-111111111111": "https://discord.com/api/webhooks/ID1/TOKEN1",
  "22222222-2222-2222-2222-222222222222": "https://discord.com/api/webhooks/ID2/TOKEN2"
}
```

Issue events whose `projectId` matches one of the keys are delivered to that webhook; everything else (and any issue without a project) falls back to the default webhook encoded in the request URL. Closes #13.

### Video Guide

I've made a small video guide to visually demonstrate setup. You can watch it on [YouTube](https://youtu.be/QgDt8yUnQcA).

### Credits

This project is heavily inspired by [@ezolla](https://github.com/ezolla)'s amazing [linear-app-discord](https://github.com/ezolla/linear-app-discord). If you're looking for more control over the data sent, I recommend checking that out.

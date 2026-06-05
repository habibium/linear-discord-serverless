![linear-discord-serverless](./docs/banner.jpg)

<h3 align="center">Get Linear's events forwarded to Discord webhooks through a Vercel serverless function.</h3>

> This is the `production` branch on [habibium/linear-discord-serverless](https://github.com/habibium/linear-discord-serverless). It bundles four upstream PRs (#15, #16, #17, #18) so the project can be deployed on modern Node + Linear's current webhook contract without waiting for upstream merges.

### Configuration

| Variable                | Required | Description                                                                                                                                                                       |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LINEAR_WEBHOOK_SECRET` | yes      | Signing secret shown in Linear's webhook settings UI. Used to verify each request's HMAC-SHA256 signature.                                                                        |
| `LDS_PROJECT_ROUTES`    | no       | JSON object mapping a Linear `projectId` to a full Discord webhook URL. Issue events whose `data.projectId` matches are delivered to the override webhook instead of the default. |

### Deploying to Vercel

```sh
pnpm install
pnpm vercel              # links the project, runs locally
pnpm vercel --prod       # production deploy
```

Then in the Vercel project's **Settings → Environment Variables**, set `LINEAR_WEBHOOK_SECRET` (and optionally `LDS_PROJECT_ROUTES`). Redeploy after adding env vars.

Linear webhook URL:

```
https://<your-deployment>.vercel.app/api/v2?id=<discord-webhook-id>&token=<discord-webhook-token>&api=<linear-api-key>
```

The static helper at `public/index.html` builds this URL from the Discord webhook URL and Linear API key.

### Video Guide

Original v1-era walkthrough on [YouTube](https://youtu.be/QgDt8yUnQcA). Setup specifics have changed (signing secret, modernised deps); the high-level idea is the same.

### Credits

This project is heavily inspired by [@ezolla](https://github.com/ezolla)'s amazing [linear-app-discord](https://github.com/ezolla/linear-app-discord). Original work by [@alii](https://github.com/alii).

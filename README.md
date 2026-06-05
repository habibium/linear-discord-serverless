![linear-discord-serverless](./docs/banner.jpg)

<h3 align="center">Get linear's events forwarded to Discord webhooks through Vercel serverless functions.</h3>

### Installation

Please visit [lds.alistair.cloud](https://lds.alistair.cloud) which documents the setup. In short, we form a URL that contains the Discord webhook ID and Token, and use that as our linear URL. That way we can use the body with ID and Token in a stateless environment.

### Verifying webhook signatures

Linear webhooks are authenticated with an HMAC-SHA256 signing secret, shown when a webhook is created in Linear's settings. Set this value as the `LINEAR_WEBHOOK_SECRET` environment variable on your deployment (e.g. in the Vercel project settings). Requests that don't carry a matching `Linear-Signature` header — or whose `webhookTimestamp` is more than 60 seconds off — are rejected with `401`.

The previous source-IP allowlist has been removed: Linear has expanded its egress IPs since then, and the official guidance is to rely on the signing secret.

### Video Guide

I've made a small video guide to visually demonstrate setup. You can watch it on [YouTube](https://youtu.be/QgDt8yUnQcA).

### Credits

This project is heavily inspired by [@ezolla](https://github.com/ezolla)'s amazing [linear-app-discord](https://github.com/ezolla/linear-app-discord). If you're looking for more control over the data sent, I recommend checking that out.

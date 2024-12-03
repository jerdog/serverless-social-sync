# Serverless Social Sync

A serverless application that synchronizes posts between Bluesky and Mastodon. Built with Cloudflare Workers, this service enables bidirectional post synchronization between your social media accounts.

## Features

- 🔄 Bidirectional sync between Bluesky and Mastodon
- ⚙️ Configurable sync parameters
  - Number of posts to sync
  - Option to ignore reposts/reblogs
  - Debug mode for troubleshooting
- 🕒 Automatic tracking of last sync time
- 🔒 Secure credential management
- 📝 Detailed sync logging
- 🚀 Modern Node.js support (v20.5.0+)

## Project Structure

```
serverless-social-sync/
├── src/
│   ├── worker.js              # Cloudflare Worker entry point
│   └── services/
│       └── SocialSyncService.js  # Core sync logic
├── .dev.vars                  # Local development variables (git-ignored)
├── .dev.vars.sample          # Sample development variables
├── package.json              # Project dependencies
├── wrangler.toml             # Cloudflare Worker configuration
├── wrangler.toml-example     # Example configuration file
└── README.md                 # Project documentation
```

## Prerequisites

- Node.js 20.5.0 or later
- npm or yarn
- Cloudflare account with Workers support
- Bluesky account
- Mastodon account

## Setup

1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```

2. Create a KV namespace for storing sync state:
   ```bash
   wrangler kv:namespace create "SYNC_STORE"
   ```

3. Create your configuration file:
   ```bash
   cp wrangler.toml-example wrangler.toml
   ```
   Update `wrangler.toml` with your:
   - KV namespace ID
   - Account ID
   - Other settings as needed

4. Copy the sample environment variables:
   ```bash
   cp .dev.vars.sample .dev.vars
   ```

5. Configure your environment variables in `.dev.vars`:
   - `DEBUG`: Enable debug logging (true/false)
   - `POSTS_TO_SYNC`: Number of posts to sync in each direction
   - `IGNORE_REPOSTS`: Skip reposts/reblogs (true/false)
   - `MASTODON_URL`: Your Mastodon instance URL
   - `MASTODON_USERNAME`: Your Mastodon username
   - `MASTODON_ACCESS_TOKEN`: Mastodon API access token
   - `BLUESKY_USERNAME`: Your Bluesky handle
   - `BLUESKY_PASSWORD`: Your Bluesky app password

## Development

Run the worker locally:
```bash
npm run dev
```

Test the scheduled function:
```bash
npm run test:trigger
```

## Deployment

1. Configure your production environment variables:
   ```bash
   wrangler secret put MASTODON_ACCESS_TOKEN
   wrangler secret put BLUESKY_PASSWORD
   ```

2. Deploy to Cloudflare Workers:
   ```bash
   npm run deploy
   ```

## Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `DEBUG` | Enable detailed logging | `false` |
| `POSTS_TO_SYNC` | Number of recent posts to sync | `10` |
| `IGNORE_REPOSTS` | Skip reposts and reblogs | `true` |
| `LAST_SYNC` | Fallback timestamp for first sync | `null` |

## Node.js Compatibility

This project uses Node.js v20.5.0+ features and requires:
- Cloudflare Workers with Node.js compatibility mode enabled
- Local Node.js v20.5.0 or later for development
- ES Modules (`type: "module"` in package.json)

The worker uses Cloudflare's Node.js compatibility mode with the following features:
- ES Modules for better code organization
- Modern JavaScript features
- Enhanced performance and security updates

## Security

- Never commit `.dev.vars` or any files containing credentials
- Use Cloudflare's secret management for sensitive data
- Rotate your API tokens regularly
- Monitor your worker's execution logs
- Keep Node.js and dependencies up to date

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

MIT License - feel free to use this project as you wish.

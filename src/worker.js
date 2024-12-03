import { SocialSyncService } from './services/SocialSyncService'

/**
 * Handles the sync operation
 * @param {*} env Environment variables and bindings
 * @returns {Promise<Object>} Sync results
 */
async function handleSync(env) {
  const config = {
    debug: env.DEBUG === 'true',
    postsToSync: parseInt(env.POSTS_TO_SYNC) || 10,
    ignoreReposts: env.IGNORE_REPOSTS === 'true',
    dryRun: env.DRY_RUN === 'true',
    lastSync: await env.SYNC_STORE.get('lastSync') || env.LAST_SYNC || null,
    mastodonUrl: env.MASTODON_URL,
    mastodonUsername: env.MASTODON_USERNAME,
    mastodonAccessToken: env.MASTODON_ACCESS_TOKEN,
    blueskyUsername: env.BLUESKY_USERNAME,
    blueskyPassword: env.BLUESKY_PASSWORD
  }

  const syncService = new SocialSyncService(config)

  try {
    const results = await syncService.sync()
    
    // Only update the last sync time if this wasn't a dry run
    if (!config.dryRun) {
      await env.SYNC_STORE.put('lastSync', results.timestamp)
    }

    return {
      success: true,
      dryRun: config.dryRun,
      timestamp: results.timestamp,
      stats: {
        blueskyToMastodon: results.blueskyToMastodon.length,
        mastodonToBluesky: results.mastodonToBluesky.length
      },
      details: config.debug ? results : undefined
    }
  } catch (error) {
    console.error('Worker execution failed:', error)
    return {
      success: false,
      dryRun: config.dryRun,
      error: error.message,
      details: config.debug ? error.stack : undefined
    }
  }
}

export default {
  // Handle scheduled events
  async scheduled(event, env, ctx) {
    return handleSync(env)
  },

  // Handle HTTP requests
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    
    // Only handle scheduled trigger endpoint
    if (url.pathname === '/__scheduled') {
      const results = await handleSync(env)
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Not Found', { status: 404 })
  }
}

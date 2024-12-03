import { SocialSyncService } from './services/SocialSyncService'

/**
 * Cloudflare Worker that handles scheduled synchronization between social media platforms
 * @typedef {Object} Env
 * @property {string} DEBUG - Enable debug logging ('true'/'false')
 * @property {string} POSTS_TO_SYNC - Number of posts to sync in each direction
 * @property {string} IGNORE_REPOSTS - Whether to ignore reposts ('true'/'false')
 * @property {string} LAST_SYNC - Optional fallback timestamp for last sync
 * @property {string} MASTODON_URL - Mastodon instance URL
 * @property {string} MASTODON_USERNAME - Mastodon username
 * @property {string} MASTODON_ACCESS_TOKEN - Mastodon API access token
 * @property {string} BLUESKY_USERNAME - Bluesky handle
 * @property {string} BLUESKY_PASSWORD - Bluesky app password
 * @property {string} DRY_RUN - Whether to perform a dry run ('true'/'false')
 * @property {KVNamespace} SYNC_STORE - KV namespace for storing sync state
 */

export default {
  /**
   * Handles scheduled execution of the social media sync
   * @param {ScheduledEvent} event - The scheduled event that triggered this execution
   * @param {Env} env - Environment variables and bindings
   * @param {ExecutionContext} ctx - Execution context
   * @returns {Promise<SyncResults>} Results of the sync operation
   * @throws {Error} If sync fails
   */
  async scheduled(event, env, ctx) {
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
}

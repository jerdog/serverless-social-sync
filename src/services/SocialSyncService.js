/**
 * @typedef {Object} SyncConfig
 * @property {boolean} debug - Enable debug logging
 * @property {number} postsToSync - Number of posts to sync in each direction
 * @property {boolean} ignoreReposts - Whether to ignore reposts/reblogs
 * @property {string|null} lastSync - ISO timestamp of last successful sync
 * @property {string} mastodonUrl - Mastodon instance URL
 * @property {string} mastodonUsername - Mastodon username
 * @property {string} mastodonAccessToken - Mastodon API access token
 * @property {string} blueskyUsername - Bluesky handle
 * @property {string} blueskyPassword - Bluesky app password
 * @property {boolean} dryRun - If true, only simulate changes without posting
 */

/**
 * @typedef {Object} SyncedPost
 * @property {'bluesky'|'mastodon'} source - Source platform
 * @property {string} sourceId - Original post ID
 * @property {string} targetId - Synced post ID or 'DRY_RUN' if simulating
 * @property {string} text - Post content
 * @property {boolean} simulated - Whether this was a dry run
 */

/**
 * @typedef {Object} SyncResults
 * @property {string} timestamp - ISO timestamp of sync completion
 * @property {SyncedPost[]} blueskyToMastodon - Posts synced from Bluesky to Mastodon
 * @property {SyncedPost[]} mastodonToBluesky - Posts synced from Mastodon to Bluesky
 * @property {boolean} dryRun - Whether this was a dry run
 */

import { BskyAgent } from '@atproto/api'
import { createRestAPIClient } from 'masto'

/**
 * Service class for bidirectional synchronization between Bluesky and Mastodon
 */
export class SocialSyncService {
  /**
   * Creates a new instance of SocialSyncService
   * @param {SyncConfig} config - Configuration options
   */
  constructor(config) {
    this.config = config
    this.debug = config.debug
    this.postsToSync = config.postsToSync
    this.ignoreReposts = config.ignoreReposts
    this.lastSync = config.lastSync
    this.dryRun = config.dryRun || false
  }

  /**
   * Initializes connections to both social platforms
   * @private
   * @throws {Error} If authentication fails
   */
  async initialize() {
    // Initialize Bluesky client
    this.bsky = new BskyAgent({
      service: 'https://bsky.social'
    })

    // Initialize Mastodon client
    this.masto = createRestAPIClient({
      url: this.config.mastodonUrl,
      accessToken: this.config.mastodonAccessToken
    })

    // Login to Bluesky
    await this.bsky.login({
      identifier: this.config.blueskyUsername,
      password: this.config.blueskyPassword
    })
  }

  /**
   * Syncs posts from Bluesky to Mastodon
   * @private
   * @returns {Promise<SyncedPost[]>} Array of synced posts
   * @throws {Error} If sync fails
   */
  async syncFromBluesky() {
    const bskyPosts = await this.bsky.getAuthorFeed({
      actor: this.config.blueskyUsername,
      limit: this.postsToSync
    })

    const syncedPosts = []
    for (const post of bskyPosts.data.feed) {
      // Skip if post is older than last sync
      if (this.lastSync && new Date(post.post.indexedAt) <= new Date(this.lastSync)) {
        continue
      }

      // Skip reposts if configured
      if (this.ignoreReposts && post.post.record.reply) {
        continue
      }

      const text = post.post.record.text
      if (this.debug) {
        console.log(`${this.dryRun ? '[DRY RUN] Would sync' : 'Syncing'} Bluesky post:`, text)
      }

      let targetId = 'DRY_RUN'
      if (!this.dryRun) {
        // Post to Mastodon
        const mastoPost = await this.masto.v1.statuses.create({
          status: text,
          visibility: 'public'
        })
        targetId = mastoPost.id
      }

      syncedPosts.push({
        source: 'bluesky',
        sourceId: post.post.uri,
        targetId,
        text,
        simulated: this.dryRun
      })
    }

    return syncedPosts
  }

  /**
   * Syncs posts from Mastodon to Bluesky
   * @private
   * @returns {Promise<SyncedPost[]>} Array of synced posts
   * @throws {Error} If sync fails
   */
  async syncFromMastodon() {
    const mastodonPosts = await this.masto.v1.accounts.$select(this.config.mastodonUsername)
      .statuses.list({
        limit: this.postsToSync,
        excludeReblogs: this.ignoreReposts
      })

    const syncedPosts = []
    for (const post of mastodonPosts) {
      // Skip if post is older than last sync
      if (this.lastSync && new Date(post.createdAt) <= new Date(this.lastSync)) {
        continue
      }

      const text = post.content.replace(/<[^>]*>/g, '') // Remove HTML tags
      if (this.debug) {
        console.log(`${this.dryRun ? '[DRY RUN] Would sync' : 'Syncing'} Mastodon post:`, text)
      }

      let targetId = 'DRY_RUN'
      if (!this.dryRun) {
        // Post to Bluesky
        const bskyPost = await this.bsky.post({
          text: text
        })
        targetId = bskyPost.uri
      }

      syncedPosts.push({
        source: 'mastodon',
        sourceId: post.id,
        targetId,
        text,
        simulated: this.dryRun
      })
    }

    return syncedPosts
  }

  /**
   * Performs bidirectional sync between Bluesky and Mastodon
   * @returns {Promise<SyncResults>} Results of the sync operation
   * @throws {Error} If sync fails
   */
  async sync() {
    try {
      await this.initialize()

      const currentTime = new Date().toISOString()
      const results = {
        timestamp: currentTime,
        blueskyToMastodon: await this.syncFromBluesky(),
        mastodonToBluesky: await this.syncFromMastodon(),
        dryRun: this.dryRun
      }

      if (this.debug) {
        console.log(`${this.dryRun ? '[DRY RUN] Sync simulation' : 'Sync'} completed:`, results)
      }

      return results
    } catch (error) {
      console.error('Sync error:', error)
      throw error
    }
  }
}

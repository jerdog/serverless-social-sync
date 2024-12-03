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
 * @property {string} timestamp - Timestamp of the post
 */

/**
 * @typedef {Object} SyncResults
 * @property {string} timestamp - ISO timestamp of sync completion
 * @property {SyncedPost[]} blueskyToMastodon - Posts synced from Bluesky to Mastodon
 * @property {SyncedPost[]} mastodonToBluesky - Posts synced from Mastodon to Bluesky
 * @property {boolean} dryRun - Whether this was a dry run
 */

import { BskyAgent } from '@atproto/api'

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
    this.mastodonApi = null
    this.bsky = null
  }

  /**
   * Makes an authenticated request to the Mastodon API
   */
  async mastodonRequest(endpoint, options = {}) {
    const url = new URL(endpoint, this.config.mastodonUrl).toString()
    const headers = {
      'Authorization': `Bearer ${this.config.mastodonAccessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers
    }

    if (this.debug) {
      console.log(`[DEBUG] Mastodon API Request: ${url}`)
    }

    const response = await fetch(url, {
      ...options,
      headers
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Mastodon API error: ${response.status} ${text}`)
    }

    return response.json()
  }

  /**
   * Initializes connections to both social platforms
   * @private
   * @throws {Error} If authentication fails
   */
  async initialize() {
    if (this.debug) {
      console.log('[DEBUG] Initializing social connections...')
    }

    // Test Mastodon connection first
    try {
      // 1. Test instance connectivity
      const instanceResponse = await fetch(new URL('/api/v1/instance', this.config.mastodonUrl).toString())
      if (!instanceResponse.ok) {
        throw new Error(`Cannot reach Mastodon instance: ${instanceResponse.status}`)
      }
      const instance = await instanceResponse.json()
      
      if (this.debug) {
        console.log('[DEBUG] Connected to Mastodon instance:', instance.uri)
      }

      // 2. Verify credentials
      const account = await this.mastodonRequest('/api/v1/accounts/verify_credentials')
      
      if (this.debug) {
        console.log('[DEBUG] Mastodon auth successful:', {
          username: account.username,
          acct: account.acct,
          id: account.id
        })
      }

      // Store account info
      this.mastodonAccount = account

    } catch (error) {
      console.error('[ERROR] Mastodon initialization failed:', error)
      throw error
    }

    // Initialize Bluesky
    try {
      this.bsky = new BskyAgent({
        service: 'https://bsky.social'
      })

      await this.bsky.login({
        identifier: this.config.blueskyUsername,
        password: this.config.blueskyPassword
      })

      if (this.debug) {
        console.log('[DEBUG] Bluesky auth successful')
      }
    } catch (error) {
      console.error('[ERROR] Bluesky initialization failed:', error)
      throw error
    }

    if (this.debug) {
      console.log('[DEBUG] All social connections initialized successfully')
    }
  }

  /**
   * Converts Mastodon HTML content to plain text while preserving basic formatting
   * @private
   */
  cleanMastodonContent(html) {
    // Replace <br> with newlines
    let text = html.replace(/<br\s*\/?>/gi, '\n')
    
    // Replace <p> with double newlines
    text = text.replace(/<p>(.*?)<\/p>/gi, '$1\n\n')
    
    // Preserve links
    text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    
    // Remove all other HTML tags
    text = text.replace(/<[^>]*>/g, '')
    
    // Fix multiple newlines
    text = text.replace(/\n{3,}/g, '\n\n')
    
    // Trim extra whitespace
    return text.trim()
  }

  /**
   * Handles rate limiting and retries
   * @private
   */
  async withRateLimit(fn, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn()
      } catch (error) {
        if (error.message.includes('rate limit') || error.status === 429) {
          const waitTime = Math.pow(2, i) * 1000 // Exponential backoff
          if (this.debug) {
            console.log(`[DEBUG] Rate limited, waiting ${waitTime}ms before retry ${i + 1}/${retries}`)
          }
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }
        throw error
      }
    }
    throw new Error(`Failed after ${retries} retries`)
  }

  /**
   * Syncs posts from Bluesky to Mastodon
   * @private
   * @returns {Promise<SyncedPost[]>} Array of synced posts
   * @throws {Error} If sync fails
   */
  async syncFromBluesky() {
    const bskyPosts = await this.withRateLimit(() =>
      this.bsky.getAuthorFeed({
        actor: this.config.blueskyUsername,
        limit: this.postsToSync
      })
    )

    const syncedPosts = []
    for (const post of bskyPosts.data.feed) {
      try {
        // Skip if post is older than last sync
        if (this.lastSync && new Date(post.post.indexedAt) <= new Date(this.lastSync)) {
          if (this.debug) console.log('[DEBUG] Skipping older post')
          continue
        }

        // Skip reposts if configured
        if (this.ignoreReposts && post.post.record.reply) {
          if (this.debug) console.log('[DEBUG] Skipping reply/repost')
          continue
        }

        const text = post.post.record.text
        if (this.debug) {
          console.log(`[DEBUG] Processing Bluesky post: ${text.substring(0, 50)}...`)
        }

        let targetId = 'DRY_RUN'
        if (!this.dryRun) {
          const mastoPost = await this.withRateLimit(() =>
            this.mastodonRequest('/api/v1/statuses', {
              method: 'POST',
              body: JSON.stringify({
                status: text,
                visibility: 'public'
              })
            })
          )
          targetId = mastoPost.id
        }

        syncedPosts.push({
          source: 'bluesky',
          sourceId: post.post.uri,
          targetId,
          text,
          simulated: this.dryRun,
          timestamp: post.post.indexedAt
        })
      } catch (error) {
        console.error(`[ERROR] Failed to sync Bluesky post ${post.post.uri}:`, error)
        // Continue with next post instead of failing completely
        continue
      }
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
    // First get the timeline directly
    const timelinePosts = await this.withRateLimit(() => 
      this.mastodonRequest('/api/v1/timelines/home', {
        params: {
          limit: this.postsToSync
        }
      })
    )

    if (this.debug) {
      console.log(`[DEBUG] Retrieved ${timelinePosts.length} posts from Mastodon timeline`)
    }

    const syncedPosts = []
    for (const post of timelinePosts) {
      try {
        // Skip if post is older than last sync
        if (this.lastSync && new Date(post.created_at) <= new Date(this.lastSync)) {
          if (this.debug) console.log('[DEBUG] Skipping older post')
          continue
        }

        // Skip reposts if configured
        if (this.ignoreReposts && post.reblog) {
          if (this.debug) console.log('[DEBUG] Skipping reblog')
          continue
        }

        // Skip if not our own post
        if (post.account.username.toLowerCase() !== this.config.mastodonUsername.toLowerCase()) {
          if (this.debug) console.log('[DEBUG] Skipping post from other user:', post.account.username)
          continue
        }

        const text = this.cleanMastodonContent(post.content)
        if (this.debug) {
          console.log(`[DEBUG] Processing Mastodon post: ${text.substring(0, 50)}...`)
        }

        let targetId = 'DRY_RUN'
        if (!this.dryRun) {
          const bskyPost = await this.withRateLimit(() =>
            this.bsky.post({
              text: text,
              createdAt: new Date().toISOString()
            })
          )
          targetId = bskyPost.uri
        }

        syncedPosts.push({
          source: 'mastodon',
          sourceId: post.id,
          targetId,
          text,
          simulated: this.dryRun,
          timestamp: post.created_at
        })
      } catch (error) {
        console.error(`[ERROR] Failed to sync Mastodon post ${post.id}:`, error)
        // Continue with next post instead of failing completely
        continue
      }
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

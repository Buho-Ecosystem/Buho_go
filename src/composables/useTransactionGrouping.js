/**
 * Transaction Grouping Composable
 * Clean, maintainable logic for grouping micropayments
 * Groups transactions by same recipient and similar descriptions
 */

// Default configuration
const DEFAULT_GROUPING_OPTIONS = {
  timeWindowSeconds: 3600,      // 1 hour
  descriptionSimilarity: 0.75,  // 75% similar
  minGroupSize: 2,              // At least 2 to form group
  maxGroupSize: 50,             // Cap at 50 transactions
  enabled: true                 // Enable/disable grouping
}

/**
 * Main grouping function
 * @param {Array} transactions - Array of transaction objects
 * @param {Object} options - Grouping configuration options
 * @returns {Array} Array of groups and standalone transactions
 */
export function groupMicropayments(transactions, options = {}) {
  const config = { ...DEFAULT_GROUPING_OPTIONS, ...options }

  if (!config.enabled || !transactions || transactions.length === 0) {
    return transactions
  }

  // Sort transactions by time (oldest first) for sequential grouping
  const sorted = [...transactions].sort((a, b) => a.settled_at - b.settled_at)

  const result = []
  let currentGroup = []
  let lastTransaction = null

  for (const tx of sorted) {
    // Check if this transaction should be added to current group
    if (
      lastTransaction &&
      currentGroup.length > 0 &&
      currentGroup.length < config.maxGroupSize &&
      shouldGroupTransactions(lastTransaction, tx, config)
    ) {
      // Add to current group
      currentGroup.push(tx)
    } else {
      // Finalize previous group if it meets minimum size
      if (currentGroup.length >= config.minGroupSize) {
        result.push(createTransactionGroup(currentGroup))
      } else {
        // Add standalone transactions
        currentGroup.forEach(t => result.push(t))
      }

      // Start new potential group
      currentGroup = [tx]
    }

    lastTransaction = tx
  }

  // Handle final group
  if (currentGroup.length >= config.minGroupSize) {
    result.push(createTransactionGroup(currentGroup))
  } else {
    currentGroup.forEach(t => result.push(t))
  }

  // Sort result by time (newest first) for display
  return result.sort((a, b) => {
    const aTime = a.type === 'group' ? a.endTime : a.settled_at
    const bTime = b.type === 'group' ? b.endTime : b.settled_at
    return bTime - aTime
  })
}

/**
 * Check if two transactions should be grouped together
 * @param {Object} tx1 - First transaction
 * @param {Object} tx2 - Second transaction
 * @param {Object} options - Grouping configuration
 * @returns {boolean} True if transactions should group
 */
export function shouldGroupTransactions(tx1, tx2, options) {
  if (!tx1 || !tx2) return false

  // Must be same type (both incoming or both outgoing)
  if (tx1.type !== tx2.type) return false

  // Check time proximity
  const timeDiff = Math.abs(tx2.settled_at - tx1.settled_at)
  if (timeDiff > options.timeWindowSeconds) return false

  // Check recipient similarity
  const recipient1 = extractRecipient(tx1)
  const recipient2 = extractRecipient(tx2)

  if (recipient1 && recipient2 && recipient1 === recipient2) {
    return true
  }

  // Check description similarity
  const desc1 = tx1.description || tx1.memo || ''
  const desc2 = tx2.description || tx2.memo || ''

  if (desc1 && desc2) {
    const similarity = calculateDescriptionSimilarity(desc1, desc2)
    return similarity >= options.descriptionSimilarity
  }

  return false
}

/**
 * Calculate similarity between two descriptions
 * Uses simple word overlap algorithm
 * @param {string} desc1 - First description
 * @param {string} desc2 - Second description
 * @returns {number} Similarity score (0-1)
 */
export function calculateDescriptionSimilarity(desc1, desc2) {
  if (!desc1 || !desc2) return 0
  if (desc1 === desc2) return 1

  // Normalize strings
  const normalize = (str) => str.toLowerCase().trim().replace(/[^\w\s]/g, '')
  const norm1 = normalize(desc1)
  const norm2 = normalize(desc2)

  if (norm1 === norm2) return 1

  // Simple word overlap algorithm
  const words1 = norm1.split(/\s+/).filter(w => w.length > 2)
  const words2 = norm2.split(/\s+/).filter(w => w.length > 2)

  if (words1.length === 0 || words2.length === 0) return 0

  // Count matching words
  const set1 = new Set(words1)
  const set2 = new Set(words2)
  let matches = 0

  set1.forEach(word => {
    if (set2.has(word)) matches++
  })

  // Calculate Jaccard similarity
  const union = new Set([...set1, ...set2])
  return matches / union.size
}

/**
 * Calculate Levenshtein distance (optional, more accurate but slower)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Edit distance
 */
export function levenshteinDistance(str1, str2) {
  const m = str1.length
  const n = str2.length
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        )
      }
    }
  }

  return dp[m][n]
}

/**
 * Extract recipient identifier from transaction
 * @param {Object} transaction - Transaction object
 * @returns {string} Recipient identifier
 */
export function extractRecipient(transaction) {
  if (!transaction) return ''

  // Try to extract from various fields
  // 1. Check for Nostr npub (zaps)
  if (transaction.senderNpub) {
    return transaction.senderNpub
  }

  // 2. Check description for npub pattern
  if (transaction.description) {
    const npubMatch = transaction.description.match(/npub1[a-zA-Z0-9]{58}/)
    if (npubMatch) return npubMatch[0]
  }

  // 3. Use payment_request or payment_hash as identifier
  if (transaction.payment_request) {
    // Extract first 20 chars as identifier
    return transaction.payment_request.substring(0, 20)
  }

  if (transaction.payment_hash) {
    return transaction.payment_hash.substring(0, 20)
  }

  // 4. Fallback to description
  return (transaction.description || transaction.memo || '').trim()
}

/**
 * Create a transaction group object
 * @param {Array} transactions - Array of transactions to group
 * @returns {Object} Group object
 */
export function createTransactionGroup(transactions) {
  if (!transactions || transactions.length === 0) {
    throw new Error('Cannot create group from empty transactions')
  }

  // Calculate total amount (handle both positive and negative)
  const totalAmount = transactions.reduce((sum, tx) => {
    const amount = Math.abs(tx.amount || 0)
    return sum + amount
  }, 0)

  // Get time range
  const times = transactions.map(tx => tx.settled_at).filter(t => t)
  const startTime = Math.min(...times)
  const endTime = Math.max(...times)

  // Get recipient/description for display
  const recipient = extractRecipient(transactions[0])
  const description = transactions[0].description || transactions[0].memo || ''

  // Generate unique group ID
  const groupId = `group-${startTime}-${endTime}-${transactions.length}`

  return {
    id: groupId,
    type: 'group',
    transactionType: transactions[0].type, // 'incoming' or 'outgoing'
    transactions: transactions,
    count: transactions.length,
    totalAmount: totalAmount,
    firstTransaction: transactions[0],
    lastTransaction: transactions[transactions.length - 1],
    recipient: recipient,
    description: description,
    startTime: startTime,
    endTime: endTime,
    settled_at: endTime, // Use endTime for sorting
    // Add display properties
    isGroup: true,
    expanded: false // For UI state (groups start collapsed per user requirement)
  }
}

/**
 * Toggle group expanded state
 * @param {Object} group - Group object
 * @returns {Object} Updated group
 */
export function toggleGroupExpanded(group) {
  if (group.type !== 'group') return group
  return {
    ...group,
    expanded: !group.expanded
  }
}

/**
 * Get summary text for a group
 * @param {Object} group - Group object
 * @returns {string} Summary text
 */
export function getGroupSummary(group) {
  if (group.type !== 'group') return ''

  const count = group.count
  const action = group.transactionType === 'incoming' ? 'from' : 'to'

  // Try to extract a nice name
  let recipientName = group.recipient

  // If recipient is a hash, use description instead
  if (recipientName && recipientName.length > 20) {
    recipientName = group.description || 'unknown'
  }

  // Truncate if too long
  if (recipientName.length > 30) {
    recipientName = recipientName.substring(0, 27) + '...'
  }

  return `${count} payment${count > 1 ? 's' : ''} ${action} ${recipientName || 'unknown'}`
}

/**
 * Check if a transaction can be grouped (not already part of a group)
 * @param {Object} item - Transaction or group object
 * @returns {boolean} True if can be grouped
 */
export function canBeGrouped(item) {
  return item && item.type !== 'group'
}

// Export configuration for external access
export { DEFAULT_GROUPING_OPTIONS }

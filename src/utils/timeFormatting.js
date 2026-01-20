/**
 * Time Formatting Utilities
 * Format timestamps into human-readable relative times
 * Following Bitcoin Design Guide patterns
 */

/**
 * Format timestamp into relative time
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted relative time
 */
export function formatRelativeTime(timestamp) {
  if (!timestamp) return ''

  const now = Math.floor(Date.now() / 1000)
  const diff = now - timestamp

  // Just now (< 1 minute)
  if (diff < 60) {
    return 'just now'
  }

  // Minutes ago (< 1 hour)
  if (diff < 3600) {
    const mins = Math.floor(diff / 60)
    return `${mins} minute${mins > 1 ? 's' : ''} ago`
  }

  // Hours ago (today, within 24 hours from start of day)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartSeconds = Math.floor(todayStart.getTime() / 1000)

  if (timestamp >= todayStartSeconds) {
    const hours = Math.floor(diff / 3600)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  }

  // Yesterday
  const yesterdayStart = todayStartSeconds - 86400
  if (timestamp >= yesterdayStart) {
    return 'yesterday'
  }

  // This week (within last 7 days)
  const weekAgo = todayStartSeconds - (7 * 86400)
  if (timestamp >= weekAgo) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const date = new Date(timestamp * 1000)
    return days[date.getDay()]
  }

  // This year (show month and day)
  const thisYear = new Date().getFullYear()
  const txDate = new Date(timestamp * 1000)
  const txYear = txDate.getFullYear()

  if (txYear === thisYear) {
    return txDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric'
    }) // e.g., "April 12"
  }

  // Older (show full date with year)
  return txDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }) // e.g., "April 12, 2021"
}

/**
 * Format timestamp into short time format (HH:MM)
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted time (e.g., "14:30")
 */
export function formatShortTime(timestamp) {
  if (!timestamp) return ''

  const date = new Date(timestamp * 1000)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/**
 * Format timestamp into full date and time
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted date and time
 */
export function formatFullDateTime(timestamp) {
  if (!timestamp) return ''

  const date = new Date(timestamp * 1000)
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}

/**
 * Format timestamp into date only
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Formatted date (e.g., "April 12, 2021")
 */
export function formatDate(timestamp) {
  if (!timestamp) return ''

  const date = new Date(timestamp * 1000)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

/**
 * Check if timestamp is today
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if timestamp is today
 */
export function isToday(timestamp) {
  if (!timestamp) return false

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartSeconds = Math.floor(todayStart.getTime() / 1000)

  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)
  const todayEndSeconds = Math.floor(todayEnd.getTime() / 1000)

  return timestamp >= todayStartSeconds && timestamp <= todayEndSeconds
}

/**
 * Check if timestamp is yesterday
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if timestamp is yesterday
 */
export function isYesterday(timestamp) {
  if (!timestamp) return false

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartSeconds = Math.floor(todayStart.getTime() / 1000)

  const yesterdayStart = todayStartSeconds - 86400
  return timestamp >= yesterdayStart && timestamp < todayStartSeconds
}

/**
 * Check if timestamp is within the last 7 days
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {boolean} True if timestamp is within last week
 */
export function isThisWeek(timestamp) {
  if (!timestamp) return false

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayStartSeconds = Math.floor(todayStart.getTime() / 1000)

  const weekAgo = todayStartSeconds - (7 * 86400)
  return timestamp >= weekAgo
}

/**
 * Get time range label for grouping
 * @param {number} startTime - Start timestamp in seconds
 * @param {number} endTime - End timestamp in seconds
 * @returns {string} Formatted time range
 */
export function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return ''

  const startRelative = formatRelativeTime(startTime)
  const endRelative = formatRelativeTime(endTime)

  // If same day, just show the day once
  if (startRelative === endRelative) {
    return startRelative
  }

  // If both are time-based (hours/minutes ago), show range with times
  if (startRelative.includes('ago') && endRelative.includes('ago')) {
    return `${formatShortTime(startTime)} - ${formatShortTime(endTime)}`
  }

  // Otherwise show full range
  return `${startRelative} - ${endRelative}`
}

/**
 * Format duration between two timestamps
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
export function formatDuration(seconds) {
  if (!seconds || seconds < 0) return '0s'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`
  }
  return `${secs}s`
}

/**
 * Format timestamp into human-readable date and time
 * Shows context-aware date with time
 * @param {number} timestamp - Unix timestamp in seconds
 * @returns {string} Human-readable date and time (e.g., "Today at 14:30", "Jan 15 at 03:59")
 */
export function formatHumanDateTime(timestamp) {
  if (!timestamp) return ''

  const date = new Date(timestamp * 1000)
  const time = date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  // Check if today
  if (isToday(timestamp)) {
    return `Today at ${time}`
  }

  // Check if yesterday
  if (isYesterday(timestamp)) {
    return `Yesterday at ${time}`
  }

  // Check if this year
  const thisYear = new Date().getFullYear()
  const txYear = date.getFullYear()

  if (txYear === thisYear) {
    // Same year: show "Jan 15 at 14:30"
    const monthDay = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    })
    return `${monthDay} at ${time}`
  }

  // Different year: show "Jan 15, 2025 at 14:30"
  const fullDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  return `${fullDate} at ${time}`
}

/**
 * Fiat Rates Service
 * Handles fetching and caching of Bitcoin fiat exchange rates from Mempool API
 */

export class FiatRatesService {
  constructor() {
    this.defaultApiUrl = 'https://mempool.space/api/v1';
    this.customApiUrl = null;
    this.rates = {};
    this.lastUpdate = null;
    this.updateInterval = 5 * 60 * 1000; // 5 minutes
    this.maxCacheAge = 60 * 60 * 1000; // 1 hour - max age for cached rates
    this.storageKey = 'buhoGO_fiat_rates';
    this.settingsKey = 'buhoGO_mempool_settings';
    this.ratesAvailable = false;
    this.lastError = null;

    this.loadSettings();
    this.loadCachedRates();
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const settings = localStorage.getItem(this.settingsKey);
      if (settings) {
        const parsed = JSON.parse(settings);
        this.customApiUrl = parsed.customMempoolUrl || null;
      }
    } catch (error) {
      console.error('Error loading mempool settings:', error);
    }
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    try {
      const settings = {
        customMempoolUrl: this.customApiUrl
      };
      localStorage.setItem(this.settingsKey, JSON.stringify(settings));
    } catch (error) {
      console.error('Error saving mempool settings:', error);
    }
  }

  /**
   * Set custom Mempool API URL
   */
  setCustomApiUrl(url) {
    if (url && !url.endsWith('/')) {
      url += '/';
    }
    this.customApiUrl = url;
    this.saveSettings();
  }

  /**
   * Get the current API URL
   */
  getApiUrl() {
    return this.customApiUrl || this.defaultApiUrl;
  }

  /**
   * Load cached rates from localStorage
   * Only use cached rates if they're less than maxCacheAge old
   */
  loadCachedRates() {
    try {
      const cached = localStorage.getItem(this.storageKey);
      if (cached) {
        const data = JSON.parse(cached);
        this.lastUpdate = data.lastUpdate ? new Date(data.lastUpdate) : null;

        // Check if cached rates are still valid (not too old)
        if (this.lastUpdate && this.isCacheValid()) {
          this.rates = data.rates || {};
          this.ratesAvailable = Object.keys(this.rates).length > 0;
          console.log('📦 Loaded cached rates from', this.lastUpdate.toISOString());
        } else {
          // Cache is too old, clear it
          this.rates = {};
          this.ratesAvailable = false;
          console.log('⚠️ Cached rates expired, need fresh data');
        }
      }
    } catch (error) {
      console.error('Error loading cached rates:', error);
      this.rates = {};
      this.lastUpdate = null;
      this.ratesAvailable = false;
    }
  }

  /**
   * Check if cache is still valid (less than maxCacheAge old)
   */
  isCacheValid() {
    if (!this.lastUpdate) return false;
    const now = new Date();
    return (now - this.lastUpdate) < this.maxCacheAge;
  }

  /**
   * Save rates to localStorage
   */
  saveCachedRates() {
    try {
      const data = {
        rates: this.rates,
        lastUpdate: this.lastUpdate ? this.lastUpdate.toISOString() : null
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Error saving cached rates:', error);
    }
  }

  /**
   * Check if rates need updating
   */
  needsUpdate() {
    if (!this.lastUpdate) return true;
    const now = new Date();
    return (now - this.lastUpdate) > this.updateInterval;
  }

  /**
   * Fetch latest fiat rates from Mempool API
   */
  async fetchLatestRates() {
    const apiUrl = this.getApiUrl();
    this.lastError = null;

    try {
      const response = await fetch(`${apiUrl}/prices`, {
        timeout: 10000 // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Validate response structure
      if (!data || typeof data !== 'object' || !data.USD) {
        throw new Error('Invalid response format from Mempool API');
      }

      // Convert to our expected format (rates per BTC)
      this.rates = {
        USD: data.USD || 0,
        EUR: data.EUR || 0,
        GBP: data.GBP || 0,
        CAD: data.CAD || 0,
        CHF: data.CHF || 0,
        AUD: data.AUD || 0,
        JPY: data.JPY || 0,
        time: data.time || Math.floor(Date.now() / 1000)
      };

      this.lastUpdate = new Date();
      this.ratesAvailable = true;
      this.lastError = null;
      this.saveCachedRates();

      console.log('✅ Fiat rates updated:', this.rates);
      return this.rates;

    } catch (error) {
      console.error('❌ Error fetching fiat rates:', error);
      this.lastError = error.message;

      // If we have valid cached rates, use them
      if (this.isCacheValid() && Object.keys(this.rates).length > 0) {
        console.log('📦 Using cached rates due to fetch error');
        this.ratesAvailable = true;
        return this.rates;
      }

      this.ratesAvailable = false;
      return null;
    }
  }

  /**
   * Get current rates (fetch if needed)
   */
  async getRates() {
    if (this.needsUpdate()) {
      await this.fetchLatestRates();
    }
    return this.rates;
  }

  /**
   * Ensure rates are loaded (alias for getRates)
   */
  async ensureRatesLoaded() {
    return await this.getRates();
  }

  /**
   * Get rate for specific currency
   * Returns null if rates are unavailable
   */
  async getRate(currency) {
    const rates = await this.getRates();
    if (!rates || !this.ratesAvailable) return null;
    return rates[currency.toUpperCase()] || null;
  }

  /**
   * Check if rates are available
   */
  areRatesAvailable() {
    return this.ratesAvailable && Object.keys(this.rates).length > 0;
  }

  /**
   * Get the last error message
   */
  getLastError() {
    return this.lastError;
  }

  /**
   * Convert satoshis to fiat
   * Returns null if rates are unavailable
   */
  async convertSatsToFiat(sats, currency = 'USD') {
    const rate = await this.getRate(currency);
    if (rate === null) return null;
    const btc = sats / 100000000; // Convert sats to BTC
    return btc * rate;
  }

  /**
   * Synchronous conversion - returns null if rates unavailable
   */
  convertSatsToFiatSync(sats, currency = 'USD') {
    if (!this.ratesAvailable) return null;
    const rate = this.rates[currency.toUpperCase()];
    if (!rate) return null;
    const btc = sats / 100000000; // Convert sats to BTC
    return btc * rate;
  }

  /**
   * Convert fiat to satoshis
   * Returns null if rates are unavailable
   */
  async convertFiatToSats(fiatAmount, currency) {
    const rate = await this.getRate(currency);
    if (!rate) return null;

    const btc = fiatAmount / rate;
    return Math.floor(btc * 100000000); // Convert BTC to sats
  }

  /**
   * Format fiat amount with currency symbol
   */
  formatFiatAmount(amount, currency) {
    const symbols = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      CAD: 'C$',
      CHF: 'CHF ',
      AUD: 'A$',
      JPY: '¥'
    };
    
    const symbol = symbols[currency.toUpperCase()] || currency.toUpperCase() + ' ';
    
    // Format based on currency
    if (currency.toUpperCase() === 'JPY') {
      return symbol + Math.round(amount).toLocaleString();
    } else {
      return symbol + amount.toFixed(2);
    }
  }

  /**
   * Get historical price for a specific timestamp
   */
  async getHistoricalPrice(currency, timestamp) {
    const apiUrl = this.getApiUrl();
    
    try {
      const response = await fetch(`${apiUrl}/historical-price?currency=${currency.toUpperCase()}&timestamp=${timestamp}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      return data.prices?.[0]?.USD || 0; // Mempool API returns USD equivalent
      
    } catch (error) {
      console.error('Error fetching historical price:', error);
      return 0;
    }
  }

  /**
   * Start automatic rate updates
   */
  startAutoUpdate() {
    // Initial fetch
    this.fetchLatestRates();
    
    // Set up interval for updates
    this.updateIntervalId = setInterval(() => {
      this.fetchLatestRates();
    }, this.updateInterval);
  }

  /**
   * Stop automatic rate updates
   */
  stopAutoUpdate() {
    if (this.updateIntervalId) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
  }

  /**
   * Get rate age in minutes
   */
  getRateAge() {
    if (!this.lastUpdate) return null;
    const now = new Date();
    return Math.floor((now - this.lastUpdate) / (1000 * 60));
  }

  /**
   * Check if rates are stale
   */
  areRatesStale() {
    const age = this.getRateAge();
    return age === null || age > 10; // Consider stale after 10 minutes
  }
}

// Create singleton instance
export const fiatRatesService = new FiatRatesService();

// Auto-start updates
fiatRatesService.startAutoUpdate();

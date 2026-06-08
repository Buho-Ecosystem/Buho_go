import { defineStore } from 'pinia'

/**
 * nadanada purchases store.
 *
 * nadanada sells privacy products with NO account, so the device-local
 * record created here is the ONLY proof a user has of what they bought:
 * the eSIM install QR/codes and the WireGuard config (including its
 * locally-generated private key). Persisted to localStorage so it survives
 * across sessions; lost on uninstall, which we mitigate by also keeping the
 * order references for the nadanada `/order?uuid=` lookup.
 *
 * Synchronous storage keeps getters reactive without async plumbing, matching
 * the other lightweight stores (mapFavorites, bitcoinPreferences).
 */
const STORAGE_KEY = 'buhoGO_nadanada_purchases_v1'

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const obj = raw ? JSON.parse(raw) : null
    return {
      esims: Array.isArray(obj?.esims) ? obj.esims : [],
      vpns: Array.isArray(obj?.vpns) ? obj.vpns : [],
    }
  } catch {
    return { esims: [], vpns: [] }
  }
}

export const useNadanadaPurchasesStore = defineStore('nadanadaPurchases', {
  state: () => {
    const persisted = load()
    return {
      esims: persisted.esims,
      vpns: persisted.vpns,
    }
  },

  getters: {
    esimCount: (state) => state.esims.length,
    vpnCount: (state) => state.vpns.length,
    totalCount: (state) => state.esims.length + state.vpns.length,
    hasPurchases: (state) => state.esims.length > 0 || state.vpns.length > 0,
    /** Predicate so templates can do `hasEsim(iccid)`. */
    hasEsim: (state) => (iccid) => state.esims.some((e) => e.iccid === iccid),
  },

  actions: {
    /**
     * Record a freshly purchased eSIM. Keyed by ICCID; a repeat completion
     * (idempotent server response) updates the existing record rather than
     * duplicating it. `purchasedAt` is stamped by the caller (stores must
     * not call Date.now() during SSR/hydration paths elsewhere, but this is
     * a user action so the caller passes it through).
     *
     * @param {{
     *   iccid: string, bundleName: string, orderReference?: string,
     *   countryName?: string, flag?: string, slug?: string,
     *   dataInGB?: number, durationInDays?: number, priceUsd?: number,
     *   installation: object, purchasedAt: number,
     * }} esim
     */
    addEsim(esim) {
      if (!esim?.iccid) return
      const i = this.esims.findIndex((e) => e.iccid === esim.iccid)
      const record = { ...esim }
      if (i >= 0) this.esims.splice(i, 1, { ...this.esims[i], ...record })
      else this.esims.unshift(record)
      this._persist()
    },

    /** Cache the latest live status/usage for an eSIM (from fetchEsimStatus). */
    updateEsimStatus(iccid, status) {
      const i = this.esims.findIndex((e) => e.iccid === iccid)
      if (i < 0) return
      this.esims.splice(i, 1, { ...this.esims[i], status, statusFetchedAt: Date.now() })
      this._persist()
    },

    removeEsim(iccid) {
      const i = this.esims.findIndex((e) => e.iccid === iccid)
      if (i < 0) return
      this.esims.splice(i, 1)
      this._persist()
    },

    /**
     * Record a freshly purchased VPN subscription. Keyed by publicKey. The
     * config + private key are stored so the user can re-display the QR or
     * download the .conf later. `id` is the publicKey (unique per purchase).
     *
     * @param {{
     *   publicKey: string, privateKey: string, presharedKey?: string,
     *   config: string, country: string, countryName?: string, flag?: string,
     *   durationLabel?: string, priceUsd?: number, serverUrl?: string,
     *   expiryDate?: string|null, purchasedAt: number,
     * }} vpn
     */
    addVpn(vpn) {
      if (!vpn?.publicKey) return
      const i = this.vpns.findIndex((v) => v.publicKey === vpn.publicKey)
      const record = { id: vpn.publicKey, ...vpn }
      if (i >= 0) this.vpns.splice(i, 1, { ...this.vpns[i], ...record })
      else this.vpns.unshift(record)
      this._persist()
    },

    updateVpnStatus(publicKey, status) {
      const i = this.vpns.findIndex((v) => v.publicKey === publicKey)
      if (i < 0) return
      this.vpns.splice(i, 1, { ...this.vpns[i], status, statusFetchedAt: Date.now() })
      this._persist()
    },

    removeVpn(publicKey) {
      const i = this.vpns.findIndex((v) => v.publicKey === publicKey)
      if (i < 0) return
      this.vpns.splice(i, 1)
      this._persist()
    },

    _persist() {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ esims: this.esims, vpns: this.vpns }),
        )
      } catch {
        // Quota / unavailable storage: keep the in-memory copy for the session.
      }
    },
  },
})

<template>
  <div class="scan-pane">
    <p
      class="scan-lede"
      :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
    >
      {{ $t('Point your camera at a Nostr profile QR code.') }}
    </p>

    <!-- Camera frame. The <video> element is mounted via v-if (not
         v-show) so qr-scanner attaches to a fresh node and never has
         to fight a display:none style — same pattern AddSiteSheet
         and SendModal use, so the scanner lifecycle matches the rest
         of the app. -->
    <div
      class="scan-frame"
      :class="$q.dark.isActive ? 'scan-frame-dark' : 'scan-frame-light'"
    >
      <video
        v-if="showCamera && !cameraError && !resolved"
        ref="videoEl"
        class="scan-video"
        playsinline
      />

      <div
        v-if="!showCamera && !cameraError && !resolved"
        class="scan-overlay"
      >
        <q-spinner-dots size="36px" color="grey-6" />
      </div>

      <div
        v-if="cameraError"
        class="scan-overlay scan-error"
        :class="$q.dark.isActive ? 'text-grey-4' : 'text-grey-7'"
      >
        <Icon icon="tabler:camera-off" width="28" height="28" />
        <p>{{ cameraError }}</p>
      </div>

      <!-- Result overlay sits inside the same frame so the layout
           doesn't jump when a code is decoded. -->
      <div v-if="resolved" class="scan-result-overlay">
        <div
          v-if="!profileEvent && !resultError"
          class="scan-status scan-status--progress"
        >
          <q-spinner size="20px" />
          <span>{{ $t('Looking up the profile…') }}</span>
        </div>
        <div
          v-else-if="resultError"
          class="scan-status scan-status--error"
        >
          <Icon icon="tabler:alert-circle" width="20" height="20" />
          <span>{{ resultError }}</span>
        </div>
      </div>
    </div>

    <NostrContactPreview
      v-if="resolved && profileEvent"
      class="scan-preview"
      :pubkey="resolved.pubkey"
      :npub="resolved.npub"
      :profile="parsedProfile"
      :nip05-verified="null"
      :existing-entry="existingEntry"
      :saving="isSaving"
      @save="onSave"
      @open-existing="onOpenExisting"
      @copy-npub="onCopyNpub"
    />

    <!-- Footer actions. "Scan again" only shows after we've stopped
         the scanner; "Paste instead" is always offered as the escape
         hatch (the parent tab control reuses it to flip to Search). -->
    <div class="scan-actions">
      <button
        v-if="resolved"
        type="button"
        class="scan-secondary-btn"
        @click="restart"
      >
        <Icon icon="tabler:refresh" width="14" height="14" />
        <span>{{ $t('Scan again') }}</span>
      </button>
      <button
        v-else
        type="button"
        class="scan-secondary-btn"
        @click="$emit('switch-to-search')"
      >
        <Icon icon="tabler:keyboard" width="14" height="14" />
        <span>{{ $t('Paste instead') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import QrScanner from 'qr-scanner';
import { createQrScanner } from '../../utils/qrScanner';
import { useAddressBookStore } from '../../stores/addressBook';
import { mapActions } from 'pinia';
import { classifyIdentifier, lookupIdentifier } from '../../utils/nostrLookup.js';
import { fetchProfile, parseProfileContent } from '../../utils/nostrFetch.js';
import { copyToClipboard } from 'quasar';
import NostrContactPreview from './NostrContactPreview.vue';

export default {
  name: 'AddContactScan',

  components: { Icon, NostrContactPreview },

  props: {
    /**
     * The Scan tab owns hardware (camera). The parent toggles
     * `active` based on which tab is selected so the stream only
     * runs while the user is looking at it. The same prop drives
     * teardown when the parent dialog closes.
     */
    active: { type: Boolean, default: false },
  },

  emits: ['saved', 'open-existing', 'switch-to-search'],

  data() {
    return {
      showCamera: false,
      cameraError: '',
      qrScanner: null,
      detected: false,
      // Result state mirrors AddContactSearch so the preview can
      // render identically regardless of how we got here.
      resolved: null,
      profileEvent: null,
      resultError: '',
      isSaving: false,
      currentToken: 0,
    };
  },

  computed: {
    parsedProfile() {
      return this.profileEvent ? parseProfileContent(this.profileEvent) : {};
    },

    existingEntry() {
      if (!this.resolved) return null;
      const store = useAddressBookStore();
      return store.findContactByPubkey(this.resolved.pubkey);
    },
  },

  watch: {
    active(isActive) {
      if (isActive) this.startCamera();
      else this.teardown();
    },
  },

  mounted() {
    if (this.active) this.startCamera();
  },

  beforeUnmount() {
    this.teardown();
  },

  methods: {
    ...mapActions(useAddressBookStore, ['addNostrContact']),

    async startCamera() {
      this.resetResult();
      this.cameraError = '';
      try {
        const hasCamera = await QrScanner.hasCamera();
        if (!hasCamera) {
          this.cameraError = this.$t('No camera found on this device.');
          return;
        }
        this.showCamera = true;
        await this.$nextTick();
        await this.startQrScanner();
      } catch (error) {
        console.error('[AddContactScan] camera init error:', error);
        this.handleCameraError(error);
      }
    },

    async startQrScanner() {
      try {
        const videoEl = this.$refs.videoEl;
        if (!videoEl) throw new Error('Video element not found');

        this.qrScanner = createQrScanner(
          videoEl,
          (result) => {
            const text = typeof result === 'string' ? result : (result?.data || result?.text || '');
            this.onDetect(text);
          },
          {
            returnDetailedScanResult: true,
            highlightScanRegion: true,
            highlightCodeOutline: true,
            preferredCamera: 'environment',
          },
        );
        await this.qrScanner.start();
      } catch (err) {
        console.error('[AddContactScan] start error:', err);
        this.handleCameraError(err);
      }
    },

    handleCameraError(error) {
      if (error?.name === 'NotAllowedError') {
        this.cameraError = this.$t('Camera permission denied. Allow access in settings or paste an identifier instead.');
      } else if (error?.name === 'NotFoundError') {
        this.cameraError = this.$t('No camera found on this device.');
      } else if (error?.name === 'NotSupportedError' || /secure context|https/i.test(error?.message || '')) {
        this.cameraError = this.$t('Camera needs a secure connection. Paste an identifier instead.');
      } else {
        this.cameraError = this.$t("Couldn't open the camera. Try pasting an identifier instead.");
      }
      this.showCamera = false;
    },

    stopScanner() {
      if (this.qrScanner) {
        try {
          this.qrScanner.stop();
          this.qrScanner.destroy();
        } catch { /* already torn down */ }
        this.qrScanner = null;
      }
    },

    teardown() {
      this.stopScanner();
      this.showCamera = false;
      this.detected = false;
      this.resetResult();
    },

    resetResult() {
      this.resolved = null;
      this.profileEvent = null;
      this.resultError = '';
    },

    async restart() {
      this.detected = false;
      this.resetResult();
      await this.startCamera();
    },

    /**
     * Pre-filter QR payloads before paying for a relay round-trip.
     * Reject anything that doesn't classify as a Nostr identifier —
     * Lightning invoices, Bitcoin addresses, plain URLs all belong
     * elsewhere and would only produce a confusing "no profile
     * found" failure for the user.
     */
    onDetect(text) {
      if (this.detected || !text) return;
      const kind = classifyIdentifier(text);
      if (!kind || kind === 'nip05') {
        // NIP-05 in a QR is theoretically possible but vanishingly
        // rare — and rejecting them here means we can keep the
        // status copy unambiguous ("scan a Nostr profile").
        return;
      }
      this.detected = true;
      this.stopScanner();
      this.showCamera = false;
      this.resolveAndFetch(text);
    },

    async resolveAndFetch(text) {
      this.currentToken += 1;
      const token = this.currentToken;
      this.resetResult();

      try {
        const result = await lookupIdentifier(text);
        if (token !== this.currentToken) return;
        this.resolved = result;
      } catch (err) {
        if (token !== this.currentToken) return;
        this.resultError = this.$t('That QR code is not a Nostr identifier.');
        console.warn('[AddContactScan] lookup failed:', err);
        return;
      }

      const store = useAddressBookStore();
      const existing = store.findContactByPubkey(this.resolved.pubkey);
      if (existing) {
        // Render from the stored snapshot so the existing-state
        // preview can fire without a network hit.
        this.profileEvent = existing.nostr_event || {
          kind: 0,
          pubkey: this.resolved.pubkey,
          content: JSON.stringify(existing.nostr_profile || {}),
          created_at: 0,
          tags: [],
        };
        return;
      }

      try {
        const opts = {};
        if (Array.isArray(this.resolved.relays) && this.resolved.relays.length > 0) {
          opts.relays = this.resolved.relays;
        }
        const event = await fetchProfile(this.resolved.pubkey, opts);
        if (token !== this.currentToken) return;
        if (!event) {
          this.resultError = this.$t("We couldn't find a Nostr profile for this identifier yet.");
          return;
        }
        this.profileEvent = event;
      } catch (err) {
        if (token !== this.currentToken) return;
        this.resultError = this.$t('Something went wrong. Please try again.');
        console.warn('[AddContactScan] fetch failed:', err);
      }
    },

    async onSave() {
      if (!this.resolved || !this.profileEvent || this.isSaving) return;
      this.isSaving = true;
      try {
        await this.addNostrContact({
          pubkey: this.resolved.pubkey,
          npub: this.resolved.npub,
          event: this.profileEvent,
          relayHints: this.resolved.relays || [],
        });
        this.$q.notify({
          type: 'positive',
          message: this.$t('Contact added'),
        });
        this.$emit('saved');
        this.teardown();
      } catch (err) {
        const msg = err?.message || '';
        if (msg.includes('Lightning address')) {
          this.$q.notify({
            type: 'negative',
            message: this.$t('No Lightning address'),
            caption: this.$t('This profile cannot receive payments yet.'),
            timeout: 4000,
          });
        } else if (msg.includes('already')) {
          this.$q.notify({
            type: 'warning',
            message: this.$t('Already in your address book'),
            timeout: 3000,
          });
        } else {
          this.$q.notify({
            type: 'negative',
            message: this.$t("Couldn't save contact"),
            caption: msg || this.$t('Please try again'),
            timeout: 4000,
          });
        }
      } finally {
        this.isSaving = false;
      }
    },

    onOpenExisting(entry) {
      this.$emit('open-existing', entry);
    },

    async onCopyNpub(npub) {
      try {
        await copyToClipboard(npub);
        this.$q.notify({
          type: 'positive',
          message: this.$t('Copied'),
          timeout: 1500,
        });
      } catch {
        this.$q.notify({
          type: 'negative',
          message: this.$t("Couldn't copy"),
          timeout: 2000,
        });
      }
    },
  },
};
</script>

<style scoped>
.scan-pane {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.scan-lede {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  line-height: 1.4;
  margin: 0;
}

.scan-frame {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  max-height: 320px;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: rgba(0, 0, 0, 0.05);
  border: 1px solid var(--border-card);
}

.scan-frame-dark {
  background: #0C0C0C;
}

.scan-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.scan-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  text-align: center;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
}

.scan-error p {
  margin: 0;
  max-width: 240px;
  line-height: 1.4;
}

.scan-result-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
}

.scan-status {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
}

.scan-status--error {
  color: #FFCFB5;
}

.scan-preview {
  margin-top: 0.25rem;
}

.scan-actions {
  display: flex;
  justify-content: center;
}

.scan-secondary-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.9rem;
  border-radius: var(--radius-pill);
  background: transparent;
  border: 1px solid var(--border-card);
  color: var(--text-secondary);
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.scan-secondary-btn:hover {
  background: rgba(120, 120, 120, 0.06);
}
</style>

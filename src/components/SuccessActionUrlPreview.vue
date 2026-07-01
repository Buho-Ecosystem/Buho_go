<!--
  SuccessActionUrlPreview
  -----------------------
  Renders a LUD-09 `url` successAction INLINE, never opening an external
  browser. It fetches the target (CapacitorHttp on native, fetch on web) and
  shows an image or text preview when it can; otherwise it falls back to the
  host + a Copy-link action so the user can open it themselves.

  The url is already domain-validated against the LNURL callback upstream
  (parseSuccessAction), so it only ever points at the same service just paid.
  Shared by the success screen (PaymentConfirmation) and Transaction Details.
-->
<template>
  <div class="sa-url-preview">
    <div v-if="state === 'loading'" class="sa-url-media sa-url-loading">
      <q-spinner size="22px" :color="$q.dark.isActive ? 'grey-5' : 'grey-7'" />
    </div>

    <img
      v-else-if="state === 'image'"
      :src="url"
      class="sa-url-media sa-url-image"
      alt=""
      @error="state = 'link'"
    />

    <div
      v-else-if="state === 'text'"
      class="sa-url-media sa-url-text"
      :class="$q.dark.isActive ? 'sa-url-text-dark' : 'sa-url-text-light'"
    >{{ previewText }}</div>

    <div class="sa-url-foot">
      <span
        class="sa-url-host"
        :class="$q.dark.isActive ? 'text-grey-5' : 'text-grey-6'"
      >{{ host }}</span>
      <q-btn
        flat
        no-caps
        dense
        class="sa-url-copy"
        :class="$q.dark.isActive ? 'sa-url-copy-dark' : 'sa-url-copy-light'"
        @click="copyUrl"
      >
        <Icon icon="tabler:copy" width="15" height="15" class="q-mr-xs" />
        {{ $t('Copy link') }}
      </q-btn>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import { fetchSuccessActionPreview } from '../utils/successActionPreview.js';

export default {
  name: 'SuccessActionUrlPreview',
  components: { Icon },
  props: {
    url: { type: String, required: true },
  },
  data() {
    return {
      // 'loading' | 'image' | 'text' | 'link'
      state: 'loading',
      previewText: '',
    };
  },
  computed: {
    host() {
      try {
        return new URL(this.url).host;
      } catch {
        return this.url;
      }
    },
  },
  watch: {
    url: 'load',
  },
  mounted() {
    this.load();
  },
  methods: {
    async load() {
      this.state = 'loading';
      this.previewText = '';
      const result = await fetchSuccessActionPreview(this.url);
      if (result.kind === 'image') {
        this.state = 'image';
      } else if (result.kind === 'text' && result.text) {
        this.previewText = result.text;
        this.state = 'text';
      } else {
        // webpage / unknown / error → just offer the host + Copy link.
        this.state = 'link';
      }
    },
    async copyUrl() {
      try {
        await navigator.clipboard.writeText(this.url);
        this.$q.notify({ type: 'positive', message: this.$t('Copied') });
      } catch {
        this.$q.notify({ type: 'negative', message: this.$t("Couldn't copy") });
      }
    },
  },
};
</script>

<style scoped>
.sa-url-preview {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  align-items: stretch;
}

.sa-url-media {
  width: 100%;
  border-radius: 10px;
  overflow: hidden;
}

.sa-url-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem 0;
}

.sa-url-image {
  display: block;
  max-height: 240px;
  object-fit: contain;
  background: rgba(127, 127, 127, 0.08);
}

.sa-url-text {
  font-family: 'SF Mono', ui-monospace, 'Roboto Mono', monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  padding: 0.625rem 0.75rem;
  text-align: left;
}

.sa-url-text-dark {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.85);
}

.sa-url-text-light {
  background: rgba(0, 0, 0, 0.04);
  color: var(--text-primary);
}

.sa-url-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.sa-url-host {
  font-family: 'Manrope', sans-serif;
  font-size: 12px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sa-url-copy {
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
}

.sa-url-copy-dark { color: #fff; }
.sa-url-copy-light { color: var(--text-primary); }
</style>

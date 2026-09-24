<template>
  <!--
    A NIP-05 address, written the way the Nostr Design Guide shows it: the
    full `name@domain`, with the domain emphasised, because the domain is
    what tells two people with the same name apart. The optional mark is
    the filled verified badge people know from other social apps (owner's
    call, 2026-09-24); callers only pass it for an address confirmed to
    point at the person's key.

    A free `name.123456` handle on our own domain renders nothing.
  -->
  <span v-if="parts" class="nostr-address">
    <Icon
      v-if="check"
      icon="tabler:rosette-discount-check-filled"
      :width="iconSize"
      :height="iconSize"
      class="nostr-address-check"
      aria-hidden="true"
    />
    <span class="nostr-address-text"><span
      v-if="parts.local"
      class="nostr-address-local"
    >{{ parts.local }}@</span><span class="nostr-address-domain">{{ parts.domain }}</span></span>
  </span>
</template>

<script>
import { Icon } from '@iconify/vue';
import { formatUsername } from '../../services/nip05';

export default {
  name: 'NostrAddress',

  components: { Icon },

  props: {
    /** A NIP-05 value, e.g. `maria@mybuho.de`. */
    address: { type: String, default: '' },
    /** Show the verified badge in front. Only for a confirmed address. */
    check: { type: Boolean, default: false },
    iconSize: { type: [Number, String], default: 15 },
  },

  computed: {
    parts() {
      return formatUsername(this.address);
    },
  },
};
</script>

<style scoped>
.nostr-address {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
}

.nostr-address-check {
  flex: 0 0 auto;
  color: var(--nostr-address-badge, var(--brand-accent));
}

.nostr-address-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nostr-address-local { font-weight: 500; }
.nostr-address-domain { font-weight: 700; }
</style>

<template>
  <!--
    The identity card.

    The whole redesign rests on this component: an identity a person can see,
    turn over and hand to someone is understood far faster than a page of
    settings. Three things are deliberate here.

      1. Tapping the card flips it to its code. One gesture replaces the two
         competing share sheets the old page had.
      2. Tapping the photo opens the identity switcher, the pattern people
         already know from account switchers. It is the only promotion the
         multi-identity feature needs.
      3. The footer is the only place in the app that reports identity health,
         and it does it in words rather than colour, so there is no amber dot
         anywhere.

    The ring around the photo carries setup progress and goes neutral once it
    completes. A permanent green ring around a face reads as a verification
    badge, which is exactly the claim a username must never make.
  -->
  <div class="id-card-stage" :class="{ 'is-flipped': flipped }">
    <div class="id-card-flipper">
      <!-- Front -->
      <button
        type="button"
        class="id-card-face id-card-front"
        :aria-label="$t('Show my code')"
        @click="flip"
      >
        <span class="id-card-issuer">
          <Icon icon="tabler:shield-check" width="13" height="13" />
          {{ $t('Your BuhoGO card') }}
        </span>

        <span class="id-card-body">
          <!--
            Nested interactive element. It is a span with a click handler
            rather than a button so it stays valid inside the card button,
            and it carries its own role + keyboard handler to remain
            operable.
          -->
          <span
            class="id-card-ring"
            role="button"
            tabindex="0"
            :aria-label="$t('Switch identity')"
            @click.stop="$emit('switch-identity')"
            @keydown.enter.stop="$emit('switch-identity')"
            @keydown.space.prevent.stop="$emit('switch-identity')"
          >
            <svg class="id-card-progress" viewBox="0 0 76 76" aria-hidden="true">
              <circle cx="38" cy="38" r="35" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2.5" />
              <circle
                v-if="!complete"
                cx="38" cy="38" r="35"
                fill="none"
                stroke="#15DE72"
                stroke-width="2.5"
                stroke-linecap="round"
                :stroke-dasharray="RING_LENGTH"
                :stroke-dashoffset="ringOffset"
              />
            </svg>
            <span class="id-card-avatar">
              <img v-if="avatar" :src="avatar" alt="" @error="$emit('avatar-error')" />
              <Icon v-else icon="tabler:user" width="30" height="30" />
            </span>
            <span v-if="canSwitch" class="id-card-swap" aria-hidden="true">
              <Icon icon="tabler:switch-horizontal" width="12" height="12" />
            </span>
          </span>

          <span class="id-card-meta">
            <span class="id-card-name">{{ name }}</span>
            <span v-if="username" class="id-card-handle">{{ '@' + username }}</span>
          </span>
        </span>

        <span class="id-card-foot">
          <span class="id-card-status">
            <Icon :icon="complete ? 'tabler:check' : 'tabler:alert-triangle'" width="13" height="13" />
            {{ status }}
          </span>
          <span class="id-card-flip-btn">
            <Icon icon="tabler:qrcode" width="13" height="13" />
            {{ $t('Code') }}
          </span>
        </span>
      </button>

      <!-- Back. Tapping anywhere turns it over, same as the front, so the
           card behaves like an object rather than a screen with controls. -->
      <button
        type="button"
        class="id-card-face id-card-back"
        :aria-label="$t('Turn back')"
        @click="flip"
      >
        <span class="id-card-qr">
          <vue-qrcode
            v-if="qrValue"
            :value="qrValue"
            :options="qrOptions"
            class="id-card-qr-canvas"
          />
          <span v-else class="id-card-qr-empty"><q-spinner size="22px" color="grey-7" /></span>
          <span v-if="qrValue && avatar" class="id-card-qr-avatar">
            <img :src="avatar" alt="" />
          </span>
        </span>
        <span class="id-card-qr-caption">{{ qrCaption }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import VueQrcode from '@chenfengyuan/vue-qrcode';
import { getQrOptionsWithSize } from '../../utils/qrConfig.js';

/** Circumference of the r=35 progress ring, rounded. */
const RING_LENGTH = 220;

export default {
  name: 'IdentityCard',

  components: { Icon, VueQrcode },

  props: {
    name: { type: String, required: true },
    username: { type: String, default: '' },
    avatar: { type: String, default: '' },
    /** Health line shown in the footer. Already localised by the caller. */
    status: { type: String, required: true },
    /** 0..1 setup progress. 1 turns the ring neutral. */
    progress: { type: Number, default: 1 },
    qrValue: { type: String, default: '' },
    qrCaption: { type: String, default: '' },
    canSwitch: { type: Boolean, default: false },
  },

  emits: ['switch-identity', 'avatar-error', 'flip'],

  data() {
    return {
      flipped: false,
      RING_LENGTH,
    };
  },

  computed: {
    complete() {
      return this.progress >= 1;
    },

    ringOffset() {
      const p = Math.max(0, Math.min(1, this.progress));
      return RING_LENGTH * (1 - p);
    },

    /**
     * The generator's own size is what actually decides the rendered box:
     * vue-qrcode paints at the size it is given and CSS on its root does not
     * reliably scale it. 116 is the card's 130px plate minus its padding.
     */
    qrOptions() {
      return getQrOptionsWithSize(116);
    },
  },

  methods: {
    flip() {
      this.flipped = !this.flipped;
      this.$emit('flip', this.flipped);
    },
  },
};
</script>

<style scoped>
/* The card is the one place in the identity surface with its own palette:
   a dark green field that reads as a printed object rather than a UI
   surface, in both themes. */
.id-card-stage {
  perspective: 1500px;
  margin: 2px 0;
}

/* min-height keeps both faces the same size: the back is absolutely
   positioned, so without it the card would collapse to the front's height
   and the code would spill over the edges. */
.id-card-flipper {
  position: relative;
  min-height: 196px;
  transform-style: preserve-3d;
  transition: transform 0.62s cubic-bezier(0.4, 0.1, 0.2, 1);
}

.id-card-stage.is-flipped .id-card-flipper { transform: rotateY(180deg); }

/* backface-visibility alone is not enough: it is unreliable under headless
   rendering and in a few Android WebViews, where both faces end up painted
   at once. Opacity is the belt to its braces, swapped at the half-way point
   of the flip so the change is never visible. */
.id-card-face {
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  border-radius: 26px;
  width: 100%;
  display: block;
  transition: opacity 0s linear 0.31s;
}

.id-card-stage.is-flipped .id-card-front { opacity: 0; pointer-events: none; }
.id-card-stage:not(.is-flipped) .id-card-back { opacity: 0; pointer-events: none; }

.id-card-front {
  background: linear-gradient(150deg, #12271F, #0B3B2E);
  color: #F3F7F4;
  padding: 19px 20px 17px;
  position: relative;
  overflow: hidden;
  border: 0;
  font-family: 'Manrope', sans-serif;
  text-align: left;
  cursor: pointer;
  box-shadow: 0 22px 46px -26px rgba(0, 0, 0, 0.75);
}

.id-card-front::after {
  content: "";
  position: absolute;
  right: -56px;
  top: -60px;
  width: 200px;
  height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle at 42% 42%, rgba(21, 222, 114, 0.13), transparent 66%);
  pointer-events: none;
}

.id-card-issuer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(243, 247, 244, 0.62);
}

.id-card-body {
  display: flex;
  gap: 14px;
  align-items: center;
  margin-top: 15px;
  position: relative;
  z-index: 2;
}

.id-card-ring {
  position: relative;
  width: 76px;
  height: 76px;
  flex: 0 0 auto;
  display: block;
  cursor: pointer;
}

.id-card-progress {
  position: absolute;
  inset: 0;
  width: 76px;
  height: 76px;
  transform: rotate(-90deg);
}

.id-card-avatar {
  position: absolute;
  inset: 7px;
  border-radius: 50%;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.13);
  color: rgba(255, 255, 255, 0.6);
  display: grid;
  place-items: center;
}

.id-card-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.id-card-swap {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  background: #F3F7F4;
  color: #12271F;
  display: grid;
  place-items: center;
  border: 2.5px solid #12271F;
}

.id-card-meta { min-width: 0; }

.id-card-name {
  display: block;
  font-size: 21px;
  font-weight: 760;
  letter-spacing: -0.03em;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.id-card-handle {
  display: block;
  font-size: 13.5px;
  color: rgba(243, 247, 244, 0.62);
  margin-top: 3px;
  font-family: var(--font-mono);
}

.id-card-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 17px;
  position: relative;
  z-index: 2;
}

.id-card-status {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  color: rgba(243, 247, 244, 0.62);
  min-width: 0;
}

.id-card-flip-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.14);
  color: #F3F7F4;
  border-radius: 999px;
  padding: 9px 14px;
  font-size: 12px;
  font-weight: 650;
  min-height: 36px;
  flex: 0 0 auto;
}

/* Back */
.id-card-back {
  position: absolute;
  inset: 0;
  transform: rotateY(180deg);
  background: var(--bg-card);
  border: 1px solid var(--border-card);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 14px;
  overflow: hidden;
  cursor: pointer;
  font-family: 'Manrope', sans-serif;
}

/* Sized to fit inside the card rather than to be the biggest possible code.
   130px still scans comfortably at arm's length; Get paid carries the large
   one for the across-the-counter case. */
.id-card-qr {
  width: 130px;
  height: 130px;
  border-radius: 16px;
  background: #fff;
  padding: 7px;
  position: relative;
  display: block;
  flex: 0 0 auto;
  box-shadow: 0 12px 26px -18px rgba(0, 0, 0, 0.55);
}

/* Belt and braces: whatever element the QR component renders, keep it inside
   the plate. */
.id-card-qr :deep(img),
.id-card-qr :deep(canvas),
.id-card-qr-canvas { width: 100%; height: 100%; display: block; }

.id-card-qr-empty { width: 100%; height: 100%; display: grid; place-items: center; }

/* Centre occlusion is safe at this size with error-correction level H, and
   it avoids the three corner finder patterns scanners rely on most. */
.id-card-qr-avatar {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 32px;
  height: 32px;
  border-radius: 10px;
  overflow: hidden;
  border: 3px solid #fff;
  display: block;
}

.id-card-qr-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }

.id-card-qr-caption {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  text-align: center;
  max-width: 260px;
  line-height: 1.35;
}


</style>

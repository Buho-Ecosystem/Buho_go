<!--
  SpendMapPreview: the drawn street map on the Spend tab's Bitcoin Map card.
  Decorative only (the card names what it opens). Drawn rather than a photo so
  it stays sharp at any size and follows the theme through its own colours,
  with no brightness tricks: streets, a park and a river, a few orange shop
  pins and the blue "you are here" dot.
-->
<template>
  <svg class="map-preview" viewBox="0 45 360 194" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
    <rect class="map-ground" y="45" width="360" height="194" />
    <rect class="map-park" x="165" y="28" width="74" height="48" rx="12" />
    <path class="map-water" d="M-20 228 C60 196 112 258 184 232 C252 207 300 246 380 218" />
    <g class="map-street">
      <path d="M40 -10 L62 310" />
      <path d="M90 -10 L104 310" />
      <path d="M200 -10 L214 310" />
      <path d="M312 -10 L334 310" />
      <path d="M-10 32 L370 52" />
      <path d="M-10 112 L370 128" />
      <path d="M-10 270 L370 282" />
    </g>
    <g class="map-road">
      <path d="M-10 74 L370 112" />
      <path d="M128 -10 L156 310" />
      <path d="M262 -10 C252 84 284 164 244 310" />
      <path d="M-10 168 C100 156 220 178 370 154" />
    </g>
    <g class="map-pins">
      <g v-for="[x, y] in pins" :key="`${x}-${y}`" :transform="`translate(${x} ${y})`">
        <path d="M0 0 C-7 -9 -11 -14 -11 -19 A11 11 0 1 1 11 -19 C11 -14 7 -9 0 0 Z" />
        <circle cx="0" cy="-19" r="4" />
      </g>
    </g>
    <circle class="map-you-halo" cx="150" cy="190" r="16" />
    <circle class="map-you" cx="150" cy="190" r="7" />
  </svg>
</template>

<script setup>
/** Pin tips in map coordinates; the view shows y 45 to 239, the card's shape. */
const pins = [[96, 108], [186, 144], [238, 96], [300, 166], [58, 182]];
</script>

<style scoped>
.map-preview { display: block; width: 100%; height: 100%; }
.map-ground { fill: #EFE7D6; }
.map-park { fill: #D6E5C6; }
.map-water { fill: none; stroke: #C9DFE2; stroke-width: 24; }
.map-street { fill: none; stroke: #F8F4EA; stroke-width: 3; stroke-linecap: round; }
.map-road { fill: none; stroke: #FFFFFF; stroke-width: 7; stroke-linecap: round; }
.map-pins { fill: #F7931A; filter: drop-shadow(0 2px 2px rgba(80, 50, 10, 0.3)); }
.map-pins circle { fill: #FFFFFF; }
.map-you-halo { fill: rgba(10, 132, 255, 0.18); }
.map-you { fill: #0A84FF; stroke: #FFFFFF; stroke-width: 2.5; }

body.body--dark .map-ground { fill: #1C1E1D; }
body.body--dark .map-park { fill: #1F2B23; }
body.body--dark .map-water { stroke: #1A2C33; }
body.body--dark .map-street { stroke: #2A2D2C; }
body.body--dark .map-road { stroke: #3A3E3C; }
body.body--dark .map-pins { filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.45)); }
body.body--dark .map-you-halo { fill: rgba(10, 132, 255, 0.22); }
</style>

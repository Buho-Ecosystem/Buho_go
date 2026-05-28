<template>
  <q-page class="map-page">
    <!--
      Bitcoin merchant map. Built across phases:
        Phase 2 — MapLibre map core (theme-aware, clustering, geolocation)
        Phase 3 — bottom sheet + distance-sorted nearby list
        Phase 4 — place detail + directions + share
        Phase 5 — filters, search, empty/error/offline states
      This placeholder keeps the lazy /map route resolvable while the
      surface is assembled.
    -->
    <div class="map-page-loading">
      <q-spinner-dots size="40px" :color="$q.dark.isActive ? 'brand-green' : 'brand-green-dark'" />
    </div>
  </q-page>
</template>

<script>
export default {
  name: 'MapPage',
}
</script>

<style scoped>
.map-page {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
}
.map-page-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

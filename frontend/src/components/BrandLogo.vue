<script setup>
defineProps({ icon: Boolean, decorative: Boolean });
const brandBase = `${import.meta.env.BASE_URL}branding/`;
</script>

<template>
  <span class="aureli-logo" :class="{ 'aureli-logo-icon': icon }">
    <img
      :src="`${brandBase}${icon ? 'aureli-icon.webp' : 'aureli-wordmark.webp?v=2'}`"
      :alt="decorative ? '' : 'Aureli'"
      :aria-hidden="decorative || undefined"
      :width="icon ? 512 : 1000"
      :height="icon ? 512 : 333"
      draggable="false"
    />
  </span>
</template>

<style scoped>
/* Frame the supplied artwork's whitespace without changing its proportions. */
.aureli-logo {
  display: block;
  position: relative;
  width: 100%;
  aspect-ratio: 1924 / 520;
  overflow: hidden;
}
.aureli-logo img {
  position: absolute;
  display: block;
  width: 112.89%;
  max-width: none;
  height: auto;
  left: -6.24%;
  top: -15%;
  mix-blend-mode: multiply;
}
.aureli-logo-icon { aspect-ratio: 1054 / 610; }
.aureli-logo-icon img { width: 118.98%; left: -9.87%; top: -52.95%; }
</style>

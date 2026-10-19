<!--
  GetWalletAppStep: in the web app on an Android phone, "Wallet app on this
  phone" cannot work: a web page can neither find the wallet apps nor be
  sent back to. So the step says where it works, BuhoGO for Android, with
  both stores, and keeps the way that works here: a code to show.
-->
<template>
  <FormSheetStep
    :title="$t('Use the BuhoGO app')"
    :subtitle="$t('Connecting a wallet app on this phone works in BuhoGO for Android. Install it, then connect from there.')"
    back
    @back="$emit('back')"
  >
    <template #icon>
      <Icon icon="tabler:device-mobile-down" width="26" height="26" />
    </template>

    <StoreBadges class="get-app__badges" />
    <p class="iform-foot get-app__foot">{{ $t('Staying in the browser? Show a code your wallet app scans or opens.') }}</p>

    <template #footer>
      <button type="button" class="iform-secondary" @click="$emit('show-code')">
        {{ $t('Show a code instead') }}
      </button>
    </template>
  </FormSheetStep>
</template>

<script>
import FormSheetStep from '../sheets/FormSheetStep.vue';
import StoreBadges from '../StoreBadges.vue';

export default {
  name: 'GetWalletAppStep',
  components: { FormSheetStep, StoreBadges },
  emits: ['back', 'show-code'],
};
</script>

<style scoped>
.get-app__badges {
  justify-content: center;
}
.get-app__foot {
  text-align: center;
  margin-top: 18px;
}
</style>

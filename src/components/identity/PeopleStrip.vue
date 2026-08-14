<template>
  <!--
    The people you actually pay.

    This is what the identity tab becomes once setup is done, and it is the
    reason to open the tab at all afterwards. Tapping a face starts a payment
    through the same route the address book already uses; the last chip opens
    the scanner.

    Contacts used to be a single row pinned under everything else, which is a
    strange rank for the most-used identity feature in the app.
  -->
  <div class="people">
    <div class="people-head">
      <span class="people-title">{{ $t('People') }}</span>
      <button v-if="total > 0" type="button" class="people-all" @click="$emit('see-all')">
        {{ $t('See all {n}', { n: total }) }}
      </button>
    </div>

    <div class="people-strip">
      <button
        v-for="person in people"
        :key="person.id"
        type="button"
        class="person"
        @click="$emit('pay', person)"
      >
        <!-- ContactAvatar deliberately does not own its own size; the
             parent supplies it, which is why the wrapper carries the box. -->
        <span class="person-avatar">
          <ContactAvatar :entry="person" />
        </span>
        <span class="person-name">{{ firstName(person.name) }}</span>
      </button>

      <button type="button" class="person" @click="$emit('scan')">
        <span class="person-avatar person-avatar--add">
          <Icon icon="tabler:plus" width="20" height="20" />
        </span>
        <span class="person-name">{{ $t('Add') }}</span>
      </button>
    </div>
  </div>
</template>

<script>
import { Icon } from '@iconify/vue';
import ContactAvatar from '../AddressBook/ContactAvatar.vue';

export default {
  name: 'PeopleStrip',

  components: { Icon, ContactAvatar },

  props: {
    /** Already sliced and sorted by the caller. */
    people: { type: Array, required: true },
    total: { type: Number, default: 0 },
  },

  emits: ['pay', 'scan', 'see-all'],

  methods: {
    /**
     * A row of faces needs one word under each, not a full name that
     * truncates to "Jonas W…". The full name is on the contact itself.
     */
    firstName(name) {
      if (!name) return '';
      return String(name).trim().split(/\s+/)[0];
    },
  },
};
</script>

<style scoped>
.people { margin-top: 20px; }

.people-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 0 4px 10px;
}

.people-title {
  flex: 1;
  font-family: 'Manrope', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--text-primary);
}

.people-all {
  border: 0;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  font-size: 13px;
  font-weight: 620;
  color: var(--brand-accent);
  cursor: pointer;
  padding: 4px 2px;
}

/* Horizontal scroll with no visible bar: the row is meant to feel like a
   shelf of faces, and a scrollbar under 56px avatars looks like an error. */
.people-strip {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  padding: 2px 4px 6px;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.people-strip::-webkit-scrollbar { display: none; }

.person {
  border: 0;
  background: transparent;
  font-family: 'Manrope', sans-serif;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  width: 60px;
  padding: 0;
}

.person-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
}

.person-avatar :deep(.contact-avatar) {
  width: 56px;
  height: 56px;
  font-size: 56px;
}

.person-avatar--add {
  background: var(--bg-input);
  color: var(--text-muted);
  border: 1.5px dashed var(--border-card);
}

.person-name {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
  max-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

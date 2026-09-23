<template>
  <div class="app-shell">
    <header class="topbar">
      <!-- `all=1` forces the full library; a bare `/` would bounce a session
           reader straight back to their active case. -->
      <RouterLink class="brand" to="/?all=1">
        <span class="brand-mark">T</span>
        <span>Tracebook</span>
      </RouterLink>
      <span class="tagline">Engineering investigation notebook</span>
    </header>
    <RouterView />
  </div>
</template>

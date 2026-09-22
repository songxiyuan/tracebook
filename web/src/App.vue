<template>
  <div class="app-shell">
    <header class="topbar">
      <RouterLink class="brand" to="/">
        <span class="brand-mark">T</span>
        <span>Tracebook</span>
      </RouterLink>
      <span class="tagline">Engineering investigation notebook</span>
    </header>
    <RouterView />
  </div>
</template>

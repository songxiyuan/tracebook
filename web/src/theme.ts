import { onMounted, onBeforeUnmount, ref } from 'vue'

/**
 * Theme state for the Viewer. The preference is one of light / dark / system;
 * `system` follows the OS setting live. The resolved value is written to
 * `data-theme` on <html>, which the token overrides in styles.css key off.
 */
export type ThemePref = 'light' | 'dark' | 'system'
const STORAGE_KEY = 'tracebook:theme'

function systemDark(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
}

function readPref(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch { /* storage may be unavailable */ }
  return 'system'
}

function resolve(pref: ThemePref): 'light' | 'dark' {
  return pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref
}

function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolve(pref)
}

/** Apply the stored theme as early as possible (called from main.ts before mount). */
export function initTheme() {
  apply(readPref())
}

export function useTheme() {
  const pref = ref<ThemePref>(readPref())
  const resolved = ref<'light' | 'dark'>(resolve(pref.value))

  function set(next: ThemePref) {
    pref.value = next
    resolved.value = resolve(next)
    apply(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage may be unavailable */ }
  }

  /** Toggle flips the *resolved* appearance and pins it as an explicit choice. */
  function toggle() {
    set(resolved.value === 'dark' ? 'light' : 'dark')
  }

  const media = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-color-scheme: dark)') : undefined
  function onSystemChange() {
    if (pref.value !== 'system') return
    resolved.value = resolve('system')
    apply('system')
  }
  onMounted(() => media?.addEventListener('change', onSystemChange))
  onBeforeUnmount(() => media?.removeEventListener('change', onSystemChange))

  return { pref, resolved, set, toggle }
}

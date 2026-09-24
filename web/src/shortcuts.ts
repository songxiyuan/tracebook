import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Global keyboard shortcuts for the Viewer. Kept intentionally small and
 * non-intrusive: shortcuts never fire while the user is typing in a field, and
 * every one has an on-screen equivalent, so the keyboard is an accelerator, not
 * the only way in.
 *
 *   /      focus the nearest search box
 *   g h    go to the case library
 *   ?      toggle the shortcut help overlay
 *   Esc    close the help overlay
 */
export interface ShortcutEntry { keys: string; description: string }

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: '/', description: '聚焦搜索框' },
  { keys: 'g h', description: '返回案例列表' },
  { keys: '?', description: '打开 / 关闭快捷键帮助' },
  { keys: 'Esc', description: '关闭弹层' },
]

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function useShortcuts() {
  const helpOpen = ref(false)
  const router = useRouter()
  let lastG = 0

  function focusSearch() {
    const el = document.querySelector<HTMLElement>('input[type="search"]')
    el?.focus()
  }

  function onKey(event: KeyboardEvent) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') { helpOpen.value = false; return }
    // Never hijack typing; the only exception is Escape, handled above.
    if (isTypingTarget(event.target)) return
    if (event.key === '/') { event.preventDefault(); focusSearch(); return }
    if (event.key === '?') { event.preventDefault(); helpOpen.value = !helpOpen.value; return }
    if (event.key === 'g') { lastG = Date.now(); return }
    if (event.key === 'h' && Date.now() - lastG < 800) {
      lastG = 0
      void router.push({ name: 'cases', query: { all: '1' } })
    }
  }

  onMounted(() => window.addEventListener('keydown', onKey))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

  return { helpOpen }
}

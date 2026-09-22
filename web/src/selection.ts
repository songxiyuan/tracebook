import { ref } from 'vue'

/**
 * The Flow node the reader last inspected, kept outside the component so a
 * content refresh can restore it instead of throwing the reader back to an
 * unselected canvas. Only one node is remembered: it is a reading position,
 * not case data.
 */
export const selectedFlowNode = ref<{ blockId: string; nodeId: string } | undefined>()

export function rememberFlowSelection(blockId: string, nodeId: string | undefined) {
  selectedFlowNode.value = nodeId ? { blockId, nodeId } : undefined
}

/** Drop the remembered node when the reader moves to another case. */
export function clearFlowSelection() {
  selectedFlowNode.value = undefined
}

export function rememberedNodeFor(blockId: string): string | undefined {
  const current = selectedFlowNode.value
  return current?.blockId === blockId ? current.nodeId : undefined
}

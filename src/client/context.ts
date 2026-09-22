/**
 * The client service surface this plugin composes.
 *
 * Each import below is type-only and exists to load that package's
 * `declare module '@deepseek-ai/cordis'` augmentation into the program: the
 * services (`slots`, `sidebarRight`, `sidebarRightTabs`, `conversation`,
 * `sessions`) and the slot contracts are declared by the packages that provide
 * them, and Cordis plugin code reaches them through `ctx`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

export type ClientContext = Context

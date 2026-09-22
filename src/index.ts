import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { MetadataOnlyArtifactStore } from './core/artifact-store.js'
import { TracebookService } from './core/service.js'
import { FileArtifactStore } from './host/artifact-store.js'
import { registerHttpRoutes } from './host/http.js'
import { DshCaseRepository } from './host/storage.js'
import { registerTools } from './host/tools.js'
import { seedExampleCase } from './example.js'

export * from './core/model.js'
export * from './core/repository.js'
export * from './core/memory-repository.js'
export * from './core/artifact-store.js'
export * from './core/service.js'
export * from './core/errors.js'

export const name = 'tracebook'
export const inject = ['tools', 'storageDomain', 'webServer']

export interface Config {
  artifactDirectory?: string
  webDirectory?: string
  metadataOnlyArtifacts?: boolean
  seedExampleCase?: boolean
}

export function apply(ctx: Context, config: Config = {}) {
  ctx.effect(async () => {
    const repository = await DshCaseRepository.open(ctx.storageDomain)
    const artifactStore = config.metadataOnlyArtifacts
      ? new MetadataOnlyArtifactStore()
      : new FileArtifactStore(resolve(config.artifactDirectory ?? '.tracebook/artifacts'))
    const service = new TracebookService(repository, artifactStore)
    if (config.seedExampleCase) await seedExampleCase(service)
    const disposeTools = registerTools(ctx, service)
    const disposeHttp = registerHttpRoutes(ctx, service, config.webDirectory)
    return async () => {
      disposeHttp()
      disposeTools()
      await repository.close()
    }
  }, 'tracebook')
}

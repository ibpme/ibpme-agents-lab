import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';

export function createProfileValidator() {
  let runtime: Promise<ModelRuntime> | undefined;
  return async (profile: { provider: string; model: string; effort: ModelThinkingLevel }, signal: AbortSignal): Promise<string | undefined> => {
    signal.throwIfAborted();
    // No catalog network refresh or agent session: validation must not execute tasks.
    runtime ??= import('@earendil-works/pi-coding-agent').then(({ ModelRuntime }) => ModelRuntime.create({ allowModelNetwork: false })).catch(error => { runtime = undefined; throw error; });
    const models = await runtime;
    signal.throwIfAborted();
    if (models.getError()) return 'model_registry_error';
    const model = models.getPhysicalModel(profile.provider, profile.model);
    if (!model) return models.getModelOfType('classifier', profile.provider, profile.model) ? 'classifier_not_chat_model' : 'unknown_chat_model';
    const { getSupportedThinkingLevels } = await import('@earendil-works/pi-ai');
    if (!getSupportedThinkingLevels(model).includes(profile.effort)) return 'unsupported_effort';
    if (!models.hasConfiguredAuth(profile.provider)) return 'missing_provider_auth';
    return undefined;
  };
}

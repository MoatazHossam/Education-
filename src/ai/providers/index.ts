import type { AppConfig } from '../../config.js';
import type { AiProvider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { OpenAiProvider } from './openai.js';

/** The configured provider, or null when AI is not set up on this server (AI_PROVIDER=none). */
export function createAiProvider(config: AppConfig): AiProvider | null {
  if (config.AI_PROVIDER === 'none') return null;
  const common = { apiKey: config.AI_API_KEY!, model: config.AI_MODEL!, apiBase: config.AI_API_BASE, timeoutMs: config.AI_TIMEOUT_MS };
  switch (config.AI_PROVIDER) {
    case 'gemini':
      return new GeminiProvider(common);
    case 'anthropic':
      return new AnthropicProvider(common);
    case 'openai':
      return new OpenAiProvider(common);
  }
}

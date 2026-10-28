import { z } from 'zod';
import { AnthropicProvider } from '../ai/providers/anthropic.js';
import { GeminiProvider } from '../ai/providers/gemini.js';
import { OpenAiProvider } from '../ai/providers/openai.js';
import { parseJsonReply, portableSchema } from '../ai/schema.js';
import { AI_PROVIDERS, AiProviderError, type AiProvider } from '../ai/types.js';

// Usage (the same variables as the application; the key is read from the environment, never from the command line):
//   AI_PROVIDER=gemini AI_API_KEY=… AI_MODEL=gemini-2.5-pro [AI_API_BASE=…] npm run ai:check
//
// Sends this application's adapter one small request with a JSON schema to the real provider and
// checks the reply: the key is accepted, the model exists, structured replies come back in shape.
// It costs one small request; it uses no database and no school's allowance.
const Reply = z.object({ arabic: z.string().min(1).max(100), english: z.string().min(1).max(100) });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main() {
  const name = required('AI_PROVIDER');
  if (!(AI_PROVIDERS as readonly string[]).includes(name)) throw new Error(`AI_PROVIDER must be one of ${AI_PROVIDERS.join(', ')}`);
  const config = { apiKey: required('AI_API_KEY'), model: required('AI_MODEL'), apiBase: process.env.AI_API_BASE?.trim() || undefined, timeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 120_000) };
  const provider: AiProvider = name === 'gemini' ? new GeminiProvider(config) : name === 'anthropic' ? new AnthropicProvider(config) : new OpenAiProvider(config);

  console.log(`Provider ${provider.name}, model ${provider.model}${config.apiBase ? `, endpoint ${config.apiBase}` : ''}`);
  const started = Date.now();
  const reply = await provider.generate({
    system: 'You are a translator for a school curriculum platform. Answer with JSON only.',
    prompt: 'Translate the English word "curriculum" into Modern Standard Arabic. Answer as {"arabic": "<the Arabic word>", "english": "curriculum"}.',
    jsonSchema: portableSchema(Reply),
    maxOutputTokens: 4000,
  });
  console.log(`Answered in ${Date.now() - started} ms by ${reply.model}: finish=${reply.finish}, tokens in=${reply.inputTokens ?? '?'} out=${reply.outputTokens ?? '?'}`);
  if (reply.finish !== 'stop') throw new Error(`The reply did not finish normally (${reply.finish})`);
  const value = parseJsonReply(reply.text, Reply);
  console.log(`Reply matches the schema: ${JSON.stringify(value)}`);
  console.log('OK');
}

main().catch((err: unknown) => {
  if (err instanceof AiProviderError) console.error(`FAILED (${err.kind}${err.status ? `, HTTP ${err.status}` : ''}): ${err.message}`);
  else console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

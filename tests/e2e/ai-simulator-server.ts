import { AiSimulator } from '../helpers/ai-simulator.js';

// The E2E server's AI provider (tests/e2e/server.ts, startAiSimulator). Unscripted requests get a
// reply that matches the platform administration's connection test.
const sim = new AiSimulator(process.env.E2E_AI_KEY!);
sim.defaultText = '{"arabic":"منهج"}';
await sim.start(Number(process.env.E2E_AI_PORT));

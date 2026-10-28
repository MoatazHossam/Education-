import { stopAiSimulator, stopServer } from './server.js';

export default async function globalTeardown(): Promise<void> {
  await stopServer();
  await stopAiSimulator();
}

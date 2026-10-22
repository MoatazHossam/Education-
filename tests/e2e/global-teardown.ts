import { stopServer } from './server.js';

export default async function globalTeardown(): Promise<void> {
  await stopServer();
}

import { createServer, type Server, type Socket } from 'node:net';

/** The standard antivirus test string (EICAR): harmless, reported by every scanner. */
export const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export type FakeClamdMode = 'scan' | 'error' | 'hang' | 'close';

/**
 * A stand-in for ClamAV's daemon that speaks its TCP protocol (zPING, zINSTREAM with
 * length-prefixed chunks). In "scan" mode it reports Eicar-Test-Signature when the stream
 * contains the EICAR string anywhere (the real clamd only when the file starts with it).
 */
export async function startFakeClamd(): Promise<{
  port: number;
  mode: FakeClamdMode;
  /** Every stream received, reassembled from its chunks. */
  streams: Buffer[];
  chunkSizes: number[];
  close(): Promise<void>;
}> {
  const state = { mode: 'scan' as FakeClamdMode, streams: [] as Buffer[], chunkSizes: [] as number[] };
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buf = Buffer.alloc(0);
    let command: string | null = null;
    const parts: Buffer[] = [];
    socket.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (command === null) {
        const end = buf.indexOf(0);
        if (end < 0) return;
        command = buf.subarray(0, end).toString();
        buf = buf.subarray(end + 1);
        if (command === 'zPING') return void socket.end('PONG\0');
        if (command !== 'zINSTREAM') return void socket.end('UNKNOWN COMMAND\0');
      }
      while (buf.length >= 4) {
        const size = buf.readUInt32BE(0);
        if (size === 0) {
          const stream = Buffer.concat(parts);
          state.streams.push(stream);
          if (state.mode === 'hang') return;
          if (state.mode === 'close') return void socket.destroy();
          if (state.mode === 'error') return void socket.end('stream: Can\'t allocate memory ERROR\0');
          return void socket.end(stream.includes(EICAR) ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        }
        if (buf.length < 4 + size) return;
        state.chunkSizes.push(size);
        parts.push(buf.subarray(4, 4 + size));
        buf = buf.subarray(4 + size);
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return Object.assign(state, {
    port,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  });
}

import { decryptStream, encryptStream } from '../lib/backup-crypt.js';

// Encrypts or decrypts a backup archive from stdin to stdout with the passphrase in
// MIDAD_BACKUP_PASSPHRASE (src/lib/backup-crypt.ts). Used by the ops scripts through the app image:
//   docker run --rm -i -e MIDAD_BACKUP_PASSPHRASE midad:local node dist/cli/backup-crypt.js encrypt < in > out
async function main() {
  const mode = process.argv[2];
  const passphrase = process.env.MIDAD_BACKUP_PASSPHRASE ?? '';
  if (mode !== 'encrypt' && mode !== 'decrypt') throw new Error('usage: backup-crypt.js encrypt|decrypt < input > output');
  if (!passphrase) throw new Error('Set MIDAD_BACKUP_PASSPHRASE');
  await (mode === 'encrypt' ? encryptStream : decryptStream)(passphrase, process.stdin, process.stdout);
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});

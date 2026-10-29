// Azure AI Speech (neural text-to-speech) over its REST API, through curl so the environment's HTTPS proxy and
// CA bundle apply. The key is read from AZURE_SPEECH_KEY and handed to curl on stdin, never on the command line
// or on disk; the region comes from AZURE_SPEECH_REGION.
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function azureConfig() {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new Error('Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in the environment (environment settings, not the chat).');
  if (!/^[a-z0-9]+$/.test(region)) throw new Error('AZURE_SPEECH_REGION should look like "westeurope" or "uaenorth".');
  // Keys are letters and digits; anything else would break the curl configuration it is written into.
  if (!/^[A-Za-z0-9]+$/.test(key)) throw new Error('AZURE_SPEECH_KEY should contain only letters and digits.');
  return { key, region };
}

/** SSML for one line: the voice, its locale, and the speaking rate (e.g. "-5%"). */
export function ssml(text, voice, rate = '0%') {
  const lang = voice.split('-').slice(0, 2).join('-');
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}">${escapeXml(text)}</prosody></voice></speak>`;
}

/** Synthesizes one line to a 48 kHz 16-bit mono WAV at `out` (untrimmed). Retries throttling and server errors. */
export function synthesize({ text, voice, rate, out }, { key, region }) {
  const body = `${out}.ssml.xml`;
  writeFileSync(body, ssml(text, voice, rate));
  const config = [
    `url = "https://${region}.tts.speech.microsoft.com/cognitiveservices/v1"`,
    'request = "POST"',
    `header = "Ocp-Apim-Subscription-Key: ${key}"`,
    'header = "Content-Type: application/ssml+xml"',
    'header = "X-Microsoft-OutputFormat: riff-48khz-16bit-mono-pcm"',
    'header = "User-Agent: midad-showcase"',
    `data-binary = "@${body}"`,
    `output = "${out}"`,
    'silent',
    'show-error',
    'write-out = "%{http_code}"',
  ].join('\n');
  try {
    for (let attempt = 0; ; attempt++) {
      const r = spawnSync('curl', ['-K', '-'], { input: config, encoding: 'utf8' });
      const status = Number(r.stdout.trim());
      if (status === 200) return;
      const retry = status === 429 || status >= 500 || r.status !== 0;
      if (!retry || attempt >= 5) {
        rmSync(out, { force: true });
        throw new Error(`Azure TTS answered ${status || r.stderr.trim()} for: ${text.slice(0, 60)}…`);
      }
      sleep(2000 * 2 ** attempt);
    }
  } finally {
    rmSync(body, { force: true });
  }
}

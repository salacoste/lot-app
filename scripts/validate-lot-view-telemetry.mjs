import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/lot/[lotId]/LotViewTelemetryBeacon.tsx', import.meta.url), 'utf8');

assert.match(source, /fetch\(/, 'lot-view telemetry must use fetch');
assert.match(source, /keepalive:\s*true/, 'lot-view telemetry must preserve unload delivery with fetch keepalive');
assert.match(source, /'X-Lot-View-Intent':\s*'visible-detail'/, 'intent header is mandatory');
assert.match(source, /'X-Lot-Client-Id':\s*clientId/, 'privacy-safe client identity header is mandatory');
assert.doesNotMatch(
  source,
  /sendBeacon\(/,
  'sendBeacon cannot express the mandatory custom headers and must not silently weaken validation',
);
assert.doesNotMatch(source, /AbortController/, 'keepalive telemetry must survive component unmount/navigation');
assert.doesNotMatch(source, /controller\.abort\(/, 'cleanup must not abort an in-flight keepalive request');
assert.doesNotMatch(source, /signal:\s*/, 'keepalive request must not be bound to component lifetime');

console.log('Lot-view telemetry transport contract is valid.');

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

async function loadCryptoModule() {
  const sourcePath = path.resolve('lib/crypto.ts');
  const source = await readFile(sourcePath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const tempDir = await mkdtemp(path.join(tmpdir(), 's3man-crypto-test-'));
  const modulePath = path.join(tempDir, 'crypto.mjs');
  await writeFile(modulePath, output, 'utf8');
  return import(pathToFileURL(modulePath).href);
}

test('config encryption round trips using the current format', async () => {
  const { encryptConfig, decryptConfig } = await loadCryptoModule();
  const plaintext = JSON.stringify({ secretAccessKey: 'secret', nested: { value: 42 } });

  const encrypted = await encryptConfig(plaintext);
  assert.notEqual(encrypted, plaintext);
  assert.ok(encrypted.startsWith('aes-gcm:'));

  const decrypted = await decryptConfig(encrypted);
  assert.equal(decrypted, plaintext);
});

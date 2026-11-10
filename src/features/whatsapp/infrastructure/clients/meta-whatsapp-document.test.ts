import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceDocumentName as name } from '../../../resources/domain/resource-document-name.js';
import { MetaWhatsAppClient } from './meta-whatsapp.client.js';
test('resource titles keep accents, one extension, and safe length with meaningful fallbacks', () => {
  assert.equal(name('Programa FLAP – Canadá', 'original.pdf'), 'Programa FLAP – Canadá.pdf');
  assert.equal(name('Canadá.PDF', 'original.pdf'), 'Canadá.pdf');
  assert.equal(name('', 'original.pdf'), 'original.pdf');
  assert.equal(name(null, null), 'Recurso.pdf');
  assert.equal(name('Canadá/Quebec\\Verano\n2027', 'original.pdf'), 'Canadá Quebec Verano 2027.pdf');
  assert.ok(name('á'.repeat(300), 'original.pdf').length <= 255);
});
test('WhatsApp uses the explicit document name even for download URLs; text is unchanged', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const payloads: Array<{ document?: { filename: string; link: string }; text?: { body: string } }> = [];
  globalThis.fetch = (async (_url, options) => {
    payloads.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ messages: [{ id: 'provider' }] }), { status: 200 });
  }) as typeof fetch;
  const client = new MetaWhatsAppClient();
  await client.sendMessage({ to: '525555000001', mediaUrl: 'https://example.com/resources/1/download', fileName: name('Canadá', 'source.pdf') });
  await client.sendMessage({ to: '525555000001', mediaUrl: 'https://example.com/download' });
  await client.sendMessage({ to: '525555000001', body: 'Hola' });
  assert.equal(payloads[0].document?.filename, 'Canadá.pdf');
  assert.equal(payloads[1].document?.filename, 'Recurso.pdf');
  assert.equal(payloads[2].text?.body, 'Hola');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { MetaWhatsAppAccountService } from './meta-whatsapp-account.service.js';

test('account lookup returns only the real business number and name, caches and deduplicates requests', async () => {
  let requests = 0;
  const service = new MetaWhatsAppAccountService(async (url, options) => {
    requests += 1;
    assert.match(String(url), /fields=display_phone_number,verified_name/);
    assert.equal(String(url).includes('access_token='), false);
    assert.ok(options?.headers);
    return new Response(JSON.stringify({ display_phone_number: '+52 1 55 1534 4731', verified_name: 'TKTours', id: 'provider-id' }));
  });
  const results = await Promise.all([service.getAccount(), service.getAccount()]);
  assert.deepEqual(results[0], { phoneNumber: '+5215515344731', displayName: 'TKTours' });
  assert.deepEqual(await service.getAccount(), results[0]);
  assert.equal(requests, 1);
});

test('provider failures or missing display numbers are not confused with the Meta phone ID', async () => {
  for (const response of [new Response('secret provider error', { status: 403 }), new Response(JSON.stringify({ id: '123456789' }))]) {
    const service = new MetaWhatsAppAccountService(async () => response);
    await assert.rejects(service.getAccount(), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /No se pudo consultar el número/);
      assert.doesNotMatch(error.message, /secret|123456789/);
      return true;
    });
  }
});

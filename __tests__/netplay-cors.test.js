import http from 'http';
import { jest } from '@jest/globals';

describe('netplay-server CORS handling', () => {
  test('rejects requests from disallowed origins', async () => {
    process.env.ALLOWED_DOMAINS = 'https://allowed.com';
    jest.resetModules();
    const { httpServer } = await import('../server/netplay-server.js');
    await new Promise(resolve => httpServer.listen(0, resolve));
    const port = httpServer.address().port;
    const result = await new Promise(resolve => {
      const req = http.request({ port, path: '/rooms', headers: { origin: 'https://blocked.com' } }, res => {
        let data = '';
        res.on('data', d => (data += d));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.end();
    });
    expect(result.statusCode).toBe(403);
    httpServer.close();
    delete process.env.ALLOWED_DOMAINS;
  });
});

import { jest } from '@jest/globals';

beforeAll(async () => {
  global.window = {};
  await import('../data/src/GameManager.js');
});

describe('GameManager screenshot', () => {
  test('resolves when screenshot file appears', async () => {
    jest.useFakeTimers();
    const FS = {
      files: {},
      unlink: jest.fn(path => { delete FS.files[path]; }),
      stat: jest.fn(path => { if (!(path in FS.files)) throw new Error('ENOENT'); }),
      readFile: jest.fn(path => FS.files[path])
    };
    const gm = Object.create(global.window.EJS_GameManager.prototype);
    gm.FS = FS;
    gm.functions = { screenshot: jest.fn() };

    const promise = gm.screenshot();
    setTimeout(() => { FS.files['/screenshot.png'] = new Uint8Array([1,2,3]); }, 20);

    jest.advanceTimersByTime(20);
    jest.advanceTimersByTime(50);

    const data = await promise;
    expect(data).toEqual(new Uint8Array([1,2,3]));
    jest.useRealTimers();
  });
});

import { persistWithRetry } from './persist-retry';

describe('persistWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('succeeds on first try, fn called once', async () => {
    const fn = jest.fn().mockResolvedValue('ok');

    const promise = persistWithRetry(fn);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails once then succeeds, fn called twice', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');

    const promise = persistWithRetry(fn);
    await jest.advanceTimersByTimeAsync(50);
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts attempts and throws last error', async () => {
    const lastError = new Error('persistent');
    const fn = jest.fn().mockRejectedValue(lastError);

    const promise = persistWithRetry(fn);
    const assertion = expect(promise).rejects.toBe(lastError);
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(150);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

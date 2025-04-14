/**
 * Polyfill for crypto.randomUUID
 * Provides a fallback implementation when the native method is not available
 */

declare global {
  interface Crypto {
    randomUUID(): string;
  }
}

if (typeof crypto !== 'undefined' && !('randomUUID' in crypto)) {
  (crypto as any).randomUUID = function(): string {
    return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c: string) => {
      const randomValue = crypto.getRandomValues(new Uint8Array(1))[0];
      return (parseInt(c) ^ (randomValue & 15) >> (parseInt(c) / 4)).toString(16);
    });
  };
}

export {};

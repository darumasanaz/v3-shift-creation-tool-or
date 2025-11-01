import { SCHEMA_VERSION, STORAGE_PREFIX } from '../constants';
import { SCHEMA_VERSION_STORAGE_KEY } from './storageKeys';

export function initializeStorageSchema(): void {
  if (typeof window === 'undefined') return;
  try {
    const storage = window.localStorage;
    const currentVersion = storage.getItem(SCHEMA_VERSION_STORAGE_KEY);
    if (currentVersion === SCHEMA_VERSION) {
      return;
    }

    const keysToClear: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        keysToClear.push(key);
      }
    }
    for (const key of keysToClear) {
      storage.removeItem(key);
    }
    storage.setItem(SCHEMA_VERSION_STORAGE_KEY, SCHEMA_VERSION);
  } catch (error) {
    console.warn('Failed to initialize storage schema', error);
  }
}

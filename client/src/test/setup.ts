import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import i18n from '../i18n';

await i18n.changeLanguage('en');

afterEach(() => {
  cleanup();
});

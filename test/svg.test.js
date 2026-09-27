// @vitest-environment happy-dom
import { it, expect } from 'vitest';
import { parseSvg } from '../src/coaster.js';

it('parseSvg extrae formas rellenas con sus agujeros e ignora trazos sin relleno', () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
    <path d="M1 1H9V9H1Z M3 3V7H7V3Z"/>
    <circle cx="5" cy="5" r="1" fill="none" stroke="black"/>
  </svg>`;
  const groups = parseSvg(svg);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toHaveLength(2); // contorno + agujero
});

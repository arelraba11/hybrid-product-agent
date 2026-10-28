import { describe, expect, test } from 'bun:test';
import { matchProductNames } from './productMatch';

// Stored names as produced by stemToProductName for data/products/*.txt.
const STORED = [
   'aurora smartwatch s3',
   'brewmaster y coffee machine',
   'electroride z vehicle',
   'evophone x',
   'neobook air 14 laptop',
   'printforge 3d printer',
   'skyline drone m2',
   'tidal soundbar 500',
];

describe('matchProductNames', () => {
   test.each([
      ['BrewMaster Y', 'brewmaster y coffee machine'],
      ['the BrewMaster Y', 'brewmaster y coffee machine'],
      ['brew master y', 'brewmaster y coffee machine'],
      ['NeoBook Air 14', 'neobook air 14 laptop'],
      ['neobook', 'neobook air 14 laptop'],
      ['PrintForge 3D Printer', 'printforge 3d printer'],
      ['The  NeoBook-Air_14!', 'neobook air 14 laptop'],
   ])('%p matches %p', (query, expected) => {
      expect(matchProductNames(query, STORED)).toEqual([expected]);
   });

   test.each(['EvoPhone Z', 'PixelPad', '', 'the'])(
      '%p matches nothing',
      (query) => {
         expect(matchProductNames(query, STORED)).toEqual([]);
      }
   );
});

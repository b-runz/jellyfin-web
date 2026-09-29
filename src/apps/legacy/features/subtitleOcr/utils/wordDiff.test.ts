import { describe, expect, it } from 'vitest';

import { changedWords, wordDiff } from './wordDiff';

describe('wordDiff', () => {
    it('returns one same segment for identical strings', () => {
        expect(wordDiff('I am here.', 'I am here.')).toEqual([
            { text: 'I am here.', kind: 'same' }
        ]);
    });

    it('marks a single changed word as removed then added', () => {
        expect(wordDiff('l am here.', 'I am here.')).toEqual([
            { text: 'l', kind: 'removed' },
            { text: 'I', kind: 'added' },
            { text: ' am here.', kind: 'same' }
        ]);
    });

    it('handles an insertion', () => {
        expect(wordDiff('I am here', 'I am not here')).toEqual([
            { text: 'I am ', kind: 'same' },
            { text: 'not', kind: 'added' },
            { text: ' here', kind: 'same' }
        ]);
    });

    it('handles a deletion', () => {
        expect(wordDiff('I am not here', 'I am here')).toEqual([
            { text: 'I am ', kind: 'same' },
            { text: 'not', kind: 'removed' },
            { text: ' here', kind: 'same' }
        ]);
    });

    it('keeps punctuation attached to the word it belongs to', () => {
        expect(wordDiff('Hello Anakln.', 'Hello Anakin.')).toEqual([
            { text: 'Hello ', kind: 'same' },
            { text: 'Anakln.', kind: 'removed' },
            { text: 'Anakin.', kind: 'added' }
        ]);
    });

    it('merges adjacent changed words into one segment per kind', () => {
        expect(wordDiff('a b c d', 'a x y d')).toEqual([
            { text: 'a ', kind: 'same' },
            { text: 'b c', kind: 'removed' },
            { text: 'x y', kind: 'added' },
            { text: ' d', kind: 'same' }
        ]);
    });

    it('treats line breaks as whitespace and keeps them in same segments', () => {
        expect(wordDiff('one\ntwo', 'one\nthree')).toEqual([
            { text: 'one\n', kind: 'same' },
            { text: 'two', kind: 'removed' },
            { text: 'three', kind: 'added' }
        ]);
    });
});

describe('changedWords', () => {
    it('returns removed words without punctuation, deduplicated', () => {
        expect(changedWords('Hello Anakln. Anakln!', 'Hello Anakin. Anakin!')).toEqual([ 'Anakln' ]);
    });

    it('returns one word for a pure insertion (the added word)', () => {
        expect(changedWords('I am here', 'I am not here')).toEqual([ 'not' ]);
    });

    it('returns an empty list for identical text', () => {
        expect(changedWords('same', 'same')).toEqual([]);
    });
});

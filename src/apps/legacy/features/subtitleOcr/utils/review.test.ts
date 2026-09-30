import { describe, expect, it } from 'vitest';

import type { Review, ReviewLine } from '../types';
import { buildAcceptRequest, isReviewComplete, parseNames, splitReview, toggleName } from './review';

const line = (index: number, certainty: ReviewLine['Certainty'], ocrText = 'l am here', chosenText = 'I am here'): ReviewLine => ({
    Index: index,
    Start: '00:00:01.000',
    End: '00:00:02.000',
    OcrText: ocrText,
    ChosenText: chosenText,
    Certainty: certainty,
    Margin: certainty === 'uncertain' ? 0.1 : 5,
    Candidates: [ { Text: ocrText, Score: 0.4 }, { Text: chosenText, Score: 0.9 } ]
});

const review = (lines: ReviewLine[]): Review => ({
    Lines: lines,
    Stats: { CuesIn: lines.length, CuesDropped: 0, LinesFlagged: 0, LmCalls: 0, VlmCalls: 0, LmFailed: false, VlmFailed: false },
    WeightsVersion: 'test'
});

describe('splitReview', () => {
    it('auto-accepts when every line is certain or adjudicated', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'adjudicated') ]));

        expect(split.autoAccept).toBe(true);
        expect(split.resolvedLines).toHaveLength(2);
        expect(split.uncertainLines).toHaveLength(0);
    });

    it('auto-accepts an empty review', () => {
        expect(splitReview(review([])).autoAccept).toBe(true);
    });

    it('does not auto-accept when one line is uncertain', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain') ]));

        expect(split.autoAccept).toBe(false);
        expect(split.uncertainLines.map(l => l.Index)).toEqual([ 1 ]);
        expect(split.resolvedLines.map(l => l.Index)).toEqual([ 0 ]);
    });
});

describe('isReviewComplete', () => {
    it('requires a decision for every uncertain line only', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain'), line(2, 'uncertain') ]));

        expect(isReviewComplete(split, {})).toBe(false);
        expect(isReviewComplete(split, { 1: 'I am here' })).toBe(false);
        expect(isReviewComplete(split, { 1: 'I am here', 2: 'l am here' })).toBe(true);
    });

    it('is complete immediately when nothing is uncertain', () => {
        expect(isReviewComplete(splitReview(review([ line(0, 'certain') ])), {})).toBe(true);
    });
});

describe('buildAcceptRequest', () => {
    it('sends no decisions and no names on auto-accept', () => {
        const split = splitReview(review([ line(0, 'certain') ]));

        expect(buildAcceptRequest(split, {}, '')).toEqual({
            Decisions: [],
            Names: [],
            NeverAsk: []
        });
    });

    it('sends one decision per uncertain line and parsed names', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain'), line(2, 'uncertain') ]));

        const request = buildAcceptRequest(split, { 1: 'I am here', 2: 'l am here' }, 'Anakin,  Padme ,Anakin');

        expect(request).toEqual({
            Decisions: [ { Index: 1, Text: 'I am here' }, { Index: 2, Text: 'l am here' } ],
            Names: [ 'Anakin', 'Padme' ],
            NeverAsk: []
        });
    });

    it('omits a decision for an uncertain line the user never answered', () => {
        const split = splitReview(review([ line(0, 'uncertain') ]));

        expect(buildAcceptRequest(split, {}, '').Decisions).toEqual([]);
    });
});

describe('parseNames', () => {
    it('trims, deduplicates and drops empty entries', () => {
        expect(parseNames(' Anakin, Padme ,, Anakin ,')).toEqual([ 'Anakin', 'Padme' ]);
    });

    it('returns an empty list for blank input', () => {
        expect(parseNames('')).toEqual([]);
        expect(parseNames('   ')).toEqual([]);
    });
});

describe('toggleName', () => {
    it('appends a name to an empty list', () => {
        expect(toggleName('', 'Anakin')).toBe('Anakin');
    });

    it('appends a name to an existing comma-separated list', () => {
        expect(toggleName('Padme', 'Anakin')).toBe('Padme, Anakin');
    });

    it('removes a name that is already present', () => {
        expect(toggleName('Padme, Anakin', 'Anakin')).toBe('Padme');
    });

    it('is a no-op for blank input', () => {
        expect(toggleName('Padme', '')).toBe('Padme');
        expect(toggleName('Padme', '   ')).toBe('Padme');
    });

    it('matches against the existing list ignoring stray whitespace, same as parseNames', () => {
        expect(toggleName(' Anakin ,Padme', 'Anakin')).toBe('Padme');
    });
});

import { describe, expect, it } from 'vitest';

import type { OcrJob } from '../types';
import { isJobActive, phaseFor, progressLabelKey } from './phase';

const job = (State: OcrJob['State'], Stage: OcrJob['Stage'] = ''): OcrJob => ({
    Id: 'j', ItemId: 'i', MediaSourceId: 'm', StreamIndex: 2, State, Stage, Done: 0, Total: 0
});

describe('phaseFor', () => {
    it('is loading until the item is loaded', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 0, itemLoaded: false })).toBe('loading');
    });

    it('is nothing when there is no job and no eligible track', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 0, itemLoaded: true })).toBe('nothing');
    });

    it('is pick when there is no job and more than one track', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 2, itemLoaded: true })).toBe('pick');
    });

    it('is progress when there is no job and exactly one track (start is automatic)', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 1, itemLoaded: true })).toBe('progress');
    });

    it('is loading when a job id exists but the job has not loaded', () => {
        expect(phaseFor({ hasJobId: true, trackCount: 1, itemLoaded: true })).toBe('loading');
    });

    it('maps job states to phases', () => {
        const at = (state: OcrJob['State']) => phaseFor({ hasJobId: true, job: job(state), trackCount: 1, itemLoaded: true });

        expect(at('Extracting')).toBe('progress');
        expect(at('Uploading')).toBe('progress');
        expect(at('Recognising')).toBe('progress');
        expect(at('AwaitingReview')).toBe('review');
        expect(at('Done')).toBe('done');
        expect(at('Failed')).toBe('failed');
        expect(at('Cancelled')).toBe('failed');
    });
});

describe('isJobActive', () => {
    it('is true for non-terminal states only', () => {
        expect(isJobActive('Extracting')).toBe(true);
        expect(isJobActive('Uploading')).toBe(true);
        expect(isJobActive('AwaitingReview')).toBe(true);
        expect(isJobActive('Done')).toBe(false);
        expect(isJobActive('Failed')).toBe(false);
        expect(isJobActive('Cancelled')).toBe(false);
        expect(isJobActive()).toBe(false);
    });
});

describe('progressLabelKey', () => {
    it('names each working phase', () => {
        expect(progressLabelKey('Extracting', '')).toBe('SubtitleOcrExtracting');
        expect(progressLabelKey('Uploading', '')).toBe('SubtitleOcrUploading');
        expect(progressLabelKey('AwaitingReview', '')).toBe('SubtitleOcrSaving');
    });

    it('names each Recognising sub-stage', () => {
        expect(progressLabelKey('Recognising', 'ocr')).toBe('SubtitleOcrRecognising');
        expect(progressLabelKey('Recognising', 'candidates')).toBe('SubtitleOcrGeneratingCandidates');
        expect(progressLabelKey('Recognising', 'scoring')).toBe('SubtitleOcrScoringCandidates');
        expect(progressLabelKey('Recognising', 'adjudicating')).toBe('SubtitleOcrCheckingUncertain');
        expect(progressLabelKey('Recognising', '')).toBe('SubtitleOcrRecognising');
    });
});

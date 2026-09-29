import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { nextStepAfterJobError, startErrorMessage } from './errors';

const axiosError = (status: number, data?: unknown) => new AxiosError('failed', String(status), undefined, undefined, {
    status, statusText: '', data, headers: {}, config: { headers: {} } as never
});

describe('startErrorMessage', () => {
    it('explains a 404 as an unsupported server', () => {
        expect(startErrorMessage(axiosError(404))).toBe('SubtitleOcrNotSupported');
    });

    it('uses the server message when the body is a string', () => {
        expect(startErrorMessage(axiosError(400, 'Stream 7 is not a bitmap subtitle.'))).toBe('Stream 7 is not a bitmap subtitle.');
    });

    it('uses a problem details title when present', () => {
        expect(startErrorMessage(axiosError(400, { title: 'Bad Request' }))).toBe('Bad Request');
    });

    it('falls back to the error message', () => {
        expect(startErrorMessage(new Error('boom'))).toBe('boom');
    });
});

describe('nextStepAfterJobError', () => {
    it('restarts when the job is gone', () => {
        expect(nextStepAfterJobError(404)).toBe('restart');
    });

    it('keeps polling for other failures', () => {
        expect(nextStepAfterJobError(500)).toBe('keep');
        expect(nextStepAfterJobError()).toBe('keep');
    });
});

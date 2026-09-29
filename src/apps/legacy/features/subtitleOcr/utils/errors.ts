import { isAxiosError } from 'axios';

import { statusOf } from '../api/request';

/**
 * Text to show when starting a job failed. Returns a translation key for the unsupported-server case,
 * otherwise the server's own message. Callers pass the result through `globalize.translate`, which
 * returns unknown keys unchanged.
 */
export const startErrorMessage = (error: unknown): string => {
    if (statusOf(error) === 404) return 'SubtitleOcrNotSupported';

    if (isAxiosError(error)) {
        const data = error.response?.data as unknown;
        if (typeof data === 'string' && data) return data;
        if (data && typeof data === 'object') {
            const problem = data as { title?: string; detail?: string };
            if (problem.detail) return problem.detail;
            if (problem.title) return problem.title;
        }
    }

    return error instanceof Error ? error.message : String(error);
};

/** A 404 on the job means the server forgot it (restart with a discarded job); start over. */
export const nextStepAfterJobError = (status?: number): 'restart' | 'keep' =>
    status === 404 ? 'restart' : 'keep';

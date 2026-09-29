import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import { POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS, PROGRESS_STATES } from '../constants';
import type { OcrJob } from '../types';
import { jobQueryKey, ocrRequest } from './request';

/**
 * Loads a job and polls it every second while the server is working. Polling stops in states
 * that wait for the user or are terminal. Failed polls retry with a growing delay capped at 10 s,
 * and the last successful data stays available for rendering.
 */
export const useJob = (jobId?: string) => {
    const { api } = useApi();

    return useQuery({
        queryKey: jobQueryKey(jobId),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<OcrJob>(api!, 'GET', `/Jobs/${jobId}`, undefined, signal);
            return response.data;
        },
        enabled: !!api && !!jobId,
        // eslint-disable-next-line sonarjs/function-return-type -- refetchInterval genuinely returns number | false
        refetchInterval: (query: { state: { data?: OcrJob } }) => {
            const state = query.state.data?.State;
            return state && PROGRESS_STATES.includes(state) ? POLL_INTERVAL_MS : false;
        },
        retry: (failureCount, error) => {
            // A missing job will not come back; let the page handle it.
            const status = (error as { response?: { status?: number } }).response?.status;
            return status !== 404 && failureCount < 3;
        },
        retryDelay: attempt => Math.min(POLL_INTERVAL_MS * 2 ** attempt, POLL_BACKOFF_MAX_MS)
    });
};

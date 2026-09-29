import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import type { Review } from '../types';
import { ocrRequest, reviewQueryKey } from './request';

export const useReview = (jobId: string | undefined, enabled: boolean) => {
    const { api } = useApi();

    return useQuery({
        queryKey: reviewQueryKey(jobId),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<Review>(api!, 'GET', `/Jobs/${jobId}/Review`, undefined, signal);
            return response.data;
        },
        enabled: !!api && !!jobId && enabled
    });
};

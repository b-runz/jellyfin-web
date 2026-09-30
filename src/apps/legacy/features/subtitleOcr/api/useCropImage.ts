import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import { cropQueryKey, ocrRequest } from './request';

/**
 * Fetches one line's crop image as a `Blob`. Only enabled when both `jobId` and `index` are given,
 * so a component only fetches crops for the uncertain lines it actually renders, never eagerly for
 * every line in the review. The result is cached indefinitely: a crop never changes once generated.
 */
export const useCropImage = (jobId: string | undefined, index: number | undefined) => {
    const { api } = useApi();

    return useQuery({
        queryKey: cropQueryKey(jobId, index),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<Blob>(
                api!, 'GET', `/Jobs/${jobId}/Crops/${index}`, undefined, signal, { responseType: 'blob' }
            );
            return response.data;
        },
        enabled: !!api && !!jobId && index !== undefined,
        staleTime: Infinity,
        gcTime: Infinity
    });
};

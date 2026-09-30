import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import type { AcceptRequest, AcceptResult } from '../types';
import { jobQueryKey, ocrRequest } from './request';

export const useAccept = (jobId?: string) => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (body: AcceptRequest) => {
            const response = await ocrRequest<AcceptResult>(api!, 'POST', `/Jobs/${jobId}/Accept`, body);
            return response.data;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: jobQueryKey(jobId) })
    });
};

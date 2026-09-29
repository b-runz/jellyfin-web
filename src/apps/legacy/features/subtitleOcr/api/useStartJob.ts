import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import type { OcrJob, StartJobRequest } from '../types';
import { jobQueryKey, ocrRequest } from './request';

export const useStartJob = () => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (body: StartJobRequest) => {
            const response = await ocrRequest<OcrJob>(api!, 'POST', '/Jobs', body);
            return response.data;
        },
        onSuccess: job => {
            queryClient.setQueryData(jobQueryKey(job.Id), job);
        }
    });
};

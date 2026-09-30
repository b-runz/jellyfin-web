import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import { QUERY_KEY } from '../constants';
import { ocrRequest } from './request';

export const useCancelJob = () => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (jobId: string) => {
            await ocrRequest<void>(api!, 'DELETE', `/Jobs/${jobId}`);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: [ QUERY_KEY ] })
    });
};

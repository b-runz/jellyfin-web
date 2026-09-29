import type { Api } from '@jellyfin/sdk';
import { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from 'axios';

import { QUERY_KEY } from '../constants';

export type OcrMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Sends a request to a `/SubtitleOcr` route. These routes are not in the generated SDK client,
 * so the SDK's axios instance is used directly with the same authorization header the SDK would send.
 * `config` merges in extra axios options, such as `responseType: 'blob'` for the crop image route.
 */
export const ocrRequest = <T>(
    api: Api,
    method: OcrMethod,
    path: string,
    data?: unknown,
    signal?: AbortSignal,
    config?: Partial<AxiosRequestConfig>
): Promise<AxiosResponse<T>> => api.axiosInstance.request<T>({
    ...config,
    method,
    url: `${api.basePath}/SubtitleOcr${path}`,
    data,
    headers: { Authorization: api.authorizationHeader },
    signal
});

/** The HTTP status carried by an axios error, if any. */
export const statusOf = (error: unknown): number | undefined =>
    isAxiosError(error) ? error.response?.status : undefined;

export const jobQueryKey = (jobId?: string) => [ QUERY_KEY, 'Job', jobId ];
export const reviewQueryKey = (jobId?: string) => [ QUERY_KEY, 'Review', jobId ];
export const cropQueryKey = (jobId?: string, index?: number) => [ QUERY_KEY, 'Crop', jobId, index ];

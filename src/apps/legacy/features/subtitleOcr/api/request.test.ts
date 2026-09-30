import type { Api } from '@jellyfin/sdk';
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { ocrRequest, statusOf } from './request';

describe('ocrRequest', () => {
    it('sends to the SubtitleOcr route with the authorization header and body', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, data: { Id: 'j1' } });
        const api = {
            basePath: 'https://server',
            authorizationHeader: 'MediaBrowser Token="t"',
            axiosInstance: { request }
        } as unknown as Api;

        const response = await ocrRequest<{ Id: string }>(api, 'POST', '/Jobs', { ItemId: 'i' });

        expect(response.data.Id).toBe('j1');
        expect(request).toHaveBeenCalledWith({
            method: 'POST',
            url: 'https://server/SubtitleOcr/Jobs',
            data: { ItemId: 'i' },
            headers: { Authorization: 'MediaBrowser Token="t"' },
            signal: undefined
        });
    });

    it('merges extra axios config, such as responseType, without dropping the auth header', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, data: new Blob() });
        const api = {
            basePath: 'https://server',
            authorizationHeader: 'MediaBrowser Token="t"',
            axiosInstance: { request }
        } as unknown as Api;

        await ocrRequest<Blob>(api, 'GET', '/Jobs/j1/Crops/3', undefined, undefined, { responseType: 'blob' });

        expect(request).toHaveBeenCalledWith({
            method: 'GET',
            url: 'https://server/SubtitleOcr/Jobs/j1/Crops/3',
            data: undefined,
            headers: { Authorization: 'MediaBrowser Token="t"' },
            signal: undefined,
            responseType: 'blob'
        });
    });
});

describe('statusOf', () => {
    it('returns the response status of an axios error', () => {
        const error = new AxiosError('conflict', '409', undefined, undefined, {
            status: 409, statusText: 'Conflict', data: {}, headers: {}, config: { headers: {} } as never
        });

        expect(statusOf(error)).toBe(409);
    });

    it('returns undefined for other errors', () => {
        expect(statusOf(new Error('x'))).toBeUndefined();
        expect(statusOf(undefined)).toBeUndefined();
    });
});

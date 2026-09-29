import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';

import { BITMAP_CODECS, TEXT_SRT_CODECS } from '../constants';
import type { EligibleTrack } from '../types';

const normalizeLanguage = (language?: string | null) => (language || '').toLowerCase();

const isBitmapSubtitle = (stream: MediaStream) =>
    stream.Type === 'Subtitle' && BITMAP_CODECS.includes((stream.Codec || '').toLowerCase());

const isExternalSrt = (stream: MediaStream) =>
    stream.Type === 'Subtitle'
    && stream.IsExternal === true
    && TEXT_SRT_CODECS.includes((stream.Codec || '').toLowerCase());

/**
 * Lists the PGS and VobSub subtitle streams of an item that have no external SRT of the same language
 * in the same media source. The order follows the media sources and their streams.
 */
export const eligibleTracks = (item: Pick<BaseItemDto, 'MediaSources'>): EligibleTrack[] => {
    const tracks: EligibleTrack[] = [];

    for (const source of item.MediaSources || []) {
        const streams = source.MediaStreams || [];
        const srtLanguages = new Set(streams.filter(isExternalSrt).map(s => normalizeLanguage(s.Language)));

        for (const stream of streams) {
            if (!isBitmapSubtitle(stream) || srtLanguages.has(normalizeLanguage(stream.Language))) {
                continue;
            }

            tracks.push({
                mediaSourceId: source.Id || '',
                streamIndex: stream.Index ?? 0,
                codec: (stream.Codec || '').toLowerCase(),
                language: stream.Language || undefined,
                isForced: stream.IsForced === true,
                displayTitle: stream.DisplayTitle || ''
            });
        }
    }

    return tracks;
};

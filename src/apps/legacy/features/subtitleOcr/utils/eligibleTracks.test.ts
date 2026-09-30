import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import { describe, expect, it } from 'vitest';

import { eligibleTracks } from './eligibleTracks';

const stream = (overrides: Partial<MediaStream>): MediaStream => ({
    Type: 'Subtitle',
    Index: 0,
    IsExternal: false,
    IsForced: false,
    DisplayTitle: 'Subtitle',
    ...overrides
});

const source = (id: string, streams: MediaStream[]): MediaSourceInfo => ({
    Id: id,
    MediaStreams: streams
});

describe('eligibleTracks', () => {
    it('returns PGS and VobSub subtitle streams regardless of codec case', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng', DisplayTitle: 'English PGS' }),
            stream({ Index: 3, Codec: 'dvdsub', Language: 'ger' }),
            stream({ Index: 4, Codec: 'VobSub', Language: 'fre' })
        ]) ] };

        const result = eligibleTracks(item);

        expect(result.map(t => t.streamIndex)).toEqual([ 2, 3, 4 ]);
        expect(result[0]).toEqual({
            mediaSourceId: 's1',
            streamIndex: 2,
            codec: 'pgssub',
            language: 'eng',
            isForced: false,
            displayTitle: 'English PGS'
        });
    });

    it('ignores non-subtitle streams and text subtitle streams', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 0, Type: 'Video', Codec: 'h264' }),
            stream({ Index: 1, Type: 'Audio', Codec: 'aac' }),
            stream({ Index: 2, Codec: 'srt', Language: 'eng' }),
            stream({ Index: 3, Codec: 'ass', Language: 'eng' })
        ]) ] };

        expect(eligibleTracks(item)).toEqual([]);
    });

    it('excludes a bitmap track when an external SRT of the same language exists, comparing case-insensitively', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'ENG' }),
            stream({ Index: 3, Codec: 'PGSSUB', Language: 'ger' }),
            stream({ Index: 10, Codec: 'subrip', Language: 'eng', IsExternal: true })
        ]) ] };

        expect(eligibleTracks(item).map(t => t.streamIndex)).toEqual([ 3 ]);
    });

    it('does not exclude when the SRT of the same language is internal', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' }),
            stream({ Index: 3, Codec: 'srt', Language: 'eng', IsExternal: false })
        ]) ] };

        expect(eligibleTracks(item).map(t => t.streamIndex)).toEqual([ 2 ]);
    });

    it('treats two missing languages as equal', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'DVDSUB', Language: null }),
            stream({ Index: 3, Codec: 'srt', IsExternal: true })
        ]) ] };

        expect(eligibleTracks(item)).toEqual([]);
    });

    it('evaluates each media source separately and keeps source order', () => {
        const item = { MediaSources: [
            source('s1', [
                stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' }),
                stream({ Index: 3, Codec: 'srt', Language: 'eng', IsExternal: true })
            ]),
            source('s2', [
                stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' })
            ])
        ] };

        expect(eligibleTracks(item)).toEqual([ {
            mediaSourceId: 's2',
            streamIndex: 2,
            codec: 'pgssub',
            language: 'eng',
            isForced: false,
            displayTitle: 'Subtitle'
        } ]);
    });

    it('returns an empty list when there are no media sources', () => {
        expect(eligibleTracks({})).toEqual([]);
        expect(eligibleTracks({ MediaSources: null })).toEqual([]);
    });
});

import type { EncodingOptions } from '@jellyfin/sdk/lib/generated-client/models/encoding-options';

/**
 * Server encoding options that are newer than the bundled SDK.
 * Added by the server branch feature/subtitle-burn-in-engine; remove once the SDK is regenerated.
 */
export interface BurnInEncodingOptions {
    /** Burn text subtitles (srt, vtt, mov_text) into the video by default. Server default: true. */
    BurnInTextSubtitles?: boolean;
    /** Font size in pixels on a 1080p frame, scaled for other resolutions. Server accepts 8..200, default 48. */
    BurnInSubtitleFontSize1080p?: number;
    /** Outline width in pixels on a 1080p frame. Server accepts 0..20, default 2. */
    BurnInSubtitleOutlineWidth1080p?: number;
}

export type ExtendedEncodingOptions = EncodingOptions & BurnInEncodingOptions;

export const BURN_IN_FONT_SIZE_MIN = 8;
export const BURN_IN_FONT_SIZE_MAX = 200;
export const BURN_IN_OUTLINE_MIN = 0;
export const BURN_IN_OUTLINE_MAX = 20;

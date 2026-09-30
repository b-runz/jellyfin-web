import type { JobState } from '../types';

export const QUERY_KEY = 'SubtitleOcr';

export const ROUTE_PATH = 'subtitleocr';
export const ITEM_ID_PARAM = 'itemId';
export const SERVER_ID_PARAM = 'serverId';
export const JOB_ID_PARAM = 'jobId';

/** States in which the server is working and the page polls. */
export const PROGRESS_STATES: JobState[] = [ 'Extracting', 'Uploading', 'Recognising' ];

export const POLL_INTERVAL_MS = 1000;
export const POLL_BACKOFF_MAX_MS = 10000;

export const BITMAP_CODECS = [ 'pgssub', 'dvdsub', 'vobsub' ];
export const TEXT_SRT_CODECS = [ 'srt', 'subrip' ];

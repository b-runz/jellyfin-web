import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type ChangeEvent, type FC, useCallback } from 'react';

import globalize from 'lib/globalize';

import type { Review } from '../types';
import { isReviewComplete, splitReview } from '../utils/review';
import ResolvedLinesList from './ResolvedLinesList';
import UncertainLineCard from './UncertainLineCard';

interface ReviewTableProps {
    jobId: string;
    review: Review;
    /** Keyed by `ReviewLine.Index`: the text the user has picked or typed for that uncertain line. */
    decisions: Record<number, string>;
    onDecide: (index: number, text: string) => void;
    namesText: string;
    onNamesTextChange: (value: string) => void;
    onFinish: () => void;
    isFinishing: boolean;
    /** Error from a failed Accept; decisions and names stay so the user can retry. */
    error?: string | null;
}

const ReviewTable: FC<ReviewTableProps> = ({
    jobId, review, decisions, onDecide, namesText, onNamesTextChange, onFinish, isFinishing, error
}) => {
    const split = splitReview(review);

    const onNamesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        onNamesTextChange(event.target.value);
    }, [ onNamesTextChange ]);

    return (
        <Stack spacing={2}>
            <Typography variant='h2' component='h2'>{globalize.translate('SubtitleOcrReviewTitle')}</Typography>

            {split.uncertainLines.map(line => (
                <UncertainLineCard
                    key={line.Index}
                    jobId={jobId}
                    line={line}
                    decision={decisions[line.Index]}
                    // eslint-disable-next-line react/jsx-no-bind
                    onDecide={text => onDecide(line.Index, text)}
                />
            ))}

            <ResolvedLinesList lines={split.resolvedLines} />

            <TextField
                label={globalize.translate('SubtitleOcrNamesLabel')}
                placeholder={globalize.translate('SubtitleOcrNamesPlaceholder')}
                value={namesText}
                onChange={onNamesChange}
                fullWidth
                size='small'
            />

            {error && <Alert severity='error'>{error}</Alert>}

            <Stack direction='row' justifyContent='flex-end'>
                <Button
                    variant='contained'
                    disabled={!isReviewComplete(split, decisions) || isFinishing}
                    onClick={onFinish}
                >
                    {globalize.translate(error ? 'SubtitleOcrRetry' : 'SubtitleOcrFinish')}
                </Button>
            </Stack>
        </Stack>
    );
};

export default ReviewTable;

import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type ChangeEvent, type FC, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';
import globalize from 'lib/globalize';

import type { ReviewLine } from '../types';
import LineCropImage from './LineCropImage';

interface UncertainLineCardProps {
    jobId: string;
    line: ReviewLine;
    /** The text the user has picked or typed for this line so far, if any. */
    decision?: string;
    onDecide: (text: string) => void;
}

/**
 * One uncertain line: crop image, scored candidate buttons and a free-text override. Structurally
 * the direct successor of the old per-glyph picker, operating on a whole line's text instead of one
 * letter shape.
 */
const UncertainLineCard: FC<UncertainLineCardProps> = ({ jobId, line, decision, onDecide }) => {
    const [ text, setText ] = useState(decision ?? '');
    const inputRef = useRef<HTMLInputElement>(null);
    const useHardwareKeyboardFocus = !layoutManager.mobile;

    useEffect(() => {
        if (useHardwareKeyboardFocus) {
            inputRef.current?.focus();
        }
    }, [ useHardwareKeyboardFocus ]);

    // On touch layouts a hardware keyboard should still work without tapping the field first. Only
    // grabs focus when no text input anywhere on the page currently has it: `ReviewTable` mounts one
    // of these per uncertain line, so a per-card listener that stole focus back whenever it wasn't its
    // *own* input focused would fight every sibling card (and the names field) on every keystroke.
    useEffect(() => {
        if (useHardwareKeyboardFocus) return;

        const onKeyDown = (event: KeyboardEvent) => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                inputRef.current?.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [ useHardwareKeyboardFocus ]);

    const submit = useCallback((value: string) => {
        if (!value) return;
        onDecide(value);
    }, [ onDecide ]);

    const onSubmit = useCallback((event: FormEvent) => {
        event.preventDefault();
        submit(text);
    }, [ submit, text ]);

    const onTextChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        setText(event.target.value);
    }, []);

    return (
        <Card variant='outlined'>
            <CardContent>
                <Stack spacing={1.5}>
                    <LineCropImage jobId={jobId} index={line.Index} />

                    {line.Candidates.length > 0 && (
                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                            {line.Candidates.map(candidate => (
                                <Button
                                    key={candidate.Text}
                                    variant={decision === candidate.Text ? 'contained' : 'outlined'}
                                    // eslint-disable-next-line react/jsx-no-bind
                                    onClick={() => {
                                        setText(candidate.Text);
                                        submit(candidate.Text);
                                    }}
                                >
                                    {candidate.Text}
                                    {candidate.Score !== null && (
                                        <Typography component='span' variant='caption' sx={{ ml: 0.75, opacity: 0.7 }}>
                                            {candidate.Score.toFixed(2)}
                                        </Typography>
                                    )}
                                </Button>
                            ))}
                        </Stack>
                    )}

                    <form onSubmit={onSubmit}>
                        <Stack direction='row' spacing={1}>
                            <TextField
                                inputRef={inputRef}
                                label={globalize.translate('SubtitleOcrTypeCorrection')}
                                value={text}
                                onChange={onTextChange}
                                size='small'
                                autoComplete='off'
                                slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
                                sx={{ flexGrow: 1 }}
                            />
                            <Button type='submit' variant='contained' disabled={!text}>
                                {globalize.translate('ButtonOk')}
                            </Button>
                        </Stack>
                    </form>

                    {decision !== undefined && (
                        <Typography variant='body2' color='text.secondary'>{decision}</Typography>
                    )}
                </Stack>
            </CardContent>
        </Card>
    );
};

export default UncertainLineCard;

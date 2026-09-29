import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React, { type FC, useCallback, useState } from 'react';

import globalize from 'lib/globalize';

import type { ReviewLine } from '../types';
import DiffText from './DiffText';

interface ResolvedLinesListProps {
    lines: ReviewLine[];
}

/**
 * Certain and adjudicated lines need no decision; they are listed collapsed for audit, with no crop
 * images fetched (a full movie can have well over a thousand of these, so eagerly loading a crop per
 * row would be prohibitively expensive; the diff text alone is enough to audit a run).
 */
const ResolvedLinesList: FC<ResolvedLinesListProps> = ({ lines }) => {
    const [ open, setOpen ] = useState(false);

    const toggleOpen = useCallback(() => setOpen(o => !o), []);

    if (lines.length === 0) return null;

    return (
        <>
            <Typography
                variant='body2'
                sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={toggleOpen}
            >
                {globalize.translate('SubtitleOcrResolvedCount', lines.length)}
            </Typography>
            <Collapse in={open}>
                <List dense>
                    {lines.map(line => (
                        <ListItem key={line.Index} divider>
                            <ListItemText
                                primary={<DiffText original={line.OcrText} corrected={line.ChosenText} />}
                                secondary={line.Certainty === 'adjudicated' ? (
                                    <Tooltip title={line.Adjudication?.ModelId || ''}>
                                        <span>{globalize.translate('SubtitleOcrAdjudicatedBy')}</span>
                                    </Tooltip>
                                ) : undefined}
                            />
                        </ListItem>
                    ))}
                </List>
            </Collapse>
        </>
    );
};

export default ResolvedLinesList;

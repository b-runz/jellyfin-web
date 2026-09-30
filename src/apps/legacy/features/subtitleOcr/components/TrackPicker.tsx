import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { EligibleTrack } from '../types';

interface TrackPickerProps {
    tracks: EligibleTrack[];
    onSelect: (track: EligibleTrack) => void;
    disabled?: boolean;
}

const TrackPicker: FC<TrackPickerProps> = ({ tracks, onSelect, disabled = false }) => (
    <>
        <Typography variant='h2' component='h2' sx={{ mb: 1 }}>
            {globalize.translate('SubtitleOcrPickTrack')}
        </Typography>
        <List>
            {tracks.map(track => (
                <ListItem
                    key={`${track.mediaSourceId}-${track.streamIndex}`}
                    secondaryAction={
                        <Button
                            variant='contained'
                            disabled={disabled}
                            // eslint-disable-next-line react/jsx-no-bind
                            onClick={() => onSelect(track)}
                        >
                            {globalize.translate('SubtitleOcrConvert')}
                        </Button>
                    }
                >
                    <ListItemText
                        primary={track.displayTitle}
                        secondary={[ track.codec.toUpperCase(), track.language, track.isForced ? globalize.translate('MediaInfoForced') : null ]
                            .filter(Boolean)
                            .join(' · ')}
                    />
                </ListItem>
            ))}
        </List>
    </>
);

export default TrackPicker;

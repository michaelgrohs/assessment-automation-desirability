import React from 'react';
import { Box, Typography, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface ScreenInfoBoxProps {
  whatYouSee: React.ReactNode;
  whatToDo: React.ReactNode;
  example?: React.ReactNode;
}

const infoAccordionSx = {
  backgroundColor: '#f5f5f5',
  border: '1px solid #e0e0e0',
  borderRadius: '8px !important',
  boxShadow: 'none',
  '&:before': { display: 'none' },
};

const exampleAccordionSx = {
  backgroundColor: '#fff8e1',
  border: '1px solid #ffe082',
  borderRadius: '8px !important',
  boxShadow: 'none',
  '&:before': { display: 'none' },
};

const summarySx = {
  minHeight: 36,
  '& .MuiAccordionSummary-content': { my: 0.5 },
};

const ScreenInfoBox: React.FC<ScreenInfoBoxProps> = ({ whatYouSee, whatToDo, example }) => (
  <Box sx={{ mb: 2.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
    <Accordion defaultExpanded={false} disableGutters sx={infoAccordionSx}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>What you see</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {typeof whatYouSee === 'string'
          ? <Typography variant="body2" color="text.secondary">{whatYouSee}</Typography>
          : whatYouSee}
      </AccordionDetails>
    </Accordion>

    <Accordion defaultExpanded={false} disableGutters sx={infoAccordionSx}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>What to do</Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        {typeof whatToDo === 'string'
          ? <Typography variant="body2" color="text.secondary">{whatToDo}</Typography>
          : whatToDo}
      </AccordionDetails>
    </Accordion>

    {example && (
      <Accordion defaultExpanded={false} disableGutters sx={exampleAccordionSx}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={summarySx}>
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#795548' }}>Example</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          {example}
        </AccordionDetails>
      </Accordion>
    )}
  </Box>
);

export default ScreenInfoBox;
import React from 'react';
import { Box, Step, StepLabel, Stepper } from '@mui/material';
import { useLocation } from 'react-router-dom';

const STEPS = [
  {
    label: 'Check Logging Error',
    routes: ['/log-quality', '/log-deviations'],
  },
  {
    label: 'Check Model Error',
    routes: ['/model-check'],
  },
  {
    label: 'Check Model Exception',
    routes: ['/deviation-selection'],
  },
  {
    label: 'Evaluate Impact',
    routes: ['/select-dimensions', '/causal-results'],
  },
  {
    label: 'Evaluate Possible Reaction',
    routes: ['/criticality-results'],
  },
];

const StepProgressBar: React.FC = () => {
  const { pathname } = useLocation();

  const activeStep = STEPS.findIndex((s) => s.routes.includes(pathname));

  return (
    <Box
      sx={{
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #e0e0e0',
        px: 3,
        py: 1.5,
      }}
    >
      <Stepper activeStep={activeStep} alternativeLabel>
        {STEPS.map((step) => (
          <Step key={step.label}>
            <StepLabel
              sx={{
                '& .MuiStepLabel-label': {
                  fontSize: '0.7rem',
                  mt: 0.5,
                },
              }}
            >
              {step.label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>
    </Box>
  );
};

export default StepProgressBar;

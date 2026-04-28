import React from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { useLocation } from 'react-router-dom';
import AccountTreeIcon from '@mui/icons-material/AccountTree';

// ── Step definitions ──────────────────────────────────────────────────────────

const PHASE1_STEPS = [
  { label: '1. Log Error Check', routes: ['/log-quality', '/log-deviations'] },
  { label: '2. Model Error Check', routes: ['/model-check'] },
  { label: '3. Model Exceptions', routes: ['/deviation-selection'] },
];

const STEP4_ROUTES = ['/select-dimensions', '/causal-results', '/risks-opportunities', '/overview'];
const STEP4_1_ROUTES = ['/select-dimensions', '/causal-results', '/overview'];
const STEP4_2_ROUTES = ['/risks-opportunities'];
const STEP5_ROUTES = ['/recommendations'];
const STEP6_ROUTES = ['/final-report'];

const AGGREGATION_ROUTES = ['/issue-grouping', '/workaround-analysis'];

// ── Sub-components ─────────────────────────────────────────────────────────────

const StepNode: React.FC<{
  label: string;
  state: 'done' | 'active' | 'pending';
}> = ({ label, state }) => {
  const bg = state === 'active' ? '#1976d2' : state === 'done' ? '#4caf50' : '#e0e0e0';
  const textColor = state === 'pending' ? '#9e9e9e' : '#fff';
  const fontWeight = state === 'active' ? 700 : 400;
  return (
    <Box display="flex" flexDirection="column" alignItems="center" sx={{ minWidth: 90 }}>
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          backgroundColor: bg,
          mb: 0.5,
          transition: 'background-color 0.2s',
        }}
      />
      <Typography
        variant="caption"
        sx={{ color: textColor === '#fff' && state !== 'active' ? (state === 'done' ? '#2e7d32' : '#9e9e9e') : (state === 'active' ? '#1976d2' : '#9e9e9e'), fontSize: '0.65rem', textAlign: 'center', fontWeight, lineHeight: 1.2 }}
      >
        {label}
      </Typography>
    </Box>
  );
};

const Connector: React.FC<{ done: boolean }> = ({ done }) => (
  <Box
    sx={{
      flex: 1,
      height: 2,
      backgroundColor: done ? '#4caf50' : '#e0e0e0',
      mt: '5px',
      mx: 0.5,
      minWidth: 16,
      transition: 'background-color 0.2s',
    }}
  />
);

// ── Main component ─────────────────────────────────────────────────────────────

const StepProgressBar: React.FC = () => {
  const { pathname } = useLocation();

  const isAggregation = AGGREGATION_ROUTES.includes(pathname);
  const inStep4 = STEP4_ROUTES.includes(pathname);
  const inStep5 = STEP5_ROUTES.includes(pathname);
  const inStep6 = STEP6_ROUTES.includes(pathname);
  // Unfold step 4 into 4.1/4.2 once the user reaches step 4 or beyond
  const step4Expanded = inStep4 || inStep5 || inStep6;

  const allPhase2Routes = [...STEP4_ROUTES, ...STEP5_ROUTES, ...STEP6_ROUTES];

  const getPhase1State = (routes: string[]): 'done' | 'active' | 'pending' => {
    if (routes.includes(pathname)) return 'active';
    if (isAggregation) return 'done';
    if (allPhase2Routes.includes(pathname)) return 'done';
    const thisIdx = PHASE1_STEPS.findIndex((s) => s.routes.includes(pathname));
    const myIdx = PHASE1_STEPS.findIndex((s) => s.routes.some((r) => routes.includes(r)));
    if (thisIdx === -1) return 'pending';
    return myIdx < thisIdx ? 'done' : 'pending';
  };

  // Step-4 state helpers
  const step4CollapseState: 'done' | 'active' | 'pending' = inStep4 ? 'active' : inStep5 ? 'done' : 'pending';
  const step41State: 'done' | 'active' | 'pending' = STEP4_1_ROUTES.includes(pathname) ? 'active' : (STEP4_2_ROUTES.includes(pathname) || inStep5 || inStep6) ? 'done' : 'pending';
  const step42State: 'done' | 'active' | 'pending' = STEP4_2_ROUTES.includes(pathname) ? 'active' : (inStep5 || inStep6) ? 'done' : 'pending';
  const step5State: 'done' | 'active' | 'pending' = STEP5_ROUTES.includes(pathname) ? 'active' : inStep6 ? 'done' : 'pending';
  const step6State: 'done' | 'active' | 'pending' = STEP6_ROUTES.includes(pathname) ? 'active' : 'pending';

  const phase1Done = isAggregation || allPhase2Routes.includes(pathname);
  const aggregationState: 'done' | 'active' | 'pending' = isAggregation
    ? 'active'
    : allPhase2Routes.includes(pathname)
      ? 'done'
      : 'pending';

  return (
    <Box
      sx={{
        backgroundColor: '#fafafa',
        borderBottom: '1px solid #e0e0e0',
        px: 3,
        py: 1.5,
      }}
    >
      {/* Phase labels */}
      <Box display="flex" alignItems="center" mb={0.75}>
        {/* Phase 1 label */}
        <Box sx={{ flex: 3 * PHASE1_STEPS.length, display: 'flex', justifyContent: 'center' }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              fontSize: '0.6rem',
              letterSpacing: 0.5,
              color: phase1Done ? '#2e7d32' : PHASE1_STEPS.some((s) => s.routes.includes(pathname)) ? '#1976d2' : '#9e9e9e',
              textTransform: 'uppercase',
            }}
          >
            Individual-level Analysis
          </Typography>
        </Box>

        {/* Spacer for aggregation node */}
        <Box sx={{ width: 80 }} />

        {/* Phase 2 label */}
        <Box sx={{ flex: step4Expanded ? 9 : 6, display: 'flex', justifyContent: 'center' }}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              fontSize: '0.6rem',
              letterSpacing: 0.5,
              color: allPhase2Routes.includes(pathname) ? '#1976d2' : '#9e9e9e',
              textTransform: 'uppercase',
            }}
          >
            Aggregated-level Analysis
          </Typography>
        </Box>
      </Box>

      {/* Steps row */}
      <Box display="flex" alignItems="center">
        {/* Phase 1 steps */}
        {PHASE1_STEPS.map((step, i) => (
          <React.Fragment key={step.label}>
            <StepNode label={step.label} state={getPhase1State(step.routes)} />
            {i < PHASE1_STEPS.length - 1 && (
              <Connector done={getPhase1State(PHASE1_STEPS[i + 1].routes) !== 'pending' || getPhase1State(step.routes) === 'done'} />
            )}
          </React.Fragment>
        ))}

        {/* Connector into aggregation */}
        <Connector done={phase1Done} />

        {/* Aggregation node */}
        <Tooltip title="Aggregation — group individual deviations into issues and configure analysis" arrow>
          <Box display="flex" flexDirection="column" alignItems="center" sx={{ mx: 0.5, cursor: 'default', minWidth: 72 }}>
            <Box
              sx={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                backgroundColor: aggregationState === 'active' ? '#7b1fa2' : aggregationState === 'done' ? '#4caf50' : '#e0e0e0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mb: 0.5,
                transition: 'background-color 0.2s',
                boxShadow: aggregationState === 'active' ? '0 0 0 3px rgba(123,31,162,0.25)' : undefined,
              }}
            >
              <AccountTreeIcon sx={{ fontSize: 14, color: aggregationState === 'pending' ? '#bdbdbd' : '#fff' }} />
            </Box>
            <Typography
              variant="caption"
              sx={{
                fontSize: '0.6rem',
                textAlign: 'center',
                fontWeight: aggregationState === 'active' ? 700 : 400,
                color: aggregationState === 'active' ? '#7b1fa2' : aggregationState === 'done' ? '#2e7d32' : '#9e9e9e',
                lineHeight: 1.2,
              }}
            >
              Aggregate
            </Typography>
          </Box>
        </Tooltip>

        {/* Connector out of aggregation */}
        <Connector done={aggregationState === 'done'} />

        {/* Phase 2 steps — step 4 expands to 4.1/4.2 once reached */}
        {step4Expanded ? (
          <>
            {/* Step 4 group */}
            <Box display="flex" flexDirection="column" alignItems="center" sx={{ position: 'relative' }}>
              <Typography variant="caption" sx={{ fontSize: '0.55rem', fontWeight: 700, color: inStep4 ? '#1976d2' : inStep5 ? '#2e7d32' : '#9e9e9e', letterSpacing: 0.3, mb: 0.25, textTransform: 'uppercase' }}>
                Step 4
              </Typography>
              <Box display="flex" alignItems="center">
                <StepNode label="4.1 Direct Impact" state={step41State} />
                <Connector done={step42State !== 'pending' || step41State === 'done'} />
                <StepNode label="4.2 Risks & Opps" state={step42State} />
              </Box>
            </Box>
            <Connector done={step5State !== 'pending' || step42State === 'done'} />
            <StepNode label="5. Recommendations" state={step5State} />
            <Connector done={step6State !== 'pending' || step5State === 'done'} />
            <StepNode label="6. Final Report" state={step6State} />
          </>
        ) : (
          <>
            <StepNode label="4. Evaluate Impact" state={step4CollapseState} />
            <Connector done={step5State !== 'pending'} />
            <StepNode label="5. Recommendations" state={step5State} />
            <Connector done={step6State !== 'pending' || step5State === 'done'} />
            <StepNode label="6. Final Report" state={step6State} />
          </>
        )}
      </Box>
    </Box>
  );
};

export default StepProgressBar;

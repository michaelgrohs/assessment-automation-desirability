import React, { useState } from 'react';
import {
  Box,
  Alert,
  Button,
  Collapse,
  Typography,
  Chip,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useFileContext } from './FileContext';

const FilterBanner: React.FC = () => {
  const { filterResult, filterSummary, clearAllFilters } = useFileContext();
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState(false);

  if (!filterResult?.isFiltered) return null;

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearAllFilters();
    } finally {
      setClearing(false);
    }
  };

  const byStep = filterResult.excludedByStep ?? {};

  // Per-step case counts
  const step1Cases = (byStep['step1'] ?? []);
  const step1bCases = (byStep['step1b'] ?? []);
  const step3Cases = (byStep['step3'] ?? []);

  // Variant counts from filterSummary (case count from excludedByStep when available)
  const step1VariantCount = filterSummary.step1_variant_sequences.length;
  const step3VariantCount = filterSummary.step3_variant_sequences.length;

  const makeIdTooltip = (ids: string[]) => {
    if (ids.length === 0) return '';
    const shown = ids.slice(0, 15).join(', ');
    return ids.length > 15 ? `${shown} … (+${ids.length - 15} more)` : shown;
  };

  return (
    <Box sx={{ px: { xs: 1, md: 3 }, pt: 1 }}>
      <Alert
        severity="warning"
        icon={false}
        sx={{ py: 0.75, '& .MuiAlert-message': { width: '100%' } }}
        action={
          <Button
            size="small"
            color="inherit"
            startIcon={clearing ? <CircularProgress size={14} color="inherit" /> : <FilterAltOffIcon />}
            onClick={handleClear}
            disabled={clearing}
          >
            {clearing ? 'Restoring…' : 'Remove all filters'}
          </Button>
        }
      >
        <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="body2" fontWeight="medium">
            Filtered log active
          </Typography>
          <Chip
            label={`${filterResult.excludedCount} cases removed (${filterResult.filteredCount} of ${filterResult.originalCount} remain)`}
            size="small"
            color="warning"
            variant="outlined"
          />
          <Button
            size="small"
            variant="text"
            color="inherit"
            sx={{ minWidth: 0, p: 0, textTransform: 'none', fontSize: '0.75rem' }}
            onClick={() => setExpanded((v) => !v)}
            endIcon={expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          >
            {expanded ? 'Hide details' : 'Details'}
          </Button>
        </Box>

        <Collapse in={expanded}>
          <Box mt={1} display="flex" gap={2} flexWrap="wrap">
            {step1Cases.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1a — Outliers &amp; Anomalies
                </Typography>
                <Tooltip title={`Case IDs: ${makeIdTooltip(step1Cases)}`} arrow>
                  <Chip label={`${step1Cases.length} case(s) excluded`} size="small" variant="outlined" sx={{ cursor: 'help' }} />
                </Tooltip>
              </Box>
            )}
            {step1VariantCount > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1a — Variant Filtering
                </Typography>
                <Tooltip
                  title={filterSummary.step1_variant_sequences.slice(0, 8).map((s) => s.join(' → ')).join('\n')}
                  arrow
                >
                  <Chip
                    label={`${step1VariantCount} variant(s)${step1Cases.length === 0 && step3Cases.length > 0 ? '' : ''}`}
                    size="small"
                    variant="outlined"
                    sx={{ cursor: 'help' }}
                  />
                </Tooltip>
              </Box>
            )}
            {step1bCases.length > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1b — Logging Error Removals
                </Typography>
                <Tooltip title={`Case IDs: ${makeIdTooltip(step1bCases)}`} arrow>
                  <Chip label={`${step1bCases.length} case(s) excluded`} size="small" variant="outlined" sx={{ cursor: 'help' }} />
                </Tooltip>
              </Box>
            )}
            {(step3Cases.length > 0 || step3VariantCount > 0) && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 3 — Case Exceptions
                </Typography>
                <Tooltip
                  title={step3Cases.length > 0
                    ? `Case IDs: ${makeIdTooltip(step3Cases)}`
                    : filterSummary.step3_variant_sequences.slice(0, 8).map((s) => s.join(' → ')).join('\n')}
                  arrow
                >
                  <Chip
                    label={step3Cases.length > 0
                      ? `${step3Cases.length} case(s) excluded`
                      : `${step3VariantCount} variant(s)`}
                    size="small"
                    variant="outlined"
                    sx={{ cursor: 'help' }}
                  />
                </Tooltip>
              </Box>
            )}
          </Box>
        </Collapse>
      </Alert>
    </Box>
  );
};

export default FilterBanner;

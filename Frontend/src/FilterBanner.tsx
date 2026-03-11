import React, { useState } from 'react';
import {
  Box,
  Alert,
  Button,
  Collapse,
  Typography,
  Chip,
  CircularProgress,
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

  const step1Count = filterSummary.step1_exclude_ids.length;
  const step1VariantCount = filterSummary.step1_variant_sequences.length;
  const step1bCount = filterSummary.step1b_remove_columns.length;
  const step3Count = filterSummary.step3_variant_sequences.length;

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
            startIcon={
              clearing ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <FilterAltOffIcon />
              )
            }
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
            label={`${filterResult.excludedCount} cases removed (${filterResult.originalCount} total)`}
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
            endIcon={
              expanded ? (
                <ExpandLessIcon fontSize="small" />
              ) : (
                <ExpandMoreIcon fontSize="small" />
              )
            }
          >
            {expanded ? 'Hide details' : 'Details'}
          </Button>
        </Box>

        <Collapse in={expanded}>
          <Box mt={1} display="flex" gap={3} flexWrap="wrap">
            {step1Count > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1a — Outliers &amp; Anomalies
                </Typography>
                <Chip label={`${step1Count} case(s) excluded`} size="small" variant="outlined" />
              </Box>
            )}
            {step1VariantCount > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1a — Variant Filtering
                </Typography>
                <Chip label={`${step1VariantCount} variant(s) excluded`} size="small" variant="outlined" />
              </Box>
            )}
            {step1bCount > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 1b — Logging Errors (remove cases)
                </Typography>
                <Chip
                  label={`${step1bCount} deviation(s) selected`}
                  size="small"
                  variant="outlined"
                />
              </Box>
            )}
            {step3Count > 0 && (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                  Step 3 — Case Exceptions
                </Typography>
                <Chip
                  label={`${step3Count} variant(s) excluded`}
                  size="small"
                  variant="outlined"
                />
              </Box>
            )}
          </Box>
        </Collapse>
      </Alert>
    </Box>
  );
};

export default FilterBanner;

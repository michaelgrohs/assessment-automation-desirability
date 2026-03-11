import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Collapse,
  CircularProgress,
  Alert,
  Chip,
  Divider,
  IconButton,
  Tooltip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import BugReportIcon from '@mui/icons-material/BugReport';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useNavigate } from 'react-router-dom';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:5000';

interface Variant {
  sequence: string[];
  count: number;
  percentage: number;
}

interface DeviationItem {
  column: string;
  label: string;
  type: string;
  affected_count: number;
  affected_percentage: number;
  top_variants: Variant[];
}

interface DeviationData {
  deviations: DeviationItem[];
  total_traces: number;
}

type DeviationAction = 'none' | 'ignore' | 'remove';

const typeColor: Record<string, string> = {
  skip: '#c62828',
  insertion: '#1565c0',
};

const DeviationCard: React.FC<{
  item: DeviationItem;
  action: DeviationAction;
  onActionChange: (action: DeviationAction) => void;
}> = ({ item, action, onActionChange }) => {
  const [expanded, setExpanded] = useState(false);
  const chipColor = typeColor[item.type] ?? '#555';

  const borderColor =
    action === 'ignore' ? '#f44336' : action === 'remove' ? '#e65100' : 'divider';
  const borderWidth = action !== 'none' ? 2 : 1;

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderColor,
        borderWidth,
        opacity: action !== 'none' ? 0.85 : 1,
        transition: 'border-color 0.15s, opacity 0.15s',
      }}
    >
      <Box display="flex" alignItems="center" px={2} py={1.5} gap={1} flexWrap="wrap">
        {/* Label + type chip */}
        <Box flex={1} minWidth={200}>
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography
              variant="body1"
              sx={{ textDecoration: action === 'ignore' ? 'line-through' : 'none' }}
            >
              {item.label}
            </Typography>
            <Chip
              label={item.type}
              size="small"
              sx={{ backgroundColor: chipColor, color: '#fff', fontSize: '0.65rem' }}
            />
            {action === 'ignore' && (
              <Chip icon={<BugReportIcon />} label="Logging Error" size="small" color="error" variant="outlined" />
            )}
            {action === 'remove' && (
              <Chip icon={<DeleteSweepIcon />} label="Remove Cases" size="small" color="warning" variant="outlined" />
            )}
          </Box>
        </Box>

        {/* Affected count + bar */}
        <Box display="flex" alignItems="center" gap={2} ml="auto">
          <Box textAlign="right">
            <Typography variant="body2" fontWeight="bold">
              {item.affected_count.toLocaleString('en-US')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              cases ({item.affected_percentage}%)
            </Typography>
          </Box>
          <Box sx={{ width: 80, height: 6, backgroundColor: '#eee', borderRadius: 3, overflow: 'hidden' }}>
            <Box
              sx={{
                height: '100%',
                width: `${item.affected_percentage}%`,
                backgroundColor: action !== 'none' ? '#bdbdbd' : chipColor,
                borderRadius: 3,
              }}
            />
          </Box>
          <IconButton
            size="small"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
      </Box>

      {/* Action toggle */}
      <Box px={2} pb={1.5}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={action}
          onChange={(_, val) => { if (val !== null) onActionChange(val as DeviationAction); }}
        >
          <ToggleButton value="none">Normal</ToggleButton>
          <ToggleButton value="ignore" sx={{ color: '#c62828' }}>
            <BugReportIcon fontSize="small" sx={{ mr: 0.5 }} />
            Ignore (Logging Error)
          </ToggleButton>
          <ToggleButton value="remove" sx={{ color: '#e65100' }}>
            <DeleteSweepIcon fontSize="small" sx={{ mr: 0.5 }} />
            Remove All Cases
          </ToggleButton>
        </ToggleButtonGroup>
        {action === 'ignore' && (
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            This deviation will be hidden in Step 3. No cases are removed.
          </Typography>
        )}
        {action === 'remove' && (
          <Typography variant="caption" color="error" display="block" mt={0.5}>
            All {item.affected_count.toLocaleString('en-US')} case(s) containing this deviation will
            be removed. Click "Apply &amp; Recompute" below to apply.
          </Typography>
        )}
      </Box>

      {/* Variants */}
      <Collapse in={expanded}>
        <Divider />
        <CardContent sx={{ pt: 1.5, pb: '12px !important' }}>
          {item.top_variants.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No variant data available.</Typography>
          ) : (
            <>
              <Typography variant="subtitle2" gutterBottom>
                Top variants containing this deviation
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Activity Sequence</TableCell>
                    <TableCell align="right">Cases</TableCell>
                    <TableCell align="right">% of affected</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {item.top_variants.map((v, i) => (
                    <TableRow key={i}>
                      <TableCell sx={{ color: 'text.secondary', width: 32 }}>{i + 1}</TableCell>
                      <TableCell>
                        <Box display="flex" alignItems="center" flexWrap="wrap" gap={0.5}>
                          {v.sequence.map((act, j) => (
                            <React.Fragment key={j}>
                              <Chip label={act} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                              {j < v.sequence.length - 1 && (
                                <Typography variant="caption" color="text.secondary">→</Typography>
                              )}
                            </React.Fragment>
                          ))}
                        </Box>
                      </TableCell>
                      <TableCell align="right">{v.count.toLocaleString('en-US')}</TableCell>
                      <TableCell align="right">{v.percentage}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Collapse>
    </Card>
  );
};

const LogDeviations: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const { loggingErrorDeviations, setLoggingErrorDeviations, filterSummary, applyAndRecompute } =
    useFileContext();

  const [data, setData] = useState<DeviationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track action per deviation column
  const [deviationActions, setDeviationActions] = useState<Record<string, DeviationAction>>({});

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setContinue({ label: 'Continue', onClick: () => navigate('/model-check') });
    return () => setContinue(null);
  }, [navigate, setContinue]);

  useEffect(() => {
    fetch(`${API_URL}/api/deviation-selection`)
      .then((res) => res.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  // Initialise action map from context on first data load
  useEffect(() => {
    if (!data) return;
    const initial: Record<string, DeviationAction> = {};
    data.deviations.forEach((d) => {
      if (loggingErrorDeviations.includes(d.column)) initial[d.column] = 'ignore';
      else if (filterSummary.step1b_remove_columns.includes(d.column)) initial[d.column] = 'remove';
      else initial[d.column] = 'none';
    });
    setDeviationActions(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const handleActionChange = (column: string, action: DeviationAction) => {
    setDeviationActions((prev) => ({ ...prev, [column]: action }));
    setApplied(false);
    // Sync "ignore" selections immediately to context (no recompute needed)
    if (action === 'ignore') {
      setLoggingErrorDeviations((prev) =>
        prev.includes(column) ? prev : [...prev, column]
      );
    } else {
      setLoggingErrorDeviations((prev) => prev.filter((c) => c !== column));
    }
  };

  const removeColumns = Object.entries(deviationActions)
    .filter(([, a]) => a === 'remove')
    .map(([col]) => col);

  const handleApplyAndRecompute = async () => {
    setApplying(true);
    setApplied(false);
    try {
      await applyAndRecompute({ ...filterSummary, step1b_remove_columns: removeColumns });
      setApplied(true);
    } catch (err) {
      console.error('Recompute failed:', err);
    } finally {
      setApplying(false);
    }
  };

  const clearAll = () => {
    if (!data) return;
    const reset: Record<string, DeviationAction> = {};
    data.deviations.forEach((d) => { reset[d.column] = 'none'; });
    setDeviationActions(reset);
    setLoggingErrorDeviations([]);
    setApplied(false);
  };

  if (loading) {
    return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error" sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>{error}</Alert>;
  }
  if (!data) return null;

  const ignoreCount = Object.values(deviationActions).filter((a) => a === 'ignore').length;
  const removeCount = removeColumns.length;
  const anyAction = ignoreCount > 0 || removeCount > 0;

  return (
    <Box sx={{ maxWidth: 960, margin: '0 auto', p: 3 }}>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="h5" fontWeight="bold">Step 1b: Identify Logging Error Deviations</Typography>
        <Tooltip
          title="Some deviations may not reflect genuine process exceptions but rather logging errors — e.g., activities that were performed but not recorded. Per deviation you can: Ignore it (hidden in Step 3, no cases removed) or Remove All Cases (all affected cases are filtered out and alignments are recomputed)."
          arrow placement="right"
        >
          <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        For each deviation, choose an action. "Ignore" hides it from Step 3 without removing cases.
        "Remove All Cases" filters out every case that contains this deviation and triggers
        alignment recomputation.
      </Typography>

      {data.deviations.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>No deviations found in the deviation matrix.</Alert>
      )}

      {data.deviations.length > 0 && (
        <>
          <Box display="flex" alignItems="center" justifyContent="space-between" my={2}>
            <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
              {ignoreCount > 0 && (
                <Chip
                  icon={<BugReportIcon />}
                  label={`${ignoreCount} ignored`}
                  color="error"
                  size="small"
                  variant="outlined"
                />
              )}
              {removeCount > 0 && (
                <Chip
                  icon={<DeleteSweepIcon />}
                  label={`${removeCount} set to remove cases`}
                  color="warning"
                  size="small"
                  variant="outlined"
                />
              )}
              {!anyAction && (
                <Typography variant="body2" color="text.secondary">No actions selected yet.</Typography>
              )}
            </Box>
            {anyAction && (
              <Button size="small" variant="text" color="inherit" onClick={clearAll}>
                Clear all
              </Button>
            )}
          </Box>

          {data.deviations.map((item) => (
            <DeviationCard
              key={item.column}
              item={item}
              action={deviationActions[item.column] ?? 'none'}
              onActionChange={(a) => handleActionChange(item.column, a)}
            />
          ))}

          {/* Apply & Recompute */}
          {removeCount > 0 && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                  Apply Case Removal &amp; Recompute
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {removeCount} deviation(s) are set to remove all affected cases. Click below to
                  apply the filter and recompute alignments.
                </Typography>
                <Box display="flex" alignItems="center" gap={2} mt={1.5}>
                  <Button
                    variant="contained"
                    size="small"
                    color="warning"
                    onClick={handleApplyAndRecompute}
                    disabled={applying}
                    startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <DeleteSweepIcon />}
                  >
                    {applying ? 'Recomputing…' : 'Apply & Recompute Alignments'}
                  </Button>
                  {applied && (
                    <Chip
                      label="Alignments recomputed successfully"
                      color="success"
                      size="small"
                      icon={<CheckCircleOutlineIcon />}
                    />
                  )}
                </Box>
              </CardContent>
            </Card>
          )}

          {ignoreCount > 0 && (
            <Alert severity="info" sx={{ mt: 2 }}>
              <strong>{ignoreCount}</strong> deviation(s) marked as logging errors will be hidden
              in Step 3 and excluded from causal analysis. No cases are removed for these.
            </Alert>
          )}
        </>
      )}
    </Box>
  );
};

export default LogDeviations;

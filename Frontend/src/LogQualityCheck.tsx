import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  CircularProgress,
  Divider,
  Checkbox,
  FormControlLabel,
  Button,
  Tooltip,
  IconButton,
  Collapse,
  TextField,
} from '@mui/material';
import PlaylistRemoveIcon from '@mui/icons-material/PlaylistRemove';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://127.0.0.1:5000';

interface VariantItem {
  sequence: string[];
  count: number;
  percentage: number;
}

interface AttributeItem {
  name: string;
  missing_count: number;
  missing_percentage: number;
}

interface OutlierItem {
  case_id: string;
  value_seconds?: number;
  value?: number;
  z_score: number;
}

interface LogQualityData {
  total_traces: number;
  total_events: number;
  trace_attributes: AttributeItem[];
  event_attributes: AttributeItem[];
  timestamp_anomalies: {
    out_of_order_count: number;
    out_of_order_case_ids: string[];
  };
  duplicate_case_ids: string[];
  trace_length_stats: { min: number; max: number; mean: number; median: number };
  trace_duration_stats: { min: number; max: number; mean: number; median: number };
  duration_outliers: OutlierItem[];
  length_outliers: OutlierItem[];
}

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
};

const SummaryCard: React.FC<{
  title: string;
  value: string | number;
  severity?: 'ok' | 'warning' | 'neutral';
}> = ({ title, value, severity = 'neutral' }) => {
  const colors: Record<string, string> = { ok: '#2e7d32', warning: '#e65100', neutral: '#1976d2' };
  return (
    <Card sx={{ minWidth: 150, flex: 1 }}>
      <CardContent sx={{ textAlign: 'center', py: 2 }}>
        <Typography variant="h4" sx={{ color: colors[severity], fontWeight: 'bold' }}>
          {typeof value === 'number' ? value.toLocaleString('en-US') : value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
};

const StatRow: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
  <Box display="flex" justifyContent="space-between" py={0.5}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" fontWeight="medium">{value}</Typography>
  </Box>
);

const COMPLETENESS_EXPLANATION =
  'An attribute is "Complete" when every record has a non-null, non-empty value. ' +
  '"Minor gaps" means < 5% of records are missing a value — generally acceptable for analysis. ' +
  '"Missing data" means ≥ 5% of records are missing — this can bias results if missingness is ' +
  'correlated with process deviations.';

const AttributeTable: React.FC<{ items: AttributeItem[] }> = ({ items }) => {
  if (items.length === 0)
    return <Typography variant="body2" color="text.secondary">No attributes found.</Typography>;
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Attribute</TableCell>
          <TableCell align="right">Missing</TableCell>
          <TableCell align="right">% Missing</TableCell>
          <TableCell align="right">Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.name}>
            <TableCell><Typography variant="body2">{item.name}</Typography></TableCell>
            <TableCell align="right">{item.missing_count.toLocaleString('en-US')}</TableCell>
            <TableCell align="right">{item.missing_percentage}%</TableCell>
            <TableCell align="right">
              {item.missing_percentage === 0 ? (
                <Chip label="Complete" size="small" color="success" variant="outlined" />
              ) : item.missing_percentage < 5 ? (
                <Chip label="Minor gaps" size="small" color="warning" variant="outlined" />
              ) : (
                <Chip label="Missing data" size="small" color="error" variant="outlined" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

const OutlierTable: React.FC<{
  outliers: OutlierItem[];
  formatValue: (item: OutlierItem) => string;
  selected: Set<string>;
  onToggle: (id: string) => void;
}> = ({ outliers, formatValue, selected, onToggle }) => (
  <Table size="small">
    <TableHead>
      <TableRow>
        <TableCell padding="checkbox">Exclude</TableCell>
        <TableCell>Case ID</TableCell>
        <TableCell align="right">Value</TableCell>
        <TableCell align="right">Z-score</TableCell>
      </TableRow>
    </TableHead>
    <TableBody>
      {outliers.map((o) => (
        <TableRow key={o.case_id} selected={selected.has(o.case_id)}>
          <TableCell padding="checkbox">
            <Checkbox
              size="small"
              checked={selected.has(o.case_id)}
              onChange={() => onToggle(o.case_id)}
            />
          </TableCell>
          <TableCell><Typography variant="body2">{o.case_id}</Typography></TableCell>
          <TableCell align="right">{formatValue(o)}</TableCell>
          <TableCell align="right">
            <Chip
              label={o.z_score > 0 ? `+${o.z_score.toFixed(2)}σ` : `${o.z_score.toFixed(2)}σ`}
              size="small"
              color={Math.abs(o.z_score) > 5 ? 'error' : 'warning'}
              variant="outlined"
            />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const LogQualityCheck: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const { filterSummary, applyAndRecompute } = useFileContext();

  const [data, setData] = useState<LogQualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Anomaly filter state
  const [excludeOutOfOrder, setExcludeOutOfOrder] = useState(false);
  const [excludeDuplicates, setExcludeDuplicates] = useState(false);

  // Outlier filter state
  const [selectedDurationOutliers, setSelectedDurationOutliers] = useState<Set<string>>(new Set());
  const [selectedLengthOutliers, setSelectedLengthOutliers] = useState<Set<string>>(new Set());
  const [durationExpanded, setDurationExpanded] = useState(false);
  const [lengthExpanded, setLengthExpanded] = useState(false);

  // Z-score threshold for bulk selection
  const [zThreshold, setZThreshold] = useState<number>(3);

  // Variant filtering state
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [markedVariantKeys, setMarkedVariantKeys] = useState<Set<string>>(new Set());
  const [variantsExpanded, setVariantsExpanded] = useState(false);

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setContinue({ label: 'Continue', onClick: () => navigate('/log-deviations') });
    return () => setContinue(null);
  }, [navigate, setContinue]);

  useEffect(() => {
    fetch(`${API_URL}/api/log-quality`)
      .then((res) => res.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });
  }, []);

  useEffect(() => {
    setVariantsLoading(true);
    fetch(`${API_URL}/api/process-variants`)
      .then((res) => res.json())
      .then((d) => { setVariants(d.variants || []); setVariantsLoading(false); })
      .catch(() => setVariantsLoading(false));
  }, []);

  const toggleOutlier = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>
  ) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const variantKey = (seq: string[]) => seq.join('\u0000');

  const toggleVariant = (key: string) => {
    setMarkedVariantKeys((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const selectAllAboveThreshold = () => {
    if (!data) return;
    setSelectedDurationOutliers(
      new Set(
        data.duration_outliers
          .filter((o) => Math.abs(o.z_score) > zThreshold)
          .map((o) => o.case_id)
      )
    );
    setSelectedLengthOutliers(
      new Set(
        data.length_outliers
          .filter((o) => Math.abs(o.z_score) > zThreshold)
          .map((o) => o.case_id)
      )
    );
  };

  const handleApplyAndRecompute = async () => {
    if (!data) return;
    setApplying(true);
    setApplied(false);

    const anomalyIds = [
      ...(excludeOutOfOrder ? data.timestamp_anomalies.out_of_order_case_ids : []),
      ...(excludeDuplicates ? data.duplicate_case_ids : []),
    ];
    const outlierIds = [
      ...Array.from(selectedDurationOutliers),
      ...Array.from(selectedLengthOutliers),
    ];
    const uniqueIds = Array.from(new Set([...anomalyIds, ...outlierIds]));

    const markedVariantSequences = variants
      .filter((v) => markedVariantKeys.has(variantKey(v.sequence)))
      .map((v) => v.sequence);

    try {
      await applyAndRecompute({
        ...filterSummary,
        step1_exclude_ids: uniqueIds,
        step1_variant_sequences: markedVariantSequences,
      });
      setApplied(true);
    } catch (err) {
      console.error('Recompute failed:', err);
    } finally {
      setApplying(false);
    }
  };

  const variantCasesSelected = variants
    .filter((v) => markedVariantKeys.has(variantKey(v.sequence)))
    .reduce((sum, v) => sum + v.count, 0);

  const hasFiltersSelected =
    excludeOutOfOrder ||
    excludeDuplicates ||
    selectedDurationOutliers.size > 0 ||
    selectedLengthOutliers.size > 0 ||
    markedVariantKeys.size > 0;

  const totalSelected =
    (excludeOutOfOrder ? data?.timestamp_anomalies.out_of_order_count ?? 0 : 0) +
    (excludeDuplicates ? data?.duplicate_case_ids.length ?? 0 : 0) +
    selectedDurationOutliers.size +
    selectedLengthOutliers.size +
    variantCasesSelected;

  if (loading) {
    return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error" sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>{error}</Alert>;
  }
  if (!data) return null;

  const hasOutOfOrder = data.timestamp_anomalies.out_of_order_count > 0;
  const hasDuplicates = data.duplicate_case_ids.length > 0;
  const hasAnomalies = hasOutOfOrder || hasDuplicates;
  const hasMissingData =
    data.trace_attributes.some((a) => a.missing_count > 0) ||
    data.event_attributes.some((a) => a.missing_count > 0);
  const hasOutliers = data.duration_outliers.length > 0 || data.length_outliers.length > 0;

  return (
    <Box sx={{ maxWidth: 900, margin: '0 auto', p: 3 }}>
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="h5" fontWeight="bold">Step 1: Log Error Check</Typography>
        <Tooltip
          title="Review data quality issues in your event log before analysis. You can optionally filter out anomalous or outlier cases — deviation statistics will then be recalculated on the remaining cases."
          arrow placement="right"
        >
          <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Filtering is optional. Cases you exclude here will be removed and alignments will be
        recomputed before subsequent steps.
      </Typography>

      {/* Summary cards */}
      <Box display="flex" gap={2} my={3} flexWrap="wrap">
        <SummaryCard title="Total Cases" value={data.total_traces} />
        <SummaryCard title="Total Events" value={data.total_events} />
        <SummaryCard
          title="Avg Events / Case"
          value={(data.total_events / Math.max(data.total_traces, 1)).toFixed(1)}
        />
        <SummaryCard
          title="Data Issues"
          value={
            data.timestamp_anomalies.out_of_order_count +
            data.duplicate_case_ids.length +
            data.duration_outliers.length +
            data.length_outliers.length
          }
          severity={hasAnomalies || hasOutliers ? 'warning' : 'ok'}
        />
      </Box>

      {!hasAnomalies && !hasMissingData && !hasOutliers && (
        <Alert icon={<CheckCircleOutlineIcon />} severity="success" sx={{ mb: 2 }}>
          No data quality issues detected. Your log looks clean.
        </Alert>
      )}
      {hasOutOfOrder && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          <strong>{data.timestamp_anomalies.out_of_order_count}</strong> case(s) contain events with
          out-of-order timestamps.
          {data.timestamp_anomalies.out_of_order_case_ids.length > 0 && (
            <Box mt={0.5}>
              <Typography variant="caption" color="text.secondary">
                Examples: {data.timestamp_anomalies.out_of_order_case_ids.slice(0, 5).join(', ')}
                {data.timestamp_anomalies.out_of_order_case_ids.length > 5 ? ', …' : ''}
              </Typography>
            </Box>
          )}
        </Alert>
      )}
      {hasDuplicates && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <strong>{data.duplicate_case_ids.length}</strong> duplicate case ID(s) found:{' '}
          {data.duplicate_case_ids.slice(0, 5).join(', ')}
          {data.duplicate_case_ids.length > 5 ? ', …' : ''}
        </Alert>
      )}

      {/* Trace statistics */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Trace Statistics</Typography>
          <Box display="flex" gap={4} flexWrap="wrap">
            <Box flex={1} minWidth={200}>
              <Typography variant="subtitle2" gutterBottom>Trace Length (events)</Typography>
              <Divider sx={{ mb: 1 }} />
              <StatRow label="Min" value={data.trace_length_stats.min} />
              <StatRow label="Max" value={data.trace_length_stats.max} />
              <StatRow label="Mean" value={data.trace_length_stats.mean} />
              <StatRow label="Median" value={data.trace_length_stats.median} />
            </Box>
            <Box flex={1} minWidth={200}>
              <Typography variant="subtitle2" gutterBottom>Trace Duration</Typography>
              <Divider sx={{ mb: 1 }} />
              <StatRow label="Min" value={formatDuration(data.trace_duration_stats.min)} />
              <StatRow label="Max" value={formatDuration(data.trace_duration_stats.max)} />
              <StatRow label="Mean" value={formatDuration(data.trace_duration_stats.mean)} />
              <StatRow label="Median" value={formatDuration(data.trace_duration_stats.median)} />
            </Box>
          </Box>
        </CardContent>
      </Card>

      {/* Outlier detection */}
      {hasOutliers && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="h6">Outlier Detection</Typography>
              <Tooltip
                title="Outliers are identified using the Z-score method. Cases whose duration or event count is more than N standard deviations from the mean are flagged. Use the threshold input below to adjust which cases are highlighted."
                arrow placement="right"
              >
                <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
              </Tooltip>
              <Chip
                label={`${data.duration_outliers.length + data.length_outliers.length} outlier(s) flagged`}
                size="small"
                color="warning"
                variant="outlined"
              />
            </Box>

            {/* Z-score threshold controls */}
            <Box display="flex" alignItems="center" gap={2} mb={2} flexWrap="wrap">
              <Typography variant="body2" color="text.secondary">
                Bulk-select all cases with |Z| &gt;
              </Typography>
              <TextField
                type="number"
                size="small"
                value={zThreshold}
                onChange={(e) => setZThreshold(Math.max(0, Number(e.target.value)))}
                inputProps={{ min: 0, step: 0.5 }}
                sx={{ width: 80 }}
              />
              <Button size="small" variant="outlined" onClick={selectAllAboveThreshold}>
                Select all above threshold
              </Button>
              {(selectedDurationOutliers.size > 0 || selectedLengthOutliers.size > 0) && (
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  onClick={() => {
                    setSelectedDurationOutliers(new Set());
                    setSelectedLengthOutliers(new Set());
                  }}
                >
                  Clear selection
                </Button>
              )}
            </Box>

            {/* Duration outliers */}
            {data.duration_outliers.length > 0 && (
              <Box mt={1}>
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ cursor: 'pointer', mb: 0.5 }}
                  onClick={() => setDurationExpanded((v) => !v)}
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="subtitle2">
                      Duration Outliers ({data.duration_outliers.length})
                    </Typography>
                    <Chip
                      label={`${selectedDurationOutliers.size} selected`}
                      size="small"
                      color={selectedDurationOutliers.size > 0 ? 'primary' : 'default'}
                    />
                  </Box>
                  <IconButton size="small">
                    {durationExpanded
                      ? <ExpandLessIcon fontSize="small" />
                      : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Box>
                <Collapse in={durationExpanded}>
                  <OutlierTable
                    outliers={data.duration_outliers}
                    formatValue={(o) => formatDuration(o.value_seconds ?? 0)}
                    selected={selectedDurationOutliers}
                    onToggle={(id) => toggleOutlier(id, setSelectedDurationOutliers)}
                  />
                </Collapse>
              </Box>
            )}

            {/* Length outliers */}
            {data.length_outliers.length > 0 && (
              <Box mt={2}>
                <Box
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  sx={{ cursor: 'pointer', mb: 0.5 }}
                  onClick={() => setLengthExpanded((v) => !v)}
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    <Typography variant="subtitle2">
                      Event Count Outliers ({data.length_outliers.length})
                    </Typography>
                    <Chip
                      label={`${selectedLengthOutliers.size} selected`}
                      size="small"
                      color={selectedLengthOutliers.size > 0 ? 'primary' : 'default'}
                    />
                  </Box>
                  <IconButton size="small">
                    {lengthExpanded
                      ? <ExpandLessIcon fontSize="small" />
                      : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Box>
                <Collapse in={lengthExpanded}>
                  <OutlierTable
                    outliers={data.length_outliers}
                    formatValue={(o) => `${o.value} events`}
                    selected={selectedLengthOutliers}
                    onToggle={(id) => toggleOutlier(id, setSelectedLengthOutliers)}
                  />
                </Collapse>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Case attribute completeness */}
      {data.trace_attributes.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="h6">Case Attribute Completeness</Typography>
              <Tooltip title={COMPLETENESS_EXPLANATION} arrow placement="right">
                <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
              </Tooltip>
              {data.trace_attributes.every((a) => a.missing_count === 0) ? (
                <Chip icon={<CheckCircleOutlineIcon />} label="All complete" size="small" color="success" variant="outlined" />
              ) : (
                <Chip icon={<WarningAmberIcon />} label="Has gaps" size="small" color="warning" variant="outlined" />
              )}
            </Box>
            <AttributeTable items={data.trace_attributes} />
          </CardContent>
        </Card>
      )}

      {/* Event attribute completeness */}
      {data.event_attributes.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <Typography variant="h6">Event Attribute Completeness</Typography>
              <Tooltip title={COMPLETENESS_EXPLANATION} arrow placement="right">
                <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
              </Tooltip>
              {data.event_attributes.every((a) => a.missing_count === 0) ? (
                <Chip icon={<CheckCircleOutlineIcon />} label="All complete" size="small" color="success" variant="outlined" />
              ) : (
                <Chip icon={<WarningAmberIcon />} label="Has gaps" size="small" color="warning" variant="outlined" />
              )}
            </Box>
            <AttributeTable items={data.event_attributes} />
          </CardContent>
        </Card>
      )}

      {/* Process Variant Filtering */}
      {variants.length > 0 && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Box display="flex" alignItems="center" gap={1} mb={1}>
              <PlaylistRemoveIcon color="action" fontSize="small" />
              <Typography variant="h6">Process Variant Filtering</Typography>
              <Tooltip
                title="Mark entire process variants for removal. All cases following the selected activity sequences will be excluded and alignments recomputed."
                arrow
                placement="right"
              >
                <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
              </Tooltip>
              <Chip label={`${variants.length} unique variant(s)`} size="small" variant="outlined" />
            </Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Select entire process variants (activity sequences) to exclude from further analysis.
            </Typography>

            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              sx={{ cursor: 'pointer', mb: 0.5 }}
              onClick={() => setVariantsExpanded((v) => !v)}
            >
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle2">All Variants</Typography>
                <Chip
                  label={`${markedVariantKeys.size} selected`}
                  size="small"
                  color={markedVariantKeys.size > 0 ? 'primary' : 'default'}
                />
              </Box>
              <IconButton size="small">
                {variantsExpanded
                  ? <ExpandLessIcon fontSize="small" />
                  : <ExpandMoreIcon fontSize="small" />}
              </IconButton>
            </Box>

            <Collapse in={variantsExpanded}>
              {variantsLoading ? (
                <CircularProgress size={20} />
              ) : (
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Exclude</TableCell>
                      <TableCell>Activity Sequence</TableCell>
                      <TableCell align="right">Cases</TableCell>
                      <TableCell align="right">Share</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {variants.map((variant) => {
                      const key = variantKey(variant.sequence);
                      return (
                        <TableRow key={key} selected={markedVariantKeys.has(key)}>
                          <TableCell padding="checkbox">
                            <Checkbox
                              size="small"
                              checked={markedVariantKeys.has(key)}
                              onChange={() => toggleVariant(key)}
                            />
                          </TableCell>
                          <TableCell>
                            <Typography
                              variant="body2"
                              sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                            >
                              {variant.sequence.join(' → ')}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">{variant.count}</TableCell>
                          <TableCell align="right">
                            <Chip
                              label={`${variant.percentage}%`}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </Collapse>
          </CardContent>
        </Card>
      )}

      {/* Apply filters section */}
      {(hasAnomalies || hasOutliers || variants.length > 0) && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>Apply Filters &amp; Recompute</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Cases excluded here are removed from the event log. Alignments and deviation
              frequencies are recomputed on the remaining cases before subsequent steps.
            </Typography>

            {hasOutOfOrder && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={excludeOutOfOrder}
                    onChange={(e) => setExcludeOutOfOrder(e.target.checked)}
                  />
                }
                label={`Exclude ${data.timestamp_anomalies.out_of_order_count} out-of-order case(s)`}
              />
            )}
            {hasDuplicates && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={excludeDuplicates}
                    onChange={(e) => setExcludeDuplicates(e.target.checked)}
                  />
                }
                label={`Exclude ${data.duplicate_case_ids.length} duplicate case(s)`}
              />
            )}

            {(selectedDurationOutliers.size > 0 || selectedLengthOutliers.size > 0) && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {selectedDurationOutliers.size + selectedLengthOutliers.size} outlier case(s)
                selected above will be excluded.
              </Typography>
            )}
            {markedVariantKeys.size > 0 && (
              <Typography variant="body2" sx={{ mt: 1 }}>
                {markedVariantKeys.size} variant(s) selected — approx. {variantCasesSelected} case(s) will be excluded.
              </Typography>
            )}

            <Box mt={2} display="flex" alignItems="center" gap={2} flexWrap="wrap">
              <Button
                variant="contained"
                size="small"
                onClick={handleApplyAndRecompute}
                disabled={!hasFiltersSelected || applying}
                startIcon={applying ? <CircularProgress size={14} color="inherit" /> : undefined}
              >
                {applying
                  ? 'Recomputing…'
                  : `Apply & Recompute Alignments${hasFiltersSelected ? ` (${totalSelected} cases)` : ''}`}
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
    </Box>
  );
};

export default LogQualityCheck;

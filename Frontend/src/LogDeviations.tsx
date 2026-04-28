import React, { useEffect, useRef, useState } from 'react';
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
  Paper,
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
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';

interface ModelContent {
  type: 'bpmn' | 'pnml' | 'declarative' | 'declarative-model';
  content?: string;
  constraints?: any[];
}

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:1965';

const UNIT_LABELS: Record<string, string> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
const formatTimeCondition = (tc: TimeCondition): string => {
  const unit = UNIT_LABELS[tc.unit] ?? tc.unit;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (tc.min === tc.max) return `exactly ${fmt(tc.min)} ${unit}`;
  if (tc.min === 0) return `within ${fmt(tc.max)} ${unit}`;
  return `${fmt(tc.min)} – ${fmt(tc.max)} ${unit}`;
};
const formatSeconds = (s: number): string => {
  if (s >= 86400) return `${(s / 86400).toFixed(1)} days`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)} hrs`;
  if (s >= 60) return `${(s / 60).toFixed(1)} min`;
  return `${s.toFixed(0)} s`;
};

interface Variant {
  sequence: string[];
  count: number;
  percentage: number;
}

interface TimeCondition {
  min: number;
  max: number;
  unit: string;
  raw?: string;
}

interface ViolationDiagnostics {
  no_target_count: number;
  target_condition_failed_count: number;
  time_window_violated_count: number;
  time_violation_details: { actual_seconds: number }[];
}

interface DeviationItem {
  column: string;
  label: string;
  type: string;
  affected_count: number;
  affected_percentage: number;
  top_variants: Variant[];
  activation_condition?: string | null;
  correlation_condition?: string | null;
  time_condition?: TimeCondition | null;
  total_activations?: number | null;
  violation_diagnostics?: ViolationDiagnostics | null;
  support?: number | null;
  confidence?: number | null;
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
  const neverActivated = item.total_activations === 0;

  const borderColor =
    action === 'ignore' ? '#f44336' : action === 'remove' ? '#e65100' : 'divider';
  const borderWidth = action !== 'none' ? 2 : 1;

  const diag = item.violation_diagnostics;
  const diagTotal = diag ? diag.no_target_count + diag.target_condition_failed_count + diag.time_window_violated_count : 0;

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderColor,
        borderWidth,
        opacity: action !== 'none' ? 0.85 : 1,
        transition: 'border-color 0.15s, opacity 0.15s',
        backgroundColor: neverActivated ? '#fafafa' : undefined,
      }}
    >
      <Box display="flex" alignItems="flex-start" px={2} py={1.5} gap={1} flexWrap="wrap">
        {/* Label + conditions + stats */}
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

          {/* Activation / Target / Time condition chips */}
          {(item.activation_condition || item.correlation_condition || item.time_condition) && (
            <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5}>
              {item.activation_condition && (
                <Tooltip title={`Activation guard: ${item.activation_condition}`} arrow>
                  <Chip
                    label={`A: ${item.activation_condition.length > 40 ? item.activation_condition.slice(0, 40) + '…' : item.activation_condition}`}
                    size="small" variant="outlined"
                    sx={{ fontSize: 10, borderColor: '#f57c00', color: '#e65100', maxWidth: 320 }}
                  />
                </Tooltip>
              )}
              {item.correlation_condition && (
                <Tooltip title={`Target/correlation guard: ${item.correlation_condition}`} arrow>
                  <Chip
                    label={`T: ${item.correlation_condition.length > 40 ? item.correlation_condition.slice(0, 40) + '…' : item.correlation_condition}`}
                    size="small" variant="outlined"
                    sx={{ fontSize: 10, borderColor: '#7b1fa2', color: '#6a1b9a', maxWidth: 320 }}
                  />
                </Tooltip>
              )}
              {item.time_condition && (
                <Tooltip title={`Time window: ${item.time_condition.raw ?? ''}`} arrow>
                  <Chip
                    label={`⏱ ${formatTimeCondition(item.time_condition)}`}
                    size="small" variant="outlined"
                    sx={{ fontSize: 10, borderColor: '#0288d1', color: '#01579b', maxWidth: 260 }}
                  />
                </Tooltip>
              )}
            </Box>
          )}

          {/* Stats chips */}
          <Box display="flex" flexWrap="wrap" gap={0.5} mt={0.5}>
            <Chip label={`Violations: ${item.affected_count.toLocaleString('en-US')}`} size="small" color="error" variant="outlined" />
            {item.total_activations != null && (
              <Chip
                label={`Activations: ${item.total_activations.toLocaleString('en-US')}`}
                size="small" color={neverActivated ? 'default' : 'success'} variant="outlined"
              />
            )}
            {item.support != null && (
              <Chip label={`Support: ${(item.support * 100).toFixed(1)}%`} size="small" variant="outlined" />
            )}
            {item.confidence != null && (
              <Chip label={`Confidence: ${(item.confidence * 100).toFixed(1)}%`} size="small" variant="outlined" />
            )}
          </Box>

          {neverActivated && (
            <Typography variant="caption" sx={{ color: '#9e9e9e', display: 'block', mt: 0.5 }}>
              Never activated — constraint was not triggered in any trace. Violations are vacuous and can be disregarded.
            </Typography>
          )}

          {/* Violation diagnostics */}
          {diag && !neverActivated && diagTotal > 0 && (
            <Box mt={0.75} p={0.75} sx={{ background: '#fff8e1', borderRadius: 1, border: '1px solid #ffe082' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#e65100', display: 'block', mb: 0.25 }}>
                Violation causes ({diagTotal} activations diagnosed):
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {diag.no_target_count > 0 && (
                  <Tooltip title="Target activity was not found in the required position" arrow>
                    <Chip label={`No target B: ${diag.no_target_count}`} size="small"
                      sx={{ fontSize: 10, background: '#fce4ec', color: '#c62828', border: '1px solid #ef9a9a' }} />
                  </Tooltip>
                )}
                {diag.target_condition_failed_count > 0 && (
                  <Tooltip title="Target B occurred but the T. correlation condition was not satisfied" arrow>
                    <Chip label={`T. condition failed: ${diag.target_condition_failed_count}`} size="small"
                      sx={{ fontSize: 10, background: '#ede7f6', color: '#4527a0', border: '1px solid #b39ddb' }} />
                  </Tooltip>
                )}
                {diag.time_window_violated_count > 0 && (
                  <Tooltip
                    title={diag.time_violation_details?.length > 0
                      ? `Avg actual time: ${formatSeconds(diag.time_violation_details.reduce((s, x) => s + x.actual_seconds, 0) / diag.time_violation_details.length)}`
                      : 'Time window was exceeded'}
                    arrow
                  >
                    <Chip
                      label={`Time window exceeded: ${diag.time_window_violated_count}${item.time_condition ? ` (allowed: ${formatTimeCondition(item.time_condition)})` : ''}`}
                      size="small"
                      sx={{ fontSize: 10, background: '#e3f2fd', color: '#0d47a1', border: '1px solid #90caf9' }}
                    />
                  </Tooltip>
                )}
              </Box>
            </Box>
          )}
        </Box>

        <IconButton
          size="small"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
          sx={{ ml: 1, mt: 0.25 }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      {/* Violation bar */}
      <Box sx={{ height: 6, backgroundColor: '#eee' }}>
        <Box sx={{ height: 6, width: `${item.affected_percentage}%`, backgroundColor: neverActivated ? '#ccc' : (action !== 'none' ? '#bdbdbd' : '#ed6c02') }} />
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
            This deviation will be hidden in the further analysis. No cases are removed.
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
              <Box sx={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
              <Table size="small" stickyHeader>
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
              </Box>
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
  const [modelContent, setModelContent] = useState<ModelContent | null>(null);
  const [modelOpen, setModelOpen] = useState(true);
  const bpmnContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  // Track action per deviation column
  const [deviationActions, setDeviationActions] = useState<Record<string, DeviationAction>>({})

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [autoPreselected, setAutoPreselected] = useState<string[]>([]);

  useEffect(() => {
    setContinue({ label: 'Continue', onClick: () => navigate('/model-check') });
    return () => setContinue(null);
  }, [navigate, setContinue]);

  useEffect(() => {
    fetch(`${API_URL}/api/deviation-selection`)
      .then((res) => res.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });

    fetch(`${API_URL}/api/model-content`)
      .then((res) => res.json())
      .then((d) => setModelContent(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (modelContent?.type !== 'bpmn' || !modelContent.content) return;
    const timer = setTimeout(() => {
      if (!bpmnContainerRef.current) return;
      if (viewerRef.current) viewerRef.current.destroy();
      const viewer = new NavigatedViewer({ container: bpmnContainerRef.current });
      viewerRef.current = viewer;
      viewer.importXML(modelContent.content!).then(() => {
        setTimeout(() => { try { (viewer.get('canvas') as any).zoom('fit-viewport'); } catch (_) {} }, 100);
      }).catch((e: any) => console.error('BPMN render error:', e));
    }, 80);
    return () => {
      clearTimeout(timer);
      if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null; }
    };
  }, [modelContent, modelOpen]);

  // Initialise action map from context on first data load
  useEffect(() => {
    if (!data) return;
    const initial: Record<string, DeviationAction> = {};
    const autoIgnore: string[] = [];

    data.deviations.forEach((d) => {
      if (loggingErrorDeviations.includes(d.column)) {
        initial[d.column] = 'ignore';
      } else if (filterSummary.step1b_remove_columns.includes(d.column)) {
        initial[d.column] = 'remove';
      } else if (d.affected_percentage < 1) {
        // Auto-mark deviations affecting <1% of cases as logging errors
        initial[d.column] = 'ignore';
        autoIgnore.push(d.column);
      } else {
        initial[d.column] = 'none';
      }
    });

    setDeviationActions(initial);

    if (autoIgnore.length > 0) {
      setAutoPreselected(autoIgnore);
      setLoggingErrorDeviations((prev) => {
        const toAdd = autoIgnore.filter((c) => !prev.includes(c));
        return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
      });
    }
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
          title="These are all deviations found in your log. Some may not reflect genuine process exceptions but rather logging errors — e.g., activities that were performed but not recorded. Per deviation you can: Ignore it (excluded from further analysis, no cases removed) or Remove All Cases (all affected cases are filtered out and alignments are recomputed)."
          arrow placement="right"
        >
          <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        These are <strong>all deviations identified during conformance checking</strong>. Before proceeding to
        in-depth analysis, decide for each deviation whether it represents a genuine deviation, a logging
        artefact, or should have its cases removed entirely.
        "Ignore" excludes a deviation from further analysis without removing cases.
        "Remove All Cases" filters out every affected case and recomputes alignments.
      </Typography>

      {/* Process model panel */}
      {modelContent && (
        <Paper variant="outlined" sx={{ mb: 2, mt: 1, overflow: 'hidden' }}>
          <Box
            display="flex" alignItems="center" px={2} py={1}
            sx={{ background: '#f5f5f5', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setModelOpen(v => !v)}
          >
            <Typography variant="subtitle2" sx={{ flex: 1 }}>Process Model</Typography>
            <IconButton size="small" sx={{ p: 0 }}>
              {modelOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Box>
          <Collapse in={modelOpen}>
            <Box
              ref={bpmnContainerRef}
              sx={{
                width: '100%', height: 300, border: 'none', overflow: 'hidden',
                display: modelContent.type === 'bpmn' ? 'block' : 'none',
              }}
            />
            {modelContent.type === 'pnml' && modelContent.content && (
              <Box sx={{ width: '100%', maxHeight: 300, overflowY: 'auto', p: 1,
                '& svg': { width: '100%', height: 'auto' } }}
                dangerouslySetInnerHTML={{ __html: modelContent.content }}
              />
            )}
            {(modelContent.type === 'declarative' || modelContent.type === 'declarative-model') && modelContent.constraints?.length && (
              <Box sx={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto', p: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Type</TableCell>
                      <TableCell>Activity A</TableCell>
                      <TableCell>Activity B</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {modelContent.constraints.map((c: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontSize: 11 }}>{c.type}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{c.op_0}</TableCell>
                        <TableCell sx={{ fontSize: 11 }}>{c.op_1 || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Collapse>
        </Paper>
      )}

      {autoPreselected.length > 0 && (
        <Alert severity="info" sx={{ mt: 1.5, mb: 1 }}>
          <strong>{autoPreselected.length} deviation(s) automatically pre-selected as Logging Errors</strong>:
          deviations occurring in fewer than 1% of cases have been pre-marked as logging errors.
          It is recommended to focus on more frequent deviations, as rare ones are unlikely to reflect
          genuine process behaviour and more likely indicate recording artefacts. You can change any
          pre-selection below.
        </Alert>
      )}

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

          {/* Group by constraint type */}
          {(() => {
            const grouped: Record<string, DeviationItem[]> = {};
            data.deviations.forEach((d) => {
              if (!grouped[d.type]) grouped[d.type] = [];
              grouped[d.type].push(d);
            });
            return Object.entries(grouped).map(([type, items]) => (
              <Card key={type} sx={{ mb: 2 }}>
                <CardContent>
                  <Typography variant="h6" gutterBottom>{type}</Typography>
                  <Divider sx={{ mb: 1.5 }} />
                  {items.map((item) => (
                    <DeviationCard
                      key={item.column}
                      item={item}
                      action={deviationActions[item.column] ?? 'none'}
                      onActionChange={(a) => handleActionChange(item.column, a)}
                    />
                  ))}
                </CardContent>
              </Card>
            ));
          })()}

          {/* Apply & Recompute */}
          {removeCount > 0 && (
            <Card sx={{ mt: 2 }}>
              <CardContent>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                  Apply Case Removal &amp; Recompute
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {removeCount} deviation(s) are set to remove all affected cases. Click below to
                  apply the filter and recompute conformance results.
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
                    {applying ? 'Recomputing…' : 'Apply & Recompute'}
                  </Button>
                  {applied && (
                    <Chip
                      label="Recomputed successfully"
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
              <strong>{ignoreCount}</strong> deviation(s) marked as logging errors will be excluded from further analysis. No cases are removed for these.
            </Alert>
          )}
        </>
      )}

    </Box>
  );
};

export default LogDeviations;

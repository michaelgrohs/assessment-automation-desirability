import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
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
  Paper,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import PlaylistRemoveIcon from '@mui/icons-material/PlaylistRemove';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useNavigate } from 'react-router-dom';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:1965';

const UNIT_LABELS: Record<string, string> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
const formatTimeCondition = (tc: { min: number; max: number; unit: string; raw?: string }): string => {
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

interface DeviationSelectionData {
  deviations: DeviationItem[];
  total_traces: number;
}

interface ModelContent {
  type: 'bpmn' | 'pnml' | 'declarative' | 'declarative-model';
  content?: string;
  constraints?: any[];
}

const typeColor: Record<string, string> = {
  skip: '#c62828',
  insertion: '#1565c0',
};

// ── Deviation card ─────────────────────────────────────────────────────────────
const DeviationCard: React.FC<{
  item: DeviationItem;
  isModelException: boolean;
  onToggleModelException: () => void;
}> = ({ item, isModelException, onToggleModelException }) => {
  const chipColor = typeColor[item.type] ?? '#555';
  const neverActivated = item.total_activations === 0;
  const diag = item.violation_diagnostics;
  const diagTotal = diag ? diag.no_target_count + diag.target_condition_failed_count + diag.time_window_violated_count : 0;

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderColor: isModelException ? '#e0e0e0' : 'divider',
        backgroundColor: neverActivated ? '#fafafa' : undefined,
        opacity: isModelException ? 0.7 : 1,
      }}
    >
      <Box display="flex" alignItems="flex-start" px={2} py={1.5}>
        <Box flex={1}>
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body1"
              sx={{ textDecoration: isModelException ? 'line-through' : 'none', color: isModelException ? 'text.disabled' : undefined }}>
              {item.label}
            </Typography>
            <Chip
              label={item.type}
              size="small"
              sx={{ backgroundColor: chipColor, color: '#fff', fontSize: '0.65rem', opacity: isModelException ? 0.5 : 1 }}
            />
            {isModelException && (
              <Chip label="Model Exception" size="small" color="secondary" variant="outlined" sx={{ fontSize: '0.65rem' }} />
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
              Never activated — constraint was not triggered in any trace.
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
      </Box>

      {/* Violation bar */}
      <Box sx={{ height: 6, backgroundColor: '#eee' }}>
        <Box sx={{ height: 6, width: `${item.affected_percentage}%`, backgroundColor: neverActivated ? '#ccc' : (isModelException ? '#bdbdbd' : '#ed6c02') }} />
      </Box>

      {/* Model exception toggle */}
      <Box px={2} py={1} sx={{ borderTop: '1px solid #f0f0f0' }}>
        <Tooltip title={isModelException ? 'Unmark as model exception' : 'Mark as Model Exception — this violation is an artefact of an incomplete model, not a real process deviation. It will be excluded from causal analysis.'} arrow>
          <Button
            size="small"
            variant={isModelException ? 'contained' : 'outlined'}
            color="secondary"
            onClick={onToggleModelException}
            sx={{ fontSize: '0.7rem' }}
          >
            {isModelException ? 'Model Exception ✓' : 'Mark as Model Exception'}
          </Button>
        </Tooltip>
      </Box>
    </Card>
  );
};

// ── Model viewer panel ─────────────────────────────────────────────────────────
const ModelPanel: React.FC<{
  modelContent: ModelContent | null;
  bpmnContainerRef: React.RefObject<HTMLDivElement>;
  height?: number;
}> = ({ modelContent, bpmnContainerRef, height = 480 }) => (
  <Paper
    elevation={0}
    variant="outlined"
    sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}
  >
    <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
      Process Model
    </Typography>

    {/* BPMN container — always in DOM so ref is available */}
    <Box
      ref={bpmnContainerRef}
      sx={{
        width: '100%',
        height,
        border: '1px solid #eee',
        borderRadius: 1,
        overflow: 'hidden',
        display: modelContent?.type === 'bpmn' ? 'block' : 'none',
      }}
    />

    {modelContent?.type === 'pnml' && modelContent.content && (
      <Box
        sx={{
          width: '100%',
          maxHeight: height,
          overflowY: 'auto',
          border: '1px solid #eee',
          borderRadius: 1,
          '& svg': { width: '100%', height: 'auto' },
        }}
        dangerouslySetInnerHTML={{ __html: modelContent.content }}
      />
    )}

    {(modelContent?.type === 'declarative' || modelContent?.type === 'declarative-model') && modelContent.constraints?.length && (
      <Box sx={{ overflowX: 'auto', maxHeight: height, overflowY: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>Operand A</TableCell>
              <TableCell>Operand B</TableCell>
              {modelContent.type === 'declarative-model' && <TableCell>Activation (A.)</TableCell>}
              {modelContent.type === 'declarative-model' && <TableCell>Target (T.)</TableCell>}
              {modelContent.type === 'declarative-model' && <TableCell>Time Window</TableCell>}
              {modelContent.type === 'declarative-model' && <TableCell align="right">Activations</TableCell>}
              {modelContent.type === 'declarative' && <TableCell align="right">Support</TableCell>}
              {modelContent.type === 'declarative' && <TableCell align="right">Confidence</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {modelContent.constraints.map((c: any, i: number) => {
              const neverActivated = modelContent.type === 'declarative-model' && c.total_activations === 0;
              return (
                <TableRow key={i} sx={{ backgroundColor: neverActivated ? '#fafafa' : undefined }}>
                  <TableCell sx={{ fontSize: 11 }}>{c.type}</TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    <Tooltip title={c.op_0} arrow placement="top">
                      <Box component="span" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}>
                        {c.op_0}
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>
                    <Tooltip title={c.op_1 || '—'} arrow placement="top">
                      <Box component="span" sx={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', verticalAlign: 'middle' }}>
                        {c.op_1 || '—'}
                      </Box>
                    </Tooltip>
                  </TableCell>
                  {modelContent.type === 'declarative-model' && (
                    <TableCell sx={{ fontSize: 10, maxWidth: 200 }}>
                      {c.activation_condition ? (
                        <Tooltip title={c.activation_condition} arrow placement="top">
                          <Box component="span" sx={{ color: '#e65100', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 200, verticalAlign: 'middle' }}>
                            {c.activation_condition.length > 35 ? c.activation_condition.slice(0, 35) + '…' : c.activation_condition}
                          </Box>
                        </Tooltip>
                      ) : <Box component="span" sx={{ color: '#bbb' }}>—</Box>}
                    </TableCell>
                  )}
                  {modelContent.type === 'declarative-model' && (
                    <TableCell sx={{ fontSize: 10, maxWidth: 200 }}>
                      {c.correlation_condition ? (
                        <Tooltip title={c.correlation_condition} arrow placement="top">
                          <Box component="span" sx={{ color: '#6a1b9a', cursor: 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block', maxWidth: 200, verticalAlign: 'middle' }}>
                            {c.correlation_condition.length > 35 ? c.correlation_condition.slice(0, 35) + '…' : c.correlation_condition}
                          </Box>
                        </Tooltip>
                      ) : <Box component="span" sx={{ color: '#bbb' }}>—</Box>}
                    </TableCell>
                  )}
                  {modelContent.type === 'declarative-model' && (
                    <TableCell sx={{ fontSize: 10, maxWidth: 160 }}>
                      {c.time_condition ? (
                        <Tooltip title={`Raw: ${c.time_condition.raw}`} arrow placement="top">
                          <Box component="span" sx={{ color: '#01579b', cursor: 'default', whiteSpace: 'nowrap' }}>
                            ⏱ {formatTimeCondition(c.time_condition)}
                          </Box>
                        </Tooltip>
                      ) : <Box component="span" sx={{ color: '#bbb' }}>—</Box>}
                    </TableCell>
                  )}
                  {modelContent.type === 'declarative-model' && (
                    <TableCell align="right" sx={{ fontSize: 11, color: neverActivated ? '#9e9e9e' : undefined }}>
                      {neverActivated
                        ? <Tooltip title="Never activated — violations are vacuous" arrow><Box component="span" sx={{ color: '#bdbdbd' }}>0 ⚠</Box></Tooltip>
                        : c.total_activations?.toLocaleString('en-US') ?? '—'}
                    </TableCell>
                  )}
                  {modelContent.type === 'declarative' && <TableCell align="right" sx={{ fontSize: 11 }}>{(c.support * 100).toFixed(1)}%</TableCell>}
                  {modelContent.type === 'declarative' && <TableCell align="right" sx={{ fontSize: 11 }}>{(c.confidence * 100).toFixed(1)}%</TableCell>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    )}

    {!modelContent && (
      <Box display="flex" justifyContent="center" alignItems="center" flex={1}>
        <CircularProgress size={24} />
      </Box>
    )}
  </Paper>
);

// ── Main component ─────────────────────────────────────────────────────────────
const DeviationSelection: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const {
    conformanceMode,
    loggingErrorDeviations,
    modelExceptionDeviations,
    setModelExceptionDeviations,
    filterSummary,
    applyAndRecompute,
  } = useFileContext();

  const [data, setData] = useState<DeviationSelectionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modelContent, setModelContent] = useState<ModelContent | null>(null);
  const bpmnContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  // Variant exception state: key = JSON.stringify(sequence)
  // "Removed" variants → Case Exception (remove cases + recompute)
  const [removedSequenceKeys, setRemovedSequenceKeys] = useState<Set<string>>(new Set());
  const removedSequencesRef = useRef<Map<string, string[]>>(new Map());
  // "Ignored" variants → Logging Error (hide from analysis, no recompute)
  const [ignoredSequenceKeys, setIgnoredSequenceKeys] = useState<Set<string>>(new Set());

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [showAllVariants, setShowAllVariants] = useState(false);
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);
  const VARIANTS_PREVIEW = 5;

  const isDeclarative = conformanceMode === 'declarative' || conformanceMode === 'declarative-model';

  useEffect(() => {
    setContinue({
      label: 'Continue',
      onClick: () => navigate('/issue-grouping'),
    });
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
      .catch((err) => console.error('Failed to load model content:', err));
  }, []);

  // Auto-exclude deviations with fewer than 10 affected cases
  useEffect(() => {
    if (!data) return;
    const lowCount = data.deviations
      .filter((d) => d.affected_count < 10 && !loggingErrorDeviations.includes(d.column))
      .map((d) => d.column);
    if (lowCount.length === 0) return;
    setModelExceptionDeviations((prev) => {
      const toAdd = lowCount.filter((c) => !prev.includes(c));
      if (toAdd.length === 0) return prev;
      setAutoExcluded(toAdd);
      return [...prev, ...toAdd];
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Restore removed sequences from context on mount
  useEffect(() => {
    if (filterSummary.step3_variant_sequences.length === 0) return;
    const keys = new Set<string>();
    filterSummary.step3_variant_sequences.forEach((seq) => {
      const k = JSON.stringify(seq);
      keys.add(k);
      removedSequencesRef.current.set(k, seq);
    });
    setRemovedSequenceKeys(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render BPMN when content available
  useEffect(() => {
    if (modelContent?.type !== 'bpmn' || !modelContent.content) return;
    // Small delay to ensure the container is painted before bpmn-js measures it
    const timer = setTimeout(() => {
      if (!bpmnContainerRef.current) return;
      if (viewerRef.current) viewerRef.current.destroy();
      const viewer = new NavigatedViewer({ container: bpmnContainerRef.current });
      viewerRef.current = viewer;
      viewer
        .importXML(modelContent.content!)
        .then(() => {
          setTimeout(() => {
            try { (viewer.get('canvas') as any).zoom('fit-viewport'); } catch (_) {}
          }, 100);
        })
        .catch((err: any) => console.error('BPMN render error:', err));
    }, 80);
    return () => {
      clearTimeout(timer);
      if (viewerRef.current) { viewerRef.current.destroy(); viewerRef.current = null; }
    };
  }, [modelContent]);

  const toggleVariantRemove = (sequence: string[], key: string) => {
    setRemovedSequenceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        removedSequencesRef.current.delete(key);
      } else {
        next.add(key);
        removedSequencesRef.current.set(key, sequence);
      }
      return next;
    });
    setApplied(false);
  };

  const toggleVariantIgnore = (_sequence: string[], key: string) => {
    setIgnoredSequenceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleModelException = (column: string) => {
    setModelExceptionDeviations((prev) =>
      prev.includes(column) ? prev.filter((c) => c !== column) : [...prev, column]
    );
  };

  const handleApplyAndRecompute = async () => {
    setApplying(true);
    setApplied(false);
    const sequences = Array.from(removedSequencesRef.current.values());
    try {
      await applyAndRecompute({ ...filterSummary, step3_variant_sequences: sequences });
      setApplied(true);
    } catch (err) {
      console.error('Recompute failed:', err);
    } finally {
      setApplying(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" mt={6}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>
        {error}
      </Alert>
    );
  }

  if (!data) return null;

  // Filter out deviations marked as logging errors in Step 1b
  const deviations = data.deviations.filter((d) => !loggingErrorDeviations.includes(d.column));
  const { total_traces } = data;

  // Collect all unique variants across all deviations (by sequence key)
  const allVariantsMap = new Map<string, Variant & { deviations: string[] }>();
  deviations.forEach((dev) => {
    dev.top_variants.forEach((v) => {
      const key = JSON.stringify(v.sequence);
      if (!allVariantsMap.has(key)) {
        allVariantsMap.set(key, { ...v, deviations: [dev.label] });
      } else {
        allVariantsMap.get(key)!.deviations.push(dev.label);
      }
    });
  });
  const allVariants = Array.from(allVariantsMap.entries());

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={0.5}>
        <Typography variant="h5" fontWeight="bold">Step 3: Review Violations & Mark Exceptions</Typography>
        <Tooltip
          title="Review all deviations found in the log. Mark model exceptions to exclude them from further analysis. At the bottom, mark specific process variants as Case Exceptions to remove their cases and recompute."
          arrow placement="right"
        >
          <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {total_traces.toLocaleString('en-US')} total cases ·
        All deviations not marked as model exceptions will proceed to analysis.
      </Typography>

      {/* Auto-exclusion banner */}
      {autoExcluded.length > 0 && (
        <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
          <strong>{autoExcluded.length} deviation(s) auto-excluded</strong>: deviations occurring in fewer than 10 cases were automatically marked as model exceptions since they lack statistical power for causal analysis. You can unmark them below if needed.
        </Alert>
      )}

      {/* Status chips */}
      {(loggingErrorDeviations.length > 0 || modelExceptionDeviations.length > 0) && (
        <Box display="flex" gap={1} flexWrap="wrap" mt={1} mb={2}>
          {loggingErrorDeviations.length > 0 && (
            <Chip label={`${loggingErrorDeviations.length} logging error(s) excluded`} color="error" size="small" variant="outlined" />
          )}
          {modelExceptionDeviations.length > 0 && (
            <Chip label={`${modelExceptionDeviations.length} model exception(s) excluded`} color="secondary" size="small" variant="outlined" />
          )}
        </Box>
      )}

      {/* Process model */}
      <Box mt={1} mb={3}>
        <ModelPanel modelContent={modelContent} bpmnContainerRef={bpmnContainerRef} />
      </Box>

      {/* ── Deviations ── */}
      {deviations.length === 0 ? (
        <Alert severity="info">No deviations found.</Alert>
      ) : (
        <>
          <Typography variant="h6" gutterBottom>Deviations</Typography>
          {deviations.map((item) => (
            <DeviationCard
              key={item.column}
              item={item}
              isModelException={modelExceptionDeviations.includes(item.column)}
              onToggleModelException={() => toggleModelException(item.column)}
            />
          ))}

          {/* ── All Variants section ── */}
          <Divider sx={{ my: 3 }} />
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Typography variant="h6">Process Variants</Typography>
            <Tooltip title="'Case Exception: Remove Cases' — remove all cases of this variant from the log and recompute. 'Case Exception: Ignore Deviations' — keep cases but exclude all deviations in this variant from further analysis." arrow>
              <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
            </Tooltip>
            {removedSequenceKeys.size > 0 && (
              <Chip icon={<PlaylistRemoveIcon />} label={`${removedSequenceKeys.size} variant(s) → remove cases`} color="warning" size="small" variant="outlined" />
            )}
            {ignoredSequenceKeys.size > 0 && (
              <Chip label={`${ignoredSequenceKeys.size} variant(s) → ignore deviations`} color="default" size="small" variant="outlined" />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            All process variants that appear in at least one deviation are listed below.
          </Typography>

          {allVariants.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No variant data available.</Typography>
          ) : (
            <>
            <Table size="small" sx={{ mb: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Activity Sequence</TableCell>
                  <TableCell>Violations</TableCell>
                  <TableCell align="right">Cases</TableCell>
                  <TableCell align="right">%</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(showAllVariants ? allVariants : allVariants.slice(0, VARIANTS_PREVIEW)).map(([key, v], i) => (
                  <TableRow
                    key={key}
                    sx={{
                      opacity: (removedSequenceKeys.has(key) || ignoredSequenceKeys.has(key)) ? 0.6 : 1,
                      backgroundColor: removedSequenceKeys.has(key) ? '#fff8e1' : ignoredSequenceKeys.has(key) ? '#f5f5f5' : undefined,
                    }}
                  >
                    <TableCell sx={{ color: 'text.secondary', width: 32 }}>{i + 1}</TableCell>
                    <TableCell>
                      <Box display="flex" alignItems="center" flexWrap="wrap" gap={0.5}>
                        {v.sequence.map((act, ai) => (
                          <React.Fragment key={ai}>
                            <Chip label={act} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                            {ai < v.sequence.length - 1 && <Typography variant="caption" color="text.secondary">→</Typography>}
                          </React.Fragment>
                        ))}
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {v.deviations.slice(0, 2).join(', ')}{v.deviations.length > 2 ? ` +${v.deviations.length - 2}` : ''}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{v.count.toLocaleString('en-US')}</TableCell>
                    <TableCell align="right">{v.percentage}%</TableCell>
                    <TableCell align="right">
                      <Box display="flex" flexDirection="column" gap={0.5} alignItems="flex-end">
                        <Tooltip title={removedSequenceKeys.has(key) ? 'Unmark — restore cases' : 'Remove all cases of this variant from the log and recompute conformance'} arrow>
                          <Button size="small" variant={removedSequenceKeys.has(key) ? 'contained' : 'outlined'} color="warning"
                            startIcon={<PlaylistRemoveIcon />}
                            onClick={() => toggleVariantRemove(v.sequence, key)}
                            sx={{ whiteSpace: 'nowrap', fontSize: '0.65rem' }}>
                            {removedSequenceKeys.has(key) ? 'Remove Cases ✓' : 'Case Exception: Remove Cases'}
                          </Button>
                        </Tooltip>
                        <Tooltip title={ignoredSequenceKeys.has(key) ? 'Unmark' : 'Keep cases but exclude all deviations occurring in this variant from further analysis'} arrow>
                          <Button size="small" variant={ignoredSequenceKeys.has(key) ? 'contained' : 'outlined'} color="inherit"
                            onClick={() => toggleVariantIgnore(v.sequence, key)}
                            sx={{ whiteSpace: 'nowrap', fontSize: '0.65rem' }}>
                            {ignoredSequenceKeys.has(key) ? 'Ignore Deviations ✓' : 'Case Exception: Ignore Deviations'}
                          </Button>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {allVariants.length > VARIANTS_PREVIEW && (
              <Box display="flex" justifyContent="center" mt={1} mb={1}>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => setShowAllVariants((v) => !v)}
                >
                  {showAllVariants
                    ? 'Show fewer variants'
                    : `Show all ${allVariants.length} variants (${allVariants.length - VARIANTS_PREVIEW} more)`}
                </Button>
              </Box>
            )}
            </>
          )}

          {/* Apply & Recompute button */}
          {removedSequenceKeys.size > 0 && (
            <Box display="flex" alignItems="center" gap={2} mt={1}>
              <Button
                variant="contained" color="warning"
                onClick={handleApplyAndRecompute}
                disabled={applying}
                startIcon={applying ? <CircularProgress size={14} color="inherit" /> : <PlaylistRemoveIcon />}
              >
                {applying ? 'Recomputing…' : `Apply & Recompute (${removedSequenceKeys.size} variant(s))`}
              </Button>
              {applied && (
                <Chip label="Recomputed successfully" color="success" size="small" icon={<CheckCircleOutlineIcon />} />
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default DeviationSelection;

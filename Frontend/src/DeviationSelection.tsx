import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CircularProgress,
  Alert,
  Chip,
  Collapse,
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
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import InfoIcon from '@mui/icons-material/Info';
import PlaylistRemoveIcon from '@mui/icons-material/PlaylistRemove';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useNavigate } from 'react-router-dom';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';
import ScreenInfoBox from './ScreenInfoBox';

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
type ExclusionType = 'process-exception' | 'out-of-control' | null;

const DeviationCard: React.FC<{
  item: DeviationItem;
  exclusionType: ExclusionType;
  onSetExclusion: (type: ExclusionType) => void;
}> = ({ item, exclusionType, onSetExclusion }) => {
  const chipColor = typeColor[item.type] ?? '#555';
  const neverActivated = item.total_activations === 0;
  const diag = item.violation_diagnostics;
  const diagTotal = diag ? diag.no_target_count + diag.target_condition_failed_count + diag.time_window_violated_count : 0;
  const isExcluded = exclusionType !== null;

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderColor: isExcluded ? '#e0e0e0' : 'divider',
        backgroundColor: neverActivated ? '#fafafa' : undefined,
        opacity: isExcluded ? 0.7 : 1,
      }}
    >
      <Box display="flex" alignItems="flex-start" px={2} py={1.5}>
        <Box flex={1}>
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body1"
              sx={{ textDecoration: isExcluded ? 'line-through' : 'none', color: isExcluded ? 'text.disabled' : undefined }}>
              {item.label}
            </Typography>
            <Chip
              label={item.type}
              size="small"
              sx={{ backgroundColor: chipColor, color: '#fff', fontSize: '0.65rem', opacity: isExcluded ? 0.5 : 1 }}
            />
            {exclusionType === 'process-exception' && (
              <Chip label="Process Exception" size="small" variant="outlined" sx={{ fontSize: '0.65rem', borderColor: '#ef9a9a', color: '#c62828' }} />
            )}
            {exclusionType === 'out-of-control' && (
              <Chip label="Out-of-control" size="small" variant="outlined" sx={{ fontSize: '0.65rem', borderColor: '#ce93d8', color: '#6a1b9a' }} />
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
        <Box sx={{ height: 6, width: `${item.affected_percentage}%`, backgroundColor: neverActivated ? '#ccc' : (isExcluded ? '#bdbdbd' : '#ed6c02') }} />
      </Box>

      {/* Exclusion type buttons */}
      <Box px={2} py={1} display="flex" gap={1} flexWrap="wrap" sx={{ borderTop: '1px solid #f0f0f0' }}>
        <Tooltip title="A valid process variant that is not captured in the model but is allowed in principle. Excluded from further analysis." arrow>
          <Button
            size="small"
            variant={exclusionType === 'process-exception' ? 'contained' : 'outlined'}
            onClick={() => onSetExclusion(exclusionType === 'process-exception' ? null : 'process-exception')}
            sx={{ fontSize: '0.7rem', borderColor: '#ef9a9a', color: exclusionType === 'process-exception' ? '#fff' : '#c62828', backgroundColor: exclusionType === 'process-exception' ? '#c62828' : undefined, '&:hover': { backgroundColor: exclusionType === 'process-exception' ? '#b71c1c' : '#fce4ec' } }}
          >
            {exclusionType === 'process-exception' ? 'Process Exception ✓' : 'Process Exception'}
          </Button>
        </Tooltip>
        <Tooltip title="A deviation you cannot influence or control (e.g. external constraint, system-forced behaviour). Excluded from further analysis." arrow>
          <Button
            size="small"
            variant={exclusionType === 'out-of-control' ? 'contained' : 'outlined'}
            onClick={() => onSetExclusion(exclusionType === 'out-of-control' ? null : 'out-of-control')}
            sx={{ fontSize: '0.7rem', borderColor: '#ce93d8', color: exclusionType === 'out-of-control' ? '#fff' : '#6a1b9a', backgroundColor: exclusionType === 'out-of-control' ? '#6a1b9a' : undefined, '&:hover': { backgroundColor: exclusionType === 'out-of-control' ? '#4a148c' : '#f3e5f5' } }}
          >
            {exclusionType === 'out-of-control' ? 'Out-of-control ✓' : 'Out-of-control'}
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

// ── Excluded deviations summary ───────────────────────────────────────────────
const ExcludedSummary: React.FC<{
  loggingErrors: string[];
  processExceptions: string[];
  outOfControl: string[];
  allDeviations: DeviationItem[];
  totalTraces: number;
}> = ({ loggingErrors, processExceptions, outOfControl, allDeviations, totalTraces }) => {
  const [open, setOpen] = React.useState(true);

  const devMap = Object.fromEntries(allDeviations.map((d) => [d.column, d]));
  const allExcluded = [
    ...loggingErrors.map((c) => ({ col: c, tag: 'Logging Error', step: 'Step 1b', tagColor: '#b71c1c', tagBg: 'rgba(183,28,28,0.08)' })),
    ...processExceptions.map((c) => ({ col: c, tag: 'Process Exception', step: 'Step 3', tagColor: '#c62828', tagBg: 'rgba(211,47,47,0.08)' })),
    ...outOfControl.map((c) => ({ col: c, tag: 'Out-of-control', step: 'Step 3', tagColor: '#6a1b9a', tagBg: 'rgba(106,27,154,0.08)' })),
  ];
  if (allExcluded.length === 0) return null;

  return (
    <Box sx={{ mb: 2, border: '1px solid #e0e0e0', borderRadius: 1, overflow: 'hidden' }}>
      <Box
        display="flex" alignItems="center" gap={1} px={2} py={1}
        sx={{ background: '#f5f5f5', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setOpen(v => !v)}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, color: '#555' }}>
          {allExcluded.length} deviation(s) excluded from further analysis
          {loggingErrors.length > 0 ? ` (${loggingErrors.length} identified as logging errors in Step 1b)` : ''}
        </Typography>
        <Chip label={`${loggingErrors.length} logging error(s)`} size="small" variant="outlined"
          sx={{ fontSize: '0.6rem', borderColor: '#ef9a9a', color: '#b71c1c' }} />
        <Chip label={`${processExceptions.length} process exception(s)`} size="small" variant="outlined"
          sx={{ fontSize: '0.6rem', borderColor: '#ff8a65', color: '#c62828' }} />
        <Chip label={`${outOfControl.length} out-of-control`} size="small" variant="outlined"
          sx={{ fontSize: '0.6rem', borderColor: '#ce93d8', color: '#6a1b9a' }} />
        <IconButton size="small" sx={{ p: 0 }}>
          {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 2, py: 1 }}>
          {allExcluded.map(({ col, tag, step, tagColor, tagBg }) => {
            const dev = devMap[col];
            const pct = dev && totalTraces > 0 ? ((dev.affected_count / totalTraces) * 100).toFixed(1) : null;
            return (
              <Box key={col} display="flex" alignItems="center" gap={1} py={0.5}
                sx={{ borderBottom: '1px solid #f0f0f0', '&:last-child': { borderBottom: 'none' } }}>
                <Chip label={tag} size="small"
                  sx={{ fontSize: '0.6rem', fontWeight: 700, height: 18, minWidth: 110, flexShrink: 0, backgroundColor: tagBg, color: tagColor }} />
                <Chip label={step} size="small" variant="outlined"
                  sx={{ fontSize: '0.58rem', height: 16, flexShrink: 0, color: '#888', borderColor: '#ccc' }} />
                <Typography variant="caption" sx={{ flex: 1, fontWeight: 500 }}>
                  {dev?.label ?? col}
                </Typography>
                {dev && (
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {dev.affected_count.toLocaleString('en-US')} trace(s){pct ? ` (${pct}%)` : ''}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const DeviationSelection: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const {
    conformanceMode,
    loggingErrorDeviations,
    processExceptionDeviations, setProcessExceptionDeviations,
    outOfControlDeviations, setOutOfControlDeviations,
    setDeviationAffectedCounts,
    setDeviationLabels,
    filterSummary,
    applyAndRecompute,
  } = useFileContext();

  const modelExceptionDeviations = [...processExceptionDeviations, ...outOfControlDeviations];

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
  const [autoExcluded, setAutoExcluded] = useState<string[]>([]);

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
      .then((d) => {
        setData(d);
        setLoading(false);
        const counts: Record<string, number> = {};
        const labels: Record<string, string> = {};
        (d.deviations || []).forEach((dev: any) => {
          counts[dev.column] = dev.affected_count;
          labels[dev.column] = dev.label ?? dev.column;
        });
        setDeviationAffectedCounts(counts);
        setDeviationLabels(labels);
      })
      .catch((err) => { setError(err.message); setLoading(false); });

    fetch(`${API_URL}/api/model-content`)
      .then((res) => res.json())
      .then((d) => setModelContent(d))
      .catch((err) => console.error('Failed to load model content:', err));
  }, []);

  // Auto-exclude deviations with fewer than 10 affected cases → out-of-control
  useEffect(() => {
    if (!data) return;
    const lowCount = data.deviations
      .filter((d) => d.affected_count < 10 && !loggingErrorDeviations.includes(d.column))
      .map((d) => d.column);
    if (lowCount.length === 0) return;
    setOutOfControlDeviations((prev) => {
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

  const setExclusionType = (column: string, type: ExclusionType) => {
    setProcessExceptionDeviations((prev) =>
      type === 'process-exception'
        ? prev.includes(column) ? prev : [...prev, column]
        : prev.filter((c) => c !== column)
    );
    setOutOfControlDeviations((prev) =>
      type === 'out-of-control'
        ? prev.includes(column) ? prev : [...prev, column]
        : prev.filter((c) => c !== column)
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
      <ScreenInfoBox
        whatYouSee="Every detected deviation with its occurrence count and diagnostic breakdown (no target, condition failed, time window violated). Each card shows the constraint or skip/insertion type, how many cases are affected, and why the violation occurred."
        whatToDo={
          <Typography variant="body2" color="text.secondary">
            Review each deviation and decide whether to exclude it from causal analysis using one of two categories:
            <br /><br />
            <strong>Process Exceptions</strong> — variants not incorporated in the model but valid in principle (e.g., a rare but legitimate path that was simply not modelled). These are handled by the process but fall outside the documented model scope.
            <br /><br />
            <strong>Out-of-control Deviations</strong> — deviations you cannot influence or eliminate (e.g., externally imposed constraints, system-forced behaviour, errors beyond the team's control). Excluding these keeps the causal analysis focused on actionable deviations only.
            <br /><br />
            Deviations marked in either category are excluded from further analysis. Leave the rest active — they form the basis for the subsequent impact assessment.
          </Typography>
        }
        example={
          isDeclarative ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                A <strong>Response(A, B)</strong> constraint says: if A occurs, B must eventually follow. A violation means B never occurred after A in that trace.
              </Typography>
              <Box sx={{ p: 1, background: '#f5f5f5', borderRadius: 1, fontSize: 11, fontFamily: 'monospace', mb: 1 }}>
                Constraint: Response(Submit, Approve)<br/>
                Violations: 47 cases — target "Approve" never reached
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
                Some of these cases may be exceptions and should be excluded:
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ p: 0.75, background: 'rgba(106,27,154,0.06)', border: '1px solid #ce93d8', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#6a1b9a', display: 'block' }}>Out-of-control:</Typography>
                  <Typography variant="caption" color="text.secondary">The supplier demanded immediate payment before an approval could be issued — you have no authority over the supplier's payment terms.</Typography>
                </Box>
                <Box sx={{ p: 0.75, background: 'rgba(21,101,192,0.06)', border: '1px solid #90caf9', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#1565c0', display: 'block' }}>Process exception:</Typography>
                  <Typography variant="caption" color="text.secondary">Purchases from company-internal partners do not require a formal approval step — a valid path simply not captured in the model.</Typography>
                </Box>
              </Box>
            </Box>
          ) : (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75, color: '#5d4037' }}>
                Example: Trace alignment against a process model
              </Typography>

              {/* Mini BPMN process model */}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Process model:</Typography>
              <Box sx={{ overflowX: 'auto', mb: 1.5, borderRadius: 1, border: '1px solid #e0e0e0', background: '#fafafa', p: 1 }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 556 58" width="556" height="58" style={{ display: 'block' }}>
                  <defs>
                    <marker id="ds-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#888"/>
                    </marker>
                  </defs>
                  {/* Start */}
                  <circle cx="16" cy="29" r="10" fill="#4caf50"/>
                  <line x1="26" y1="29" x2="36" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* Create PO */}
                  <rect x="36" y="14" width="80" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="76" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Create PO</text>
                  <line x1="116" y1="29" x2="126" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* Validate */}
                  <rect x="126" y="14" width="76" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="164" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Validate</text>
                  <line x1="202" y1="29" x2="212" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* Assign Tax Nr. */}
                  <rect x="212" y="14" width="98" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="261" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Assign Tax Nr.</text>
                  <line x1="310" y1="29" x2="320" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* Approve */}
                  <rect x="320" y="14" width="76" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="358" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Approve</text>
                  <line x1="396" y1="29" x2="406" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* Close */}
                  <rect x="406" y="14" width="66" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="439" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Close</text>
                  <line x1="472" y1="29" x2="482" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ds-arr)"/>
                  {/* End */}
                  <circle cx="494" cy="29" r="10" fill="none" stroke="#333" strokeWidth="3"/>
                  <circle cx="494" cy="29" r="5" fill="#333"/>
                </svg>
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Alignment results per case:</Typography>

              {/* Case 017 — skip of Validate */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#c62828', display: 'block', mb: 0.4 }}>
                  Case-017 — Skip detected (Validate missing from trace)
                </Typography>
                <Box sx={{ display: 'flex', gap: '3px' }}>
                  {([
                    { label: 'Create PO', type: 'sync' },
                    { label: 'Validate', type: 'skip' },
                    { label: 'Assign Tax Nr.', type: 'sync' },
                    { label: 'Approve', type: 'sync' },
                    { label: 'Close', type: 'sync' },
                  ] as { label: string; type: string }[]).map((m, i) => (
                    <Box key={i} sx={{
                      flex: 1, border: '1px solid',
                      borderColor: m.type === 'sync' ? '#a5d6a7' : '#ef9a9a',
                      borderRadius: 1,
                      background: m.type === 'sync' ? '#f1f8e9' : '#fce4ec',
                      p: '4px 2px', textAlign: 'center',
                    }}>
                      <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 600, display: 'block',
                        color: m.type === 'sync' ? '#2e7d32' : '#c62828',
                        textDecoration: m.type === 'skip' ? 'line-through' : 'none' }}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 8, display: 'block',
                        color: m.type === 'sync' ? '#388e3c' : '#e53935' }}>
                        {m.type === 'sync' ? 'sync' : '↑ SKIP'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Case 031 — skip of Assign Tax Nr. */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#c62828', display: 'block', mb: 0.4 }}>
                  Case-031 — Skip detected (Assign Tax Nr. missing from trace)
                </Typography>
                <Box sx={{ display: 'flex', gap: '3px' }}>
                  {([
                    { label: 'Create PO', type: 'sync' },
                    { label: 'Validate', type: 'sync' },
                    { label: 'Assign Tax Nr.', type: 'skip' },
                    { label: 'Approve', type: 'sync' },
                    { label: 'Close', type: 'sync' },
                  ] as { label: string; type: string }[]).map((m, i) => (
                    <Box key={i} sx={{
                      flex: 1, border: '1px solid',
                      borderColor: m.type === 'sync' ? '#a5d6a7' : '#ef9a9a',
                      borderRadius: 1,
                      background: m.type === 'sync' ? '#f1f8e9' : '#fce4ec',
                      p: '4px 2px', textAlign: 'center',
                    }}>
                      <Typography variant="caption" sx={{ fontSize: 9, fontWeight: 600, display: 'block',
                        color: m.type === 'sync' ? '#2e7d32' : '#c62828',
                        textDecoration: m.type === 'skip' ? 'line-through' : 'none' }}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 8, display: 'block',
                        color: m.type === 'sync' ? '#388e3c' : '#e53935' }}>
                        {m.type === 'sync' ? 'sync' : '↑ SKIP'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                Green = synchronous move. Red = skip (required by model, absent from trace).
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.4 }}>
                Some of these cases may be exceptions and should be excluded:
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                <Box sx={{ p: 0.75, background: 'rgba(106,27,154,0.06)', border: '1px solid #ce93d8', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#6a1b9a', display: 'block' }}>Out-of-control (Case-017, Skip of Validate):</Typography>
                  <Typography variant="caption" color="text.secondary">The supplier requested an urgent delivery and skipped the standard validation — you have no authority over what the supplier demands.</Typography>
                </Box>
                <Box sx={{ p: 0.75, background: 'rgba(21,101,192,0.06)', border: '1px solid #90caf9', borderRadius: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#1565c0', display: 'block' }}>Process exception (Case-031, Skip of Assign Tax Nr.):</Typography>
                  <Typography variant="caption" color="text.secondary">Purchases from company-internal partners do not require a tax number assignment — a valid path simply not captured in the model.</Typography>
                </Box>
              </Box>
            </Box>
          )
        }
      />
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {total_traces.toLocaleString('en-US')} total cases ·
      </Typography>

      {/* Auto-exclusion banner */}
      {autoExcluded.length > 0 && (
        <Alert severity="info" sx={{ mb: 2, mt: 1 }}>
          <strong>{autoExcluded.length} deviation(s) auto-excluded</strong>: deviations occurring in fewer than 10 cases were automatically marked as model exceptions since they lack statistical power for causal analysis. You can unmark them below if needed.
        </Alert>
      )}

      {/* Excluded deviations summary — always visible */}
      {(loggingErrorDeviations.length > 0 || processExceptionDeviations.length > 0 || outOfControlDeviations.length > 0) && data && (
        <ExcludedSummary
          loggingErrors={loggingErrorDeviations}
          processExceptions={processExceptionDeviations}
          outOfControl={outOfControlDeviations}
          allDeviations={data.deviations}
          totalTraces={data.total_traces}
        />
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
              exclusionType={
                processExceptionDeviations.includes(item.column) ? 'process-exception'
                : outOfControlDeviations.includes(item.column) ? 'out-of-control'
                : null
              }
              onSetExclusion={(type) => setExclusionType(item.column, type)}
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
            <Box sx={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1, mb: 1 }}>
            <Table size="small" stickyHeader>
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
                {allVariants.map(([key, v], i) => (
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
            </Box>
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

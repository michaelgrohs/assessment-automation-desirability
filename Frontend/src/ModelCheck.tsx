import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Alert,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemText,
  Button,
  Tooltip,
  IconButton,
  LinearProgress,
  FormControlLabel,
  Checkbox,
  Paper,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import { useNavigate } from 'react-router-dom';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:1965';
const WARN_THRESHOLD = 0.7;

const UNIT_LABELS: Record<string, string> = { s: 'seconds', m: 'minutes', h: 'hours', d: 'days' };
const formatTimeCondition = (tc: { min: number; max: number; unit: string }): string => {
  const unit = UNIT_LABELS[tc.unit] ?? tc.unit;
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (tc.min === tc.max) return `exactly ${fmt(tc.min)} ${unit}`;
  if (tc.min === 0) return `within ${fmt(tc.max)} ${unit}`;
  return `${fmt(tc.min)} – ${fmt(tc.max)} ${unit}`;
};

interface BpmnModelCheckData {
  mode: 'bpmn';
  fitness: number;
  precision: number | null;
  total_traces: number;
  activities_only_in_model: string[];
  activities_only_in_log: string[];
  activities_in_both: string[];
}

interface DeclarativeModelCheckData {
  mode: 'declarative';
  total_traces: number;
  total_constraints: number;
  constraint_violation_rate: number | null;
  activities_in_log: string[];
}

type ModelCheckData = BpmnModelCheckData | DeclarativeModelCheckData;

interface ModelContent {
  type: 'bpmn' | 'pnml' | 'declarative' | 'declarative-model';
  content?: string;
  constraints?: any[];
}

// ── Score bar ──────────────────────────────────────────────────────────────────
const ScoreBar: React.FC<{ label: string; value: number | null; tooltip: string }> = ({
  label,
  value,
  tooltip,
}) => {
  if (value === null) {
    return (
      <Box mb={2}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
          <Typography variant="body2">{label}</Typography>
          <Chip label="N/A" size="small" variant="outlined" />
        </Box>
        <Typography variant="caption" color="text.secondary">Could not be computed</Typography>
      </Box>
    );
  }
  const pct = Math.round(value * 100);
  const color = value >= WARN_THRESHOLD ? '#2e7d32' : value >= 0.5 ? '#e65100' : '#c62828';
  const severity: 'success' | 'warning' | 'error' =
    value >= WARN_THRESHOLD ? 'success' : value >= 0.5 ? 'warning' : 'error';
  return (
    <Box mb={2}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
        <Box display="flex" alignItems="center" gap={0.5}>
          <Typography variant="body2" fontWeight="medium">{label}</Typography>
          <Tooltip title={tooltip} arrow>
            <IconButton size="small">
              <InfoIcon fontSize="inherit" color="action" />
            </IconButton>
          </Tooltip>
        </Box>
        <Chip label={`${pct}%`} size="small" color={severity} variant="outlined"
          sx={{ fontWeight: 'bold', minWidth: 56 }} />
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 10,
          borderRadius: 4,
          backgroundColor: '#eee',
          '& .MuiLinearProgress-bar': { backgroundColor: color, borderRadius: 4 },
        }}
      />
    </Box>
  );
};

// ── Activity list ──────────────────────────────────────────────────────────────
const ActivityList: React.FC<{ title: string; activities: string[]; color: string }> = ({
  title, activities, color,
}) => (
  <Box flex={1} minWidth={200}>
    <Box display="flex" alignItems="center" gap={1} mb={1}>
      <Typography variant="subtitle2">{title}</Typography>
      <Chip label={activities.length} size="small" sx={{ backgroundColor: color, color: '#fff' }} />
    </Box>
    {activities.length === 0 ? (
      <Typography variant="body2" color="text.secondary">None</Typography>
    ) : (
      <List dense disablePadding>
        {activities.map((act) => (
          <ListItem key={act} disablePadding sx={{ py: 0.25 }}>
            <ListItemText primary={act} primaryTypographyProps={{ variant: 'body2' }} />
          </ListItem>
        ))}
      </List>
    )}
  </Box>
);

// ── Model viewer ───────────────────────────────────────────────────────────────
// Always renders (never returns null) so the BPMN container ref is always in the DOM.
const ModelViewer: React.FC<{
  modelContent: ModelContent | null;
  bpmnContainerRef: React.RefObject<HTMLDivElement>;
}> = ({ modelContent, bpmnContainerRef }) => (
  <Paper sx={{ mb: 5, p: 3 }}>
    <Typography variant="h6" gutterBottom>Process Model</Typography>

    {/* BPMN container — always in DOM so the ref is set before the viewer effect fires */}
    <Box
      ref={bpmnContainerRef}
      sx={{
        width: '100%',
        height: 380,
        border: '1px solid #eee',
        borderRadius: 1,
        overflow: 'hidden',
        display: modelContent?.type === 'bpmn' ? 'block' : 'none',
      }}
    />

    {!modelContent && (
      <Box display="flex" justifyContent="center" alignItems="center" height={300}>
        <CircularProgress size={32} />
      </Box>
    )}

    {modelContent?.type === 'pnml' && modelContent.content && (
      <Box
        sx={{
          width: '100%',
          maxHeight: 380,
          overflow: 'auto',
          border: '1px solid #eee',
          borderRadius: 1,
          '& svg': { width: '100%', height: 'auto' },
        }}
        dangerouslySetInnerHTML={{ __html: modelContent.content }}
      />
    )}

    {(modelContent?.type === 'declarative' || modelContent?.type === 'declarative-model') && modelContent.constraints?.length && (
      <Box sx={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
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
  </Paper>
);

// ── Confirmation checkboxes ────────────────────────────────────────────────────
const ConfirmationSection: React.FC<{
  confirmed1: boolean;
  confirmed2: boolean;
  onConfirm1: (v: boolean) => void;
  onConfirm2: (v: boolean) => void;
}> = ({ confirmed1, confirmed2, onConfirm1, onConfirm2 }) => (
  <Card sx={{ mb: 3 }}>
    <CardContent>
      <Typography variant="h6" gutterBottom>Confirm Model Validity</Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Before proceeding, confirm that neither of the following issues applies to your model.
        If one does apply, consider ending the analysis and revising the model.
      </Typography>
      <FormControlLabel
        sx={{ mt: 1, alignItems: 'flex-start' }}
        control={
          <Checkbox
            checked={confirmed1}
            onChange={(e) => onConfirm1(e.target.checked)}
            sx={{ pt: 0.5 }}
          />
        }
        label={
          <Typography variant="body2">
            I confirm the model does <strong>not</strong> have a correctness issue — e.g., it is
            not missing activities that should be part of the desired process behavior.
          </Typography>
        }
      />
      <FormControlLabel
        sx={{ mt: 1, alignItems: 'flex-start' }}
        control={
          <Checkbox
            checked={confirmed2}
            onChange={(e) => onConfirm2(e.target.checked)}
            sx={{ pt: 0.5 }}
          />
        }
        label={
          <Typography variant="body2">
            I confirm the model is <strong>not</strong> unsuitable for this log — e.g., it is not
            outdated, for a different process variant, or incompatible with the uploaded event data.
          </Typography>
        }
      />
    </CardContent>
  </Card>
);

// ── Main component ─────────────────────────────────────────────────────────────
const ModelCheck: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const { resetAll } = useFileContext();

  const [data, setData] = useState<ModelCheckData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modelContent, setModelContent] = useState<ModelContent | null>(null);
  const bpmnContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  const [confirmed1, setConfirmed1] = useState(false);
  const [confirmed2, setConfirmed2] = useState(false);

  useEffect(() => {
    setContinue(null);
    return () => setContinue(null);
  }, [setContinue]);

  useEffect(() => {
    fetch(`${API_URL}/api/model-check`)
      .then((res) => res.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch((err) => { setError(err.message); setLoading(false); });

    fetch(`${API_URL}/api/model-content`)
      .then((res) => res.json())
      .then((d) => setModelContent(d))
      .catch((err) => console.error('Failed to load model content:', err));
  }, []);

  // Render BPMN viewer — depends on both modelContent and loading so it (re-)fires
  // once the page content is committed and the container has real dimensions.
  useEffect(() => {
    if (loading) return;
    if (!modelContent?.content || modelContent.type !== 'bpmn') return;
    if (!bpmnContainerRef.current) return;

    if (viewerRef.current) viewerRef.current.destroy();
    const viewer = new NavigatedViewer({ container: bpmnContainerRef.current });
    viewerRef.current = viewer;
    viewer
      .importXML(modelContent.content)
      .then(() => {
        // Small delay lets the browser finish layout before fitting the viewport
        setTimeout(() => {
          try { (viewer.get('canvas') as any).zoom('fit-viewport'); } catch (_) {}
        }, 100);
      })
      .catch((err: any) => console.error('BPMN render error:', err));
    return () => { viewer.destroy(); viewerRef.current = null; };
  }, [modelContent, loading]);

  const handleEndAnalysis = async () => {
    try { await fetch(`${API_URL}/api/reset`, { method: 'POST' }); } catch (e) { /* ignore */ }
    resetAll();
    navigate('/');
  };

  // Render the full shell always so the BPMN container ref stays in the DOM.
  // Loading / error states are shown inline instead of as early returns.
  if (error) {
    return <Alert severity="error" sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>{error}</Alert>;
  }

  const canContinue = confirmed1 && confirmed2;

  // ── Action buttons ─────────────────────────────────────────────────────────
  const renderActions = () => (
    <Box display="flex" gap={2} justifyContent="flex-end" mt={1} flexWrap="wrap">
      <Button
        variant="outlined"
        color="error"
        onClick={handleEndAnalysis}
        startIcon={<ErrorOutlineIcon />}
      >
        End Analysis
      </Button>
      <Button
        variant="outlined"
        color="warning"
        onClick={() => { resetAll(); navigate('/'); }}
        startIcon={<ReplayIcon />}
      >
        Upload / Mine New Model
      </Button>
      <Tooltip
        title={!canContinue ? 'Please confirm both statements above before continuing.' : ''}
        arrow
      >
        <span>
          <Button
            variant="contained"
            disabled={!canContinue}
            onClick={() => navigate('/deviation-selection')}
            startIcon={<CheckCircleOutlineIcon />}
          >
            Confirm &amp; Continue
          </Button>
        </span>
      </Tooltip>
    </Box>
  );

  // Always render ModelViewer so the BPMN container ref is never unmounted.
  // Mode-specific content is conditional on data being available.
  const bpmnData = data?.mode === 'bpmn' ? (data as BpmnModelCheckData) : null;
  const declData = data?.mode === 'declarative' ? (data as DeclarativeModelCheckData) : null;

  const fitnessLow = bpmnData ? bpmnData.fitness < WARN_THRESHOLD : false;
  const precisionLow = bpmnData ? bpmnData.precision !== null && bpmnData.precision < WARN_THRESHOLD : false;
  const hasModelLogGap = bpmnData
    ? bpmnData.activities_only_in_model.length > 0 || bpmnData.activities_only_in_log.length > 0
    : false;
  const showWarning = fitnessLow || precisionLow || hasModelLogGap;

  const violationRate = declData?.constraint_violation_rate ?? 0;
  const highViolation = violationRate > 0.5;

  return (
    <Box sx={{ maxWidth: 1100, margin: '0 auto', p: 3 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={1}>
        <Typography variant="h5" fontWeight="bold">Step 2: Process Model Error Check</Typography>
        <Tooltip
          title={
            declData
              ? 'In declarative mode, the model consists of constraints mined from the log itself. Review the number of constraints and the fraction of traces that violate at least one constraint.'
              : 'Fitness measures how well the event log can be replayed on the model. Precision measures whether the model allows only the behaviour seen in the log. Scores below 70% indicate potential model-log mismatches.'
          }
          arrow placement="right"
        >
          <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {declData
          ? 'Review the mined declarative model before selecting constraint violations to analyse.'
          : 'Check whether the process model adequately represents the event log before selecting deviations.'}
      </Typography>

      {/* Loading spinner */}
      {loading && (
        <Box display="flex" justifyContent="center" my={4}><CircularProgress /></Box>
      )}

      {/* Quality alert (BPMN) */}
      {bpmnData && (showWarning ? (
        <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 2 }}>
          One or more model quality indicators are below the recommended threshold (70%). Review
          the details below before proceeding, or end the analysis if the model is not suitable.
        </Alert>
      ) : (
        <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }}>
          Model quality looks good. Fitness and precision are above 70% and activities are aligned.
        </Alert>
      ))}

      {/* Violation rate alert (declarative) */}
      {declData && highViolation && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          More than 50% of cases violate at least one mined constraint. Consider adjusting the
          minimum support threshold on the upload page.
        </Alert>
      )}

      {/* Process model — always rendered so BPMN ref stays mounted */}
      <ModelViewer modelContent={modelContent} bpmnContainerRef={bpmnContainerRef} />

      {/* ── BPMN mode content ──────────────────────────────────────────────── */}
      {bpmnData && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Conformance Scores</Typography>
              <Typography variant="caption" color="text.secondary" display="block" mb={2}>
                Based on {bpmnData.total_traces.toLocaleString('en-US')} traces
              </Typography>
              <ScoreBar
                label="Fitness"
                value={bpmnData.fitness}
                tooltip="Fraction of observed behaviour that can be replayed on the process model. Low fitness means many traces deviate significantly from the model."
              />
              <ScoreBar
                label="Precision"
                value={bpmnData.precision}
                tooltip="Fraction of model behaviour that is actually observed in the log. Low precision means the model allows much more than what the log contains."
              />
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Typography variant="h6">Activity Alignment</Typography>
                {hasModelLogGap ? (
                  <Chip icon={<ErrorOutlineIcon />} label="Mismatch detected" size="small" color="warning" variant="outlined" />
                ) : (
                  <Chip icon={<CheckCircleOutlineIcon />} label="Fully aligned" size="small" color="success" variant="outlined" />
                )}
              </Box>
              <Box display="flex" gap={4} flexWrap="wrap">
                <ActivityList title="In model only (skipped in log)" activities={bpmnData.activities_only_in_model} color="#c62828" />
                <Divider orientation="vertical" flexItem />
                <ActivityList title="In log only (not in model)" activities={bpmnData.activities_only_in_log} color="#1565c0" />
                <Divider orientation="vertical" flexItem />
                <ActivityList title="In both" activities={bpmnData.activities_in_both} color="#2e7d32" />
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── Declarative mode content ───────────────────────────────────────── */}
      {declData && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>Declarative Model Summary</Typography>
              <Box display="flex" gap={4} flexWrap="wrap" mt={1}>
                <Box textAlign="center" flex={1}>
                  <Typography variant="h4" fontWeight="bold" color="primary">
                    {declData.total_constraints}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Mined constraints</Typography>
                </Box>
                <Box textAlign="center" flex={1}>
                  <Typography variant="h4" fontWeight="bold" color={highViolation ? 'error' : 'success.main'}>
                    {(violationRate * 100).toFixed(1)}%
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Cases with ≥1 violation</Typography>
                </Box>
                <Box textAlign="center" flex={1}>
                  <Typography variant="h4" fontWeight="bold">
                    {declData.total_traces.toLocaleString('en-US')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">Total cases</Typography>
                </Box>
              </Box>
            </CardContent>
          </Card>

          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Activities in Log ({declData.activities_in_log.length})
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={0.75}>
                {declData.activities_in_log.map((act) => (
                  <Chip key={act} label={act} size="small" variant="outlined" />
                ))}
              </Box>
            </CardContent>
          </Card>
        </>
      )}

      {/* Confirmation + actions — only when data is available */}
      {data && (
        <>
          <ConfirmationSection
            confirmed1={confirmed1}
            confirmed2={confirmed2}
            onConfirm1={setConfirmed1}
            onConfirm2={setConfirmed2}
          />
          {renderActions()}
        </>
      )}
    </Box>
  );
};

export default ModelCheck;

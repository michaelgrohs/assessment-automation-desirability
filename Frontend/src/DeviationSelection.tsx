import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Checkbox,
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
  Paper,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import PlaylistRemoveIcon from '@mui/icons-material/PlaylistRemove';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useNavigate } from 'react-router-dom';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
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

interface DeviationSelectionData {
  deviations: DeviationItem[];
  total_traces: number;
}

interface ModelContent {
  type: 'bpmn' | 'pnml' | 'declarative';
  content?: string;
  constraints?: any[];
}

const typeColor: Record<string, string> = {
  skip: '#c62828',
  insertion: '#1565c0',
};

// ── Variant row with exception marking ────────────────────────────────────────
const VariantRow: React.FC<{
  variant: Variant;
  rank: number;
  isMarked: boolean;
  onToggleMark: () => void;
}> = ({ variant, rank, isMarked, onToggleMark }) => (
  <TableRow sx={{ opacity: isMarked ? 0.6 : 1, backgroundColor: isMarked ? '#fff8e1' : undefined }}>
    <TableCell sx={{ color: 'text.secondary', width: 32 }}>{rank}</TableCell>
    <TableCell>
      <Box display="flex" alignItems="center" flexWrap="wrap" gap={0.5}>
        {variant.sequence.map((act, i) => (
          <React.Fragment key={i}>
            <Chip label={act} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            {i < variant.sequence.length - 1 && (
              <Typography variant="caption" color="text.secondary">→</Typography>
            )}
          </React.Fragment>
        ))}
      </Box>
    </TableCell>
    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
      {variant.count.toLocaleString('en-US')}
    </TableCell>
    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
      {variant.percentage}%
    </TableCell>
    <TableCell align="right">
      <Tooltip title={isMarked ? 'Unmark as Case Exception' : 'Mark as Case Exception'} arrow>
        <Button
          size="small"
          variant={isMarked ? 'contained' : 'outlined'}
          color="warning"
          startIcon={<PlaylistRemoveIcon />}
          onClick={onToggleMark}
          sx={{ whiteSpace: 'nowrap', fontSize: '0.7rem' }}
        >
          {isMarked ? 'Marked' : 'Case Exception'}
        </Button>
      </Tooltip>
    </TableCell>
  </TableRow>
);

// ── Deviation card ─────────────────────────────────────────────────────────────
const DeviationCard: React.FC<{
  item: DeviationItem;
  totalTraces: number;
  selected: boolean;
  onToggle: () => void;
  markedSequenceKeys: Set<string>;
  onToggleVariantMark: (sequence: string[], key: string) => void;
}> = ({ item, totalTraces, selected, onToggle, markedSequenceKeys, onToggleVariantMark }) => {
  const [expanded, setExpanded] = useState(false);
  const chipColor = typeColor[item.type] ?? '#555';

  return (
    <Card
      variant="outlined"
      sx={{
        mb: 1.5,
        borderColor: selected ? 'primary.main' : 'divider',
        borderWidth: selected ? 2 : 1,
        transition: 'border-color 0.15s',
      }}
    >
      {/* Header row */}
      <Box
        display="flex"
        alignItems="center"
        px={2}
        py={1.5}
        sx={{ cursor: 'pointer' }}
        onClick={onToggle}
      >
        <Checkbox
          checked={selected}
          onChange={(e) => { e.stopPropagation(); onToggle(); }}
          size="small"
          sx={{ mr: 1, p: 0 }}
        />
        <Box flex={1}>
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body1" fontWeight={selected ? 'bold' : 'normal'}>
              {item.label}
            </Typography>
            <Chip
              label={item.type}
              size="small"
              sx={{ backgroundColor: chipColor, color: '#fff', fontSize: '0.65rem' }}
            />
          </Box>
        </Box>
        <Box display="flex" alignItems="center" gap={2} ml={2}>
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
                backgroundColor: chipColor,
                borderRadius: 3,
              }}
            />
          </Box>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            aria-label={expanded ? 'Collapse variants' : 'Expand variants'}
          >
            {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Box>
      </Box>

      {/* Variants */}
      <Collapse in={expanded}>
        <Divider />
        <CardContent sx={{ pt: 1.5, pb: '12px !important' }}>
          {item.top_variants.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No variant data available.
            </Typography>
          ) : (
            <>
              <Typography variant="subtitle2" gutterBottom>
                Top variants containing this deviation
                <Tooltip
                  title="Mark a variant as a 'Case Exception' to exclude all its cases from the analysis. Click 'Apply & Recompute' after marking to trigger realignment."
                  arrow
                  placement="right"
                >
                  <IconButton size="small" sx={{ ml: 0.5 }}>
                    <InfoIcon fontSize="inherit" color="action" />
                  </IconButton>
                </Tooltip>
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Activity Sequence</TableCell>
                    <TableCell align="right">Cases</TableCell>
                    <TableCell align="right">% of affected</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {item.top_variants.map((v, i) => {
                    const key = JSON.stringify(v.sequence);
                    return (
                      <VariantRow
                        key={i}
                        variant={v}
                        rank={i + 1}
                        isMarked={markedSequenceKeys.has(key)}
                        onToggleMark={() => onToggleVariantMark(v.sequence, key)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Collapse>
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

    {modelContent?.type === 'declarative' && modelContent.constraints?.length && (
      <Box sx={{ maxHeight: height, overflowY: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell>A</TableCell>
              <TableCell>B</TableCell>
              <TableCell align="right">Conf.</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {modelContent.constraints.map((c: any, i: number) => (
              <TableRow key={i}>
                <TableCell>{c.type}</TableCell>
                <TableCell>{c.op_0}</TableCell>
                <TableCell>{c.op_1 ?? '—'}</TableCell>
                <TableCell align="right">{(c.confidence * 100).toFixed(0)}%</TableCell>
              </TableRow>
            ))}
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
    selectedDeviations,
    setSelectedDeviations,
    conformanceMode,
    loggingErrorDeviations,
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
  const [markedSequenceKeys, setMarkedSequenceKeys] = useState<Set<string>>(new Set());
  // Sequence arrays corresponding to marked keys (for applyAndRecompute)
  const markedSequencesRef = useRef<Map<string, string[]>>(new Map());

  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setContinue({
      label: 'Continue',
      onClick: () => navigate('/select-dimensions'),
      disabled: selectedDeviations.length === 0,
    });
    return () => setContinue(null);
  }, [selectedDeviations, navigate, setContinue]);

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

  // Restore marked sequences from context on mount
  useEffect(() => {
    if (filterSummary.step3_variant_sequences.length === 0) return;
    const keys = new Set<string>();
    filterSummary.step3_variant_sequences.forEach((seq) => {
      const k = JSON.stringify(seq);
      keys.add(k);
      markedSequencesRef.current.set(k, seq);
    });
    setMarkedSequenceKeys(keys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render BPMN when content available
  useEffect(() => {
    if (modelContent?.type === 'bpmn' && modelContent.content && bpmnContainerRef.current) {
      if (viewerRef.current) viewerRef.current.destroy();
      const viewer = new NavigatedViewer({ container: bpmnContainerRef.current });
      viewerRef.current = viewer;
      viewer
        .importXML(modelContent.content)
        .then(() => {
          setTimeout(() => {
            try { (viewer.get('canvas') as any).zoom('fit-viewport'); } catch (_) {}
          }, 100);
        })
        .catch((err: any) => console.error('BPMN render error:', err));
      return () => { viewer.destroy(); viewerRef.current = null; };
    }
  }, [modelContent]);

  const isSelected = (col: string) => selectedDeviations.some((d) => d.column === col);

  const toggleDeviation = (item: DeviationItem) => {
    setSelectedDeviations((prev) => {
      const exists = prev.find((d) => d.column === item.column);
      if (exists) return prev.filter((d) => d.column !== item.column);
      return [...prev, { column: item.column, label: item.label, type: item.type }];
    });
  };

  const toggleVariantMark = (sequence: string[], key: string) => {
    setMarkedSequenceKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        markedSequencesRef.current.delete(key);
      } else {
        next.add(key);
        markedSequencesRef.current.set(key, sequence);
      }
      return next;
    });
    setApplied(false);
  };

  const handleApplyAndRecompute = async () => {
    setApplying(true);
    setApplied(false);
    const sequences = Array.from(markedSequencesRef.current.values());
    try {
      await applyAndRecompute({ ...filterSummary, step3_variant_sequences: sequences });
      setApplied(true);
    } catch (err) {
      console.error('Recompute failed:', err);
    } finally {
      setApplying(false);
    }
  };

  const selectAll = () => {
    if (!data) return;
    setSelectedDeviations(
      data.deviations.map((d) => ({ column: d.column, label: d.label, type: d.type }))
    );
  };

  const clearAll = () => setSelectedDeviations([]);

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
  const allSelected = deviations.length > 0 && deviations.every((d) => isSelected(d.column));

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box display="flex" alignItems="center" gap={1} mb={0.5}>
        <Typography variant="h5" fontWeight="bold">
          Step 3: Select Deviations to Analyse
        </Typography>
        <Tooltip
          title={
            conformanceMode === 'declarative'
              ? 'Select the constraint violations you want to investigate. Expand each card to see which process variants contain it. Mark individual variants as "Case Exception" to exclude their cases and recompute alignments.'
              : 'Select the deviations you want to investigate. Expand any deviation to see the variants in which it occurs. Mark individual variants as "Case Exception" to exclude their cases and trigger recomputation.'
          }
          arrow
          placement="right"
        >
          <IconButton size="small">
            <InfoIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {total_traces.toLocaleString('en-US')} total cases · The process model is shown above for
        reference. Expand a deviation and mark variants as Case Exceptions to filter them out.
      </Typography>

      {/* Process model — full width, above deviations */}
      <Box mt={2}>
        <ModelPanel modelContent={modelContent} bpmnContainerRef={bpmnContainerRef} />
      </Box>

      {/* Deviations */}
      <Box sx={{ mt: 2 }}>
          {loggingErrorDeviations.length > 0 && (
            <Alert severity="info" sx={{ mb: 2 }}>
              <strong>{loggingErrorDeviations.length}</strong> deviation(s) identified as logging
              errors in Step 1b are hidden here.
            </Alert>
          )}

          {deviations.length === 0 && (
            <Alert severity="info">No deviations found in the deviation matrix.</Alert>
          )}

          {deviations.length > 0 && (
            <>
              {/* Controls row */}
              <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                  <Chip
                    label={`${selectedDeviations.length} selected`}
                    color={selectedDeviations.length > 0 ? 'primary' : 'default'}
                    size="small"
                  />
                  {markedSequenceKeys.size > 0 && (
                    <Chip
                      icon={<PlaylistRemoveIcon />}
                      label={`${markedSequenceKeys.size} variant(s) marked as case exception`}
                      color="warning"
                      size="small"
                      variant="outlined"
                    />
                  )}
                </Box>
                <Box display="flex" gap={1}>
                  {markedSequenceKeys.size > 0 && (
                    <Button
                      size="small"
                      variant="contained"
                      color="warning"
                      onClick={handleApplyAndRecompute}
                      disabled={applying}
                      startIcon={
                        applying ? <CircularProgress size={14} color="inherit" /> : <PlaylistRemoveIcon />
                      }
                    >
                      {applying ? 'Recomputing…' : 'Apply & Recompute'}
                    </Button>
                  )}
                  {applied && (
                    <Chip
                      label="Recomputed"
                      color="success"
                      size="small"
                      icon={<CheckCircleOutlineIcon />}
                    />
                  )}
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={allSelected ? clearAll : selectAll}
                  >
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </Button>
                </Box>
              </Box>

              {deviations.map((item) => (
                <DeviationCard
                  key={item.column}
                  item={item}
                  totalTraces={total_traces}
                  selected={isSelected(item.column)}
                  onToggle={() => toggleDeviation(item)}
                  markedSequenceKeys={markedSequenceKeys}
                  onToggleVariantMark={toggleVariantMark}
                />
              ))}
            </>
          )}
      </Box>
    </Box>
  );
};

export default DeviationSelection;

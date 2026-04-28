import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Alert,
  Chip,
  Divider,
  IconButton,
  Tooltip,
  TextField,
  CircularProgress,
  Button,
  Card,
  CardContent,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
  Collapse,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import MergeIcon from '@mui/icons-material/CallMerge';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { useNavigate } from 'react-router-dom';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import { useBottomNav } from './BottomNavContext';
import { useFileContext } from './FileContext';
import ScreenInfoBox from './ScreenInfoBox';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:1965';

interface DeviationItem {
  column: string;
  label: string;
  type: string;
  affected_count: number;
  affected_percentage: number;
  top_variants?: Variant[];
}

interface DeviationSelectionData {
  deviations: DeviationItem[];
  total_traces: number;
}

interface Correlation {
  col_a: string;
  col_b: string;
  count: number;
  percentage: number;
  jaccard: number;
}

interface Itemset {
  items: string[];
  count: number;
  percentage: number;
  size: number;
}

interface Variant {
  sequence: string[];
  count: number;
  percentage: number;
}

interface ModelContent {
  type: 'bpmn' | 'pnml' | 'declarative' | 'declarative-model';
  content?: string;
  constraints?: any[];
}


// ── Main component ──────────────────────────────────────────────────────────────
const IssueGrouping: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const {
    loggingErrorDeviations,
    processExceptionDeviations,
    outOfControlDeviations,
    deviationIssueMap,
    setDeviationIssueMap,
    setSelectedDeviations,
    conformanceMode,
  } = useFileContext();

  const [data, setData] = useState<DeviationSelectionData | null>(null);
  const [correlations, setCorrelations] = useState<Correlation[]>([]);
  const [itemsets, setItemsets] = useState<Itemset[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [modelContent, setModelContent] = useState<ModelContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // BPMN viewer
  const bpmnContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);

  // Local editable issue names: column → issue name
  const [issueNames, setIssueNames] = useState<Record<string, string>>({});
  // Selected columns for group merge
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState('');
  // Expanded trace rows
  const [expandedTraces, setExpandedTraces] = useState<Set<string>>(new Set());

  // Section collapse state
  const [showCorrelations, setShowCorrelations] = useState(true);
  const [showModel, setShowModel] = useState(true);
  const [showVariants, setShowVariants] = useState(false);
  const [showGrouping, setShowGrouping] = useState(true);

  const isDeclarative = conformanceMode === 'declarative' || conformanceMode === 'declarative-model';

  useEffect(() => {
    setContinue({
      label: 'Continue to Analysis',
      onClick: () => {
        setDeviationIssueMap(issueNames);

        const doApply = async () => {
          if (data) {
            // Build a complete issue_map covering every deviation column
            const excludeCols = [...loggingErrorDeviations, ...processExceptionDeviations, ...outOfControlDeviations];
            const completeIssueMap: Record<string, string> = {};
            const excludeSet = new Set(excludeCols);
            data.deviations.forEach((d) => {
              if (!excludeSet.has(d.column)) {
                completeIssueMap[d.column] = issueNames[d.column] ?? d.label;
              }
            });

            try {
              await fetch(`${API_URL}/api/apply-issue-grouping`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  issue_map: completeIssueMap,
                  exclude_cols: excludeCols,
                }),
              });
            } catch (e) {
              console.error('Failed to apply issue grouping:', e);
            }

            // Set selectedDeviations to unique issue names
            const seen = new Set<string>();
            const uniqueIssues: { column: string; label: string; type: string }[] = [];
            data.deviations.forEach((d) => {
              if (excludeSet.has(d.column)) return;
              const issueName = issueNames[d.column] ?? d.label;
              if (!seen.has(issueName)) {
                seen.add(issueName);
                uniqueIssues.push({ column: issueName, label: issueName, type: d.type });
              }
            });
            setSelectedDeviations(uniqueIssues);
          }

          navigate('/workaround-analysis');
        };
        doApply();
      },
    });
    return () => setContinue(null);
  }, [issueNames, data, navigate, setContinue, setDeviationIssueMap, setSelectedDeviations, loggingErrorDeviations, processExceptionDeviations, outOfControlDeviations, isDeclarative]);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [devRes, corrRes, itemsetRes, varRes, modelRes] = await Promise.all([
          fetch(`${API_URL}/api/deviation-selection`).then((r) => r.json()),
          fetch(`${API_URL}/api/deviation-correlations`).then((r) => r.json()),
          fetch(`${API_URL}/api/deviation-itemsets`).then((r) => r.json()).catch(() => ({ itemsets: [] })),
          fetch(`${API_URL}/api/process-variants`).then((r) => r.json()),
          fetch(`${API_URL}/api/model-content`).then((r) => r.json()).catch(() => null),
        ]);

        const devData: DeviationSelectionData = devRes;
        setData(devData);
        setCorrelations(corrRes.correlations ?? []);
        setItemsets((itemsetRes.itemsets ?? []).filter((i: Itemset) => i.size >= 3));
        setVariants(varRes.variants ?? []);
        setModelContent(modelRes);

        const init: Record<string, string> = {};
        devData.deviations
          .filter(
            (dev) =>
              !loggingErrorDeviations.includes(dev.column) &&
              !processExceptionDeviations.includes(dev.column) &&
              !outOfControlDeviations.includes(dev.column)
          )
          .forEach((dev) => {
            init[dev.column] = deviationIssueMap[dev.column] ?? dev.label;
          });
        setIssueNames(init);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render BPMN
  useEffect(() => {
    if (modelContent?.type === 'bpmn' && modelContent.content && bpmnContainerRef.current) {
      if (viewerRef.current) viewerRef.current.destroy();
      const viewer = new NavigatedViewer({ container: bpmnContainerRef.current });
      viewerRef.current = viewer;
      viewer.importXML(modelContent.content).then(() => {
        setTimeout(() => {
          try { (viewer.get('canvas') as any).zoom('fit-viewport'); } catch (_) {}
        }, 100);
      }).catch(() => {});
      return () => { viewer.destroy(); viewerRef.current = null; };
    }
  }, [modelContent, showModel]);

  if (loading) {
    return <Box display="flex" justifyContent="center" mt={6}><CircularProgress /></Box>;
  }
  if (error) {
    return <Alert severity="error" sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>{error}</Alert>;
  }
  if (!data) return null;

  const activeDeviations = data.deviations.filter(
    (d) => !loggingErrorDeviations.includes(d.column) && !processExceptionDeviations.includes(d.column) && !outOfControlDeviations.includes(d.column)
  );

  // Build label map for correlations display
  const labelMap: Record<string, string> = {};
  activeDeviations.forEach((d) => { labelMap[d.column] = d.label; });

  // Filter correlations to only active deviations
  const activeCorrelations = correlations.filter(
    (c) => labelMap[c.col_a] && labelMap[c.col_b]
  );

  // Detect connected components (clusters) of deviations with high co-occurrence
  const CLUSTER_THRESHOLD = 0.3;
  const adj: Record<string, Set<string>> = {};
  activeCorrelations.forEach((c) => {
    if (c.jaccard >= CLUSTER_THRESHOLD) {
      if (!adj[c.col_a]) adj[c.col_a] = new Set();
      if (!adj[c.col_b]) adj[c.col_b] = new Set();
      adj[c.col_a].add(c.col_b);
      adj[c.col_b].add(c.col_a);
    }
  });
  const visitedCluster = new Set<string>();
  const clusterGroups: string[][] = [];
  const dfsCluster = (node: string, comp: string[]) => {
    visitedCluster.add(node);
    comp.push(node);
    (adj[node] || new Set()).forEach((nb) => {
      if (!visitedCluster.has(nb)) dfsCluster(nb, comp);
    });
  };
  activeDeviations.forEach((d) => {
    if (!visitedCluster.has(d.column) && adj[d.column]) {
      const comp: string[] = [];
      dfsCluster(d.column, comp);
      clusterGroups.push(comp);
    }
  });
  // Only suggest groups of 3+ — pairs are shown in the correlation table
  const suggestedGroups = clusterGroups.filter((g) => g.length >= 3);

  // Build groups from current issueNames
  const groups: Record<string, DeviationItem[]> = {};
  activeDeviations.forEach((dev) => {
    const name = issueNames[dev.column] ?? dev.label;
    if (!groups[name]) groups[name] = [];
    groups[name].push(dev);
  });

  const toggleSelect = (col: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const toggleTraces = (col: string) => {
    setExpandedTraces((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col); else next.add(col);
      return next;
    });
  };

  const applyGroup = () => {
    if (!groupName.trim() || selected.size === 0) return;
    setIssueNames((prev) => {
      const next = { ...prev };
      selected.forEach((col) => { next[col] = groupName.trim(); });
      return next;
    });
    setSelected(new Set());
    setGroupName('');
  };

  const resetGrouping = () => {
    const reset: Record<string, string> = {};
    activeDeviations.forEach((dev) => { reset[dev.column] = dev.label; });
    setIssueNames(reset);
    setSelected(new Set());
    setGroupName('');
  };

  // ── Section header helper ──
  const SectionHeader: React.FC<{
    title: string; icon?: React.ReactNode; open: boolean; onToggle: () => void; badge?: string;
  }> = ({ title, icon, open, onToggle, badge }) => (
    <Box
      display="flex" alignItems="center" gap={1} sx={{ cursor: 'pointer', py: 1 }}
      onClick={onToggle}
    >
      {icon}
      <Typography variant="h6" sx={{ flex: 1 }}>{title}</Typography>
      {badge && <Chip label={badge} size="small" variant="outlined" />}
      <IconButton size="small">{open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
    </Box>
  );

  return (
    <Box sx={{ p: 3 }}>
      <ScreenInfoBox
        whatYouSee="Pairwise deviation co-occurrence (Jaccard), frequent itemsets of 3+ deviations that co-occur together (via Apriori), your process model, common process variants, and a grouping table."
        whatToDo="Review co-occurring deviations — high Jaccard similarity or a high-support itemset suggests a shared root cause and a good grouping candidate. Rename deviations to meaningful issue names or merge related ones. The issue names you set here are the units of causal analysis in all subsequent steps."
      />

      {/* ── Transition header ── */}
      <Box
        display="flex" alignItems="center" gap={2} mb={2} p={2}
        sx={{ background: 'linear-gradient(90deg, #f3e5f5 0%, #e3f2fd 100%)', borderRadius: 2, border: '1px solid #ce93d8' }}
      >
        <AccountTreeIcon sx={{ color: '#7b1fa2', fontSize: 32 }} />
        <Box>
          <Typography variant="h5" fontWeight="bold" sx={{ color: '#4a148c' }}>
            Aggregation Step
          </Typography>
          <Typography variant="body2" sx={{ color: '#6a1b9a' }}>
            Transition from Individual-level to Aggregated-level Analysis ·{' '}
            {activeDeviations.length} active deviation(s) · {Object.keys(groups).length} issue(s)
          </Typography>
        </Box>
      </Box>

      {activeDeviations.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No active deviations — all were excluded as logging errors or model exceptions.
          Continue to proceed to the analysis phase.
        </Alert>
      )}

      {activeDeviations.length > 0 && (
        <>

          {/* ── Deviation Correlations ── */}
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardContent sx={{ pb: '8px !important' }}>
              <SectionHeader
                title="Deviation Co-occurrence"
                open={showCorrelations}
                onToggle={() => setShowCorrelations((v) => !v)}
                badge={itemsets.length > 0 ? `${activeCorrelations.length} pairs · ${itemsets.length} itemsets` : `${activeCorrelations.length} pair(s)`}
              />
              <Collapse in={showCorrelations}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Deviations that frequently co-occur in the same cases may share a root cause and are good candidates for grouping into a single issue.
                </Typography>

                {/* Suggested groups of 3+ */}
                {suggestedGroups.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Suggested multi-deviation groups
                      <Tooltip title={`Deviations connected by Jaccard ≥ ${CLUSTER_THRESHOLD} form a cluster. Groups of 3 or more are shown here as candidates for merging into a single issue.`} arrow placement="right">
                        <IconButton size="small" sx={{ ml: 0.5, p: 0 }}><InfoIcon sx={{ fontSize: 14 }} color="action" /></IconButton>
                      </Tooltip>
                    </Typography>
                    <Box display="flex" flexDirection="column" gap={1}>
                      {suggestedGroups.map((group, gi) => (
                        <Paper key={gi} variant="outlined" sx={{ p: 1.25, background: '#f3e5f5', borderColor: '#ce93d8' }}>
                          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
                            <Chip label={`${group.length} deviations`} size="small"
                              sx={{ background: '#e1bee7', color: '#4a148c', fontWeight: 700, fontSize: '0.6rem' }} />
                            <Box display="flex" flexWrap="wrap" gap={0.5} flex={1}>
                              {group.map((col) => (
                                <Chip key={col} label={labelMap[col] ?? col} size="small" variant="outlined"
                                  sx={{ fontSize: '0.65rem', borderColor: '#ab47bc', color: '#6a1b9a' }} />
                              ))}
                            </Box>
                            <Tooltip title="Select all deviations in this cluster for merging" arrow>
                              <Button size="small" variant="outlined"
                                sx={{ fontSize: '0.65rem', borderColor: '#ab47bc', color: '#6a1b9a', whiteSpace: 'nowrap' }}
                                onClick={() => {
                                  setSelected(new Set(group));
                                  setShowGrouping(true);
                                }}
                              >
                                Select all {group.length}
                              </Button>
                            </Tooltip>
                          </Box>
                          {/* Min Jaccard across all pairs in this group */}
                          {(() => {
                            const pairJaccards = group.flatMap((a, ai) =>
                              group.slice(ai + 1).map((b) => {
                                const c = activeCorrelations.find(
                                  (x) => (x.col_a === a && x.col_b === b) || (x.col_a === b && x.col_b === a)
                                );
                                return c?.jaccard ?? null;
                              }).filter((j): j is number => j !== null)
                            );
                            const minJ = pairJaccards.length ? Math.min(...pairJaccards) : null;
                            const maxJ = pairJaccards.length ? Math.max(...pairJaccards) : null;
                            return minJ !== null ? (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                Pair-wise Jaccard: min {minJ.toFixed(2)} – max {maxJ!.toFixed(2)}
                              </Typography>
                            ) : null;
                          })()}
                        </Paper>
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Frequent itemsets (size >= 3) */}
                {itemsets.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Frequent Multi-Deviation Itemsets (≥ 3)
                      <Tooltip title="Sets of 3 or more deviations that co-occur in at least 3% of all traces. Computed via Apriori. Larger itemsets with high support are strong candidates for a shared root cause." arrow placement="right">
                        <IconButton size="small" sx={{ ml: 0.5, p: 0 }}><InfoIcon sx={{ fontSize: 14 }} color="action" /></IconButton>
                      </Tooltip>
                    </Typography>
                    <Box sx={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Deviations in Set</TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                              <Tooltip title="How many traces contain ALL deviations in this set simultaneously." arrow>
                                <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>Co-occurring cases</Box>
                              </Tooltip>
                            </TableCell>
                            <TableCell align="right">% of log</TableCell>
                            <TableCell />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {itemsets.map((it, i) => (
                            <TableRow key={i} sx={{ backgroundColor: it.percentage >= 10 ? '#f3e5f5' : it.percentage >= 5 ? '#fff8e1' : undefined }}>
                              <TableCell>
                                <Box display="flex" flexWrap="wrap" gap={0.4}>
                                  {it.items.map(col => (
                                    <Chip key={col} label={labelMap[col] ?? col} size="small" variant="outlined"
                                      sx={{ fontSize: '0.6rem', borderColor: '#ab47bc', color: '#6a1b9a' }} />
                                  ))}
                                </Box>
                              </TableCell>
                              <TableCell align="right" sx={{ fontSize: 11 }}>{it.count.toLocaleString('en-US')}</TableCell>
                              <TableCell align="right">
                                <Chip
                                  label={`${it.percentage}%`}
                                  size="small"
                                  sx={{ fontSize: 10, backgroundColor: it.percentage >= 10 ? '#e1bee7' : it.percentage >= 5 ? '#fff8e1' : undefined }}
                                />
                              </TableCell>
                              <TableCell>
                                <Tooltip title="Select all deviations in this itemset for grouping" arrow>
                                  <Button size="small" variant="text"
                                    sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}
                                    onClick={() => { setSelected(new Set(it.items)); setShowGrouping(true); }}
                                  >
                                    Select all {it.size}
                                  </Button>
                                </Tooltip>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Box>
                )}

                {/* Pair-wise correlation table */}
                {activeCorrelations.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No co-occurring deviations found.</Typography>
                ) : (
                  <Box sx={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Deviation A</TableCell>
                        <TableCell>Deviation B</TableCell>
                        <TableCell align="right">Co-occurring cases</TableCell>
                        <TableCell align="right">% of log</TableCell>
                        <TableCell align="right">
                          <Tooltip title="Jaccard similarity: intersection / union of affected cases. Higher = more overlap." arrow>
                            <Box component="span" sx={{ cursor: 'help', textDecoration: 'underline dotted' }}>Jaccard</Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {activeCorrelations.map((c, i) => (
                        <TableRow key={i} sx={{ backgroundColor: c.jaccard > 0.5 ? '#f3e5f5' : undefined }}>
                          <TableCell sx={{ fontSize: 11 }}>{labelMap[c.col_a] ?? c.col_a}</TableCell>
                          <TableCell sx={{ fontSize: 11 }}>{labelMap[c.col_b] ?? c.col_b}</TableCell>
                          <TableCell align="right">{c.count.toLocaleString('en-US')}</TableCell>
                          <TableCell align="right">{c.percentage}%</TableCell>
                          <TableCell align="right">
                            <Chip
                              label={c.jaccard.toFixed(2)}
                              size="small"
                              sx={{ fontSize: 10, backgroundColor: c.jaccard > 0.5 ? '#e1bee7' : c.jaccard > 0.25 ? '#fff8e1' : undefined }}
                            />
                          </TableCell>
                          <TableCell>
                            <Tooltip title="Select both for grouping" arrow>
                              <Button
                                size="small"
                                variant="text"
                                sx={{ fontSize: '0.65rem', whiteSpace: 'nowrap' }}
                                onClick={() => {
                                  setSelected(new Set([c.col_a, c.col_b]));
                                  setShowGrouping(true);
                                }}
                              >
                                Group these
                              </Button>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </Box>
                )}
              </Collapse>
            </CardContent>
          </Card>

          <Divider sx={{ my: 2 }} />

          {/* ── Issue Grouping ── */}
          <Card variant="outlined" sx={{ mb: 2 }}>
            <CardContent sx={{ pb: '8px !important' }}>
              <SectionHeader
                title="Group Deviations into Issues"
                open={showGrouping}
                onToggle={() => setShowGrouping((v) => !v)}
                badge={`${Object.keys(groups).length} issue(s)`}
              />
              <Collapse in={showGrouping}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  By default each deviation is its own issue. Merge related deviations into a shared issue for aggregated analysis. Consult the Co-occurrence section below to identify candidates.
                </Typography>

                {/* Merge tool */}
                <Paper variant="outlined" sx={{ p: 1.5, mb: 2, background: '#fafafa' }}>
                  <Box display="flex" gap={1} alignItems="center" flexWrap="wrap">
                    <TextField
                      size="small"
                      label="Issue name"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      sx={{ minWidth: 260 }}
                      placeholder="e.g. Missing handover documentation"
                    />
                    <Button
                      variant="contained" size="small" startIcon={<MergeIcon />}
                      disabled={selected.size < 2 || !groupName.trim()}
                      onClick={applyGroup}
                    >
                      Merge {selected.size > 0 ? `(${selected.size})` : ''}
                    </Button>
                    {selected.size > 0 && (
                      <Button size="small" variant="text" onClick={() => setSelected(new Set())}>Clear selection</Button>
                    )}
                    <Button size="small" variant="text" color="inherit" onClick={resetGrouping}>Reset all</Button>
                  </Box>
                </Paper>

                {/* Deviation table */}
                <Box sx={{ maxHeight: 500, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1, mb: 2 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox">Select</TableCell>
                      <TableCell>Deviation</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell align="right">Violations</TableCell>
                      <TableCell>Issue Name</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {activeDeviations.map((dev) => {
                      const isSel = selected.has(dev.column);
                      const tracesOpen = expandedTraces.has(dev.column);
                      return (
                        <React.Fragment key={dev.column}>
                          <TableRow selected={isSel} sx={{ cursor: 'pointer' }} onClick={() => toggleSelect(dev.column)}>
                            <TableCell padding="checkbox">
                              <input type="checkbox" checked={isSel} onChange={() => toggleSelect(dev.column)} onClick={(e) => e.stopPropagation()} style={{ cursor: 'pointer' }} />
                            </TableCell>
                            <TableCell sx={{ fontWeight: isSel ? 600 : 'normal', fontSize: 12 }}>{dev.label}</TableCell>
                            <TableCell>
                              <Chip label={dev.type} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />
                            </TableCell>
                            <TableCell align="right" sx={{ fontSize: 12 }}>{dev.affected_count.toLocaleString('en-US')}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <TextField
                                size="small" variant="standard"
                                value={issueNames[dev.column] ?? dev.label}
                                onChange={(e) => setIssueNames((prev) => ({ ...prev, [dev.column]: e.target.value }))}
                                sx={{ minWidth: 200 }}
                              />
                            </TableCell>
                            <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                              <Tooltip title={tracesOpen ? 'Hide traces' : 'Show traces'} arrow>
                                <IconButton size="small" onClick={() => toggleTraces(dev.column)}>
                                  {tracesOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                </IconButton>
                              </Tooltip>
                            </TableCell>
                          </TableRow>
                          {tracesOpen && (
                            <TableRow>
                              <TableCell colSpan={6} sx={{ py: 0, background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
                                <Collapse in={tracesOpen} unmountOnExit>
                                  <Box sx={{ px: 2, py: 1 }}>
                                    {(dev.top_variants?.length ?? 0) === 0 ? (
                                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>No trace data available.</Typography>
                                    ) : (
                                      <>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75, fontWeight: 600 }}>
                                          Top traces containing this deviation:
                                        </Typography>
                                        {dev.top_variants!.map((v, vi) => (
                                          <Box key={vi} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', flex: 1, lineHeight: 1.5 }}>
                                              {v.sequence.join(' → ')}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', pt: 0.1 }}>
                                              {v.count.toLocaleString('en-US')} case{v.count !== 1 ? 's' : ''} ({v.percentage}%)
                                            </Typography>
                                          </Box>
                                        ))}
                                      </>
                                    )}
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                </Box>

                {/* Issue preview */}
                <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>
                  Issue Preview
                </Typography>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {Object.entries(groups).map(([issueName, devs]) => (
                    <Paper key={issueName} variant="outlined" sx={{ p: 1, minWidth: 180 }}>
                      <Typography variant="caption" fontWeight="bold" display="block">{issueName}</Typography>
                      {devs.length > 1 && (
                        <Chip label={`${devs.length} merged`} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.6rem', mb: 0.5 }} />
                      )}
                      <Box display="flex" flexWrap="wrap" gap={0.25} mt={0.25}>
                        {devs.map((d) => (
                          <Chip key={d.column} label={d.label} size="small" variant="outlined" sx={{ fontSize: '0.6rem' }} />
                        ))}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Collapse>
            </CardContent>
          </Card>

          {/* ── Process Model ── */}
          {modelContent && (
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent sx={{ pb: '8px !important' }}>
                <SectionHeader
                  title="Process Model"
                  open={showModel}
                  onToggle={() => setShowModel((v) => !v)}
                />
                <Collapse in={showModel}>
                  {modelContent.type === 'bpmn' && (
                    <Box
                      ref={bpmnContainerRef}
                      sx={{ width: '100%', height: 400, border: '1px solid #eee', borderRadius: 1, overflow: 'hidden' }}
                    />
                  )}
                  {(modelContent.type === 'declarative' || modelContent.type === 'declarative-model') && modelContent.constraints?.length && (
                    <Box sx={{ overflowX: 'auto', maxHeight: 350, overflowY: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Type</TableCell>
                            <TableCell>Operand A</TableCell>
                            <TableCell>Operand B</TableCell>
                            {modelContent.type === 'declarative-model' && <TableCell align="right">Activations</TableCell>}
                            {modelContent.type === 'declarative' && <TableCell align="right">Support</TableCell>}
                            {modelContent.type === 'declarative' && <TableCell align="right">Confidence</TableCell>}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {modelContent.constraints.map((c: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontSize: 11 }}>{c.type}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{c.op_0}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{c.op_1 || '—'}</TableCell>
                              {modelContent.type === 'declarative-model' && (
                                <TableCell align="right" sx={{ fontSize: 11 }}>{c.total_activations ?? '—'}</TableCell>
                              )}
                              {modelContent.type === 'declarative' && (
                                <TableCell align="right" sx={{ fontSize: 11 }}>{(c.support * 100).toFixed(1)}%</TableCell>
                              )}
                              {modelContent.type === 'declarative' && (
                                <TableCell align="right" sx={{ fontSize: 11 }}>{(c.confidence * 100).toFixed(1)}%</TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  )}
                </Collapse>
              </CardContent>
            </Card>
          )}

          {/* ── Process Variants ── */}
          {variants.length > 0 && (
            <Card variant="outlined" sx={{ mb: 2 }}>
              <CardContent sx={{ pb: '8px !important' }}>
                <SectionHeader
                  title="Process Variants in Log"
                  open={showVariants}
                  onToggle={() => setShowVariants((v) => !v)}
                  badge={`${variants.length} variant(s)`}
                />
                <Collapse in={showVariants}>
                  <Typography variant="body2" color="text.secondary" gutterBottom>
                    All unique activity sequences observed in the log, sorted by frequency.
                  </Typography>
                  <Box sx={{ maxHeight: 340, overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>#</TableCell>
                          <TableCell>Activity Sequence</TableCell>
                          <TableCell align="right">Cases</TableCell>
                          <TableCell align="right">%</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {variants.map((v, i) => (
                          <TableRow key={i}>
                            <TableCell sx={{ color: 'text.secondary', width: 32, fontSize: 11 }}>{i + 1}</TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                {v.sequence.join(' → ')}
                              </Typography>
                            </TableCell>
                            <TableCell align="right" sx={{ fontSize: 11 }}>{v.count.toLocaleString('en-US')}</TableCell>
                            <TableCell align="right">
                              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
                                <Box sx={{ width: 40, height: 6, background: '#eee', borderRadius: 1, overflow: 'hidden' }}>
                                  <Box sx={{ width: `${v.percentage}%`, height: '100%', background: '#1976d2' }} />
                                </Box>
                                <Typography variant="caption">{v.percentage}%</Typography>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Collapse>
              </CardContent>
            </Card>
          )}

        </>
      )}
    </Box>
  );
};

export default IssueGrouping;

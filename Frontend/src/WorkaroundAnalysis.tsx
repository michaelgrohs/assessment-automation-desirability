import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Switch, FormControlLabel,
  TextField, Chip, CircularProgress, Alert, Divider, Tooltip, IconButton,
  Collapse, Button,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import MergeIcon from '@mui/icons-material/CallMerge';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useNavigate } from 'react-router-dom';
import { useBottomNav } from './BottomNavContext';
import { useFileContext, WorkaroundEntry } from './FileContext';
import ScreenInfoBox from './ScreenInfoBox';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:1965';

// ── Pattern types ──────────────────────────────────────────────────────────────
type PatternType =
  | 'recurrence'
  | 'direct_repetition'
  | 'mutually_exclusive'
  | 'wrong_order'
  | 'missing_occurrence'
  | 'unusual_neighbor';

interface PatternEntry {
  pattern_type: PatternType;
  activity: string;
  description: string;
  support_count: number;
  total_deviating: number;
  support_pct: number;
  exclusive_partner?: string;
  swap_partner?: string;
  unusual_neighbors?: string[];
}

interface MergeSuggestion {
  issue_a: string;
  issue_b: string;
  pattern_type: string;
  activity: string;
  description: string;
  support_count: number;
  total_traces: number;
  support_pct: number;
}

const PATTERN_LABELS: Record<PatternType, string> = {
  recurrence: 'Recurrence',
  direct_repetition: 'Direct Repetition',
  mutually_exclusive: 'Mutually Exclusive',
  wrong_order: 'Wrong Order',
  missing_occurrence: 'Missing Occurrence',
  unusual_neighbor: 'Unusual Neighbor',
};

const PATTERN_COLORS: Record<PatternType, { bg: string; text: string }> = {
  recurrence:          { bg: '#fff3e0', text: '#e65100' },
  direct_repetition:   { bg: '#fbe9e7', text: '#bf360c' },
  mutually_exclusive:  { bg: '#f3e5f5', text: '#6a1b9a' },
  wrong_order:         { bg: '#e3f2fd', text: '#0d47a1' },
  missing_occurrence:  { bg: '#f5f5f5', text: '#424242' },
  unusual_neighbor:    { bg: '#e0f2f1', text: '#00695c' },
};

// ── Goal dimensions ────────────────────────────────────────────────────────────
const ALL_GOAL_DIMENSIONS = ['time', 'costs', 'quality', 'outcome', 'compliance', 'flexibility'] as const;

const DIM_INFO: Record<string, { label: string; color: string; placeholder: string }> = {
  time:        { label: 'Time',        color: '#1565c0', placeholder: 'e.g. Speeds up case handling by bypassing a slow approval step.' },
  costs:       { label: 'Costs',       color: '#6a1b9a', placeholder: 'e.g. Avoids expensive re-work by resolving the issue earlier.' },
  quality:     { label: 'Quality',     color: '#2e7d32', placeholder: 'e.g. Ensures the output meets standards despite a missing tool.' },
  outcome:     { label: 'Outcome',     color: '#e65100', placeholder: 'e.g. Increases the chance of a successful result for the patient.' },
  compliance:  { label: 'Compliance',  color: '#00695c', placeholder: 'e.g. Ensures a mandatory check still happens via an alternative route.' },
  flexibility: { label: 'Flexibility', color: '#78909c', placeholder: 'e.g. Allows the process to adapt to exceptional patient needs not covered by the standard pathway.' },
};

const WorkaroundAnalysis: React.FC = () => {
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const {
    selectedDeviations, setSelectedDeviations,
    selectedDimensions,
    workaroundMap, setWorkaroundMap,
    deviationIssueMap, setDeviationIssueMap,
    loggingErrorDeviations, processExceptionDeviations, outOfControlDeviations,
  } = useFileContext();

  // Only show dimensions the user has configured + always include flexibility (not computable)
  const goalDimOptions = [
    ...(selectedDimensions.length > 0
      ? ALL_GOAL_DIMENSIONS.filter(d => d !== 'flexibility' && selectedDimensions.includes(d))
      : ALL_GOAL_DIMENSIONS.filter(d => d !== 'flexibility')),
    'flexibility' as const,
  ];

  const [resourcesByIssue, setResourcesByIssue] = useState<Record<string, string[]>>({});
  const [patternsByIssue, setPatternsByIssue] = useState<Record<string, PatternEntry[]>>({});
  const [mergeSuggestions, setMergeSuggestions] = useState<MergeSuggestion[]>([]);
  const [merging, setMerging] = useState<string | null>(null); // key = `${issue_a}||${issue_b}`
  const [expandedPatterns, setExpandedPatterns] = useState<Record<string, boolean>>({});
  const [showMergeSuggestions, setShowMergeSuggestions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/workaround-resources`).then(r => r.json()),
      fetch(`${API_URL}/api/workaround-patterns`).then(r => r.json()).catch(() => ({ patterns: {}, merge_suggestions: [] })),
    ])
      .then(([resData, patData]) => {
        setResourcesByIssue(resData.resources_by_issue || {});
        setPatternsByIssue(patData.patterns || {});
        setMergeSuggestions(patData.merge_suggestions || []);
        setLoading(false);
      })
      .catch(() => {
        setFetchError('Could not load resource data from backend.');
        setLoading(false);
      });
  }, []);

  // Merge issue_a and issue_b under mergedName: update issue map, re-apply grouping, refresh patterns
  const applyMerge = async (issue_a: string, issue_b: string, mergedName: string) => {
    const key = `${issue_a}||${issue_b}`;
    setMerging(key);

    // Remap every col pointing to issue_a or issue_b → mergedName
    const updatedIssueMap: Record<string, string> = {};
    Object.entries(deviationIssueMap).forEach(([col, name]) => {
      updatedIssueMap[col] = (name === issue_a || name === issue_b) ? mergedName : name;
    });

    const excludeCols = [...loggingErrorDeviations, ...processExceptionDeviations, ...outOfControlDeviations];
    const excludeSet = new Set(excludeCols);
    const completeIssueMap: Record<string, string> = {};
    Object.entries(updatedIssueMap).forEach(([col, name]) => {
      if (!excludeSet.has(col)) completeIssueMap[col] = name;
    });

    try {
      await fetch(`${API_URL}/api/apply-issue-grouping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issue_map: completeIssueMap, exclude_cols: excludeCols }),
      });

      // Refresh patterns
      const patData = await fetch(`${API_URL}/api/workaround-patterns`).then(r => r.json());

      // Update context
      setDeviationIssueMap(updatedIssueMap);
      // Replace issue_a and issue_b entries with the single merged name
      const seenNames = new Set<string>();
      const uniqueIssues: typeof selectedDeviations = [];
      selectedDeviations.forEach(d => {
        const newName = (d.column === issue_a || d.column === issue_b) ? mergedName : d.column;
        if (!seenNames.has(newName)) {
          seenNames.add(newName);
          uniqueIssues.push({ ...d, column: newName, label: newName });
        }
      });
      setSelectedDeviations(uniqueIssues);

      // Merge workaround entries: keep issue_a's entry under new name, discard issue_b
      setWorkaroundMap(prev => {
        const next = { ...prev };
        if (next[issue_a]) next[mergedName] = next[issue_a];
        delete next[issue_a];
        delete next[issue_b];
        return next;
      });

      // Update local pattern + suggestion state
      setPatternsByIssue(patData.patterns || {});
      setMergeSuggestions(patData.merge_suggestions || []);

      // Refresh resources
      const resData = await fetch(`${API_URL}/api/workaround-resources`).then(r => r.json());
      setResourcesByIssue(resData.resources_by_issue || {});
    } catch (e) {
      console.error('Merge failed', e);
    } finally {
      setMerging(null);
    }
  };

  useEffect(() => {
    setContinue({
      label: 'Continue to Impact Evaluation',
      onClick: () => navigate('/select-dimensions'),
    });
    return () => setContinue(null);
  }, [navigate, setContinue]);

  const getEntry = (issue: string): WorkaroundEntry =>
    workaroundMap[issue] ?? { isWorkaround: false, actorRoles: [], misfit: '', goal: '', goalDimensions: {} };

  const updateEntry = (issue: string, patch: Partial<WorkaroundEntry>) => {
    setWorkaroundMap(prev => ({
      ...prev,
      [issue]: { ...getEntry(issue), ...patch },
    }));
  };

  const toggleActor = (issue: string, resource: string) => {
    const current = getEntry(issue).actorRoles;
    const updated = current.includes(resource)
      ? current.filter(r => r !== resource)
      : [...current, resource];
    updateEntry(issue, { actorRoles: updated });
  };

  const issues = selectedDeviations.map(d => d.column);

  const togglePatterns = (issue: string) =>
    setExpandedPatterns(prev => ({ ...prev, [issue]: !prev[issue] }));

  return (
    <Box sx={{ width: '100%', mt: 5 }}>
      <Box display="flex" alignItems="center" mb={1}>
        <Typography variant="h5">Workaround Analysis</Typography>
        <Tooltip
          title="Workarounds are a special type of deviation: intentional adaptations by an actor who faces a misfit (a system constraint or gap) and bends the process to achieve a goal. They differ from errors because they are deliberate and purposeful. Each workaround can be described by (1) the actor role, (2) the misfit that triggered it, (3) the goal pursued, and (4) the intended effect on process dimensions (time, costs, quality, outcome, compliance, flexibility). This stated intent is later compared to the measured causal effect."
          arrow placement="right"
        >
          <IconButton size="small" sx={{ ml: 1 }}>
            <InfoIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>
      <ScreenInfoBox
        whatYouSee="One card per issue showing detected behavioral patterns (recurrence, wrong order, missing step, etc.) and a toggle to classify it as a workaround. When enabled, fields appear for the actor role, the system misfit that triggered the behaviour, the goal pursued, and the intended impact per dimension."
        whatToDo="For each issue, decide whether it is a workaround and fill in the context. The stated intent will later be compared to the measured causal effect to reveal alignment or conflict."
        example={
          <Box sx={{ fontSize: 12, color: '#555' }}>
            <strong>Example — "Skip Validation":</strong><br />
            A nurse skips a mandatory validation step because the system is slow during peak hours (<em>misfit</em>).
            The goal is to keep case handling fast (<em>Time</em>).
            The intended effect is a shorter duration — but the causal analysis may reveal a quality drop.<br /><br />
            <strong>What to fill in:</strong><br />
            · <strong>Misfit</strong> — what constraint or system problem triggers the deviation?<br />
            · <strong>Goal</strong> — what is the actor trying to achieve?<br />
            · <strong>Intended dimensions</strong> — which process dimensions does the actor expect to improve, and how?
          </Box>
        }
      />
      <Typography variant="body2" color="text.secondary" mb={3}>
        Workarounds are a special class of deviations: <strong>intentional adaptations</strong> performed by an actor who faces a constraint (<em>misfit</em>) and bends the process to pursue a specific goal. Unlike unintentional errors, they carry an intended effect on process dimensions such as time, costs, or quality. Describing that intent here allows the tool to compare it to the actually measured causal effect later — revealing whether the workaround truly helps or inadvertently causes harm.
      </Typography>

      {loading && <CircularProgress size={24} />}
      {fetchError && <Alert severity="warning" sx={{ mb: 2 }}>{fetchError}</Alert>}

      {/* ── Merge suggestions banner ── */}
      {!loading && mergeSuggestions.filter(s => s.support_pct > 5).length > 0 && (
        <Box
          sx={{
            mb: 3,
            border: '1px solid #1565c0',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <Box
            display="flex" alignItems="center" gap={1} px={2} py={1}
            sx={{ background: '#e3f2fd', cursor: 'pointer' }}
            onClick={() => setShowMergeSuggestions(v => !v)}
          >
            <Typography variant="body2" sx={{ fontWeight: 700, color: '#0d47a1', flex: 1 }}>
              {(() => { const n = mergeSuggestions.filter(s => s.support_pct > 5).length; return `Merge suggestions — ${n} issue pair${n > 1 ? 's' : ''} may benefit from grouping (>5% of traces)`; })()}
            </Typography>
            <IconButton size="small" sx={{ p: 0, color: '#0d47a1' }}>
              {showMergeSuggestions ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Box>
          <Collapse in={showMergeSuggestions}>
            <Box px={2} py={1.5} display="flex" flexDirection="column" gap={1}>
              {mergeSuggestions.filter(s => s.support_pct > 5).map((s, idx) => {
                const key = `${s.issue_a}||${s.issue_b}`;
                const isMerging = merging === key;
                return (
                  <Box
                    key={idx}
                    sx={{
                      background: '#f8fbff',
                      border: '1px solid #90caf9',
                      borderLeft: '4px solid #1565c0',
                      borderRadius: '0 4px 4px 0',
                      px: 1.5,
                      py: 1,
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={1} mb={0.5} flexWrap="wrap">
                      <Chip label={s.issue_a} size="small" sx={{ fontSize: '0.65rem', fontWeight: 600, background: '#e3f2fd', color: '#0d47a1' }} />
                      <Typography variant="caption" color="text.secondary">+</Typography>
                      <Chip label={s.issue_b} size="small" sx={{ fontSize: '0.65rem', fontWeight: 600, background: '#e3f2fd', color: '#0d47a1' }} />
                      <Chip
                        label={`Wrong Order · ${s.support_pct}% (${s.support_count}/${s.total_traces} traces)`}
                        size="small"
                        sx={{ fontSize: '0.6rem', background: PATTERN_COLORS.wrong_order.bg, color: PATTERN_COLORS.wrong_order.text }}
                      />
                      <Box sx={{ ml: 'auto' }}>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={isMerging ? <CircularProgress size={12} color="inherit" /> : <MergeIcon />}
                          disabled={!!merging}
                          onClick={() => applyMerge(s.issue_a, s.issue_b, `Wrong Order + ${s.activity}`)}
                          sx={{ fontSize: '0.65rem', py: 0.25, px: 1 }}
                        >
                          {isMerging ? 'Merging…' : `Merge as "Wrong Order + ${s.activity}"`}
                        </Button>
                      </Box>
                    </Box>
                    <Typography variant="caption" color="text.secondary">{s.description}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Collapse>
        </Box>
      )}

      {!loading && issues.map(issue => {
        const entry = getEntry(issue);
        const resources = resourcesByIssue[issue] || [];
        const patterns = patternsByIssue[issue] || [];
        const isPatternsExpanded = expandedPatterns[issue] ?? false;

        return (
          <Card
            key={issue}
            sx={{
              mb: 3,
              border: entry.isWorkaround ? '2px solid #1565c0' : '1px solid #e0e0e0',
              transition: 'border 0.2s',
            }}
          >
            <CardContent>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>{issue}</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={entry.isWorkaround}
                      onChange={e => updateEntry(issue, { isWorkaround: e.target.checked })}
                      color="primary"
                    />
                  }
                  label={<Typography variant="body2">Is a workaround</Typography>}
                  labelPlacement="start"
                  sx={{ ml: 0 }}
                />
              </Box>

              {/* ── Pattern hints ── */}
              {patterns.length > 0 && (
                <Box mt={1.5} sx={{ background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 1, p: 1.25 }}>
                  <Box
                    display="flex" alignItems="center" gap={1} sx={{ cursor: 'pointer' }}
                    onClick={() => togglePatterns(issue)}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#555', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5, flex: 1 }}>
                      Potential Workaround Patterns
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={0.5} sx={{ flex: 2 }}>
                      {Array.from(new Set(patterns.map(p => p.pattern_type))).map(pt => (
                        <Chip
                          key={pt}
                          label={PATTERN_LABELS[pt as PatternType]}
                          size="small"
                          sx={{
                            fontSize: '0.6rem',
                            backgroundColor: PATTERN_COLORS[pt as PatternType].bg,
                            color: PATTERN_COLORS[pt as PatternType].text,
                            fontWeight: 600,
                          }}
                        />
                      ))}
                    </Box>
                    <IconButton size="small" sx={{ p: 0 }}>
                      {isPatternsExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </IconButton>
                  </Box>

                  <Collapse in={isPatternsExpanded}>
                    <Box mt={1} display="flex" flexDirection="column" gap={0.75}>
                      {patterns.map((p, idx) => {
                        const col = PATTERN_COLORS[p.pattern_type];
                        return (
                          <Box
                            key={idx}
                            sx={{
                              background: col.bg,
                              borderLeft: `3px solid ${col.text}`,
                              borderRadius: '0 4px 4px 0',
                              px: 1.25,
                              py: 0.75,
                            }}
                          >
                            <Box display="flex" alignItems="center" gap={1} mb={0.25}>
                              <Chip
                                label={PATTERN_LABELS[p.pattern_type]}
                                size="small"
                                sx={{ fontSize: '0.58rem', backgroundColor: col.bg, color: col.text, fontWeight: 700, border: `1px solid ${col.text}` }}
                              />
                              <Typography variant="caption" sx={{ color: col.text, fontWeight: 600 }}>
                                {p.support_pct}% support ({p.support_count}/{p.total_deviating} traces)
                              </Typography>
                            </Box>
                            <Typography variant="caption" sx={{ color: '#444' }}>
                              {p.description}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  </Collapse>
                </Box>
              )}

              {/* Actor roles — always visible so user can identify who deviates before deciding */}
              <Box mt={1.5}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#666', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                  Actor Role
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                  Resources responsible for this deviation. Select to assign.
                </Typography>
                {resources.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No resources found (no <code>org:resource</code> in log, or backend needs restart).
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                    {resources.map(r => (
                      <Chip
                        key={r}
                        label={r}
                        size="small"
                        onClick={() => toggleActor(issue, r)}
                        color={entry.actorRoles.includes(r) ? 'primary' : 'default'}
                        variant={entry.actorRoles.includes(r) ? 'filled' : 'outlined'}
                        sx={{ cursor: 'pointer' }}
                      />
                    ))}
                  </Box>
                )}
              </Box>

              {entry.isWorkaround && (
                <>
                  <Divider sx={{ my: 2 }} />

                  {/* Workaround pattern type */}
                  <Box mb={2.5}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#666', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                      Workaround Pattern Type
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      Select the mechanism that best describes this workaround.
                      {patterns.length > 0 && ' Highlighted types were detected in the data.'}
                    </Typography>
                    <Box display="flex" flexWrap="wrap" gap={0.75}>
                      {(Object.keys(PATTERN_LABELS) as PatternType[]).map(pt => {
                        const detected = patterns.some(p => p.pattern_type === pt);
                        const selected = entry.patternType === pt;
                        const col = PATTERN_COLORS[pt];
                        return (
                          <Chip
                            key={pt}
                            label={PATTERN_LABELS[pt]}
                            size="small"
                            onClick={() => updateEntry(issue, { patternType: selected ? undefined : pt })}
                            sx={{
                              cursor: 'pointer',
                              fontSize: '0.65rem',
                              fontWeight: selected ? 700 : 400,
                              backgroundColor: selected ? col.text : detected ? col.bg : undefined,
                              color: selected ? '#fff' : detected ? col.text : undefined,
                              border: selected
                                ? `2px solid ${col.text}`
                                : detected
                                  ? `1px solid ${col.text}`
                                  : '1px solid #ccc',
                              opacity: !detected && !selected ? 0.55 : 1,
                            }}
                          />
                        );
                      })}
                    </Box>
                  </Box>

                  {/* Misfit */}
                  <Box mb={2.5}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#666', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                      Misfit
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      What struggle or constraint causes the resource to deviate from the standard process?
                    </Typography>
                    <TextField
                      fullWidth size="small" multiline minRows={2}
                      placeholder="e.g. The system does not support direct admission without a referral in urgent cases."
                      value={entry.misfit}
                      onChange={e => updateEntry(issue, { misfit: e.target.value })}
                    />
                  </Box>

                  {/* Goal */}
                  <Box mb={2.5}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#666', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                      Goal
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      What goal does the resource aim to achieve through this workaround?
                    </Typography>
                    <TextField
                      fullWidth size="small" multiline minRows={2}
                      placeholder="e.g. Ensure timely care for the patient despite administrative bottlenecks."
                      value={entry.goal}
                      onChange={e => updateEntry(issue, { goal: e.target.value })}
                    />
                  </Box>

                  {/* Intended dimension impact */}
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#666', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                      Intended Dimension Impact
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                      Which dimensions does this workaround aim to improve? Select all that apply and briefly describe the intended effect — this will be compared to the measured causal impact later. <em>Flexibility</em> is informative only and cannot be computed.
                    </Typography>
                    {goalDimOptions.length === 0 ? (
                      <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                        No dimensions configured yet. Set them up in the Impact Evaluation step.
                      </Typography>
                    ) : (
                      <>
                        <Box display="flex" flexWrap="wrap" gap={0.75} mb={1.25}>
                          {goalDimOptions.map(dim => {
                            const isSelected = dim in entry.goalDimensions;
                            const info = DIM_INFO[dim];
                            const isFlexibility = dim === 'flexibility';
                            return (
                              <Tooltip
                                key={dim}
                                title={isFlexibility ? 'Informative only — flexibility cannot be computed in the causal analysis.' : ''}
                                arrow
                                placement="top"
                              >
                                <Chip
                                  label={isFlexibility ? `${info.label} (informative)` : info.label}
                                  size="small"
                                  onClick={() => {
                                    const updated = { ...entry.goalDimensions };
                                    if (isSelected) { delete updated[dim]; }
                                    else { updated[dim] = ''; }
                                    updateEntry(issue, { goalDimensions: updated });
                                  }}
                                  sx={{
                                    cursor: 'pointer',
                                    fontSize: '0.65rem',
                                    fontWeight: isSelected ? 700 : 400,
                                    fontStyle: isFlexibility ? 'italic' : 'normal',
                                    backgroundColor: isSelected ? info.color : undefined,
                                    color: isSelected ? '#fff' : isFlexibility ? info.color : undefined,
                                    border: isSelected ? `2px solid ${info.color}` : isFlexibility ? `1px dashed ${info.color}` : '1px solid #ccc',
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                        </Box>
                        {goalDimOptions.filter(dim => dim in entry.goalDimensions).map(dim => {
                          const info = DIM_INFO[dim];
                          return (
                            <Box key={dim} sx={{ mb: 1 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600, color: info.color, display: 'block', mb: 0.4 }}>
                                {info.label} — how does the workaround aim to improve this?
                              </Typography>
                              <TextField
                                fullWidth size="small" multiline minRows={1}
                                placeholder={info.placeholder}
                                value={entry.goalDimensions[dim]}
                                onChange={e => {
                                  updateEntry(issue, { goalDimensions: { ...entry.goalDimensions, [dim]: e.target.value } });
                                }}
                              />
                            </Box>
                          );
                        })}
                      </>
                    )}
                  </Box>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

export default WorkaroundAnalysis;

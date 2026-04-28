import React from 'react';
import {
  Box, Typography, Card, CardContent, Button, TextField,
  Chip, Divider, IconButton, Tooltip, Select, MenuItem,
  ToggleButton, ToggleButtonGroup,
  Table, TableHead, TableRow, TableCell, TableBody,
  Collapse,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useLocation, useNavigate } from 'react-router-dom';
import { useBottomNav } from './BottomNavContext';
import { useFileContext, RiskOpportunity } from './FileContext';
import ScreenInfoBox from './ScreenInfoBox';

// ── Types ─────────────────────────────────────────────────────────────────────

type CriticalityLevel =
  | 'very negative' | 'negative' | 'slightly negative' | 'neutral'
  | 'slightly positive' | 'positive' | 'very positive';

interface CriticalityRule { min: number; max: number; label: CriticalityLevel; }
interface CriticalityMap { [dimension: string]: CriticalityRule[]; }

// ── Constants ─────────────────────────────────────────────────────────────────

const HORIZON_LABELS: Record<RiskOpportunity['horizon'], string> = {
  short: 'Short-term',
  mid:   'Mid-term',
  long:  'Long-term',
};

const HORIZON_COLORS: Record<RiskOpportunity['horizon'], string> = {
  short: '#1565c0',
  mid:   '#6a1b9a',
  long:  '#00695c',
};

const DIM_INFO: Record<string, { color: string }> = {
  time:        { color: '#1565c0' },
  costs:       { color: '#6a1b9a' },
  quality:     { color: '#2e7d32' },
  outcome:     { color: '#e65100' },
  compliance:  { color: '#00695c' },
  flexibility: { color: '#78909c' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeid = () => Math.random().toString(36).slice(2, 9);

const getCriticality = (value: number, rules: CriticalityRule[] = []): CriticalityLevel | null => {
  for (const rule of rules) {
    if (value >= rule.min && value < rule.max) return rule.label;
  }
  return null;
};

const getCriticalityMatrixColor = (label: CriticalityLevel | null) => {
  switch (label) {
    case 'very positive':     return 'rgba(0,100,0,0.85)';
    case 'positive':          return 'rgba(76,175,80,0.75)';
    case 'slightly positive': return 'rgba(129,199,132,0.7)';
    case 'neutral':           return 'rgba(200,200,200,0.7)';
    case 'slightly negative': return 'rgba(255,183,77,0.75)';
    case 'negative':          return 'rgba(255,152,0,0.75)';
    case 'very negative':     return 'rgba(211,47,47,0.85)';
    default:                  return '#fff';
  }
};

const criticalityWeight = (label: CriticalityLevel | null): number => {
  switch (label) {
    case 'very negative':    return 3;
    case 'negative':         return 2;
    case 'slightly negative':return 1;
    case 'neutral':          return 0;
    case 'slightly positive':return -1;
    case 'positive':         return -2;
    case 'very positive':    return -3;
    default:                 return 0;
  }
};

const criticalityColor = (label: string | null) => {
  switch (label) {
    case 'very positive':    return { bg: 'rgba(0,100,0,0.12)',    text: 'rgba(0,100,0,0.9)' };
    case 'positive':         return { bg: 'rgba(76,175,80,0.12)',  text: 'rgba(56,142,60,0.9)' };
    case 'slightly positive':return { bg: 'rgba(129,199,132,0.15)',text: 'rgba(56,142,60,0.75)' };
    case 'neutral':          return { bg: 'rgba(200,200,200,0.2)', text: '#555' };
    case 'slightly negative':return { bg: 'rgba(255,183,77,0.15)', text: '#e65100' };
    case 'negative':         return { bg: 'rgba(255,152,0,0.18)',  text: '#e65100' };
    case 'very negative':    return { bg: 'rgba(211,47,47,0.14)',  text: 'rgba(183,28,28,0.9)' };
    default:                 return { bg: '#f5f5f5', text: '#888' };
  }
};

// ── Component ─────────────────────────────────────────────────────────────────

const RisksOpportunities: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();

  const { results = [], criticalityMap = {} as CriticalityMap, priorityList = [] } = location.state ?? {};
  const [matrixOpen, setMatrixOpen] = React.useState(true);

  const {
    selectedDeviations,
    workaroundMap,
    issueRisksOpportunities,
    setIssueRisksOpportunities,
  } = useFileContext();

  const issues = selectedDeviations.map((d: any) => d.column);
  const dimensions = Array.from(new Set((results as any[]).map((r: any) => r.dimension))) as string[];
  const deviationsInResults = Array.from(new Set((results as any[]).map((r: any) => r.deviation))) as string[];

  React.useEffect(() => {
    setContinue({
      label: 'Continue to Recommendations',
      onClick: () => navigate('/recommendations', { state: { results, criticalityMap, priorityList } }),
    });
    return () => setContinue(null);
    // results/criticalityMap/priorityList come from router state and don't change while on this page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, setContinue]);

  const getEntries = (issue: string): RiskOpportunity[] =>
    issueRisksOpportunities[issue] ?? [];

  const addEntry = (issue: string, type: RiskOpportunity['type']) => {
    const entry: RiskOpportunity = { id: makeid(), type, horizon: 'short', description: '' };
    setIssueRisksOpportunities(prev => ({
      ...prev,
      [issue]: [...(prev[issue] ?? []), entry],
    }));
  };

  const updateEntry = (issue: string, id: string, patch: Partial<RiskOpportunity>) => {
    setIssueRisksOpportunities(prev => ({
      ...prev,
      [issue]: (prev[issue] ?? []).map(e => e.id === id ? { ...e, ...patch } : e),
    }));
  };

  const removeEntry = (issue: string, id: string) => {
    setIssueRisksOpportunities(prev => ({
      ...prev,
      [issue]: (prev[issue] ?? []).filter(e => e.id !== id),
    }));
  };

  const legendItems: { label: CriticalityLevel; color: string }[] = [
    { label: 'very positive',     color: getCriticalityMatrixColor('very positive') },
    { label: 'positive',          color: getCriticalityMatrixColor('positive') },
    { label: 'slightly positive', color: getCriticalityMatrixColor('slightly positive') },
    { label: 'neutral',           color: getCriticalityMatrixColor('neutral') },
    { label: 'slightly negative', color: getCriticalityMatrixColor('slightly negative') },
    { label: 'negative',          color: getCriticalityMatrixColor('negative') },
    { label: 'very negative',     color: getCriticalityMatrixColor('very negative') },
  ];

  return (
    <Box sx={{ width: '100%', mt: 5 }}>
      <ScreenInfoBox
        whatYouSee="A criticality overview matrix (issues × dimensions, colour-coded by impact) and per-issue cards where you can add risks and opportunities with a time horizon (short / mid / long-term)."
        whatToDo="Use the criticality matrix as context. For each issue, add risks (potential future negative impacts) and opportunities (potential future benefits) that are not captured by the measured causal effect alone — e.g. reputational risk, regulatory opportunity, or downstream ripple effects."
      />

      {/* ── Criticality overview matrix ── */}
      {dimensions.length > 0 && deviationsInResults.length > 0 && (
        <Box sx={{ mb: 4, border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
          <Box
            display="flex" justifyContent="space-between" alignItems="center"
            sx={{ px: 2, py: 1.5, backgroundColor: '#f5f5f5', cursor: 'pointer', userSelect: 'none' }}
            onClick={() => setMatrixOpen(o => !o)}
          >
            <Box display="flex" alignItems="center" gap={1}>
              <Typography variant="subtitle1" fontWeight={600}>Criticality Overview</Typography>
              <Tooltip
                title="Overall direction score per issue: for each dimension, the criticality label maps to a weight (very negative = +3, negative = +2, slightly negative = +1, neutral = 0, slightly positive = −1, positive = −2, very positive = −3). These weights sum across all dimensions. A positive total means the issue has an overall negative impact; a negative total means overall positive. Use this as context when defining risks and opportunities below."
                arrow placement="right"
              >
                <InfoIcon fontSize="small" color="action" sx={{ cursor: 'help' }} />
              </Tooltip>
            </Box>
            <IconButton size="small">{matrixOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}</IconButton>
          </Box>
          <Collapse in={matrixOpen}>
            <Box sx={{ p: 2 }}>
              {/* Legend */}
              <Box display="flex" flexWrap="wrap" gap={1.5} mb={1.5} alignItems="center">
                {legendItems.map(item => (
                  <Box key={item.label} display="flex" alignItems="center" gap={0.5}>
                    <Box sx={{ width: 14, height: 14, backgroundColor: item.color, borderRadius: 0.5 }} />
                    <Typography variant="caption" sx={{ fontSize: '0.6rem' }}>{item.label}</Typography>
                  </Box>
                ))}
              </Box>

              {/* Matrix table */}
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, background: '#fafafa' }}>Dimension</TableCell>
                      {deviationsInResults.map(dev => (
                        <TableCell key={dev} align="center" sx={{ fontWeight: 700, background: '#fafafa', whiteSpace: 'nowrap', fontSize: 11 }}>
                          <Tooltip title={dev} arrow>
                            <span>{dev.length > 20 ? dev.slice(0, 18) + '…' : dev}</span>
                          </Tooltip>
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dimensions.map(dim => (
                      <TableRow key={dim}>
                        <TableCell sx={{ fontWeight: 600 }}>{dim}</TableCell>
                        {deviationsInResults.map(dev => {
                          const result = (results as any[]).find((r: any) => r.dimension === dim && r.deviation === dev);
                          if (!result || result.ate == null) return <TableCell key={dev} />;
                          const label = getCriticality(result.ate, (criticalityMap as CriticalityMap)[dim]);
                          return (
                            <Tooltip key={dev} title={`CATE = ${result.ate?.toFixed(3) ?? '—'} (p = ${result.p_value?.toFixed(3) ?? '—'})`} arrow placement="top">
                              <TableCell align="center" sx={{ backgroundColor: getCriticalityMatrixColor(label), color: '#fff', fontWeight: 500, fontSize: 11 }}>
                                {label ?? '–'}
                              </TableCell>
                            </Tooltip>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Box>
          </Collapse>
        </Box>
      )}

      <Box display="flex" alignItems="center" mb={1}>
        <Typography variant="h5">Risks &amp; Opportunities</Typography>
        <Tooltip
          title="For each issue, define the risks and opportunities it poses across time horizons. These, together with the direct causal impact and workaround goals, form the full evaluation summary shown below each issue."
          arrow placement="right"
        >
          <IconButton size="small" sx={{ ml: 1 }}>
            <InfoIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={3}>
        For each issue, add the risks and opportunities it creates — short, mid, or long term. The evaluation summary below each card combines this with the measured causal impact and any stated workaround goal.
      </Typography>

      {issues.map((issue: string) => {
        const entries = getEntries(issue);
        const risks = entries.filter(e => e.type === 'risk');
        const opps  = entries.filter(e => e.type === 'opportunity');
        const workaround = workaroundMap[issue];

        // Direct impact: per-dimension criticality for this issue
        const issueResults = (results as any[]).filter((r: any) => r.deviation === issue);

        return (
          <Card key={issue} sx={{ mb: 4, border: '1px solid #e0e0e0' }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>{issue}</Typography>

              {/* ── Input section ── */}
              <Box display="flex" gap={2} flexWrap="wrap" mb={2}>
                <Button
                  size="small" variant="outlined" color="error"
                  startIcon={<AddIcon />}
                  onClick={() => addEntry(issue, 'risk')}
                  sx={{ fontSize: '0.72rem' }}
                >
                  Add Risk
                </Button>
                <Button
                  size="small" variant="outlined" color="success"
                  startIcon={<AddIcon />}
                  onClick={() => addEntry(issue, 'opportunity')}
                  sx={{ fontSize: '0.72rem' }}
                >
                  Add Opportunity
                </Button>
              </Box>

              {entries.length === 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No risks or opportunities defined yet.
                </Typography>
              )}

              {entries.map(entry => {
                const isRisk = entry.type === 'risk';
                const hColor = HORIZON_COLORS[entry.horizon];
                return (
                  <Box
                    key={entry.id}
                    sx={{
                      mb: 1.5,
                      p: 1.25,
                      borderRadius: 1,
                      border: `1px solid ${isRisk ? 'rgba(211,47,47,0.3)' : 'rgba(56,142,60,0.3)'}`,
                      borderLeft: `4px solid ${isRisk ? '#c62828' : '#2e7d32'}`,
                      background: isRisk ? 'rgba(211,47,47,0.03)' : 'rgba(56,142,60,0.03)',
                    }}
                  >
                    <Box display="flex" alignItems="center" gap={1} mb={1}>
                      <Chip
                        label={isRisk ? 'Risk' : 'Opportunity'}
                        size="small"
                        sx={{
                          fontSize: '0.6rem', fontWeight: 700,
                          backgroundColor: isRisk ? 'rgba(211,47,47,0.12)' : 'rgba(56,142,60,0.12)',
                          color: isRisk ? '#c62828' : '#2e7d32',
                        }}
                      />
                      <ToggleButtonGroup
                        exclusive
                        size="small"
                        value={entry.horizon}
                        onChange={(_, val) => { if (val) updateEntry(issue, entry.id, { horizon: val }); }}
                        sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: '0.62rem', lineHeight: 1.4 } }}
                      >
                        {(['short', 'mid', 'long'] as const).map(h => (
                          <ToggleButton
                            key={h} value={h}
                            sx={{
                              '&.Mui-selected': {
                                backgroundColor: `${HORIZON_COLORS[h]}22`,
                                color: HORIZON_COLORS[h],
                                fontWeight: 700,
                              },
                            }}
                          >
                            {HORIZON_LABELS[h]}
                          </ToggleButton>
                        ))}
                      </ToggleButtonGroup>
                      <IconButton
                        size="small" color="inherit"
                        onClick={() => removeEntry(issue, entry.id)}
                        sx={{ ml: 'auto', opacity: 0.5, '&:hover': { opacity: 1 } }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <TextField
                      fullWidth size="small" multiline minRows={1}
                      placeholder={isRisk
                        ? 'Describe the risk this issue poses…'
                        : 'Describe the opportunity this issue presents…'}
                      value={entry.description}
                      onChange={e => updateEntry(issue, entry.id, { description: e.target.value })}
                    />
                  </Box>
                );
              })}

              {/* ── Evaluation summary ── */}
              <Divider sx={{ my: 2 }} />
              <Typography variant="caption" sx={{ fontWeight: 700, color: '#555', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5 }}>
                Evaluation Summary
              </Typography>

              <Box mt={1} display="flex" flexDirection="column" gap={1.5}>
                {/* Direct impact */}
                <Box>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#444', display: 'block', mb: 0.5 }}>
                    Direct Impact (Causal Analysis)
                  </Typography>
                  {issueResults.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>No causal results available.</Typography>
                  ) : (
                    <Box display="flex" flexWrap="wrap" gap={0.75}>
                      {issueResults.map((r: any) => {
                        const label = getCriticality(r.ate, criticalityMap[r.dimension]);
                        const { bg, text } = criticalityColor(label);
                        return (
                          <Tooltip
                            key={r.dimension}
                            title={`${r.dimension}: CATE = ${r.ate?.toFixed(3) ?? '—'} (p = ${r.p_value?.toFixed(3) ?? '—'})`}
                            arrow placement="top"
                          >
                            <Box sx={{ px: 1, py: 0.4, borderRadius: 1, background: bg, cursor: 'default' }}>
                              <Typography variant="caption" sx={{ fontWeight: 700, color: text, fontSize: '0.65rem' }}>
                                {r.dimension}
                              </Typography>
                              <Typography variant="caption" sx={{ color: text, fontSize: '0.62rem', display: 'block' }}>
                                {label ?? 'unclassified'} ({r.ate >= 0 ? '+' : ''}{r.ate?.toFixed(2) ?? '—'})
                              </Typography>
                            </Box>
                          </Tooltip>
                        );
                      })}
                    </Box>
                  )}
                </Box>

                {/* Workaround goal */}
                {workaround?.isWorkaround && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#444', display: 'block', mb: 0.5 }}>
                      Workaround Goal
                    </Typography>
                    {workaround.goal && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                        {workaround.goal}
                      </Typography>
                    )}
                    {Object.keys(workaround.goalDimensions ?? {}).length > 0 && (
                      <Box display="flex" flexDirection="column" gap={0.4}>
                        {Object.entries(workaround.goalDimensions).map(([dim, desc]) => {
                          const col = DIM_INFO[dim]?.color ?? '#888';
                          return (
                            <Box key={dim} display="flex" gap={1} alignItems="flex-start">
                              <Chip
                                label={dim}
                                size="small"
                                sx={{ fontSize: '0.58rem', fontWeight: 700, backgroundColor: `${col}20`, color: col, flexShrink: 0 }}
                              />
                              {desc ? (
                                <Typography variant="caption" color="text.secondary">{desc}</Typography>
                              ) : (
                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>no description</Typography>
                              )}
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                )}

                {/* Risks & opportunities summary */}
                {(risks.length > 0 || opps.length > 0) && (
                  <Box>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: '#444', display: 'block', mb: 0.5 }}>
                      Risks &amp; Opportunities
                    </Typography>
                    <Box display="flex" flexDirection="column" gap={0.4}>
                      {[...risks, ...opps].map(e => {
                        const isRisk = e.type === 'risk';
                        const hColor = HORIZON_COLORS[e.horizon];
                        return (
                          <Box key={e.id} display="flex" gap={1} alignItems="flex-start">
                            <Chip
                              label={isRisk ? 'Risk' : 'Opp.'}
                              size="small"
                              sx={{
                                fontSize: '0.58rem', fontWeight: 700, flexShrink: 0,
                                backgroundColor: isRisk ? 'rgba(211,47,47,0.1)' : 'rgba(56,142,60,0.1)',
                                color: isRisk ? '#c62828' : '#2e7d32',
                              }}
                            />
                            <Chip
                              label={HORIZON_LABELS[e.horizon]}
                              size="small"
                              sx={{ fontSize: '0.58rem', flexShrink: 0, backgroundColor: `${hColor}18`, color: hColor }}
                            />
                            <Typography variant="caption" color="text.secondary">
                              {e.description || <em>no description</em>}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
};

export default RisksOpportunities;

import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  Table,
  Divider,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Slider,
  Button,
  Tooltip,
  IconButton,
  Chip,
} from "@mui/material";
import InfoIcon from "@mui/icons-material/Info";

import { useLocation, useNavigate } from "react-router-dom";
import { useFileContext } from "./FileContext";
import { useBottomNav } from "./BottomNavContext";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

interface CausalResult {
  deviation: string;
  dimension: string;
  ate: number;
  p_value: number;
  error?: string;
}

type CriticalityLevel =
  | "very negative"
  | "negative"
  | "slightly negative"
  | "neutral"
  | "slightly positive"
  | "positive"
  | "very positive";

const ALL_LEVELS: CriticalityLevel[] = [
  "very negative",
  "negative",
  "slightly negative",
  "neutral",
  "slightly positive",
  "positive",
  "very positive",
];

const LEVEL_ORDER: CriticalityLevel[] = [
  "very negative",
  "negative",
  "slightly negative",
  "neutral",
  "slightly positive",
  "positive",
  "very positive",
];

interface CriticalityRule {
  min: number;
  max: number;
  label: CriticalityLevel;
}

interface CriticalityMap {
  [dim: string]: CriticalityRule[];
}

// Dimensions where ATE represents a probability change (0–1 scale, binary outcome)
const BINARY_DIMENSIONS = new Set(["outcome", "compliance", "quality"]);

const getAteTooltip = (dimension: string, deviation: string, ate: number): string => {
  if (!isFinite(ate)) return "";
  const dimLower = dimension.toLowerCase();
  const isBinary = BINARY_DIMENSIONS.has(dimLower);
  const direction = ate < 0 ? "decreased" : "increased";
  const absAte = Math.abs(ate);

  if (isBinary) {
    const pct = (absAte * 100).toLocaleString('en-US', { maximumFractionDigits: 1 });
    return `The likelihood of a positive ${dimension} is ${direction} on average by ${pct}% if "${deviation}" happens.`;
  } else {
    const fmtAbs = absAte.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const fmtAte = ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `The ${dimension} CATE is ${fmtAte}. This means that ${dimension} is ${direction} by ${fmtAbs} on average whenever "${deviation}" occurs.`;
  }
};

const levelColor = (level: CriticalityLevel) => {
  switch (level) {
    case "very negative":
      return "rgba(211,47,47,1)";
    case "negative":
      return "rgba(255,152,0,1)";
    case "slightly negative":
      return "rgba(255,183,77,1)";
    case "neutral":
      return "rgba(200,200,200,1)";
    case "slightly positive":
      return "rgba(129,199,132,1)";
    case "positive":
      return "rgba(76,175,80,1)";
    case "very positive":
      return "rgba(0,100,0,1)";
    default:
      return "#ccc";
  }
};

const CausalResults: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { setContinue } = useBottomNav();

  const { selectedDeviations, resetAll, workaroundMap } = useFileContext();

  const handleReset = () => {
    resetAll();
    navigate("/");
  };

  const selectedDimensions = location.state?.selectedDimensions || [];

  const [results, setResults] = useState<CausalResult[]>([]);
  const [loading, setLoading] = useState(true);

  // selected levels per dimension (ordered in LEVEL_ORDER)
  const [selectedLevels, setSelectedLevels] = React.useState<{
    [dimension: string]: CriticalityLevel[];
  }>({});

  // boundaries per dimension = cut points between levels
  const [boundaries, setBoundaries] = useState<{
    [dim: string]: number[];
  }>({});

  const getMaxAbsEffect = (rows: any[]) => {
    if (!rows.length) return 1;
    return Math.max(...rows.map((r) => Math.abs(r.ate ?? 0)), 1);
  };

  const getCellColor = (dimension: string, ate: number, maxAbs: number) => {
    if (ate === undefined || maxAbs === 0) return "#fff";

    const intensity = Math.max(Math.min(Math.abs(ate) / maxAbs, 1), 0.15);

    const isNegativeGood = ["time", "costs"].includes(dimension.toLowerCase());
    const isPositiveGood = ["outcome", "quality", "compliance"].includes(
      dimension.toLowerCase()
    );

    let isGood = false;
    if (isNegativeGood) isGood = ate < 0;
    else if (isPositiveGood) isGood = ate > 0;
    else isGood = ate > 0;

    return isGood
      ? `rgba(76,175,80,${intensity})`
      : `rgba(211,47,47,${intensity})`;
  };

  const isNegativeGoodDim = (dim: string) =>
    ["time", "costs"].includes(dim.toLowerCase());

  const levelsForDim = (dim: string) => {
    const lvls = selectedLevels[dim] || [];
    return isNegativeGoodDim(dim) ? [...lvls].reverse() : lvls;
  };

  const sortedCutsForDim = (dim: string) => {
    const cuts = boundaries[dim] || [];
    return [...cuts].sort((a, b) => a - b);
  };



  // fetch causal effects
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${API_URL}/api/compute-causal-effects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviations: selectedDeviations.map((d: any) => d.column),
            dimensions: selectedDimensions,
          }),
        });

        const text = await res.text();
        const data = JSON.parse(text);

        setResults(data.results || []);
      } catch (err) {
        console.error("Fetch failed:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Activity duration contribution (only when time dimension is selected) ──
  const hasTimeDimension = selectedDimensions
    .map((d: string) => d.toLowerCase())
    .includes('time');

  interface ActivityDurationRow {
    activity: string;
    with_deviation: number | null;
    without_deviation: number | null;
    difference: number | null;
  }

  const [durationContributions, setDurationContributions] = useState<
    Record<string, ActivityDurationRow[]>
  >({});
  const [durationLoading, setDurationLoading] = useState(false);

  useEffect(() => {
    if (!hasTimeDimension || loading || deviations.length === 0) return;
    setDurationLoading(true);
    fetch(`${API_URL}/api/activity-duration-contribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviations: selectedDeviations.map((d: any) => d.column) }),
    })
      .then((r) => r.json())
      .then((data) => {
        setDurationContributions(data.contributions || {});
      })
      .catch((err) => console.error('Duration contribution fetch failed:', err))
      .finally(() => setDurationLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTimeDimension, loading, results.length]);

  const formatDurSec = (s: number | null): string => {
    if (s === null || s === undefined) return '—';
    const abs = Math.abs(s);
    if (abs >= 86400) return `${(s / 86400).toFixed(1)} d`;
    if (abs >= 3600) return `${(s / 3600).toFixed(1)} h`;
    if (abs >= 60) return `${(s / 60).toFixed(1)} min`;
    return `${s.toFixed(0)} s`;
  };

  const maxAbsEffect = getMaxAbsEffect(results);

  const dimensions = React.useMemo(
    () => Array.from(new Set(results.map((r) => r.dimension))),
    [results]
  );
  const deviations = React.useMemo(
    () => Array.from(new Set(results.map((r) => r.deviation))),
    [results]
  );

  // default selected levels = all, ordered
  useEffect(() => {
    if (!dimensions.length) return;

    setSelectedLevels((prev) => {
      let changed = false;
      const updated = { ...prev };
      dimensions.forEach((dim) => {
        if (!updated[dim]) {
          updated[dim] = [...LEVEL_ORDER];
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [dimensions]);

  // default boundaries: ±5% = neutral, ±25% = slightly, ±50% = moderate, beyond = very
  // all relative to the maximum absolute ATE for the dimension (keeps user edits)
  useEffect(() => {
    if (!dimensions.length || !results.length) return;

    const updated: { [dim: string]: number[] } = {};

    dimensions.forEach((dim) => {
      const levels = selectedLevels[dim] || [];
      if (levels.length < 2) return;

      // keep user changes if already correct length
      if (boundaries[dim] && boundaries[dim].length === levels.length - 1) return;

      const values = results
        .filter((r) => r.dimension === dim)
        .map((r) => r.ate)
        .filter((v) => v !== undefined);

      if (!values.length) return;

      // scale relative to the largest observed effect, minimum 1 to avoid degenerate sliders
      const maxAbs = Math.max(...values.map(Math.abs), 1);

      // 6 cut points for 7 levels: neutral = ±5%, slightly = ±25%, moderate = ±50%, very = beyond
      const fractions = [-0.50, -0.25, -0.05, +0.05, +0.25, +0.50];
      updated[dim] = fractions.map((f) => f * maxAbs);
    });

    if (Object.keys(updated).length) {
      setBoundaries((prev) => ({ ...prev, ...updated }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions, results, selectedLevels]);

  const buildCriticalityMap = (): CriticalityMap => {
    const map: CriticalityMap = {};

    dimensions.forEach((dim) => {
      const levels = levelsForDim(dim);
      const cuts = sortedCutsForDim(dim);

      if (levels.length < 2) return;
      if (cuts.length !== levels.length - 1) return;

      map[dim] = levels.map((label, i) => {
        if (i === 0) return { min: -Infinity, max: cuts[0], label };
        if (i === levels.length - 1) return { min: cuts[i - 1], max: Infinity, label };
        return { min: cuts[i - 1], max: cuts[i], label };
      });
    });

    return map;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setContinue({
      label: "Continue to Risks & Opportunities",
      onClick: () =>
        navigate("/risks-opportunities", {
          state: { results, criticalityMap: buildCriticalityMap() },
        }),
    });
    return () => setContinue(null);
  }, [results, boundaries, selectedLevels, navigate, setContinue]);

  if (loading) {
    return (
      <Box mt={6} textAlign="center">
        <CircularProgress />
        <Typography mt={2}>Computing causal effects...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "90vw", maxWidth: 1000, margin: "0 auto", mt: 4 }}>
      {/* HEADER */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Typography variant="h5">Causal Effects</Typography>

        <Button variant="outlined" color="secondary" onClick={handleReset}>
          Reset & Start Over
        </Button>
      </Box>

      <Box display="flex" alignItems="center" mb={1}>
        <Typography variant="h5">Conditional Average Treatment Effects (CATE)</Typography>
        <Tooltip
          title="Each cell shows the Conditional Average Treatment Effect (CATE) of a deviation on a process dimension, with the p-value in parentheses. For binary dimensions (outcome, compliance, quality), the CATE represents the change in probability of a positive outcome. For continuous dimensions (time, costs), the CATE is the average unit change. Hover over any cell for a plain-language interpretation. Use the criticality configurator below to assign qualitative labels to CATE ranges."
          arrow
          placement="right"
        >
          <IconButton size="small" sx={{ ml: 1 }}>
            <InfoIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* CATE intuition explanation */}
      <Box sx={{ backgroundColor: "grey.50", border: "1px solid", borderColor: "grey.200", borderRadius: 2, p: 2, mb: 3 }}>
        <Typography variant="body2" gutterBottom>
          A <strong>CATE</strong> (Conditional Average Treatment Effect) measures the estimated causal impact of a deviation on a process dimension, compared to cases without that deviation. For example, a CATE of <strong>−12.5</strong> for the <em>time</em> dimension means that cases where this deviation occurred were on average <strong>12.5 time units (e.g., seconds) shorter</strong>.
            A CATE of <strong>−0.30</strong> for a binary dimension like <em>outcome</em> means the probability of a positive outcome was on average <strong>30% lower</strong> in affected cases.
        </Typography>
        <Typography variant="body2" gutterBottom sx={{ mt: 1 }}>
          The <strong>p-value</strong> (in parentheses) indicates statistical significance: a smaller p-value means the estimated effect is less likely to be due to chance. A common threshold is p &lt; 0.05.
        </Typography>

        {/* Annotated example cell */}
        <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Box
            sx={{
              backgroundColor: "rgba(211,47,47,0.35)",
              border: "2px solid rgba(211,47,47,0.7)",
              borderRadius: 1,
              px: 2,
              py: 1,
              textAlign: "center",
              minWidth: 110,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: "bold" }}>
              −0.30{" "}
              <Typography component="span" variant="caption">
                (0.021)
              </Typography>
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.secondary">
              <strong>−0.30</strong> = CATE: the deviation reduces the dimension by 0.30 units on average
              (or −30%ok, make the toolt for binary dimensions)
            </Typography>
            <br />
            <Typography variant="caption" color="text.secondary">
              <strong>(0.021)</strong> = p-value: statistically significant at the 5% level (p &lt; 0.05)
            </Typography>
            <br />
            <Typography variant="caption" color="text.secondary">
              Cell color: <span style={{ color: "rgba(211,47,47,0.9)" }}>red = negative impact</span>, <span style={{ color: "rgba(76,175,80,0.9)" }}>green = positive impact</span>; intensity reflects effect size.
            </Typography>
          </Box>
        </Box>
      </Box>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" sx={{ minWidth: 400, tableLayout: 'auto' }}>
          <TableHead>
            <TableRow>
              <TableCell
                sx={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 3,
                  background: '#f5f5f5',
                  fontWeight: 700,
                  minWidth: 120,
                  borderRight: '2px solid',
                  borderColor: 'divider',
                }}
              >
                Dimension
              </TableCell>
              {deviations.map((dev) => (
                <TableCell
                  key={dev}
                  align="center"
                  sx={{ minWidth: 120, maxWidth: 200, whiteSpace: 'normal', wordBreak: 'break-word' }}
                >
                  {dev}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>

          <TableBody>
            {dimensions.map((dim) => (
              <TableRow key={dim}>
                <TableCell
                  sx={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 2,
                    background: '#fafafa',
                    borderRight: '2px solid',
                    borderColor: 'divider',
                    fontWeight: 'bold',
                  }}
                >
                  <strong>{dim}</strong>
                </TableCell>

                {deviations.map((dev) => {
                  const result = results.find(
                    (r) => r.dimension === dim && r.deviation === dev
                  );

                  if (!result) return <TableCell key={dev} />;

                  const bgColor = getCellColor(dim, result.ate, maxAbsEffect);
                  const entry = workaroundMap[dev];
                  const expectedDesc = entry?.isWorkaround && entry.goalDimensions?.[dim.toLowerCase()];

                  return (
                    <Tooltip
                      key={dev}
                      title={result.ate !== undefined ? getAteTooltip(dim, dev, result.ate) : ""}
                      arrow
                      placement="top"
                    >
                      <TableCell
                        align="center"
                        style={{ backgroundColor: bgColor, minWidth: 120, cursor: "help" }}
                      >
                        <Typography variant="body2" sx={{ fontWeight: "bold" }}>
                          {result.ate !== undefined
                            ? result.ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : "-"}{" "}
                          <Typography component="span" variant="caption">
                            ({result.p_value !== undefined ? result.p_value.toFixed(3) : "-"})
                          </Typography>
                        </Typography>
                        {expectedDesc && (
                          <Tooltip
                            title={`Expected by actor: "${expectedDesc}"`}
                            arrow
                            placement="bottom"
                          >
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'inline-block',
                                mt: 0.4,
                                px: 0.6,
                                py: 0.1,
                                borderRadius: 0.5,
                                fontSize: '0.55rem',
                                fontWeight: 700,
                                letterSpacing: 0.3,
                                background: 'rgba(21,101,192,0.12)',
                                color: '#1565c0',
                                cursor: 'help',
                              }}
                            >
                              ★ expected
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                    </Tooltip>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>

      {/* ── Activity duration contribution section ── */}
      {hasTimeDimension && (
        <>
          <Divider sx={{ my: 4 }} />
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Typography variant="h5">Activity Duration Contribution</Typography>
            <Tooltip
              title="Shows which activities contribute to longer or shorter process duration when a deviation occurs. Duration per activity is approximated as the time gap to the next event (since only one timestamp per activity is typically recorded). Activities are sorted by the absolute difference between traces with and without the deviation."
              arrow placement="right"
            >
              <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
            </Tooltip>
          </Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Average time from each activity until the next event, compared between cases with and without each deviation.
          </Typography>

          {durationLoading ? (
            <Box display="flex" justifyContent="center" mt={3}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            deviations.map((dev) => {
              const devObj = selectedDeviations.find((d: any) => d.column === dev);
              const label = devObj?.label ?? dev;
              const rows: ActivityDurationRow[] = durationContributions[dev] || [];
              if (rows.length === 0) return null;
              const maxAbsDiff = Math.max(...rows.map((r) => Math.abs(r.difference ?? 0)), 1);
              return (
                <Box key={dev} mb={4}>
                  <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                    {label}
                  </Typography>
                  <Box sx={{ overflowX: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                          <TableCell><strong>Activity</strong></TableCell>
                          <TableCell align="right"><strong>Avg. with deviation</strong></TableCell>
                          <TableCell align="right"><strong>Avg. without deviation</strong></TableCell>
                          <TableCell align="right"><strong>Difference</strong></TableCell>
                          <TableCell><strong>Impact</strong></TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => {
                          const diff = row.difference;
                          const barWidth = diff !== null ? (Math.abs(diff) / maxAbsDiff) * 100 : 0;
                          const isLonger = diff !== null && diff > 0;
                          return (
                            <TableRow key={row.activity}>
                              <TableCell>{row.activity}</TableCell>
                              <TableCell align="right">
                                {row.with_deviation !== null ? formatDurSec(row.with_deviation) : <span style={{ color: '#bbb' }}>—</span>}
                              </TableCell>
                              <TableCell align="right">
                                {row.without_deviation !== null ? formatDurSec(row.without_deviation) : <span style={{ color: '#bbb' }}>—</span>}
                              </TableCell>
                              <TableCell align="right">
                                {diff !== null ? (
                                  <Chip
                                    label={`${diff > 0 ? '+' : ''}${formatDurSec(diff)}`}
                                    size="small"
                                    sx={{
                                      backgroundColor: isLonger ? 'rgba(211,47,47,0.12)' : 'rgba(76,175,80,0.12)',
                                      color: isLonger ? '#c62828' : '#2e7d32',
                                      fontWeight: 600,
                                      fontSize: '0.72rem',
                                    }}
                                  />
                                ) : <span style={{ color: '#bbb' }}>—</span>}
                              </TableCell>
                              <TableCell sx={{ minWidth: 120 }}>
                                {diff !== null && (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Box
                                      sx={{
                                        height: 10,
                                        width: `${barWidth}%`,
                                        maxWidth: 100,
                                        backgroundColor: isLonger ? 'rgba(211,47,47,0.6)' : 'rgba(76,175,80,0.6)',
                                        borderRadius: 1,
                                        minWidth: 2,
                                      }}
                                    />
                                  </Box>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Red = activity takes longer when deviation is present (contributes to delay). Green = shorter.
                  </Typography>
                </Box>
              );
            })
          )}
        </>
      )}

      {/* Criticality configurator */}
      <Box mt={6}>
        <Typography variant="h6" gutterBottom>
          Define Criticality per Dimension
        </Typography>

        {dimensions.map((dim) => {
          const values = results
            .filter((r) => r.dimension === dim)
            .map((r) => r.ate)
            .filter((v) => v !== undefined);

          if (!values.length) return null;

          // compute min/max per dimension
            const rawMin = Math.min(...values);
            const rawMax = Math.max(...values);

            // Use ±1 minimum scale when all ATEs are within [-1, 1], otherwise ±10
            const allWithinUnit = rawMin >= -1 && rawMax <= 1;
            const min = Math.min(allWithinUnit ? -1 : -10, rawMin);
            const max = Math.max(allWithinUnit ? 1 : 10, rawMax);

            // optional padding to avoid 0-length gradient
            const padding = (max - min) * 0.05; // 5%
            const scaleMin = min - padding;
            const scaleMax = max + padding;


          const levelsRaw = selectedLevels[dim] || [];
          if (levelsRaw.length < 2) return null;

          const cuts = sortedCutsForDim(dim);
          const displayLevels = levelsForDim(dim); // already reversed if negative-good
          const boundariesArr = [min, ...cuts, max];
          const toPct = (v: number) => ((v - scaleMin) / (scaleMax - scaleMin)) * 100;

          const computeGradient = () => {
              const boundariesArr = [scaleMin, ...cuts, scaleMax];
              const stops: string[] = [];

              for (let i = 0; i < displayLevels.length; i++) {
                const start = boundariesArr[i];
                const end = boundariesArr[i + 1];

                const startPercent = ((start - scaleMin) / (scaleMax - scaleMin)) * 100;
                const endPercent = ((end - scaleMin) / (scaleMax - scaleMin)) * 100;

                // two stops per block for solid color
                stops.push(`${levelColor(displayLevels[i])} ${startPercent}%`);
                stops.push(`${levelColor(displayLevels[i])} ${endPercent}%`);
              }

              return `linear-gradient(to right, ${stops.join(", ")})`;
            };


          return (
            <Box key={dim} mb={5}>
              <Typography variant="subtitle1" gutterBottom>
                {dim}
              </Typography>

              {/* Multi Select Categories */}
              <Typography variant="body2">Select Categories:</Typography>
              <FormGroup row>
                {ALL_LEVELS.map((level) => (
                  <FormControlLabel
                    key={level}
                    control={
                      <Checkbox
                        checked={selectedLevels[dim]?.includes(level) || false}
                        onChange={(e) => {
                          const current = selectedLevels[dim] || [];
                          const updated = e.target.checked
                            ? [...current, level]
                            : current.filter((l) => l !== level);

                          const sorted = LEVEL_ORDER.filter((l) => updated.includes(l));

                          setSelectedLevels((prev) => ({ ...prev, [dim]: sorted }));

                          // adjust boundaries length if needed (keep existing as much as possible)
                          setBoundaries((prev) => {
                            const currentCuts = (prev[dim] || []).slice().sort((a, b) => a - b);
                            const needed = Math.max(sorted.length - 1, 0);
                            if (currentCuts.length === needed) return prev;

                            // if fewer needed, truncate
                            if (currentCuts.length > needed) {
                              return { ...prev, [dim]: currentCuts.slice(0, needed) };
                            }

                            // if more needed, extend using equal spacing across range
                            const range = max - min || 1;
                            const extra = needed - currentCuts.length;
                            const step = range / (sorted.length || 1);
                            const startFrom = currentCuts.length
                              ? currentCuts[currentCuts.length - 1]
                              : min + step;

                            const newCuts = [...currentCuts];
                            for (let i = 0; i < extra; i++) {
                              newCuts.push(startFrom + step * (i + 1));
                            }
                            return { ...prev, [dim]: newCuts.sort((a, b) => a - b) };
                          });
                        }}
                      />
                    }
                    label={level}
                  />
                ))}
              </FormGroup>

              {/* Range Slider */}
              <Typography variant="body2" sx={{ mt: 2 }}>
                ATE Range
              </Typography>

              <Slider
                value={cuts}
                min={scaleMin}
                  max={scaleMax}
                  step={(scaleMax - scaleMin) / 500}
                onChange={(e, newValue) =>
                  setBoundaries((prev) => ({
                    ...prev,
                    [dim]: (newValue as number[]).slice().sort((a, b) => a - b),
                  }))
                }
                valueLabelDisplay="auto"
                valueLabelFormat={(v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                track={false}
                sx={{
                  height: 8,
                  "& .MuiSlider-rail": {
                    opacity: 1,
                    backgroundImage: computeGradient(),
                    border: "none",
                  },
                  "& .MuiSlider-track": {
                    background: "transparent",
                    border: "none",
                  },
                  "& .MuiSlider-thumb": {
                    zIndex: 2,
                  },
                }}
              />




                {/* Cut labels at exact thumb positions */}
                <Box sx={{ position: "relative", height: 18, mt: 0.5 }}>
                  {/* min */}
                  <Typography
                    variant="caption"
                    sx={{ position: "absolute", left: 0, transform: "translateX(0%)" }}
                  >
                    {min.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Typography>

                  {/* cuts */}
                  {cuts.map((cut, i) => (
                    <Typography
                      key={i}
                      variant="caption"
                      sx={{
                        position: "absolute",
                        left: `${toPct(cut)}%`,
                        transform: "translateX(-50%)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {cut.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Typography>
                  ))}

                  {/* max */}
                  <Typography
                    variant="caption"
                    sx={{ position: "absolute", left: "100%", transform: "translateX(-100%)" }}
                  >
                    {max.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Typography>
                </Box>

                {/* Level labels centered in each segment */}
                <Box sx={{ position: "relative", height: 18, mt: 0.5 }}>
                  {displayLevels.map((lvl, i) => {
                    const start = boundariesArr[i];
                    const end = boundariesArr[i + 1];
                    const mid = (start + end) / 2;

                    return (
                      <Typography
                        key={`${lvl}-${i}`}
                        variant="caption"
                        sx={{
                          position: "absolute",
                          left: `${toPct(mid)}%`,
                          transform: "translateX(-50%)",
                          whiteSpace: "nowrap",
                          textAlign: "center",
                        }}
                      >
                        {lvl}
                      </Typography>
                    );
                  })}
                </Box>
            </Box>
          );
        })}
      </Box>

    </Box>
  );
};

export default CausalResults;
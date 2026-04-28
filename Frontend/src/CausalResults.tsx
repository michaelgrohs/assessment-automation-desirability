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
  n_traces?: number;
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
    return `The likelihood of a positive ${dimension} is ${direction} on average by ${pct}% if "${deviation}" happens (global ATE, all traces).`;
  } else {
    const fmtAbs = absAte.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const fmtAte = ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `ATE = ${fmtAte}. ${dimension} is ${direction} by ${fmtAbs} on average whenever "${deviation}" occurs (global, all traces).`;
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
        <Typography variant="h5">Causal Effects (Average Treatment Effect)</Typography>

        <Button variant="outlined" color="secondary" onClick={handleReset}>
          Reset & Start Over
        </Button>
      </Box>


      <Typography variant="body2" color="text.secondary" gutterBottom>
        The <strong>ATE (Average Treatment Effect)</strong> compares all deviating traces against all non-deviating traces — a global estimate of each deviation's impact. P-values in parentheses; p&nbsp;&lt;&nbsp;0.05 is significant. For binary dimensions (outcome, compliance, quality) values are probability changes; for continuous dimensions (time, costs) they are unit changes.
      </Typography>

      <Divider sx={{ my: 3 }} />

      <Box sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 340, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Table size="small" stickyHeader sx={{ minWidth: 400, tableLayout: 'auto' }}>
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
            {dimensions.map((dim, dIdx) => {
              const isLast = dIdx === dimensions.length - 1;
              const rowBorder = isLast ? '1px solid rgba(224,224,224,1)' : '3px solid rgba(0,0,0,0.15)';
              return (
                <TableRow key={dim}>
                  <TableCell sx={{
                    position: 'sticky', left: 0, zIndex: 2, background: '#fafafa',
                    borderRight: '2px solid', borderColor: 'divider',
                    borderBottom: rowBorder, py: 1.5,
                  }}>
                    <Typography variant="body2" fontWeight="bold">{dim.charAt(0).toUpperCase() + dim.slice(1)}</Typography>
                  </TableCell>
                  {deviations.map((dev) => {
                    const result = results.find((r) => r.dimension === dim && r.deviation === dev);
                    if (!result) return <TableCell key={dev} sx={{ borderBottom: rowBorder }} />;
                    const hasError = !!result.error;
                    const bgColor = hasError ? '#f5f5f5' : getCellColor(dim, result.ate, maxAbsEffect);
                    const entry = workaroundMap[dev];
                    const expectedDesc = entry?.isWorkaround && entry.goalDimensions?.[dim.toLowerCase()];
                    return (
                      <Tooltip key={dev} title={hasError ? result.error! : getAteTooltip(dim, dev, result.ate)} arrow placement="top">
                        <TableCell align="center" sx={{ backgroundColor: bgColor, minWidth: 130, borderBottom: rowBorder, verticalAlign: 'middle', cursor: 'help' }}>
                          {hasError ? (
                            <Typography variant="caption" sx={{ color: 'text.disabled', fontStyle: 'italic' }}>n/a</Typography>
                          ) : (
                            <>
                              <Typography variant="body2" fontWeight="bold">
                                {result.ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                                <Typography component="span" variant="caption">
                                  ({result.p_value !== undefined ? result.p_value.toFixed(3) : '-'})
                                </Typography>
                              </Typography>
                              {result.n_traces !== undefined && (
                                <Typography variant="caption" sx={{ display: 'block', fontSize: '0.6rem', color: 'text.secondary' }}>
                                  n={result.n_traces.toLocaleString('en-US')}
                                </Typography>
                              )}
                              {expectedDesc && (
                                <Tooltip title={`Expected by actor: "${expectedDesc}"`} arrow placement="bottom">
                                  <Typography variant="caption" sx={{ display: 'inline-block', mt: 0.3, px: 0.6, py: 0.1, borderRadius: 0.5, fontSize: '0.55rem', fontWeight: 700, background: 'rgba(21,101,192,0.12)', color: '#1565c0', cursor: 'help' }}>
                                    ★ expected
                                  </Typography>
                                </Tooltip>
                              )}
                            </>
                          )}
                        </TableCell>
                      </Tooltip>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>

      {/* Criticality configurator */}
      <Box mt={6}>
        <Typography variant="h6" gutterBottom>
          Define Criticality per Dimension
        </Typography>

        {dimensions.map((dim) => {
          const ateValues = results
            .filter((r) => r.dimension === dim)
            .map((r) => r.ate)
            .filter((v): v is number => v !== undefined && isFinite(v));

          if (!ateValues.length) return null;

          const rawMin = Math.min(...ateValues);
          const rawMax = Math.max(...ateValues);

          // Use ±1 minimum scale when all values are within [-1, 1], otherwise ±10
          const allWithinUnit = rawMin >= -1 && rawMax <= 1;
          const min = Math.min(allWithinUnit ? -1 : -10, rawMin);
          const max = Math.max(allWithinUnit ? 1 : 10, rawMax);

            // optional padding to avoid 0-length gradient
            const padding = (max - min) * 0.05; // 5%
            const scaleMin = min - padding;
            const scaleMax = max + padding;


          const levelsRaw = selectedLevels[dim] || [];
          if (levelsRaw.length < 2) return null;

          const rawCuts = sortedCutsForDim(dim);
          // Clamp cuts to current scale so thumbs never render outside the track
          const cuts = rawCuts.map((c) => Math.max(scaleMin, Math.min(scaleMax, c)));
          const displayLevels = levelsForDim(dim); // already reversed if negative-good
          const boundariesArr = [min, ...cuts, max];
          const toPct = (v: number) => Math.max(0, Math.min(100, ((v - scaleMin) / (scaleMax - scaleMin)) * 100));

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
              <Typography variant="subtitle1" mb={0.5}>{dim.charAt(0).toUpperCase() + dim.slice(1)}</Typography>

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
              <Typography variant="body2" sx={{ mt: 2 }}>ATE Range</Typography>
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
                valueLabelDisplay="off"
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
import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Divider,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Button,
  IconButton,
  CircularProgress,
  Alert,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CloseIcon from "@mui/icons-material/Close";
import InfoIcon from "@mui/icons-material/Info";
import DeleteIcon from "@mui/icons-material/Delete";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import MapIcon from "@mui/icons-material/Map";
import { useLocation, useNavigate } from "react-router-dom";
import { useBottomNav } from "./BottomNavContext";
import { useFileContext, IssueCausalLink } from "./FileContext";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import ScreenInfoBox from "./ScreenInfoBox";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTip,
  ResponsiveContainer,
  Cell,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

const formatSeconds = (s: number): string => {
  if (s >= 86400) return `${(s / 86400).toFixed(1)} days`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)} hrs`;
  if (s >= 60) return `${(s / 60).toFixed(1)} min`;
  return `${s.toFixed(0)} s`;
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface CausalResult {
  deviation: string;
  dimension: string;
  ate: number;
  p_value: number;
  error?: string;
  cate?: number;
  cate_p_value?: number;
  cate_n_traces?: number;
  cate_length_range?: [number, number] | null;
  cate_error?: string;
}

interface ActivityDurationRow {
  activity: string;
  with_deviation: number | null;
  without_deviation: number | null;
  difference: number | null;
}

type CriticalityLevel =
  | "very negative"
  | "negative"
  | "slightly negative"
  | "neutral"
  | "slightly positive"
  | "positive"
  | "very positive";

interface CriticalityRule {
  min: number;
  max: number;
  label: CriticalityLevel;
}

interface CriticalityMap {
  [dimension: string]: CriticalityRule[];
}

interface PriorityItem {
  deviation: string;
  score: number;
  reasons: string[];
}

interface DevRule {
  conditions: { feature: string; op: string; value: number }[];
  prediction: number;
  support: number;
  precision: number;
  coverage: number;
}

interface RuleResult {
  rules: DevRule[];
  feature_importance: { feature: string; importance: number }[];
  total_traces: number;
  deviation_rate: number;
  n_features?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const BINARY_DIMS = new Set(["outcome", "quality", "compliance"]);
const NEGATIVE_GOOD_DIMS = new Set(["time", "costs"]);
const DIM_NAMES_SET = new Set(["time", "costs", "quality", "outcome", "compliance"]);

const criticalityWeight = (label: CriticalityLevel | null): number => {
  switch (label) {
    case "very negative":    return 3;
    case "negative":         return 2;
    case "slightly negative":return 1;
    case "neutral":          return 0;
    case "slightly positive":return -1;
    case "positive":         return -2;
    case "very positive":    return -3;
    default:                 return 0;
  }
};

const getCriticality = (value: number, rules: CriticalityRule[] = []): CriticalityLevel | null => {
  for (const rule of rules) {
    if (value >= rule.min && value < rule.max) return rule.label;
  }
  return null;
};

const getCriticalityColor = (label: CriticalityLevel | null): string => {
  switch (label) {
    case "very positive":     return "rgba(0,100,0,0.85)";
    case "positive":          return "rgba(76,175,80,0.75)";
    case "slightly positive": return "rgba(129,199,132,0.7)";
    case "neutral":           return "rgba(200,200,200,0.7)";
    case "slightly negative": return "rgba(255,183,77,0.75)";
    case "negative":          return "rgba(255,152,0,0.75)";
    case "very negative":     return "rgba(211,47,47,0.85)";
    default: return "#fff";
  }
};

const overallDirection = (score: number): "negative" | "positive" | "neutral" => {
  if (score > 0) return "negative";
  if (score < 0) return "positive";
  return "neutral";
};

const directionChipColor = (dir: "negative" | "positive" | "neutral"): "error" | "success" | "default" => {
  if (dir === "negative") return "error";
  if (dir === "positive") return "success";
  return "default";
};

const recommendationText = (dev: string, dir: "negative" | "positive" | "neutral"): string => {
  if (dir === "negative")
    return `"${dev}" has an overall negative impact on your process. Investigate its root causes and take steps to prevent or reduce its occurrence.`;
  if (dir === "positive")
    return `"${dev}" has an overall positive impact on your process. Understand why it occurs and consider institutionalizing it as a standard practice.`;
  return `"${dev}" has a neutral overall impact. No immediate action is required — monitor it periodically but deprioritize remediation.`;
};

const getDimInterpretation = (dim: string, ate: number): string => {
  if (!isFinite(ate)) return "–";
  const dimL = dim.toLowerCase();
  const dimCap = dimL.charAt(0).toUpperCase() + dimL.slice(1);
  const isBinary = BINARY_DIMS.has(dimL);
  const isNegGood = NEGATIVE_GOOD_DIMS.has(dimL);
  const abs = Math.abs(ate);
  if (isBinary) {
    const pct = (abs * 100).toFixed(1);
    if (ate > 0) return `↑ +${pct}% probability of positive ${dimCap} (beneficial)`;
    if (ate < 0) return `↓ −${pct}% probability of positive ${dimCap} (harmful)`;
    return "No effect";
  }
  const fmt = abs.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (isNegGood) {
    if (ate < 0) return `↓ −${fmt} units of ${dimCap} (beneficial — lower is better)`;
    if (ate > 0) return `↑ +${fmt} units of ${dimCap} (harmful — higher is worse)`;
  } else {
    if (ate > 0) return `↑ +${fmt} units of ${dimCap} (beneficial)`;
    if (ate < 0) return `↓ −${fmt} units of ${dimCap} (harmful)`;
  }
  return "No effect";
};

const computeBins = (values: number[], numBins = 12): { label: string; count: number }[] => {
  if (!values.length) return [];
  const min = values.reduce((a, b) => (b < a ? b : a), values[0]);
  const max = values.reduce((a, b) => (b > a ? b : a), values[0]);
  if (min === max) return [{ label: min.toLocaleString("en-US", { maximumFractionDigits: 2 }), count: values.length }];
  const binSize = (max - min) / numBins;
  const bins = Array.from({ length: numBins }, (_, i) => ({
    label: (min + i * binSize).toLocaleString("en-US", { maximumFractionDigits: 1 }),
    count: 0,
  }));
  values.forEach((v) => {
    const idx = Math.min(Math.floor((v - min) / binSize), numBins - 1);
    bins[idx].count++;
  });
  return bins;
};

const pearsonCorr = (xs: number[], ys: number[]): number | null => {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0)
  );
  return den === 0 ? null : num / den;
};

const detectCategorical = (col: string, matrixRows: any[]): boolean => {
  if (DIM_NAMES_SET.has(col) || col === "trace_id" || col === "activities") return false;
  if (matrixRows.length === 0) return false;
  const firstVal = matrixRows.find((r) => r[col] !== null && r[col] !== undefined)?.[col];
  if (firstVal === undefined) return false;
  if (typeof firstVal === "number" || typeof firstVal === "boolean") return false;
  if (Array.isArray(firstVal)) return false;
  const vals = matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
  const unique = new Set(vals);
  return unique.size >= 2 && unique.size <= 20;
};

const ruleConditionsToText = (rule: DevRule): string => {
  return rule.conditions
    .map((c) => {
      if (Math.abs(c.value - 0.5) < 0.1) {
        const lastUs = c.feature.lastIndexOf("_");
        if (lastUs > 0) {
          const origCol = c.feature.slice(0, lastUs);
          const cat = c.feature.slice(lastUs + 1);
          return c.op === ">" ? `${origCol} = ${cat}` : `${origCol} ≠ ${cat}`;
        }
      }
      return `${c.feature} ${c.op} ${c.value}`;
    })
    .join(" AND ");
};

// ── Co-occurrence Matrix ────────────────────────────────────────────────────────

const DeviationCooccurrence: React.FC<{ priorityList: PriorityItem[]; matrixRows: any[] }> = ({
  priorityList,
  matrixRows,
}) => {
  const [open, setOpen] = useState(false);
  const devNames = priorityList.map((p) => p.deviation);

  if (devNames.length < 2 || matrixRows.length === 0) return null;

  const coOccurrence: Record<string, Record<string, number>> = {};
  devNames.forEach((a) => {
    coOccurrence[a] = {};
    const aTraces = matrixRows.filter((r) => r[a] === 1);
    const aCount = aTraces.length;
    devNames.forEach((b) => {
      if (a === b) { coOccurrence[a][b] = -1; return; }
      coOccurrence[a][b] = aCount > 0 ? aTraces.filter((r) => r[b] === 1).length / aCount : 0;
    });
  });

  const cellBg = (val: number): string => {
    if (val < 0) return "#f5f5f5";
    if (val <= 0.5) {
      const t = val / 0.5;
      return `rgba(255,${Math.round(255 - t * 103)},${Math.round(255 - t * 255)},0.85)`;
    }
    const t = (val - 0.5) / 0.5;
    return `rgba(${Math.round(255 - t * 44)},${Math.round(152 - t * 105)},${Math.round(t * 47)},0.85)`;
  };

  return (
    <Box sx={{ mb: 3, border: "1px solid #e0e0e0", borderRadius: 2, overflow: "hidden" }}>
      <Box
        display="flex"
        justifyContent="space-between"
        alignItems="center"
        sx={{ px: 2, py: 1.5, backgroundColor: "#f5f5f5", cursor: "pointer", userSelect: "none" }}
        onClick={() => setOpen((o) => !o)}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Deviation Co-occurrence Matrix
          <Box component="span" sx={{ ml: 1, fontSize: 12, color: "text.secondary", fontWeight: 400 }}>
            P(B | A) — how often does B occur when A is present?
          </Box>
        </Typography>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
          {open ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      {open && (
        <Box sx={{ p: 2, overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 11, fontWeight: 700, backgroundColor: "#fafafa" }}>A \ B →</TableCell>
                {devNames.map((b) => (
                  <TableCell key={b} align="center"
                    sx={{ fontSize: 10, fontWeight: 700, backgroundColor: "#fafafa", whiteSpace: "nowrap" }}>
                    <Tooltip title={b} arrow>
                      <span>{b.length > 18 ? b.slice(0, 16) + "…" : b}</span>
                    </Tooltip>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {devNames.map((a) => (
                <TableRow key={a}>
                  <TableCell sx={{ fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>
                    <Tooltip title={a} arrow>
                      <span>{a.length > 18 ? a.slice(0, 16) + "…" : a}</span>
                    </Tooltip>
                  </TableCell>
                  {devNames.map((b) => {
                    const val = coOccurrence[a][b];
                    const isDiag = a === b;
                    return (
                      <Tooltip
                        key={b}
                        title={isDiag ? "" : `${Math.round(val * 100)}% of traces with "${a}" also have "${b}"`}
                        arrow
                      >
                        <TableCell
                          align="center"
                          sx={{
                            fontSize: 11,
                            fontWeight: isDiag ? 400 : 600,
                            backgroundColor: isDiag ? "#f5f5f5" : cellBg(val),
                            color: !isDiag && val > 0.5 ? "white" : "inherit",
                          }}
                        >
                          {isDiag ? "—" : `${Math.round(val * 100)}%`}
                        </TableCell>
                      </Tooltip>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
};

// ── Correlation overview (deviation vs all attributes) ────────────────────────

interface CorrelationOverviewProps {
  deviation: string;
  matrixRows: any[];
  matrixCols: string[];
  activeCorrelCol: string | null;
  onSelectCol: (col: string | null) => void;
}

const CorrelationOverview: React.FC<CorrelationOverviewProps> = ({
  deviation,
  matrixRows,
  matrixCols,
  activeCorrelCol,
  onSelectCol,
}) => {
  const [showOtherDevs, setShowOtherDevs] = useState(false);

  const orderedCols = matrixCols.length > 0 ? matrixCols : (matrixRows.length > 0 ? Object.keys(matrixRows[0]) : []);

  const isOtherDev = (col: string): boolean => {
    if (col === deviation || DIM_NAMES_SET.has(col)) return false;
    const vals = matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
    return vals.length > 0 && vals.every((v) => v === 0 || v === 1);
  };

  const corrRows = orderedCols
    .filter((col) => {
      if (col === deviation || col === "trace_id" || col === "activities") return false;
      if (DIM_NAMES_SET.has(col)) return false;
      if (Array.isArray(matrixRows[0]?.[col])) return false;
      if (!showOtherDevs && isOtherDev(col)) return false;
      return matrixRows.some((r) => typeof r[col] === "number");
    })
    .map((col) => {
      const pairs = matrixRows.filter(
        (r) => typeof r[col] === "number" && (r[deviation] === 0 || r[deviation] === 1)
      );
      const xs = pairs.map((r) => r[col]);
      const ys = pairs.map((r) => r[deviation]);
      const r = pearsonCorr(xs, ys);
      return { col, r, n: pairs.length };
    })
    .filter((row) => row.r !== null)
    .sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!));

  const catRows = orderedCols
    .filter((col) => {
      if (col === deviation || col === "trace_id" || col === "activities") return false;
      if (DIM_NAMES_SET.has(col)) return false;
      if (isOtherDev(col)) return false;
      return detectCategorical(col, matrixRows);
    })
    .map((col) => {
      const categories = Array.from(new Set(matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined)));
      const rates = categories.map((cat) => {
        const inCat = matrixRows.filter((r) => r[col] === cat);
        return inCat.length > 0 ? inCat.filter((r) => r[deviation] === 1).length / inCat.length : 0;
      });
      const maxRate = rates.length > 0 ? Math.max(...rates) : 0;
      const minRate = rates.length > 0 ? Math.min(...rates) : 0;
      const n = matrixRows.filter((r) => r[col] !== null && r[col] !== undefined).length;
      return { col, maxRate, range: maxRate - minRate, n };
    })
    .filter((row) => row.n > 0)
    .sort((a, b) => b.range - a.range);

  if (corrRows.length === 0 && catRows.length === 0) return null;

  const corrColor = (r: number | null): string => {
    if (r === null) return "#eee";
    const abs = Math.abs(r);
    if (abs > 0.5) return r > 0 ? "rgba(230,120,0,0.15)" : "rgba(21,101,192,0.15)";
    if (abs > 0.2) return r > 0 ? "rgba(230,120,0,0.1)" : "rgba(25,118,210,0.1)";
    return "transparent";
  };

  return (
    <Box sx={{ mt: 2, border: "1px solid #e0e0e0", borderRadius: 1, p: 2, backgroundColor: "#fafafe" }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle2">
          Attribute Correlations with <strong>{deviation}</strong>
          <Box component="span" sx={{ ml: 1, fontSize: 11, color: "text.secondary" }}>
            (click a row to explore)
          </Box>
        </Typography>
        <Button
          size="small"
          variant={showOtherDevs ? "contained" : "outlined"}
          disableElevation
          onClick={() => setShowOtherDevs((v) => !v)}
          sx={{ fontSize: 11 }}
        >
          {showOtherDevs ? "Hide other deviations" : "Show other deviations"}
        </Button>
      </Box>

      {corrRows.length > 0 && (
        <>
          <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
            <Typography variant="caption" color="text.secondary">Numeric attributes — Pearson r</Typography>
            <Tooltip title="Pearson correlation coefficient between this numeric attribute and the deviation (0/1). Values near ±1 indicate a strong linear association; near 0 means little linear relationship. Click a row to explore visually." arrow>
              <InfoIcon sx={{ fontSize: 13, color: "text.disabled", cursor: "help" }} />
            </Tooltip>
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Attribute</TableCell>
                  <TableCell align="center" sx={{ fontSize: 11, fontWeight: 700 }}>Pearson r</TableCell>
                  <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Strength</TableCell>
                  <TableCell align="right" sx={{ fontSize: 11, fontWeight: 700 }}>n</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {corrRows.map(({ col, r, n }) => {
                  const abs = Math.abs(r!);
                  const strength = abs > 0.5 ? "strong" : abs > 0.2 ? "moderate" : "weak";
                  const active = activeCorrelCol === col;
                  return (
                    <TableRow
                      key={col}
                      onClick={() => onSelectCol(active ? null : col)}
                      sx={{
                        cursor: "pointer",
                        backgroundColor: active ? "#e3f2fd" : corrColor(r),
                        "&:hover": { backgroundColor: "#e8f4fd" },
                        outline: active ? "2px solid #1976d2" : "none",
                        outlineOffset: "-2px",
                      }}
                    >
                      <TableCell sx={{ fontSize: 11 }}>
                        {col === "trace_duration_seconds" ? "Duration (s)" : col}
                        {isOtherDev(col) && (
                          <Box component="span" sx={{ ml: 0.5, fontSize: 10, color: "#888" }}>(dev)</Box>
                        )}
                        {active && <Box component="span" sx={{ ml: 0.5, color: "#1976d2", fontSize: 11 }}>↑</Box>}
                      </TableCell>
                      <TableCell align="center" sx={{
                        fontSize: 11, fontWeight: 600,
                        color: r! > 0 ? "#c62828" : "#1565c0",
                      }}>
                        {r!.toFixed(3)}
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, color: abs > 0.5 ? "#c62828" : abs > 0.2 ? "#e65100" : "#888" }}>
                        {strength}
                      </TableCell>
                      <TableCell align="right" sx={{ fontSize: 10, color: "text.secondary" }}>{n}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </>
      )}

      {catRows.length > 0 && (
        <Box sx={{ mt: corrRows.length > 0 ? 2 : 0 }}>
          <Box display="flex" alignItems="center" gap={0.5} mb={0.5} sx={{ mt: corrRows.length > 0 ? 1 : 0 }}>
            <Typography variant="caption" color="text.secondary">Categorical attributes — deviation rate range</Typography>
            <Tooltip title="For each category value of this attribute, the deviation rate is the fraction of traces in that category that have the deviation. The range shows [min rate, max rate] across all values — a wide range suggests this attribute differentiates deviant traces. Click a row to explore." arrow>
              <InfoIcon sx={{ fontSize: 13, color: "text.disabled", cursor: "help" }} />
            </Tooltip>
          </Box>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ backgroundColor: "#f5f5f5" }}>
                <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Attribute</TableCell>
                <TableCell align="center" sx={{ fontSize: 11, fontWeight: 700 }}>Max dev rate</TableCell>
                <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Rate range</TableCell>
                <TableCell align="right" sx={{ fontSize: 11, fontWeight: 700 }}>n</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {catRows.map(({ col, maxRate, range, n }) => {
                const active = activeCorrelCol === col;
                return (
                  <TableRow
                    key={col}
                    onClick={() => onSelectCol(active ? null : col)}
                    sx={{
                      cursor: "pointer",
                      backgroundColor: active ? "#e3f2fd" : "transparent",
                      "&:hover": { backgroundColor: "#e8f4fd" },
                      outline: active ? "2px solid #1976d2" : "none",
                      outlineOffset: "-2px",
                    }}
                  >
                    <TableCell sx={{ fontSize: 11 }}>
                      {col}
                      {active && <Box component="span" sx={{ ml: 0.5, color: "#1976d2", fontSize: 11 }}>↑</Box>}
                    </TableCell>
                    <TableCell align="center" sx={{ fontSize: 11, fontWeight: 600 }}>
                      {(maxRate * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell sx={{ fontSize: 11 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{
                          height: 8, borderRadius: 1,
                          backgroundColor: "#f57c00", opacity: 0.7,
                          width: `${Math.max(4, range * 100)}%`,
                          minWidth: 4,
                        }} />
                        <Box component="span" sx={{ fontSize: 10, color: "text.secondary", whiteSpace: "nowrap" }}>
                          {(range * 100).toFixed(0)}pp
                        </Box>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 10, color: "text.secondary" }}>{n}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
};

// ── Process Context Panel ─────────────────────────────────────────────────────

const ProcessContextPanel: React.FC<{ deviation: string; matrixRows: any[] }> = ({
  deviation,
  matrixRows,
}) => {
  const g0 = matrixRows.filter((r) => r[deviation] === 0);
  const g1 = matrixRows.filter((r) => r[deviation] === 1);

  const mean0 = g0.length > 0
    ? g0.reduce((s, r) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g0.length
    : 0;
  const mean1 = g1.length > 0
    ? g1.reduce((s, r) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g1.length
    : 0;

  const traceLengthData = [
    { label: "No deviation", mean: parseFloat(mean0.toFixed(1)) },
    { label: "Deviation", mean: parseFloat(mean1.toFixed(1)) },
  ];

  const allActivities = new Set<string>();
  matrixRows.forEach((r) => {
    if (Array.isArray(r.activities)) r.activities.forEach((a: string) => allActivities.add(a));
  });

  const hasActivities = allActivities.size > 0;
  const eps = 1e-9;

  const activityLifts = Array.from(allActivities).map((act) => {
    const rateWith = g1.length > 0
      ? g1.filter((r) => Array.isArray(r.activities) && r.activities.includes(act)).length / g1.length
      : 0;
    const rateWithout = g0.length > 0
      ? g0.filter((r) => Array.isArray(r.activities) && r.activities.includes(act)).length / g0.length
      : 0;
    return { act, lift: rateWith / (rateWithout + eps), rateWith, rateWithout };
  });

  const LIFT_CAP = 5;
  const top10 = activityLifts
    .sort((a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1))
    .slice(0, 10)
    .map((item) => {
      const clipped = item.lift > LIFT_CAP;
      const shortName = item.act.length > 28 ? item.act.slice(0, 26) + "…" : item.act;
      return {
        label: clipped ? shortName + " ···" : shortName,
        lift: parseFloat(Math.min(item.lift, LIFT_CAP).toFixed(2)),
        liftActual: parseFloat(item.lift.toFixed(2)),
        rateWith: parseFloat((item.rateWith * 100).toFixed(1)),
        rateWithout: parseFloat((item.rateWithout * 100).toFixed(1)),
        clipped,
      };
    });

  return (
    <Box sx={{ mt: 2, border: "1px solid #e0e0e0", borderRadius: 1, p: 2, backgroundColor: "#fafafe" }}>
      <Box display="flex" alignItems="center" gap={0.5} mb={1}>
        <Typography variant="subtitle2">Process Context</Typography>
        <Tooltip title="Compares traces with and without this deviation: average trace length and which activities are significantly more (or less) common when the deviation is present." arrow>
          <InfoIcon sx={{ fontSize: 15, color: "text.disabled", cursor: "help" }} />
        </Tooltip>
      </Box>
      <Box display="flex" gap={3} flexWrap="wrap">
        <Box sx={{ flex: "0 1 220px", minWidth: 180 }}>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Mean trace length (number of activities)
          </Typography>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={traceLengthData} margin={{ top: 4, right: 8, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={30} />
              <RechartsTip formatter={(v: any) => [`${v} activities`, "Mean length"]} />
              <Bar dataKey="mean" radius={[2, 2, 0, 0]}>
                <Cell fill="#78909c" />
                <Cell fill="#f57c00" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>

        {hasActivities && top10.length > 0 && (
          <Box sx={{ flex: "1 1 300px", minWidth: 260 }}>
            <Box display="flex" alignItems="center" gap={0.5} mb={0.5}>
              <Typography variant="caption" color="text.secondary">
                Activity lift — how much more (or less) often each activity appears in deviant vs. conformant traces (lift = rate in deviant ÷ rate in conformant)
              </Typography>
              <Tooltip title={`Lift compares how frequently each activity occurs in traces WITH the deviation versus traces WITHOUT it. Lift = (share of deviant traces containing the activity) ÷ (share of conformant traces containing it). A lift of 2 means the activity is twice as common when the deviation occurs — suggesting a strong association. A lift of 0.5 means it appears half as often — the activity tends to be skipped in deviant traces. A lift near 1 means roughly equal presence in both groups, so no strong link to the deviation. Bars are capped at ${LIFT_CAP}×; labels ending in "···" are truncated — hover to see the actual value.`} arrow>
                <InfoIcon sx={{ fontSize: 13, color: "text.disabled", cursor: "help", flexShrink: 0 }} />
              </Tooltip>
            </Box>
            <ResponsiveContainer width="100%" height={Math.max(160, top10.length * 26)}>
              <BarChart data={top10} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, LIFT_CAP]}
                  tick={{ fontSize: 9 }}
                  tickFormatter={(v) => v === LIFT_CAP ? `${LIFT_CAP}+` : v.toFixed(1)}
                />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 8 }} width={140} />
                <RechartsTip
                  formatter={(_v: any, _name: string, props: any) => {
                    const p = props.payload;
                    const liftStr = p.clipped ? `${p.liftActual} (capped at ${LIFT_CAP})` : p.liftActual.toFixed(2);
                    return [`${liftStr}  (with: ${p.rateWith}%, without: ${p.rateWithout}%)`, "Lift"];
                  }}
                />
                <Bar
                  dataKey="lift"
                  shape={(props: any) => {
                    const { x, y, width, height, payload } = props;
                    if (!width || !height) return <g />;
                    const fill = payload.liftActual > 1 ? "#f57c00" : "#1976d2";
                    if (!payload.clipped) {
                      return <rect x={x} y={y} width={width} height={height} fill={fill} opacity={0.75} rx={2} />;
                    }
                    const bx = x + width * 0.52;
                    const sw = 5;
                    return (
                      <g>
                        <rect x={x} y={y} width={width} height={height} fill={fill} opacity={0.75} rx={2} />
                        <line x1={bx - sw} y1={y - 1} x2={bx + 1} y2={y + height + 1} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
                        <line x1={bx + 2} y1={y - 1} x2={bx + sw + 3} y2={y + height + 1} stroke="white" strokeWidth={2.5} strokeLinecap="round" />
                      </g>
                    );
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        )}
      </Box>
    </Box>
  );
};

// ── Decision Rules Panel ──────────────────────────────────────────────────────

const DecisionRulesPanel: React.FC<{
  rulesData: RuleResult | null;
  rulesLoading: boolean;
  rulesError: string | null;
}> = ({ rulesData, rulesLoading, rulesError }) => {
  if (rulesLoading) {
    return (
      <Box display="flex" alignItems="center" gap={1} sx={{ mt: 2, p: 2 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">Extracting predictive rules…</Typography>
      </Box>
    );
  }
  if (rulesError) {
    return <Alert severity="warning" sx={{ mt: 2 }}>{rulesError}</Alert>;
  }
  if (!rulesData) return null;

  const { rules = [], feature_importance = [] } = rulesData;
  const topImportance = feature_importance.slice(0, 8);
  const topRules = rules.filter((r) => r.precision >= 0.6).slice(0, 5);

  // Only show the panel when rules have meaningful predictive power
  if (topRules.length === 0) return null;

  const condLabel = (c: DevRule["conditions"][0]): string => {
    if (Math.abs(c.value - 0.5) < 0.1) {
      const lastUs = c.feature.lastIndexOf("_");
      if (lastUs > 0) {
        const origCol = c.feature.slice(0, lastUs);
        const cat = c.feature.slice(lastUs + 1);
        return c.op === ">" ? `${origCol} = ${cat}` : `${origCol} ≠ ${cat}`;
      }
    }
    return `${c.feature} ${c.op} ${c.value}`;
  };

  return (
    <Box sx={{ mt: 2, border: "1px solid #e0e0e0", borderRadius: 1, p: 2, backgroundColor: "#fafafe" }}>
      <Typography variant="subtitle2" gutterBottom>Predictive Rules</Typography>

      {topImportance.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Feature Importance — top attributes explaining the deviation
          </Typography>
          <ResponsiveContainer width="100%" height={Math.max(100, topImportance.length * 24)}>
            <BarChart data={topImportance} layout="vertical" margin={{ top: 4, right: 60, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={(v) => v.toFixed(2)} />
              <YAxis type="category" dataKey="feature" tick={{ fontSize: 8 }} width={130} />
              <RechartsTip formatter={(v: any) => [v.toFixed(4), "Importance"]} />
              <Bar dataKey="importance" fill="#7e57c2" radius={[0, 2, 2, 0]} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}

      {topRules.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No predictive patterns found in the available attributes.
        </Typography>
      ) : (
        <Box>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
            Top predictive rules (sorted by precision — how often the deviation is present when rule fires)
          </Typography>
          {topRules.map((rule, i) => (
            <Box
              key={i}
              sx={{
                mb: 1.5, p: 1.5, borderRadius: 1,
                backgroundColor: "rgba(126,87,194,0.04)",
                border: "1px solid rgba(126,87,194,0.2)",
              }}
            >
              <Box display="flex" flexWrap="wrap" gap={0.5} alignItems="center" mb={0.5}>
                {rule.conditions.map((c, j) => (
                  <React.Fragment key={j}>
                    {j > 0 && (
                      <Chip label="AND" size="small" variant="outlined" sx={{ fontSize: 9, height: 18, px: 0 }} />
                    )}
                    <Chip
                      label={condLabel(c)}
                      size="small"
                      sx={{ fontSize: 10, backgroundColor: "#fff3e0", height: 22 }}
                    />
                  </React.Fragment>
                ))}
                <Box component="span" sx={{ ml: 0.5, fontSize: 10, color: "#888" }}>
                  → deviation likely
                </Box>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {(rule.precision * 100).toFixed(0)}% precision · covers {(rule.coverage * 100).toFixed(0)}% of traces · {rule.support} trace{rule.support !== 1 ? "s" : ""}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

// ── Key Pattern Box ────────────────────────────────────────────────────────────

const KeyPatternBox: React.FC<{
  topRuleText: string | null;
  dir: "negative" | "positive" | "neutral";
}> = ({ topRuleText, dir }) => {
  if (!topRuleText || dir === "neutral") return null;
  if (dir === "negative") {
    return (
      <Alert severity="warning" icon={false} sx={{ mb: 2 }}>
        <Typography variant="body2">
          <strong>⚠ Key risk pattern:</strong> This deviation is most likely when{" "}
          <strong>{topRuleText}</strong>. Focus prevention on these cases.
        </Typography>
      </Alert>
    );
  }
  return (
    <Alert severity="success" icon={false} sx={{ mb: 2 }}>
      <Typography variant="body2">
        <strong>✓ Success pattern:</strong> This beneficial deviation tends to occur when{" "}
        <strong>{topRuleText}</strong>. Consider formalizing this as a standard practice.
      </Typography>
    </Alert>
  );
};

// ── Root cause panel (per deviation × dimension) ──────────────────────────────

interface RootCausePanelProps {
  deviation: string;
  dimension: string;
  matrixRows: any[];
  matrixCols: string[];
  correlCol: string | null;
  onSetCorrelCol: (col: string | null) => void;
  onClose: () => void;
  onRulesLoaded: (text: string | null) => void;
}

const RootCausePanel: React.FC<RootCausePanelProps> = ({
  deviation,
  dimension,
  matrixRows,
  matrixCols,
  correlCol,
  onSetCorrelCol,
  onClose,
  onRulesLoaded,
}) => {
  const [rulesData, setRulesData] = useState<RuleResult | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [rulesError, setRulesError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviation) return;
    setRulesLoading(true);
    setRulesError(null);
    fetch(`${API_URL}/api/deviation-rules?deviation=${encodeURIComponent(deviation)}`)
      .then((r) => r.json())
      .then((data) => {
        setRulesData(data);
        const topRule = data.rules?.[0];
        onRulesLoaded(topRule && topRule.precision > 0.55 ? ruleConditionsToText(topRule) : null);
      })
      .catch(() => {
        setRulesError("Failed to extract predictive rules.");
        onRulesLoaded(null);
      })
      .finally(() => setRulesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviation]);

  const isBinaryDim = BINARY_DIMS.has(dimension.toLowerCase());

  const orderedCols = matrixCols.length > 0 ? matrixCols : (matrixRows.length > 0 ? Object.keys(matrixRows[0]) : []);

  const allDevCols = new Set(
    orderedCols.filter((col) => {
      if (DIM_NAMES_SET.has(col)) return false;
      const vals = matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
      return vals.length > 0 && vals.every((v) => v === 0 || v === 1);
    })
  );

  const traceTableCols = orderedCols.filter((col) => !allDevCols.has(col) || col === deviation);

  const canCorrel = (col: string) =>
    col !== dimension && col !== deviation && !Array.isArray(matrixRows[0]?.[col]) &&
    (matrixRows.some((r) => typeof r[col] === "number") || detectCategorical(col, matrixRows));

  const dimValues = matrixRows.map((r) => r[dimension]).filter((v): v is number => typeof v === "number");
  const devValues = matrixRows.map((r) => r[deviation]).filter((v) => v === 0 || v === 1);

  const sortedRows = [...matrixRows]
    .filter((row) => typeof row[dimension] === "number")
    .sort((a, b) => a[dimension] - b[dimension]);
  const bottomFive = sortedRows.slice(0, 5);
  const topFive = sortedRows.slice(-5).reverse();

  const isColNumerical = (col: string) => matrixRows.some((r) => typeof r[col] === "number");

  const renderActivityChevrons = (acts: string[]) => (
    <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 0" }}>
      {acts.map((act, idx) => (
        <React.Fragment key={idx}>
          {idx > 0 && <Box component="span" sx={{ mx: 0.4, color: "#bbb", fontSize: "10px" }}>›</Box>}
          <Box component="span" sx={{
            display: "inline-block", background: "#e3f2fd", color: "#1565c0",
            borderRadius: "3px", px: "4px", py: "1px", fontSize: "10px",
            whiteSpace: "nowrap", lineHeight: 1.5,
          }}>{act}</Box>
        </React.Fragment>
      ))}
    </Box>
  );

  const renderCellValue = (val: any) => {
    if (Array.isArray(val)) return renderActivityChevrons(val as string[]);
    if (typeof val === "number") return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return val ?? "–";
  };

  const dimChart = isBinaryDim ? (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart
        data={[
          { label: "0 (negative)", count: dimValues.filter((v) => v === 0).length },
          { label: "1 (positive)", count: dimValues.filter((v) => v === 1).length },
        ]}
        margin={{ top: 4, right: 8, left: 0, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 9 }} width={28} />
        <RechartsTip formatter={(v: any) => [v, "traces"]} />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          <Cell fill="#f57c00" /><Cell fill="#66bb6a" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  ) : (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={computeBins(dimValues)} margin={{ top: 4, right: 8, left: 0, bottom: 36 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tick={{ fontSize: 9 }} width={28} />
        <RechartsTip formatter={(v: any) => [v, "traces"]} />
        <Bar dataKey="count" fill="#1976d2" opacity={0.75} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );

  const renderCorrelation = () => {
    if (!correlCol) return null;
    if (Array.isArray(matrixRows[0]?.[correlCol]))
      return (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Correlation not available for activity sequence columns.
        </Typography>
      );

    if (detectCategorical(correlCol, matrixRows)) {
      const categories = Array.from(
        new Set(matrixRows.map((r) => r[correlCol]).filter((v) => v !== null && v !== undefined))
      );
      const catBarData = categories
        .map((cat) => {
          const inCat = matrixRows.filter((r) => r[correlCol] === cat);
          const devRate = inCat.length > 0
            ? inCat.filter((r) => r[deviation] === 1).length / inCat.length
            : 0;
          return { label: String(cat), devRate: parseFloat(devRate.toFixed(4)), n: inCat.length };
        })
        .sort((a, b) => b.devRate - a.devRate);

      return (
        <Box sx={{ mt: 2, p: 2, border: "1px solid #e0e0e0", borderRadius: 1, backgroundColor: "#f9f9f9" }}>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
            <Typography variant="subtitle2">
              Deviation rate by <strong>{correlCol}</strong> value
            </Typography>
            <IconButton size="small" onClick={() => onSetCorrelCol(null)}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <ResponsiveContainer width="100%" height={Math.max(160, catBarData.length * 32)}>
            <BarChart data={catBarData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
              <YAxis tick={{ fontSize: 9 }} width={44}
                tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} domain={[0, 1]} />
              <RechartsTip
                formatter={(v: any, _name: string, props: any) => [
                  `${(v * 100).toFixed(1)}% (${props.payload.n} traces)`,
                  "Deviation rate",
                ]}
              />
              <Bar dataKey="devRate" radius={[2, 2, 0, 0]}>
                {catBarData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.devRate > 0.5 ? "#f57c00" : "#1976d2"} opacity={0.75} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      );
    }

    if (!isColNumerical(correlCol)) return null;

    const g0 = matrixRows.filter((r) => r[deviation] === 0 && typeof r[correlCol] === "number");
    const g1 = matrixRows.filter((r) => r[deviation] === 1 && typeof r[correlCol] === "number");
    const mean0dev = g0.length ? g0.reduce((s, r) => s + r[correlCol], 0) / g0.length : 0;
    const mean1dev = g1.length ? g1.reduce((s, r) => s + r[correlCol], 0) / g1.length : 0;
    const devBars = [
      { label: "No deviation (0)", mean: mean0dev },
      { label: "Deviation (1)", mean: mean1dev },
    ];

    const pairsForDim = matrixRows.filter(
      (r) => typeof r[correlCol] === "number" && typeof r[dimension] === "number"
    );
    const r = pearsonCorr(pairsForDim.map((r) => r[correlCol]), pairsForDim.map((r) => r[dimension]));

    let dimCorrelChart: React.ReactNode;
    if (isBinaryDim) {
      const dg0 = matrixRows.filter((r) => r[dimension] === 0 && typeof r[correlCol] === "number");
      const dg1 = matrixRows.filter((r) => r[dimension] === 1 && typeof r[correlCol] === "number");
      const dmean0 = dg0.length ? dg0.reduce((s, r) => s + r[correlCol], 0) / dg0.length : 0;
      const dmean1 = dg1.length ? dg1.reduce((s, r) => s + r[correlCol], 0) / dg1.length : 0;
      dimCorrelChart = (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart
            data={[{ label: `${dimension}=0`, mean: dmean0 }, { label: `${dimension}=1`, mean: dmean1 }]}
            margin={{ top: 4, right: 8, left: 0, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 9 }} width={40} />
            <RechartsTip formatter={(v: any) => [v.toFixed(3), `Mean ${correlCol}`]} />
            <Bar dataKey="mean" radius={[2, 2, 0, 0]}>
              <Cell fill="#f57c00" /><Cell fill="#66bb6a" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    } else {
      const sample = pairsForDim.slice(0, 500).map((row) => ({ x: row[correlCol], y: row[dimension] }));
      dimCorrelChart = (
        <>
          <ResponsiveContainer width="100%" height={160}>
            <ScatterChart margin={{ top: 4, right: 8, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="x" type="number" name={correlCol} tick={{ fontSize: 9 }}
                label={{ value: correlCol, position: "insideBottom", offset: -12, fontSize: 9 }} />
              <YAxis dataKey="y" type="number" name={dimension} tick={{ fontSize: 9 }} width={40} />
              <ZAxis range={[18, 18]} />
              <RechartsTip cursor={{ strokeDasharray: "3 3" }}
                formatter={(v: any, n: string) => [v.toLocaleString("en-US", { maximumFractionDigits: 2 }), n]} />
              <Scatter data={sample} fill="#1976d2" opacity={0.45} />
            </ScatterChart>
          </ResponsiveContainer>
          {pairsForDim.length > 500 && (
            <Typography variant="caption" color="text.secondary">
              Showing 500 of {pairsForDim.length} traces.
            </Typography>
          )}
        </>
      );
    }

    return (
      <Box sx={{ mt: 2, p: 2, border: "1px solid #e0e0e0", borderRadius: 1, backgroundColor: "#f9f9f9" }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2">
            Correlation: <strong>{correlCol}</strong> vs deviation and dimension
            {r !== null && (
              <Box component="span" sx={{ ml: 1, fontSize: 12, color: Math.abs(r) > 0.5 ? "#f57c00" : Math.abs(r) > 0.2 ? "#e65100" : "#555" }}>
                (Pearson r = {r.toFixed(3)} with {dimension})
              </Box>
            )}
          </Typography>
          <IconButton size="small" onClick={() => onSetCorrelCol(null)}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box display="flex" gap={3} flexWrap="wrap">
          <Box sx={{ flex: "1 1 200px", minWidth: 180 }}>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              Mean <strong>{correlCol}</strong> by <strong>{deviation}</strong>
            </Typography>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={devBars} margin={{ top: 4, right: 8, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} width={40} />
                <RechartsTip formatter={(v: any) => [v.toFixed(3), `Mean ${correlCol}`]} />
                <Bar dataKey="mean" radius={[2, 2, 0, 0]}>
                  <Cell fill="#78909c" /><Cell fill="#f57c00" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
          <Box sx={{ flex: "1 1 200px", minWidth: 180 }}>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              <strong>{correlCol}</strong> vs <strong>{dimension}</strong>
              {isBinaryDim ? " (mean by group)" : " (scatter)"}
            </Typography>
            {dimCorrelChart}
          </Box>
        </Box>
      </Box>
    );
  };

  const TraceTable = ({ label, rows, headerColor }: { label: string; rows: any[]; headerColor: string }) => (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" gutterBottom>{label}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        Click a column header to explore its correlation with the dimension and deviation.
      </Typography>
      <Box sx={{ overflowX: "auto", border: "1px solid #e0e0e0", borderRadius: 1 }}>
        <Table size="small" sx={{ minWidth: 500 }}>
          <TableHead>
            <TableRow>
              {traceTableCols.map((col) => {
                const clickable = canCorrel(col);
                const active = correlCol === col;
                return (
                  <TableCell
                    key={col}
                    onClick={clickable ? () => onSetCorrelCol(active ? null : col) : undefined}
                    sx={{
                      fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
                      backgroundColor: active ? "#e3f2fd" : headerColor,
                      cursor: clickable ? "pointer" : "default",
                      userSelect: "none",
                      "&:hover": clickable ? { backgroundColor: "#bbdefb" } : {},
                      borderBottom: active ? "2px solid #1976d2" : undefined,
                    }}
                  >
                    {col === "trace_duration_seconds" ? "Duration (s)" : col}
                    {active && <Box component="span" sx={{ ml: 0.5, color: "#1976d2" }}>↑</Box>}
                    {clickable && !active && <Box component="span" sx={{ ml: 0.5, color: "#bbb", fontSize: 9 }}>~</Box>}
                  </TableCell>
                );
              })}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={idx} sx={{ "&:nth-of-type(even)": { backgroundColor: "#fafafa" } }}>
                {traceTableCols.map((col) => (
                  <TableCell key={col} sx={{ fontSize: 10, verticalAlign: "middle" }}>
                    {col === deviation
                      ? row[col] === 1
                        ? <Box component="span" sx={{ color: "#c62828", fontWeight: 700 }}>✓</Box>
                        : "–"
                      : renderCellValue(row[col])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ border: "1px solid #e0e0e0", borderRadius: 2, p: 3, mt: 2, backgroundColor: "#fafafa" }}>
      <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={2}>
        <Box>
          <Typography variant="h6" sx={{ mb: 0.5 }}>Root Cause Analysis</Typography>
          <Box display="flex" gap={1}>
            <Chip label={`Dimension: ${dimension}`} size="small" color="primary" variant="outlined" />
            <Chip label={`Deviation: ${deviation}`} size="small" color="warning" variant="outlined" />
            <Chip label={`${matrixRows.length} traces`} size="small" variant="outlined" />
          </Box>
        </Box>
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>

      <Box display="flex" gap={4} flexWrap="wrap" mb={2}>
        <Box sx={{ flex: "1 1 260px", minWidth: 220 }}>
          <Typography variant="subtitle2" gutterBottom>
            Distribution of <em>{dimension}</em>
            {isBinaryDim ? " (binary)" : ` — ${dimValues.length} values`}
          </Typography>
          {dimChart}
        </Box>
        <Box sx={{ flex: "0 1 200px", minWidth: 160 }}>
          <Typography variant="subtitle2" gutterBottom>
            Distribution of <em>{deviation}</em>
          </Typography>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart
              data={[
                { label: "0 — no deviation", count: devValues.filter((v) => v === 0).length },
                { label: "1 — deviation", count: devValues.filter((v) => v === 1).length },
              ]}
              margin={{ top: 4, right: 8, left: 0, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={28} />
              <RechartsTip formatter={(v: any) => [v, "traces"]} />
              <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                <Cell fill="#78909c" /><Cell fill="#f57c00" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      {(() => {
        const devTraces = matrixRows.filter((r) => r[deviation] === 1);
        if (devTraces.length === 0) return null;
        const coDevs = Array.from(allDevCols)
          .filter((col) => col !== deviation)
          .map((col) => ({
            col,
            rate: devTraces.filter((r) => r[col] === 1).length / devTraces.length,
          }))
          .filter((x) => x.rate >= 0.5)
          .sort((a, b) => b.rate - a.rate);
        if (coDevs.length === 0) return null;
        return (
          <Box sx={{ mb: 2, p: 2, border: "1px solid #ffe082", borderRadius: 1, backgroundColor: "#fff8e1" }}>
            <Typography variant="subtitle2" gutterBottom>
              Frequently Co-occurring Deviations
              <Box component="span" sx={{ ml: 1, fontSize: 12, color: "text.secondary", fontWeight: 400 }}>
                other deviations present in ≥50% of traces that contain <em>{deviation}</em>
              </Box>
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 0.5 }}>
              {coDevs.map(({ col, rate }) => (
                <Chip
                  key={col}
                  label={`${col}  ${Math.round(rate * 100)}%`}
                  size="small"
                  sx={{ fontSize: 11, backgroundColor: "#ffe082", color: "#5d4037", maxWidth: 360 }}
                  title={col}
                />
              ))}
            </Box>
          </Box>
        );
      })()}

      <ProcessContextPanel deviation={deviation} matrixRows={matrixRows} />
      <DecisionRulesPanel rulesData={rulesData} rulesLoading={rulesLoading} rulesError={rulesError} />
      <CorrelationOverview
        deviation={deviation}
        matrixRows={matrixRows}
        matrixCols={matrixCols}
        activeCorrelCol={correlCol}
        onSelectCol={onSetCorrelCol}
      />
      {renderCorrelation()}

      <Divider sx={{ my: 2 }} />

      <TraceTable label={`5 Traces with Lowest ${dimension}`} rows={bottomFive} headerColor="#e3f2fd" />
      <TraceTable label={`5 Traces with Highest ${dimension}`} rows={topFive} headerColor="#fce4ec" />
    </Box>
  );
};

// ── Issue Graph Editor ─────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 48;
const COL_GAP = 220;
const ROW_GAP = 120;

interface IssueGraphEditorProps {
  issues: string[];
  links: IssueCausalLink[];
  onAddLink: (from: string, to: string, description: string) => void;
  onRemoveLink: (id: string) => void;
}

const IssueGraphEditor: React.FC<IssueGraphEditorProps> = ({ issues, links, onAddLink, onRemoveLink }) => {
  const [nodePositions, setNodePositions] = React.useState<Record<string, { x: number; y: number }>>({});
  const [connectSource, setConnectSource] = React.useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = React.useState<string | null>(null);
  const [newLinkDesc, setNewLinkDesc] = React.useState('');
  const hoverLeaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(issues.length)));
    const pos: Record<string, { x: number; y: number }> = {};
    issues.forEach((iss, i) => {
      pos[iss] = { x: 40 + (i % cols) * COL_GAP, y: 40 + Math.floor(i / cols) * ROW_GAP };
    });
    setNodePositions(pos);
  }, [issues.join('|')]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleNodeClick = (issue: string) => {
    if (!connectSource) {
      setConnectSource(issue);
    } else if (connectSource === issue) {
      setConnectSource(null);
    } else {
      const duplicate = links.some(l => l.from === connectSource && l.to === issue);
      if (!duplicate) onAddLink(connectSource, issue, newLinkDesc);
      setConnectSource(null);
      setNewLinkDesc('');
    }
  };

  const posVals = Object.values(nodePositions);
  const svgW = posVals.length ? Math.max(...posVals.map(p => p.x)) + NODE_W + 60 : 500;
  const svgH = posVals.length ? Math.max(...posVals.map(p => p.y)) + NODE_H + 60 : 200;

  const edgePath = (from: string, to: string) => {
    const s = nodePositions[from];
    const t = nodePositions[to];
    if (!s || !t) return null;
    const sx = s.x + NODE_W; const sy = s.y + NODE_H / 2;
    const tx = t.x;          const ty = t.y + NODE_H / 2;
    const mx = (sx + tx) / 2;
    return { d: `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`, mx, my: (sy + ty) / 2 };
  };

  if (issues.length === 0) {
    return (
      <Box sx={{ p: 2, border: '1px dashed #bdbdbd', borderRadius: 1, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">No issues to display. Complete the grouping step first.</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {connectSource ? (
        <Box sx={{ mb: 1, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Alert severity="info" sx={{ py: 0.5, flex: 1 }}>
            Connecting from <strong>{connectSource}</strong> — click a target node to create a link, or click the same node again to cancel.
          </Alert>
          <TextField
            size="small" label="Relationship label (optional)" value={newLinkDesc}
            onChange={e => setNewLinkDesc(e.target.value)}
            sx={{ minWidth: 240 }} placeholder="e.g. causes rework"
          />
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Click a node to start connecting. Hover an arrow and click × to delete it.
        </Typography>
      )}

      <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, overflowX: 'auto', backgroundColor: '#fafafa' }}>
        <svg width={svgW} height={svgH} style={{ display: 'block' }}>
          <defs>
            <marker id="rec-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#7b1fa2" />
            </marker>
          </defs>

          {links.map(link => {
            const ep = edgePath(link.from, link.to);
            if (!ep) return null;
            const isHov = hoveredEdge === link.id;
            return (
              <g key={link.id}
                onMouseEnter={() => {
                  if (hoverLeaveTimer.current) clearTimeout(hoverLeaveTimer.current);
                  setHoveredEdge(link.id);
                }}
                onMouseLeave={() => {
                  hoverLeaveTimer.current = setTimeout(() => setHoveredEdge(null), 350);
                }}
              >
                <path d={ep.d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: 'pointer' }} />
                <path d={ep.d} fill="none" stroke={isHov ? '#9c27b0' : '#7b1fa2'}
                  strokeWidth={isHov ? 2.5 : 1.5} markerEnd="url(#rec-arrow)" opacity={0.75} />
                <text x={ep.mx} y={ep.my - 7} textAnchor="middle" fontSize={10} fill="#6a1b9a"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {link.description || 'causes'}
                </text>
                {isHov && (
                  <g transform={`translate(${ep.mx - 9},${ep.my - 26})`}
                    style={{ cursor: 'pointer' }} onClick={() => onRemoveLink(link.id)}>
                    <circle cx={9} cy={9} r={9} fill="#ef5350" />
                    <text x={9} y={14} textAnchor="middle" fontSize={13} fill="white"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>×</text>
                  </g>
                )}
              </g>
            );
          })}

          {issues.map(issue => {
            const pos = nodePositions[issue];
            if (!pos) return null;
            const isSrc = connectSource === issue;
            const isTgt = connectSource !== null && connectSource !== issue;
            return (
              <g key={issue} transform={`translate(${pos.x},${pos.y})`}
                style={{ cursor: 'pointer' }} onClick={() => handleNodeClick(issue)}>
                <rect width={NODE_W} height={NODE_H} rx={6}
                  fill={isSrc ? '#ede7f6' : '#fff'}
                  stroke={isSrc ? '#7b1fa2' : isTgt ? '#9c27b0' : '#bdbdbd'}
                  strokeWidth={isSrc ? 2.5 : isTgt ? 1.5 : 1}
                  strokeDasharray={isTgt ? '5 3' : undefined}
                />
                <foreignObject x={4} y={4} width={NODE_W - 8} height={NODE_H - 8}>
                  <div
                    // @ts-ignore
                    xmlns="http://www.w3.org/1999/xhtml"
                    style={{
                      fontSize: 11, lineHeight: 1.3, padding: '2px 4px',
                      overflow: 'hidden', wordBreak: 'break-word', color: '#333',
                      textAlign: 'center', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {issue}
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>
      </Box>

      {links.length > 0 && (
        <Box mt={1.5} display="flex" flexDirection="column" gap={0.5}>
          {links.map(link => (
            <Box key={link.id} display="flex" alignItems="center" gap={0.75} flexWrap="wrap"
              sx={{ p: 0.75, border: '1px solid #e0e0e0', borderRadius: 1, background: '#fff' }}>
              <Chip label={link.from} size="small"
                sx={{ background: '#ede7f6', color: '#4a148c', fontWeight: 600, fontSize: '0.7rem' }} />
              <Typography variant="caption" color="text.secondary">→ causes →</Typography>
              <Chip label={link.to} size="small"
                sx={{ background: '#e8f5e9', color: '#1b5e20', fontWeight: 600, fontSize: '0.7rem' }} />
              {link.description && (
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, fontStyle: 'italic' }}>
                  {link.description}
                </Typography>
              )}
              <IconButton size="small" onClick={() => onRemoveLink(link.id)}
                sx={{ ml: 'auto', opacity: 0.5, '&:hover': { opacity: 1 } }}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

// ── Horizon / dim helpers ──────────────────────────────────────────────────────

const HORIZON_LABELS: Record<string, string> = { short: 'Short-term', mid: 'Mid-term', long: 'Long-term' };
const HORIZON_COLORS: Record<string, string> = { short: '#1565c0', mid: '#6a1b9a', long: '#00695c' };
const DIM_COLORS: Record<string, string> = {
  time: '#1565c0', costs: '#6a1b9a', quality: '#2e7d32',
  outcome: '#e65100', compliance: '#00695c', flexibility: '#78909c',
};

// ── BPMN deviation highlight helpers ──────────────────────────────────────────

type HighlightRole = 'skip' | 'insert-self' | 'insert-context';

interface BpmnHighlight {
  activity: string;
  role: HighlightRole;
  label?: string; // shown as badge below the element
}

// Compute predecessor/successor for an inserted activity from raw trace sequences
const computeInsertionContext = (
  activityName: string,
  deviationCol: string,
  matrixRows: any[]
): { predecessor: string | null; successor: string | null } => {
  const preds: Record<string, number> = {};
  const succs: Record<string, number> = {};
  matrixRows.filter((r: any) => r[deviationCol] === 1).forEach((r: any) => {
    if (!Array.isArray(r.activities)) return;
    r.activities.forEach((act: string, idx: number) => {
      if (act === activityName) {
        if (idx > 0) { const p = r.activities[idx - 1]; preds[p] = (preds[p] || 0) + 1; }
        if (idx < r.activities.length - 1) { const s = r.activities[idx + 1]; succs[s] = (succs[s] || 0) + 1; }
      }
    });
  });
  return {
    predecessor: Object.entries(preds).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    successor:   Object.entries(succs).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
  };
};

const buildDeviationHighlights = (
  issueName: string,
  deviationIssueMap: Record<string, string>,
  matrixRows: any[]
): { highlights: BpmnHighlight[]; insertionContexts: { activity: string; predecessor: string | null; successor: string | null }[] } => {
  const cols = Object.entries(deviationIssueMap)
    .filter(([, name]) => name === issueName).map(([col]) => col);
  const toParse = cols.length > 0 ? cols : [issueName];

  const highlights: BpmnHighlight[] = [];
  const insertionContexts: { activity: string; predecessor: string | null; successor: string | null }[] = [];

  toParse.forEach(col => {
    const skip = col.match(/^\(Skip (.+)\)$/);
    if (skip) { highlights.push({ activity: skip[1], role: 'skip' }); return; }
    const insert = col.match(/^\(Insert (.+)\)$/);
    if (insert) {
      const act = insert[1];
      highlights.push({ activity: act, role: 'insert-self' });
      const { predecessor, successor } = computeInsertionContext(act, col, matrixRows);
      insertionContexts.push({ activity: act, predecessor, successor });
      if (predecessor) highlights.push({ activity: predecessor, role: 'insert-context', label: `→ ${act} inserted after` });
      if (successor)   highlights.push({ activity: successor,   role: 'insert-context', label: `${act} inserted before →` });
    }
  });

  return { highlights, insertionContexts };
};

// Keep a simple version for cases where matrixRows not needed (FinalReport overview)
const parseDeviationActivities = (
  issueName: string,
  deviationIssueMap: Record<string, string>
): { activity: string; devType: 'skip' | 'insert' }[] => {
  const cols = Object.entries(deviationIssueMap)
    .filter(([, name]) => name === issueName).map(([col]) => col);
  const toParse = cols.length > 0 ? cols : [issueName];
  const result: { activity: string; devType: 'skip' | 'insert' }[] = [];
  toParse.forEach(col => {
    const skip = col.match(/^\(Skip (.+)\)$/);
    if (skip) { result.push({ activity: skip[1], devType: 'skip' }); return; }
    const insert = col.match(/^\(Insert (.+)\)$/);
    if (insert) result.push({ activity: insert[1], devType: 'insert' });
  });
  return result;
};

const BpmnHighlightViewer: React.FC<{
  xml: string;
  highlights: BpmnHighlight[];
}> = ({ xml, highlights }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !xml) return;
    const viewer = new NavigatedViewer({ container: containerRef.current });
    viewer.importXML(xml).then(() => {
      try {
        (viewer.get('canvas') as any).zoom('fit-viewport');
        const elementRegistry = viewer.get('elementRegistry') as any;
        const overlays = viewer.get('overlays') as any;

        const STYLES: Record<HighlightRole, { color: string; bg: string; dash: boolean }> = {
          'skip':           { color: '#f57c00', bg: 'rgba(245,124,0,0.18)',   dash: false },
          'insert-self':    { color: '#1565c0', bg: 'rgba(21,101,192,0.18)',  dash: false },
          'insert-context': { color: '#0288d1', bg: 'rgba(2,136,209,0.07)',   dash: true  },
        };

        highlights.forEach(({ activity, role, label }) => {
          const { color, bg, dash } = STYLES[role];
          elementRegistry.filter((el: any) =>
            el.businessObject?.name === activity && el.type !== 'label'
          ).forEach((el: any) => {
            const border = dash
              ? `2px dashed ${color}`
              : `3px solid ${color}`;
            const badgeHtml = label
              ? `<div style="position:absolute;bottom:-22px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:9px;font-weight:700;color:${color};background:#fff;padding:1px 5px;border-radius:3px;border:1px solid ${color};pointer-events:none;">${label}</div>`
              : '';
            overlays.add(el.id, {
              position: { top: 0, left: 0 },
              html: `<div style="position:relative;width:${el.width}px;height:${el.height}px;"><div style="width:100%;height:100%;background:${bg};border:${border};border-radius:4px;pointer-events:none;box-sizing:border-box;"></div>${badgeHtml}</div>`,
            });
          });
        });
      } catch (_) {}
    }).catch(() => {});
    return () => { try { viewer.destroy(); } catch (_) {} };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml, JSON.stringify(highlights)]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
};

// ── Main component ─────────────────────────────────────────────────────────────

const Recommendations: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();

  const results: CausalResult[] = location.state?.results || [];
  const criticalityMap: CriticalityMap = location.state?.criticalityMap || {};
  const priorityList: PriorityItem[] = location.state?.priorityList || [];

  const { workaroundMap, issueRisksOpportunities, issueCausalLinks, setIssueCausalLinks, deviationIssueMap, conformanceMode } = useFileContext();

  // Use causal results order (deduped deviations from results); fall back to priorityList
  const issueList = React.useMemo(() => {
    const fromResults = Array.from(new Set(results.map((r: CausalResult) => r.deviation)));
    return fromResults.length > 0 ? fromResults : priorityList.map((p: PriorityItem) => p.deviation);
  }, [results, priorityList]);

  const [matrixRows, setMatrixRows] = useState<any[]>([]);
  const [matrixCols, setMatrixCols] = useState<string[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixFetched, setMatrixFetched] = useState(false);

  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [modelDialogDev, setModelDialogDev] = useState<string | null>(null);

  const [expandedDevs, setExpandedDevs] = useState<Set<string>>(new Set());
  const [selectedDimPerDev, setSelectedDimPerDev] = useState<{ [dev: string]: string }>({});
  const [correlCols, setCorrelCols] = useState<{ [key: string]: string | null }>({});
  const [topRuleTexts, setTopRuleTexts] = useState<{ [dev: string]: string | null }>({});

  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [pullingModel, setPullingModel] = useState(false);
  const [pullError, setPullError] = useState<string>("");
  const [startingOllama, setStartingOllama] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/ollama/models`)
      .then((r) => r.json())
      .then((data) => {
        setOllamaOnline(data.online);
        setOllamaModels(data.models ?? []);
        if (data.models?.length > 0) setSelectedModel(data.models[0]);
      })
      .catch(() => setOllamaOnline(false));
  }, []);

  const pullModel = (model: string) => {
    setPullingModel(true);
    setPullError("");
    fetch(`${API_URL}/api/ollama/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setPullError(data.error); return; }
        return fetch(`${API_URL}/api/ollama/models`).then((r) => r.json()).then((d) => {
          setOllamaModels(d.models ?? []);
          setSelectedModel(model);
        });
      })
      .catch(() => setPullError("Pull failed. Check if LLM is running."))
      .finally(() => setPullingModel(false));
  };

  const startOllama = () => {
    setStartingOllama(true);
    fetch(`${API_URL}/api/ollama/start`, { method: "POST" })
      .then(() => {
        // Wait a moment then re-check status
        setTimeout(() => {
          fetch(`${API_URL}/api/ollama/models`)
            .then((r) => r.json())
            .then((data) => {
              setOllamaOnline(data.online);
              setOllamaModels(data.models ?? []);
              if (data.models?.length > 0) setSelectedModel(data.models[0]);
            })
            .catch(() => setOllamaOnline(false))
            .finally(() => setStartingOllama(false));
        }, 2500);
      })
      .catch(() => setStartingOllama(false));
  };

  const [reactionItems, setReactionItems] = useState<Record<string, string>>({});
  const [durationExpanded, setDurationExpanded] = useState<Record<string, boolean>>({});

  // Activity duration contribution (for time dimension)
  const [durationContributions, setDurationContributions] = useState<Record<string, { activity: string; with_deviation: number | null; without_deviation: number | null; difference: number | null }[]> | null>(null);
  const [durationLoading, setDurationLoading] = useState(false);
  const [durationError, setDurationError] = useState<string | null>(null);

  const timeDeviations = React.useMemo(
    () => Array.from(new Set(results.filter((r) => r.dimension === 'time').map((r) => r.deviation))),
    [results]
  );

  useEffect(() => {
    if (timeDeviations.length === 0) return;
    setDurationLoading(true);
    fetch(`${API_URL}/api/activity-duration-contribution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviations: timeDeviations }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setDurationError(d.error); }
        else { setDurationContributions(d.contributions ?? {}); }
        setDurationLoading(false);
      })
      .catch((e) => { setDurationError(e.message); setDurationLoading(false); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeDeviations.join(',')]);

  const [llmSuggestions, setLlmSuggestions] = useState<{ [dev: string]: string }>({});
  const [llmLoading, setLlmLoading] = useState<{ [dev: string]: boolean }>({});
  const [llmErrors, setLlmErrors] = useState<{ [dev: string]: string }>({});

  const fetchLlmSuggestion = (deviation: string, dir: "negative" | "positive" | "neutral" | string) => {
    if (llmSuggestions[deviation] || llmLoading[deviation]) return;
    if (!selectedModel) return;
    setLlmLoading((p) => ({ ...p, [deviation]: true }));
    setLlmErrors((p) => ({ ...p, [deviation]: "" }));
    const causalEffects = results
      .filter((r) => r.deviation === deviation && isFinite(r.ate))
      .map((r) => ({
        dimension: r.dimension,
        ate: r.ate,
        criticality: getCriticality(r.ate, criticalityMap[r.dimension]) ?? "neutral",
      }));
    const allActivities = Array.from(
      new Set(
        matrixRows.flatMap((row) => (Array.isArray(row.activities) ? row.activities : []))
      )
    ).sort();

    const workaround = workaroundMap[deviation];
    const workaroundContext = workaround?.isWorkaround ? {
      actor_roles: workaround.actorRoles,
      misfit: workaround.misfit,
      goal: workaround.goal,
      pattern_type: workaround.patternType ?? null,
      intended_dimensions: Object.entries(workaround.goalDimensions ?? {}).map(([dim, desc]) => ({ dimension: dim, description: desc })),
    } : null;

    const risksOpps = (issueRisksOpportunities[deviation] ?? []).map(e => ({
      type: e.type,
      horizon: e.horizon,
      description: e.description,
    }));

    const causalLinks = {
      causes: issueCausalLinks.filter(l => l.from === deviation).map(l => ({ issue: l.to, description: l.description || '' })),
      caused_by: issueCausalLinks.filter(l => l.to === deviation).map(l => ({ issue: l.from, description: l.description || '' })),
    };

    const durationRows = (durationContributions?.[deviation] ?? []).map(r => ({
      activity: r.activity,
      with_deviation: r.with_deviation,
      without_deviation: r.without_deviation,
      difference: r.difference,
    }));

    fetch(`${API_URL}/api/llm-suggestion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviation,
        direction: dir,
        causal_effects: causalEffects,
        top_rule: topRuleTexts[deviation] ?? null,
        model: selectedModel,
        all_activities: allActivities,
        workaround: workaroundContext,
        risks_opportunities: risksOpps,
        causal_links: causalLinks,
        duration_contributions: durationRows,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setLlmErrors((p) => ({ ...p, [deviation]: data.error }));
        } else {
          setLlmSuggestions((p) => ({ ...p, [deviation]: data.suggestion }));
        }
      })
      .catch(() => setLlmErrors((p) => ({ ...p, [deviation]: "Failed to reach LLM. Is it running?" })))
      .finally(() => setLlmLoading((p) => ({ ...p, [deviation]: false })));
  };

  useEffect(() => {
    if (conformanceMode !== 'bpmn') return;
    fetch(`${API_URL}/api/model-content`)
      .then(r => r.json())
      .then(d => { if (d?.type === 'bpmn' && d.content) setBpmnXml(d.content); })
      .catch(() => {});
  }, [conformanceMode]);

  useEffect(() => {
    if (matrixFetched) return;
    setMatrixLoading(true);
    fetch(`${API_URL}/api/current-impact-matrix`)
      .then((r) => r.json())
      .then((data) => {
        setMatrixRows(data.rows ?? []);
        setMatrixCols(data.columns ?? []);
        setMatrixFetched(true);
      })
      .catch(() => {})
      .finally(() => setMatrixLoading(false));
  }, [matrixFetched]);

  useEffect(() => {
    setContinue({
      label: "Continue to Final Report",
      onClick: () => navigate("/final-report", {
        state: { results, criticalityMap, priorityList, reactionItems, llmSuggestions, matrixRows, durationContributions },
      }),
    });
    return () => setContinue(null);
  }, [navigate, setContinue, results, criticalityMap, priorityList, reactionItems, llmSuggestions]);

  const toggleExpand = (dev: string) => {
    setExpandedDevs((prev) => {
      const next = new Set(prev);
      if (next.has(dev)) {
        next.delete(dev);
      } else {
        next.add(dev);
        if (!selectedDimPerDev[dev]) {
          const dims = results.filter((r) => r.deviation === dev && r.ate !== undefined).map((r) => r.dimension);
          if (dims.length > 0) {
            setSelectedDimPerDev((p) => ({ ...p, [dev]: dims[0] }));
          }
        }
      }
      return next;
    });
  };

  const exportCSV = () => {
    const dims = Array.from(new Set(results.map((r) => r.dimension)));
    let csv = "Deviation,Recommendation\n";
    issueList.forEach((deviation: string) => {
      const reaction = (reactionItems[deviation] || "").replace(/"/g, '""');
      csv += `"${deviation}","${reaction}"\n`;
    });

    csv += "\nCATE Table\nDeviation," + dims.join(",") + "\n";
    issueList.forEach((deviation: string) => {
      const cells = dims.map((dim) => {
        const r = results.find((x: CausalResult) => x.deviation === deviation && x.dimension === dim);
        return r?.ate != null ? r.ate.toFixed(2) : "";
      });
      csv += `"${deviation}",${cells.join(",")}\n`;
    });

    if (matrixRows.length > 0) {
      const allDevCols = matrixCols.filter((col) => {
        const vals = matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
        return vals.length > 0 && vals.every((v) => v === 0 || v === 1);
      });
      csv += "\nFrequently Co-occurring Deviations (≥50%)\nDeviation,Co-occurring Deviations\n";
      issueList.forEach((deviation: string) => {
        const devTraces = matrixRows.filter((r) => r[deviation] === 1);
        if (!devTraces.length) return;
        const coDevs = allDevCols
          .filter((col) => col !== deviation)
          .map((col) => ({ col, rate: devTraces.filter((r) => r[col] === 1).length / devTraces.length }))
          .filter((x) => x.rate >= 0.5)
          .sort((a, b) => b.rate - a.rate)
          .map((x) => `${x.col} (${Math.round(x.rate * 100)}%)`)
          .join("; ");
        csv += `"${deviation}","${coDevs}"\n`;
      });
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recommendations.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const dims = Array.from(new Set(results.map((r) => r.dimension)));

    doc.setFontSize(16);
    doc.text("Process Deviation Recommendations", 14, 16);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 23);

    doc.setFontSize(12);
    doc.text("1. Priority Overview", 14, 32);
    autoTable(doc, {
      startY: 36,
      head: [["Deviation", ...dims.map(d => d.charAt(0).toUpperCase() + d.slice(1))]],
      body: issueList.map((deviation: string) => {
        const dimCells = dims.map((dim) => {
          const r = results.find((x: CausalResult) => x.deviation === deviation && x.dimension === dim);
          return r?.ate != null ? r.ate.toFixed(2) : "–";
        });
        return [deviation, ...dimCells];
      }),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [66, 66, 66] },
    });

    if (matrixRows.length > 0) {
      const allDevCols = matrixCols.filter((col) => {
        const vals = matrixRows.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
        return vals.length > 0 && vals.every((v) => v === 0 || v === 1);
      });
      const coRows = issueList.map((deviation: string) => {
        const devTraces = matrixRows.filter((r) => r[deviation] === 1);
        if (!devTraces.length) return [deviation, "–"];
        const coDevs = allDevCols
          .filter((col) => col !== deviation)
          .map((col) => ({ col, rate: devTraces.filter((r) => r[col] === 1).length / devTraces.length }))
          .filter((x) => x.rate >= 0.5)
          .sort((a, b) => b.rate - a.rate)
          .map((x) => `${x.col} (${Math.round(x.rate * 100)}%)`)
          .join(", ");
        return [deviation, coDevs || "none"];
      });

      const coStartY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(12);
      doc.text("2. Deviation Co-occurrence (≥50%)", 14, coStartY);
      autoTable(doc, {
        startY: coStartY + 4,
        head: [["Deviation", "Co-occurring Deviations"]],
        body: coRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [66, 66, 66] },
      });
    }

    issueList.forEach((deviation: string) => {
      doc.addPage();

      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text(`Issue: ${deviation}`, 14, 18);
      doc.setFont("helvetica", "normal");

      const causalRows = results
        .filter((r: CausalResult) => r.deviation === deviation && isFinite(r.ate))
        .map((r: CausalResult) => {
          const intentDesc = workaroundMap[deviation]?.goalDimensions?.[r.dimension] ?? "—";
          return [
            r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1),
            intentDesc,
            r.ate.toFixed(3),
            r.p_value?.toFixed(3) ?? "–",
            getCriticality(r.ate, criticalityMap[r.dimension]) ?? "–",
          ];
        });
      autoTable(doc, {
        startY: 24,
        head: [["Dimension", "Participant's Intent", "CATE", "p-value", "Criticality"]],
        body: causalRows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [80, 80, 80] },
        columnStyles: { 1: { cellWidth: 65 } },
      });

      let curY = (doc as any).lastAutoTable.finalY + 10;

      const topRule = topRuleTexts[deviation];
      if (topRule) {
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Key Predictive Pattern", 14, curY);
        doc.setFont("helvetica", "normal");
        curY += 5;
        doc.setFontSize(8);
        const ruleLines = doc.splitTextToSize(topRule, 182);
        doc.text(ruleLines, 14, curY);
        curY += ruleLines.length * 4 + 8;
      }

      const suggestion = llmSuggestions[deviation];
      if (suggestion) {
        if (curY > 240) { doc.addPage(); curY = 18; }
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`AI Suggestions (${selectedModel})`, 14, curY);
        doc.setFont("helvetica", "normal");
        curY += 5;
        doc.setFontSize(8);
        const sugLines = doc.splitTextToSize(suggestion, 182);
        doc.text(sugLines, 14, curY);
        curY += sugLines.length * 4 + 8;
      }

      const reaction = reactionItems[deviation];
      if (reaction) {
        if (curY > 240) { doc.addPage(); curY = 18; }
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("Recommendation", 14, curY);
        doc.setFont("helvetica", "normal");
        curY += 5;
        doc.setFontSize(8);
        const reactLines = doc.splitTextToSize(reaction, 182);
        doc.text(reactLines, 14, curY);
      }
    });

    doc.save("recommendations.pdf");
  };

  if (issueList.length === 0) {
    return (
      <Box sx={{ width: "100%", mt: 4 }}>
        <Typography variant="h5" mb={3}>Step 5 — Recommendations</Typography>
        <Alert severity="warning">
          No analysis data found. Please go back and complete the causal analysis first.
        </Alert>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate("/")}>
          Back to Start
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", margin: "0 auto", mt: 4 }}>
      <ScreenInfoBox
        whatYouSee="One card per issue showing: participant intent vs. measured causal impact per dimension, risks & opportunities, an AI suggestion button (requires LLM-setup with Ollama https://ollama.com), and a free-text recommendation field. At the bottom: a deviation co-occurrence matrix, activity duration table, and an interactive issue relationship graph."
        whatToDo="For each issue, review the evidence and write a recommendation. Optionally generate an AI suggestion as a starting point. At the bottom, draw causal relationships between issues by clicking nodes to connect them. Then click Continue to Final Report."
      />

      <Box display="flex" alignItems="center" justifyContent="space-between" mb={1} flexWrap="wrap" gap={1}>
        <Box display="flex" alignItems="center">
          <Typography variant="h5">Step 5 — Recommendations</Typography>
          <Tooltip
            title="Each issue is reviewed combining: (1) the participant's stated goal from the workaround analysis, (2) the measured causal effect on the process, and (3) the risks and opportunities identified in step 4.2. Use this full picture to formulate a recommendation. Expand a card to investigate root causes."
            arrow
            placement="right"
          >
            <IconButton size="small" sx={{ ml: 1 }}>
              <InfoIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        </Box>
        <Box display="flex" gap={1}>
          <Button size="small" variant="outlined" onClick={exportCSV}>Export CSV</Button>
          <Button size="small" variant="outlined" onClick={exportPDF}>Export PDF</Button>
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Issues are ordered by overall negative causal impact. Each card shows the full evaluation context — participant's stated goal, measured process impact, and identified risks/opportunities — so you can write an informed recommendation. Expand any card to investigate root causes per dimension.
      </Typography>

      {/* Ollama model selector */}
      <Box sx={{ mb: 3, p: 1.5, border: "1px solid #e0e0e0", borderRadius: 2, backgroundColor: "#fafafa", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, color: "#6a0080" }}>AI Model</Typography>
        {ollamaOnline === null && (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">Checking LLM…</Typography>
          </Box>
        )}
        {ollamaOnline === false && (
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Alert severity="error" sx={{ py: 0, px: 1, fontSize: 11 }}>
              LLM is not running.
            </Alert>
            <Button
              size="small"
              variant="outlined"
              onClick={startOllama}
              disabled={startingOllama}
              sx={{ fontSize: 11, borderColor: '#9c27b0', color: '#9c27b0' }}
            >
              {startingOllama ? "Starting…" : "Start LLM"}
            </Button>
          </Box>
        )}
        {ollamaOnline && ollamaModels.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} sx={{ fontSize: 12 }}>
              {ollamaModels.map((m) => (
                <MenuItem key={m} value={m} sx={{ fontSize: 12 }}>{m}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        {ollamaOnline && ollamaModels.length === 0 && !pullingModel && (
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="caption" color="text.secondary">No models found.</Typography>
            <Button size="small" variant="outlined" sx={{ fontSize: 11, borderColor: "#9c27b0", color: "#9c27b0" }} onClick={() => pullModel("llama3.2")}>
              Download llama3.2
            </Button>
          </Box>
        )}
        {ollamaOnline && ollamaModels.length > 0 && (
          <Button size="small" variant="text" sx={{ fontSize: 11, color: "#9c27b0" }} onClick={() => pullModel("llama3.2")} disabled={pullingModel}>
            + llama3.2
          </Button>
        )}
        {pullingModel && (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={12} />
            <Typography variant="caption" color="text.secondary">Downloading… this may take a few minutes.</Typography>
          </Box>
        )}
        {pullError && <Typography variant="caption" color="error">{pullError}</Typography>}
      </Box>

      {matrixLoading && (
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">Loading trace data…</Typography>
        </Box>
      )}

      {matrixRows.length > 0 && (
        <DeviationCooccurrence priorityList={priorityList} matrixRows={matrixRows} />
      )}

      {/* ── BPMN deviation model dialog ── */}
      {modelDialogDev && bpmnXml && (() => {
        const { highlights, insertionContexts } = buildDeviationHighlights(modelDialogDev, deviationIssueMap, matrixRows);
        const skips = highlights.filter(h => h.role === 'skip').map(h => h.activity);
        const inserts = highlights.filter(h => h.role === 'insert-self').map(h => h.activity);
        return (
          <Dialog open fullScreen onClose={() => setModelDialogDev(null)}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
              <MapIcon sx={{ color: '#7b1fa2' }} />
              <Box flex={1}>
                <Typography variant="subtitle1" fontWeight={700}>{modelDialogDev}</Typography>
                <Box display="flex" gap={1} flexWrap="wrap" mt={0.5}>
                  {skips.map(a => (
                    <Chip key={a} size="small" label={`Skipped: ${a}`}
                      sx={{ fontSize: '0.65rem', background: 'rgba(245,124,0,0.15)', color: '#f57c00', border: '1px solid #f57c00' }} />
                  ))}
                  {insertionContexts.map(({ activity, predecessor, successor }) => (
                    <Chip key={activity} size="small"
                      label={predecessor || successor
                        ? `Inserted: ${activity} (after: ${predecessor ?? '?'}, before: ${successor ?? '?'})`
                        : `Inserted: ${activity}`}
                      sx={{ fontSize: '0.65rem', background: 'rgba(21,101,192,0.15)', color: '#1565c0', border: '1px solid #1565c0' }} />
                  ))}
                </Box>
              </Box>
              <IconButton onClick={() => setModelDialogDev(null)}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, position: 'relative' }}>
              <Box sx={{ position: 'absolute', top: 8, left: 12, zIndex: 10, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip size="small" label="■ Skipped activity" sx={{ fontSize: '0.6rem', background: 'rgba(245,124,0,0.18)', color: '#f57c00', border: '1px solid #f57c00' }} />
                <Chip size="small" label="■ Inserted activity (if in model)" sx={{ fontSize: '0.6rem', background: 'rgba(21,101,192,0.18)', color: '#1565c0', border: '1px solid #1565c0' }} />
                <Chip size="small" label="╌ Insertion context (before/after)" sx={{ fontSize: '0.6rem', background: 'rgba(2,136,209,0.07)', color: '#0288d1', border: '1px dashed #0288d1' }} />
              </Box>
              <BpmnHighlightViewer xml={bpmnXml} highlights={highlights} />
            </DialogContent>
          </Dialog>
        );
      })()}

      {issueList.map((deviation: string) => {
        const workaround = workaroundMap[deviation];
        const risksOpps = issueRisksOpportunities[deviation] ?? [];
        const issueResults = results.filter((r: CausalResult) => r.deviation === deviation && isFinite(r.ate));
        const dimsForDev = issueResults.map((r: CausalResult) => r.dimension);
        const isExpanded = expandedDevs.has(deviation);
        const activeDim = selectedDimPerDev[deviation] || dimsForDev[0] || "";
        const correlKey = `${deviation}::${activeDim}`;

        // All dimensions to show in matrix: union of causal dims + participant goal dims
        const goalDims = Object.keys(workaround?.goalDimensions ?? {});
        const allMatrixDims = Array.from(new Set([...dimsForDev, ...goalDims]));

        // Determine overall direction from causal results for border colour
        const scores = issueResults.map((r: CausalResult) => {
          const label = getCriticality(r.ate, criticalityMap[r.dimension]);
          return criticalityWeight(label as any);
        });
        const totalScore = scores.reduce((a: number, b: number) => a + b, 0);
        const dir = totalScore > 0 ? "negative" : totalScore < 0 ? "positive" : "neutral";
        const borderColor = dir === "negative" ? "#f57c00" : dir === "positive" ? "#66bb6a" : "#bdbdbd";

        return (
          <Card key={deviation} sx={{ mb: 3, borderLeft: `4px solid ${borderColor}`, borderRadius: 2 }} variant="outlined">
            <CardContent>

              {/* Header */}
              <Box display="flex" alignItems="center" gap={1} mb={2}>
                <Typography variant="h6" sx={{ fontSize: "1rem", fontWeight: 700, flex: 1 }}>{deviation}</Typography>
                {workaround?.isWorkaround && (
                  <Chip label="Workaround" size="small" sx={{ fontSize: '0.62rem', fontWeight: 600, background: '#e3f2fd', color: '#1565c0' }} />
                )}
                <Chip
                  label={dir === "negative" ? "Overall: negative" : dir === "positive" ? "Overall: positive" : "Overall: neutral"}
                  color={dir === "negative" ? "error" : dir === "positive" ? "success" : "default"}
                  size="small" sx={{ fontWeight: 700 }}
                />
                {bpmnXml && parseDeviationActivities(deviation, deviationIssueMap).length > 0 && (
                  <Tooltip title="View deviation in process model" arrow>
                    <IconButton size="small" onClick={() => setModelDialogDev(deviation)}
                      sx={{ color: '#7b1fa2' }}>
                      <MapIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>

              {/* ── Summary matrix ── */}
              <Box sx={{ overflowX: 'auto', mb: 2 }}>
                <Table size="small" sx={{ tableLayout: 'fixed', minWidth: 560 }}>
                  <TableHead>
                    <TableRow sx={{ background: '#f5f5f5' }}>
                      <TableCell sx={{ fontSize: 11, fontWeight: 700, width: 110 }}>Dimension</TableCell>
                      <TableCell sx={{ fontSize: 11, fontWeight: 700, width: '38%' }}>
                        Participant's intent
                        <Box component="span" sx={{ display: 'block', fontSize: '0.6rem', fontWeight: 400, color: '#888', fontStyle: 'italic' }}>
                          individual perspective
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontWeight: 700, width: '38%' }}>
                        Actual process impact
                        <Box component="span" sx={{ display: 'block', fontSize: '0.6rem', fontWeight: 400, color: '#888', fontStyle: 'italic' }}>
                          measured causal effect (all cases)
                        </Box>
                      </TableCell>
                      <TableCell sx={{ fontSize: 11, fontWeight: 700, width: 80, textAlign: 'center' }}>Alignment</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {allMatrixDims.map((dim) => {
                      const causalResult = issueResults.find((r: CausalResult) => r.dimension === dim);
                      const intentDesc = workaround?.goalDimensions?.[dim];
                      const hasIntent = intentDesc !== undefined;
                      const isFlexibility = dim === 'flexibility';
                      const critLabel = causalResult ? getCriticality(causalResult.ate, criticalityMap[dim]) : null;
                      const critBg = getCriticalityColor(critLabel as any);
                      const dimColor = DIM_COLORS[dim] ?? '#555';

                      // Alignment: only when participant targeted the dim AND we have a causal result
                      let alignment: 'aligned' | 'misaligned' | null = null;
                      if (hasIntent && causalResult && !isFlexibility) {
                        const isGood = NEGATIVE_GOOD_DIMS.has(dim.toLowerCase())
                          ? causalResult.ate < 0
                          : causalResult.ate > 0;
                        alignment = isGood ? 'aligned' : 'misaligned';
                      }

                      return (
                        <TableRow key={dim} sx={{ '&:nth-of-type(even)': { background: '#fafafa' } }}>
                          <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>
                            <Chip label={dim.charAt(0).toUpperCase() + dim.slice(1)} size="small" sx={{ fontSize: '0.62rem', fontWeight: 700, backgroundColor: `${dimColor}18`, color: dimColor, height: 20 }} />
                          </TableCell>
                          <TableCell sx={{ fontSize: 11 }}>
                            {hasIntent ? (
                              <Box>
                                <Chip label="targeted" size="small" sx={{ fontSize: '0.58rem', mb: 0.4, height: 16, background: `${dimColor}18`, color: dimColor }} />
                                {intentDesc ? (
                                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.68rem' }}>{intentDesc}</Typography>
                                ) : (
                                  <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic', fontSize: '0.65rem' }}>no description</Typography>
                                )}
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic', fontSize: '0.65rem' }}>not targeted</Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ fontSize: 11 }}>
                            {isFlexibility ? (
                              <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic', fontSize: '0.65rem' }}>not computed</Typography>
                            ) : causalResult ? (
                              <Box>
                                <Box component="span" sx={{ display: 'inline-block', px: 0.75, py: 0.25, borderRadius: 0.5, background: critBg, color: '#fff', fontSize: '0.65rem', fontWeight: 700, mr: 0.5 }}>
                                  {critLabel ?? 'unclassified'}
                                </Box>
                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                  CATE {causalResult.ate >= 0 ? '+' : ''}{causalResult.ate.toFixed(2)} (p={causalResult.p_value?.toFixed(3) ?? '–'})
                                </Typography>
                              </Box>
                            ) : (
                              <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic', fontSize: '0.65rem' }}>not measured</Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ textAlign: 'center' }}>
                            {alignment === 'aligned' && (
                              <Tooltip title="Participant's intent matches the measured direction" arrow>
                                <Typography sx={{ color: '#2e7d32', fontWeight: 700, fontSize: '1rem', cursor: 'default' }}>✓</Typography>
                              </Tooltip>
                            )}
                            {alignment === 'misaligned' && (
                              <Tooltip title="Participant's intent conflicts with the measured direction" arrow>
                                <Typography sx={{ color: '#c62828', fontWeight: 700, fontSize: '1rem', cursor: 'default' }}>✗</Typography>
                              </Tooltip>
                            )}
                            {alignment === null && (
                              <Typography color="text.disabled" sx={{ fontSize: '0.8rem' }}>—</Typography>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>

              {/* Risks & opportunities */}
              {risksOpps.length > 0 && (
                <Box sx={{ mb: 2, p: 1.25, border: '1px solid #e0e0e0', borderRadius: 1, background: '#fafafa' }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: '#555', textTransform: 'uppercase', fontSize: '10px', letterSpacing: 0.5, display: 'block', mb: 0.75 }}>
                    Risks &amp; Opportunities
                  </Typography>
                  <Box display="flex" flexDirection="column" gap={0.4}>
                    {risksOpps.map((e) => {
                      const isRisk = e.type === 'risk';
                      const hColor = HORIZON_COLORS[e.horizon] ?? '#555';
                      return (
                        <Box key={e.id} display="flex" gap={0.75} alignItems="flex-start">
                          <Chip label={isRisk ? 'Risk' : 'Opp.'} size="small" sx={{ fontSize: '0.57rem', fontWeight: 700, flexShrink: 0, height: 18, backgroundColor: isRisk ? 'rgba(211,47,47,0.1)' : 'rgba(56,142,60,0.1)', color: isRisk ? '#c62828' : '#2e7d32' }} />
                          <Chip label={HORIZON_LABELS[e.horizon]} size="small" sx={{ fontSize: '0.57rem', flexShrink: 0, height: 18, backgroundColor: `${hColor}18`, color: hColor }} />
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>{e.description || <em>no description</em>}</Typography>
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              )}

              {/* AI suggestion */}
              <Box sx={{ mb: 1.5 }}>
                {!llmSuggestions[deviation] && (
                  <Button
                    size="small" variant="outlined"
                    disabled={!!llmLoading[deviation] || !selectedModel || ollamaOnline !== true}
                    startIcon={llmLoading[deviation] ? <CircularProgress size={14} /> : undefined}
                    onClick={() => fetchLlmSuggestion(deviation, dir)}
                    sx={{ borderColor: "#9c27b0", color: "#9c27b0", "&:hover": { borderColor: "#6a0080", color: "#6a0080" } }}
                  >
                    {llmLoading[deviation] ? "Generating…" : `AI Suggestions${selectedModel ? ` (${selectedModel})` : ""}`}
                  </Button>
                )}
                {llmErrors[deviation] && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{llmErrors[deviation]}</Alert>}
                {llmSuggestions[deviation] && (
                  <Box sx={{ mt: 1, p: 1.5, backgroundColor: "#f3e5f5", borderLeft: "3px solid #9c27b0", borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: "#6a0080", display: "block", mb: 0.5 }}>
                      AI Suggestions ({selectedModel})
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{llmSuggestions[deviation]}</Typography>
                    <Button size="small" sx={{ mt: 1, fontSize: 11, color: "#9c27b0" }}
                      onClick={() => {
                        setLlmSuggestions((p) => { const n = { ...p }; delete n[deviation]; return n; });
                        setLlmErrors((p) => { const n = { ...p }; delete n[deviation]; return n; });
                      }}
                    >Regenerate</Button>
                  </Box>
                )}
              </Box>

              {/* Recommendation */}
              <Box sx={{ mb: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: '#1565c0', display: 'block', mb: 0.5 }}>
                  Recommendation
                </Typography>
                <TextField
                  multiline minRows={2} maxRows={5} fullWidth size="small"
                  placeholder="Based on the evidence above, what action do you recommend for this issue?"
                  value={reactionItems[deviation] || ''}
                  onChange={(e) => setReactionItems((prev) => ({ ...prev, [deviation]: e.target.value }))}
                  inputProps={{ style: { fontSize: 12 } }}
                />
              </Box>

              {/* Activity duration contribution (time dimension only) */}
              {durationContributions && durationContributions[deviation] && durationContributions[deviation].length > 0 && (
                <Box sx={{ mb: 1.5 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={durationExpanded[deviation] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => setDurationExpanded(prev => ({ ...prev, [deviation]: !prev[deviation] }))}
                    sx={{ fontSize: '0.72rem', borderColor: '#1565c0', color: '#1565c0', mb: 0.75 }}
                    disableElevation
                  >
                    {durationExpanded[deviation] ? 'Hide' : 'Show'} Activity Duration Contribution
                    <Tooltip
                      title="Shows average activity durations — approximated as the gap to the next event in the same trace — for traces with vs without this deviation. Red = activity takes longer in deviant traces; blue = activity is faster."
                      arrow
                    >
                      <InfoIcon sx={{ fontSize: 14, ml: 0.75, color: '#90caf9' }} />
                    </Tooltip>
                  </Button>
                  {durationExpanded[deviation] && (() => {
                    const g0tl = matrixRows.filter((r: any) => r[deviation] === 0);
                    const g1tl = matrixRows.filter((r: any) => r[deviation] === 1);
                    const avgLen0 = g0tl.length > 0
                      ? (g0tl.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g0tl.length).toFixed(1)
                      : null;
                    const avgLen1 = g1tl.length > 0
                      ? (g1tl.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g1tl.length).toFixed(1)
                      : null;
                    return (
                    <>
                    {avgLen0 != null && avgLen1 != null && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        Mean trace length: <strong>{avgLen1} activities</strong> (with deviation) vs. <strong>{avgLen0} activities</strong> (without). A shorter trace with slower individual activities can still be faster overall — and vice versa.
                      </Typography>
                    )}
                    <Box sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Activity</TableCell>
                            <TableCell align="right">With deviation</TableCell>
                            <TableCell align="right">Without deviation</TableCell>
                            <TableCell align="right">Difference</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {durationContributions[deviation].map((row) => {
                            const diff = row.difference;
                            const diffColor = diff == null ? undefined : diff > 0 ? '#c62828' : '#1565c0';
                            return (
                              <TableRow key={row.activity}>
                                <TableCell>{row.activity}</TableCell>
                                <TableCell align="right">{row.with_deviation != null ? formatSeconds(row.with_deviation) : '—'}</TableCell>
                                <TableCell align="right">{row.without_deviation != null ? formatSeconds(row.without_deviation) : '—'}</TableCell>
                                <TableCell align="right" sx={{ color: diffColor, fontWeight: diff != null ? 600 : undefined }}>
                                  {diff != null ? `${diff > 0 ? '+' : ''}${formatSeconds(Math.abs(diff))} ${diff > 0 ? 'slower' : 'faster'}` : '—'}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Box>
                    </>
                    );
                  })()}
                </Box>
              )}
              {durationLoading && results.some((r: CausalResult) => r.deviation === deviation && r.dimension === 'time') && (
                <Box display="flex" alignItems="center" gap={1} mb={1.5}>
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">Computing activity durations…</Typography>
                </Box>
              )}

              {/* Root cause investigation */}
              {dimsForDev.length > 0 && (
                <Box>
                  <Button size="small" variant={isExpanded ? "contained" : "outlined"}
                    startIcon={isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => toggleExpand(deviation)} disableElevation
                  >
                    {isExpanded ? "Hide Root Cause Analysis" : "Investigate Root Causes"}
                  </Button>
                </Box>
              )}
            </CardContent>

            {isExpanded && (
              <CardContent sx={{ pt: 0 }}>
                {dimsForDev.length > 1 && (
                  <FormControl size="small" sx={{ mt: 1, mb: 1, minWidth: 200 }}>
                    <Select value={activeDim} onChange={(e) => setSelectedDimPerDev((p) => ({ ...p, [deviation]: e.target.value }))} sx={{ fontSize: 12 }}>
                      {dimsForDev.map((d: string) => <MenuItem key={d} value={d} sx={{ fontSize: 12 }}>{d}</MenuItem>)}
                    </Select>
                  </FormControl>
                )}
                <KeyPatternBox topRuleText={topRuleTexts[deviation] ?? null} dir={dir as "negative" | "positive" | "neutral"} />
                {activeDim && matrixRows.length > 0 ? (
                  <RootCausePanel
                    deviation={deviation} dimension={activeDim}
                    matrixRows={matrixRows} matrixCols={matrixCols}
                    correlCol={correlCols[correlKey] ?? null}
                    onSetCorrelCol={(col) => setCorrelCols((prev) => ({ ...prev, [correlKey]: col }))}
                    onClose={() => toggleExpand(deviation)}
                    onRulesLoaded={(text) => setTopRuleTexts((prev) => ({ ...prev, [deviation]: text }))}
                  />
                ) : matrixRows.length === 0 && !matrixLoading ? (
                  <Alert severity="info" sx={{ mt: 1 }}>Trace data not available.</Alert>
                ) : (
                  <Box display="flex" alignItems="center" gap={1} sx={{ mt: 2 }}>
                    <CircularProgress size={16} />
                    <Typography variant="caption">Loading trace data…</Typography>
                  </Box>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      {/* ── Issue Relationship Graph ─────────────────────────────────────────── */}
      <Box sx={{ mt: 4, border: '1px solid #e0e0e0', borderRadius: 2, overflow: 'hidden' }}>
        <Box display="flex" alignItems="center" gap={1}
          sx={{ px: 2, py: 1.5, backgroundColor: '#f3e5f5', borderBottom: '1px solid #e1bee7' }}>
          <AccountTreeIcon sx={{ color: '#7b1fa2', fontSize: 20 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: '#4a148c', flex: 1 }}>
            Issue Relationships
          </Typography>
          {issueCausalLinks.filter(l => issueList.includes(l.from) && issueList.includes(l.to)).length > 0 && (
            <Chip
              label={`${issueCausalLinks.filter(l => issueList.includes(l.from) && issueList.includes(l.to)).length} link(s)`}
              size="small" variant="outlined"
              sx={{ fontSize: '0.65rem', borderColor: '#ce93d8', color: '#7b1fa2' }}
            />
          )}
          <Tooltip title="Draw directed causal links between issues. Click a node to select it as the source, then click another node to create a link. Hover an arrow and click × to delete it." arrow>
            <InfoIcon sx={{ fontSize: 16, color: '#9c27b0', cursor: 'help' }} />
          </Tooltip>
        </Box>
        <Box sx={{ p: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Draw directed causal relationships between issues — e.g. "Issue A causes Issue B." These links will appear in the final report.
          </Typography>
          <IssueGraphEditor
            issues={issueList}
            links={issueCausalLinks.filter(l => issueList.includes(l.from) && issueList.includes(l.to))}
            onAddLink={(from, to, description) => {
              setIssueCausalLinks(prev => [
                ...prev,
                { id: Math.random().toString(36).slice(2, 9), from, to, description },
              ]);
            }}
            onRemoveLink={(id) => setIssueCausalLinks(prev => prev.filter(l => l.id !== id))}
          />
        </Box>
      </Box>

    </Box>
  );
};

export default Recommendations;

import React from "react";
import {
  Box,
  Typography,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Divider,
  Button,
  Tooltip,
  IconButton,
} from "@mui/material";
import InfoIcon from "@mui/icons-material/Info";
import { useLocation, useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { useBottomNav } from "./BottomNavContext";
import ScreenInfoBox from "./ScreenInfoBox";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

interface CausalResult {
  deviation: string;
  dimension: string;
  ate: number;
  p_value: number;
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

const getCriticality = (
  value: number,
  rules: CriticalityRule[] = []
): CriticalityLevel | null => {
  for (const rule of rules) {
    if (value >= rule.min && value < rule.max) return rule.label;
  }
  return null;
};

const getCriticalityColor = (label: CriticalityLevel | null) => {
  switch (label) {
    case "very positive":      return "rgba(0,100,0,0.85)";
    case "positive":           return "rgba(76,175,80,0.75)";
    case "slightly positive":  return "rgba(129,199,132,0.7)";
    case "neutral":            return "rgba(200,200,200,0.7)";
    case "slightly negative":  return "rgba(255,183,77,0.75)";
    case "negative":           return "rgba(255,152,0,0.75)";
    case "very negative":      return "rgba(211,47,47,0.85)";
    default:                   return "#fff";
  }
};

const criticalityWeight = (label: CriticalityLevel | null) => {
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

const CriticalityResults: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();

  const results: CausalResult[] = location.state?.results || [];
  const criticalityMap: CriticalityMap = location.state?.criticalityMap || {};

  const dimensions = Array.from(new Set(results.map((r) => r.dimension)));
  const deviations = Array.from(new Set(results.map((r) => r.deviation)));

  const deviationPriorities = deviations
    .map((dev) => {
      let score = 0;
      dimensions.forEach((dim) => {
        const result = results.find((r) => r.dimension === dim && r.deviation === dev);
        if (!result) return;
        score += criticalityWeight(getCriticality(result.ate, criticalityMap[dim]));
      });
      return { deviation: dev, score, reasons: [] as string[] };
    })
    .sort((a, b) => b.score - a.score);

  const [priorityList] = React.useState(deviationPriorities);

  React.useEffect(() => {
    setContinue({
      label: "Continue to Risks & Opportunities",
      onClick: () => navigate("/risks-opportunities", { state: { results, criticalityMap, priorityList } }),
    });
    return () => setContinue(null);
  }, [navigate, setContinue, results, criticalityMap, priorityList]);

  const exportCSV = () => {
    let csv = "Dimension,Deviation,Criticality,ATE\n";
    dimensions.forEach((dim) => {
      deviations.forEach((dev) => {
        const result = results.find((r) => r.dimension === dim && r.deviation === dev);
        if (!result) return;
        const label = getCriticality(result.ate, criticalityMap[dim]);
        csv += `${dim},${dev},${label ?? ""},${result.ate}\n`;
      });
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "causal_results.csv";
    a.click();
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    doc.text("Criticality Results", 14, 15);
    autoTable(doc, {
      startY: 20,
      head: [["Dimension", ...deviations]],
      body: dimensions.map((dim) => [
        dim,
        ...deviations.map((dev) => {
          const result = results.find((r) => r.dimension === dim && r.deviation === dev);
          if (!result || result.ate == null) return "";
          const label = getCriticality(result.ate, criticalityMap[dim]);
          return `${label ?? "-"} (${result.ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`;
        }),
      ]),
    });
    doc.save("causal_analysis.pdf");
  };

  const legendItems: { label: CriticalityLevel; color: string }[] = [
    { label: "very positive",    color: getCriticalityColor("very positive") },
    { label: "positive",         color: getCriticalityColor("positive") },
    { label: "slightly positive",color: getCriticalityColor("slightly positive") },
    { label: "neutral",          color: getCriticalityColor("neutral") },
    { label: "slightly negative",color: getCriticalityColor("slightly negative") },
    { label: "negative",         color: getCriticalityColor("negative") },
    { label: "very negative",    color: getCriticalityColor("very negative") },
  ];

  return (
    <Box sx={{ width: "100%", margin: "0 auto", mt: 4 }}>
      <ScreenInfoBox
        whatYouSee="A colour-coded matrix of causal effects (ATE) for each issue × dimension combination. Each cell shows the criticality label based on the thresholds you set on the previous page (very negative → very positive)."
        whatToDo="Review the overall pattern of impacts. Use this matrix as a summary before moving to risks & opportunities. If a classification looks wrong, go back and adjust the criticality thresholds in the previous step."
      />

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={4}>
        <Box display="flex" alignItems="center">
          <Typography variant="h5">Criticality Overview</Typography>
          <Tooltip
            title="Each cell shows the criticality label assigned to the CATE of a deviation for a given dimension, based on the thresholds configured on the previous page."
            arrow
            placement="right"
          >
            <IconButton size="small" sx={{ ml: 1 }}>
              <InfoIcon fontSize="small" color="action" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box display="flex" gap={3} mb={3} alignItems="center" flexWrap="wrap">
        <Typography variant="subtitle2">Legend:</Typography>
        {legendItems.map((item) => (
          <Box key={item.label} display="flex" alignItems="center" gap={1}>
            <Box sx={{ width: 16, height: 16, backgroundColor: item.color, borderRadius: 1 }} />
            <Typography variant="caption">{item.label}</Typography>
          </Box>
        ))}
      </Box>

      <Button variant="outlined" onClick={exportCSV} sx={{ mt: 1 }}>
        Export as CSV
      </Button>
      <Button variant="contained" sx={{ ml: 2, mt: 1 }} onClick={exportPDF}>
        Export as PDF
      </Button>

      <Divider sx={{ my: 3 }} />

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell><strong>Dimension</strong></TableCell>
            {deviations.map((dev) => (
              <TableCell key={dev} align="center"><strong>{dev}</strong></TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {dimensions.map((dim) => (
            <TableRow key={dim}>
              <TableCell><strong>{dim}</strong></TableCell>
              {deviations.map((dev) => {
                const result = results.find((r) => r.dimension === dim && r.deviation === dev);
                if (!result || result.ate == null) return <TableCell key={dev} />;
                const label = getCriticality(result.ate, criticalityMap[dim]);
                return (
                  <TableCell
                    key={dev}
                    align="center"
                    sx={{
                      backgroundColor: getCriticalityColor(label),
                      color: "white",
                      fontWeight: 500,
                    }}
                  >
                    {label ?? "-"} ({result.ate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
};

export default CriticalityResults;

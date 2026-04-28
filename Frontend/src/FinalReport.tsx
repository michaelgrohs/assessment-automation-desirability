import React, { useEffect, useState, useRef } from "react";
import {
  Box, Typography, Chip, Divider, Table, TableHead, TableRow,
  TableCell, TableBody, Card, CardContent, Button, Tooltip, Alert,
  IconButton, CircularProgress,
} from "@mui/material";
import InfoIcon from "@mui/icons-material/Info";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import MapIcon from "@mui/icons-material/Map";
import { useLocation, useNavigate } from "react-router-dom";
import NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import { useBottomNav } from "./BottomNavContext";
import { useFileContext, IssueCausalLink } from "./FileContext";
import ScreenInfoBox from "./ScreenInfoBox";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

const formatSeconds = (s: number): string => {
  if (s >= 86400) return `${(s / 86400).toFixed(1)} days`;
  if (s >= 3600) return `${(s / 3600).toFixed(1)} hrs`;
  if (s >= 60) return `${(s / 60).toFixed(1)} min`;
  return `${s.toFixed(0)} s`;
};

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

type DurationRow = {
  activity: string;
  with_deviation: number | null;
  without_deviation: number | null;
  difference: number | null;
};

interface CausalResult {
  deviation: string;
  dimension: string;
  ate: number;
  p_value: number;
  error?: string;
}

type CriticalityLevel =
  | "very negative" | "negative" | "slightly negative" | "neutral"
  | "slightly positive" | "positive" | "very positive";

interface CriticalityRule { min: number; max: number; label: CriticalityLevel; }
interface CriticalityMap { [dimension: string]: CriticalityRule[]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const getCriticality = (value: number, rules: CriticalityRule[] = []): CriticalityLevel | null => {
  for (const rule of rules) {
    if (value >= rule.min && value < rule.max) return rule.label;
  }
  return null;
};

const critColor = (label: CriticalityLevel | null): string => {
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

const critWeight = (label: CriticalityLevel | null): number => {
  switch (label) {
    case "very negative":    return 3;
    case "negative":         return 2;
    case "slightly negative":return 1;
    case "neutral":          return 0;
    case "slightly positive":return -1;
    case "positive":         return -2;
    case "very positive":    return -3;
    default: return 0;
  }
};

const overallDir = (score: number): "negative" | "positive" | "neutral" =>
  score > 0 ? "negative" : score < 0 ? "positive" : "neutral";

// ── Read-only graph ───────────────────────────────────────────────────────────

const NODE_W = 160;
const NODE_H = 48;

const ReadOnlyGraph: React.FC<{ issues: string[]; links: IssueCausalLink[] }> = ({ issues, links }) => {
  const cols = Math.max(1, Math.ceil(Math.sqrt(issues.length)));
  const positions: Record<string, { x: number; y: number }> = {};
  issues.forEach((iss, i) => {
    positions[iss] = { x: 40 + (i % cols) * 220, y: 40 + Math.floor(i / cols) * 120 };
  });

  const posVals = Object.values(positions);
  const svgW = posVals.length ? Math.max(...posVals.map(p => p.x)) + NODE_W + 60 : 500;
  const svgH = posVals.length ? Math.max(...posVals.map(p => p.y)) + NODE_H + 60 : 180;

  if (issues.length === 0) return (
    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
      No issues available.
    </Typography>
  );

  return (
    <Box sx={{ border: '1px solid #e0e0e0', borderRadius: 1, overflowX: 'auto', backgroundColor: '#fafafa' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        <defs>
          <marker id="fr-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#7b1fa2" />
          </marker>
        </defs>

        {links.map(link => {
          const s = positions[link.from];
          const t = positions[link.to];
          if (!s || !t) return null;
          const sx = s.x + NODE_W; const sy = s.y + NODE_H / 2;
          const tx = t.x;          const ty = t.y + NODE_H / 2;
          const mx = (sx + tx) / 2;
          const my = (sy + ty) / 2;
          const d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
          return (
            <g key={link.id}>
              <path d={d} fill="none" stroke="#7b1fa2" strokeWidth={1.5}
                markerEnd="url(#fr-arrow)" opacity={0.7} />
              <text x={mx} y={my - 7} textAnchor="middle" fontSize={10} fill="#6a1b9a"
                style={{ userSelect: 'none' }}>
                {link.description || 'causes'}
              </text>
            </g>
          );
        })}

        {issues.map(issue => {
          const pos = positions[issue];
          if (!pos) return null;
          return (
            <g key={issue} transform={`translate(${pos.x},${pos.y})`}>
              <rect width={NODE_W} height={NODE_H} rx={6} fill="#fff" stroke="#bdbdbd" strokeWidth={1} />
              <foreignObject x={4} y={4} width={NODE_W - 8} height={NODE_H - 8}>
                <div
                  // @ts-ignore
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{
                    fontSize: 11, padding: '2px 4px', overflow: 'hidden',
                    wordBreak: 'break-word', color: '#333', textAlign: 'center',
                    height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
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
  );
};

// ── BPMN overview viewer ───────────────────────────────────────────────────────

const BpmnOverviewViewer: React.FC<{
  xml: string;
  highlights: { activity: string; color: string; bg: string }[];
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
        highlights.forEach(({ activity, color, bg }) => {
          elementRegistry.filter((el: any) =>
            el.businessObject?.name === activity && el.type !== 'label'
          ).forEach((el: any) => {
            overlays.add(el.id, {
              position: { top: 0, left: 0 },
              html: `<div style="width:${el.width}px;height:${el.height}px;background:${bg};border:3px solid ${color};border-radius:4px;pointer-events:none;box-sizing:border-box;"></div>`,
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

const FinalReport: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { setContinue } = useBottomNav();
  const {
    workaroundMap, issueRisksOpportunities, issueCausalLinks,
    loggingErrorDeviations, processExceptionDeviations, outOfControlDeviations,
    deviationAffectedCounts, deviationLabels, deviationIssueMap, conformanceMode,
  } = useFileContext();

  const results: CausalResult[] = location.state?.results || [];
  const criticalityMap: CriticalityMap = location.state?.criticalityMap || {};
  const reactionItems: Record<string, string> = location.state?.reactionItems || {};
  const llmSuggestions: Record<string, string> = location.state?.llmSuggestions || {};
  const matrixRows: any[] = location.state?.matrixRows || [];
  const durationContributions: Record<string, DurationRow[]> | null = location.state?.durationContributions || null;

  const [allRulesData, setAllRulesData] = useState<Record<string, RuleResult>>({});
  const [rulesLoading, setRulesLoading] = useState(false);
  const [bpmnXml, setBpmnXml] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);

  const issueList: string[] = React.useMemo(() => {
    const fromResults = Array.from(new Set(results.map(r => r.deviation)));
    return fromResults.length > 0 ? fromResults : [];
  }, [results]);

  useEffect(() => {
    if (conformanceMode !== 'bpmn') return;
    fetch(`${API_URL}/api/model-content`)
      .then(r => r.json())
      .then(d => { if (d?.type === 'bpmn' && d.content) setBpmnXml(d.content); })
      .catch(() => {});
  }, [conformanceMode]);

  useEffect(() => {
    if (issueList.length === 0) return;
    setRulesLoading(true);
    Promise.all(
      issueList.map(dev =>
        fetch(`${API_URL}/api/deviation-rules?deviation=${encodeURIComponent(dev)}`)
          .then(r => r.json())
          .then((data: RuleResult) => ({ dev, data }))
          .catch(() => ({ dev, data: null }))
      )
    ).then(results => {
      const map: Record<string, RuleResult> = {};
      results.forEach(({ dev, data }) => { if (data) map[dev] = data; });
      setAllRulesData(map);
      setRulesLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueList.join(',')]);

  const activeLinks = issueCausalLinks.filter(
    l => issueList.includes(l.from) && issueList.includes(l.to)
  );

  const dims = React.useMemo(
    () => Array.from(new Set(results.map(r => r.dimension))),
    [results]
  );

  useEffect(() => {
    setContinue({ label: "Back to Start", onClick: () => navigate("/") });
    return () => setContinue(null);
  }, [navigate, setContinue]);

  const negativeIssues = issueList.filter(dev => {
    const score = results
      .filter(r => r.deviation === dev && isFinite(r.ate))
      .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
    return score > 0;
  });
  const positiveIssues = issueList.filter(dev => {
    const score = results
      .filter(r => r.deviation === dev && isFinite(r.ate))
      .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
    return score < 0;
  });

  const exportPDF = async () => {
    setPdfExporting(true);
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    const contentW = pageW - margin * 2;

    const sectionTitle = (text: string, y: number) => {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(text, margin, y);
      doc.setFont("helvetica", "normal");
    };

    const bodyText = (text: string, y: number, indent = 0, maxW?: number) => {
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(text, maxW ?? contentW - indent);
      doc.text(lines, margin + indent, y);
      return lines.length;
    };

    // ── Title ──────────────────────────────────────────────────────────────────
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("Conformance Analysis — Final Report", margin, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleString()}`, margin, 26);

    // ── 1. Executive Summary ──────────────────────────────────────────────────
    sectionTitle("1. Executive Summary", 36);
    doc.setFontSize(9);
    doc.text(`Total issues analysed: ${issueList.length}`, margin, 43);
    doc.text(`Negative overall impact: ${negativeIssues.length}`, margin, 49);
    doc.text(`Positive overall impact: ${positiveIssues.length}`, margin, 55);
    doc.text(`Causal relationships defined: ${activeLinks.length}`, margin, 61);

    const totalExcluded = loggingErrorDeviations.length + processExceptionDeviations.length + outOfControlDeviations.length;
    doc.text(`Excluded deviations: ${totalExcluded} (${loggingErrorDeviations.length} logging error, ${processExceptionDeviations.length} process exception, ${outOfControlDeviations.length} out-of-control)`, margin, 67);

    // ── 2. Excluded Deviations ────────────────────────────────────────────────
    if (totalExcluded > 0) {
      sectionTitle("2. Excluded Deviations", 78);
      const excludedRows: string[][] = [
        ...loggingErrorDeviations.map(col => {
          const count = deviationAffectedCounts[col];
          return [deviationLabels[col] ?? col, "Logging Error", "Step 1b", count !== undefined ? `${count.toLocaleString("en-US")} traces` : "–"];
        }),
        ...processExceptionDeviations.map(col => {
          const count = deviationAffectedCounts[col];
          return [deviationLabels[col] ?? col, "Process Exception", "Step 3", count !== undefined ? `${count.toLocaleString("en-US")} traces` : "–"];
        }),
        ...outOfControlDeviations.map(col => {
          const count = deviationAffectedCounts[col];
          return [deviationLabels[col] ?? col, "Out-of-control", "Step 3", count !== undefined ? `${count.toLocaleString("en-US")} traces` : "–"];
        }),
      ];
      autoTable(doc, {
        startY: 82,
        head: [["Deviation", "Type", "Step", "Traces Affected"]],
        body: excludedRows,
        styles: { fontSize: 7 },
        headStyles: { fillColor: [100, 100, 100] },
        columnStyles: { 0: { cellWidth: 80 }, 3: { halign: "right" } },
      });
    }

    // ── 3. Issue Impact Overview ──────────────────────────────────────────────
    const impactStartY = totalExcluded > 0 ? ((doc as any).lastAutoTable?.finalY ?? 82) + 10 : 78;
    const impactTitleY = impactStartY;
    const sectionNum = totalExcluded > 0 ? "3" : "2";
    sectionTitle(`${sectionNum}. Issue Impact Overview`, impactTitleY);
    autoTable(doc, {
      startY: impactTitleY + 4,
      head: [["Issue", ...dims.map(d => `${d.charAt(0).toUpperCase() + d.slice(1)} (ATE)`), ...dims.map(d => `${d.charAt(0).toUpperCase() + d.slice(1)} (Label)`), "Overall"]],
      body: issueList.map(dev => {
        const ateVals = dims.map(dim => {
          const r = results.find(x => x.deviation === dev && x.dimension === dim);
          if (!r || !isFinite(r.ate)) return "–";
          return r.ate.toFixed(3);
        });
        const labelVals = dims.map(dim => {
          const r = results.find(x => x.deviation === dev && x.dimension === dim);
          if (!r || !isFinite(r.ate)) return "–";
          return getCriticality(r.ate, criticalityMap[dim]) ?? "–";
        });
        const score = results
          .filter(r => r.deviation === dev && isFinite(r.ate))
          .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
        return [dev, ...ateVals, ...labelVals, overallDir(score)];
      }),
      styles: { fontSize: 6 },
      headStyles: { fillColor: [66, 66, 66] },
    });

    // ── 4. Issue Relationships ────────────────────────────────────────────────
    const nextSectionNum = parseInt(sectionNum) + 1;
    if (activeLinks.length > 0) {
      const relY = ((doc as any).lastAutoTable?.finalY ?? 100) + 10;
      sectionTitle(`${nextSectionNum}. Issue Relationships`, relY);
      autoTable(doc, {
        startY: relY + 4,
        head: [["Cause", "Effect", "Description"]],
        body: activeLinks.map(l => [l.from, l.to, l.description || "causes"]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [123, 31, 162] },
      });
    }

    // ── 5. Process Model (landscape A4, colored by impact) ───────────────────
    const afterRelNum = activeLinks.length > 0 ? nextSectionNum + 1 : nextSectionNum;
    if (bpmnXml) {
      // Build same highlights as the on-screen view
      const pdfHighlights: { activity: string; color: string; fill: string }[] = [];
      issueList.forEach(dev => {
        const score = results
          .filter(r => r.deviation === dev && isFinite(r.ate))
          .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
        const dir = overallDir(score);
        const color = dir === 'negative' ? '#f57c00' : dir === 'positive' ? '#2e7d32' : '#9e9e9e';
        const fill  = dir === 'negative' ? '#fde8cc'  : dir === 'positive' ? '#c8e6c9'  : '#e8e8e8';
        const cols = Object.entries(deviationIssueMap).filter(([, n]) => n === dev).map(([c]) => c);
        (cols.length > 0 ? cols : [dev]).forEach(col => {
          const skip = col.match(/^\(Skip (.+)\)$/);
          if (skip) { pdfHighlights.push({ activity: skip[1], color, fill }); return; }
          const insert = col.match(/^\(Insert (.+)\)$/);
          if (insert) pdfHighlights.push({ activity: insert[1], color, fill });
        });
      });

      // Landscape A4 page: 297 × 210 mm
      doc.addPage([297, 210], 'landscape');
      const lW = 297; const lH = 210; const lM = 14;
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.text(`${afterRelNum}. Process Model — Deviation Overview`, lM, lM + 6);
      doc.setFont('helvetica', 'normal');

      // Legend
      const legendY = lM + 11;
      [[`#f57c00`, `#fde8cc`, 'Negative impact'], [`#2e7d32`, `#c8e6c9`, 'Positive impact'], [`#9e9e9e`, `#e8e8e8`, 'Neutral']]
        .forEach(([stroke, fill, label], i) => {
          const lx = lM + i * 56;
          doc.setFillColor(fill); doc.setDrawColor(stroke);
          doc.setLineWidth(0.5);
          doc.rect(lx, legendY, 4, 3, 'FD');
          doc.setFontSize(7); doc.setTextColor(80, 80, 80);
          doc.text(label, lx + 5, legendY + 2.5);
        });
      doc.setTextColor(0, 0, 0);

      const imgY = legendY + 6;
      const maxImgW = lW - lM * 2;          // 269 mm
      const maxImgH = lH - imgY - lM;       // remaining height ≈ 175 mm

      const tmpDiv = document.createElement('div');
      tmpDiv.style.cssText = 'width:2200px;height:1100px;position:fixed;left:-99999px;top:0;overflow:hidden';
      document.body.appendChild(tmpDiv);
      try {
        const tmpViewer = new NavigatedViewer({ container: tmpDiv });
        await tmpViewer.importXML(bpmnXml);
        (tmpViewer.get('canvas') as any).zoom('fit-viewport');
        await new Promise(r => setTimeout(r, 300));

        // Color elements directly in SVG (overlays are HTML and not captured by saveSVG)
        const elemReg = tmpViewer.get('elementRegistry') as any;
        const canvasMod = tmpViewer.get('canvas') as any;
        pdfHighlights.forEach(({ activity, color, fill }) => {
          elemReg.filter((el: any) =>
            el.businessObject?.name === activity && el.type !== 'label'
          ).forEach((el: any) => {
            const gfx: SVGGElement = canvasMod.getGraphics(el);
            if (!gfx) return;
            const rect = gfx.querySelector<SVGRectElement>('rect');
            if (rect) {
              rect.style.fill = fill;
              rect.style.stroke = color;
              rect.style.strokeWidth = '4px';
            }
          });
        });

        const { svg } = await (tmpViewer as any).saveSVG();
        tmpViewer.destroy();

        if (svg) {
          // Parse natural aspect ratio from SVG viewBox to avoid distortion
          const vbMatch = svg.match(/viewBox="[\d.-]+ [\d.-]+ ([\d.]+) ([\d.]+)"/);
          const natW = vbMatch ? parseFloat(vbMatch[1]) : 2;
          const natH = vbMatch ? parseFloat(vbMatch[2]) : 1;
          const aspect = natW / natH;

          // Fit within available area preserving aspect ratio
          let finalW = maxImgW;
          let finalH = finalW / aspect;
          if (finalH > maxImgH) { finalH = maxImgH; finalW = finalH * aspect; }
          const imgX = lM + (maxImgW - finalW) / 2; // center

          // Render canvas at natural aspect ratio (high res)
          const pxW = 2800;
          const pxH = Math.round(pxW / aspect);

          const imgData = await new Promise<string>((resolve) => {
            const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              const cv = document.createElement('canvas');
              cv.width = pxW; cv.height = pxH;
              const ctx = cv.getContext('2d')!;
              ctx.fillStyle = '#fff';
              ctx.fillRect(0, 0, pxW, pxH);
              ctx.drawImage(img, 0, 0, pxW, pxH);
              URL.revokeObjectURL(url);
              resolve(cv.toDataURL('image/jpeg', 0.93));
            };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
            img.src = url;
          });
          if (imgData) doc.addImage(imgData, 'JPEG', imgX, imgY, finalW, finalH);
        }
      } catch (_) {
        doc.setFontSize(8);
        doc.text('(Process model visualization unavailable)', lM, imgY + 6);
      } finally {
        document.body.removeChild(tmpDiv);
      }
    }

    // ── 6. Per-Issue Detail ────────────────────────────────────────────────────
    doc.addPage('a4', 'portrait');
    const recSectionNum = bpmnXml ? afterRelNum + 1 : afterRelNum;
    sectionTitle(`${recSectionNum}. Per-Issue Detail`, 18);
    let curY = 26;

    issueList.forEach((dev, idx) => {
      if (curY > 240) { doc.addPage('a4', 'portrait'); curY = 18; }

      // Issue header
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(`${idx + 1}. ${dev}`, margin, curY);
      doc.setFont("helvetica", "normal");
      curY += 6;

      const score = results
        .filter(r => r.deviation === dev && isFinite(r.ate))
        .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
      const dir = overallDir(score);
      doc.setFontSize(8);
      doc.text(`Overall direction: ${dir}`, margin + 4, curY);
      curY += 5;

      // Process position (BPMN mode: skips and insertions with context)
      const pdfDevCols = Object.entries(deviationIssueMap)
        .filter(([, name]) => name === dev).map(([col]) => col);
      const pdfToParse = pdfDevCols.length > 0 ? pdfDevCols : [dev];
      const positionLines: string[] = [];
      pdfToParse.forEach(col => {
        const skip = col.match(/^\(Skip (.+)\)$/);
        if (skip) { positionLines.push(`Skip: activity "${skip[1]}" should occur but is absent`); return; }
        const insert = col.match(/^\(Insert (.+)\)$/);
        if (insert) {
          const act = insert[1];
          const preds: Record<string, number> = {};
          const succs: Record<string, number> = {};
          matrixRows.filter((r: any) => r[col] === 1).forEach((r: any) => {
            if (!Array.isArray(r.activities)) return;
            r.activities.forEach((a: string, i: number) => {
              if (a === act) {
                if (i > 0) { const p = r.activities[i-1]; preds[p] = (preds[p]||0)+1; }
                if (i < r.activities.length-1) { const s = r.activities[i+1]; succs[s] = (succs[s]||0)+1; }
              }
            });
          });
          const topPred = Object.entries(preds).sort((a,b)=>b[1]-a[1])[0]?.[0];
          const topSucc = Object.entries(succs).sort((a,b)=>b[1]-a[1])[0]?.[0];
          const ctx = topPred || topSucc
            ? ` — typically inserted after "${topPred ?? '?'}", before "${topSucc ?? '?'}"`
            : '';
          positionLines.push(`Insert: activity "${act}" appears unexpectedly${ctx}`);
        }
      });
      if (positionLines.length > 0) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFont("helvetica", "bold");
        doc.text("Process position:", margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 4;
        positionLines.forEach(line => {
          if (curY > 260) { doc.addPage('a4', 'portrait'); curY = 18; }
          const n = bodyText(line, curY, 8);
          curY += n * 4 + 2;
        });
      }

      // ATE values per dimension
      const devResults = results.filter(r => r.deviation === dev && isFinite(r.ate));
      if (devResults.length > 0) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        autoTable(doc, {
          startY: curY,
          head: [["Dimension", "ATE", "Criticality"]],
          body: devResults.map(r => [
            r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1),
            r.ate.toFixed(4),
            getCriticality(r.ate, criticalityMap[r.dimension]) ?? "–",
          ]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [90, 90, 90] },
          margin: { left: margin + 4 },
          tableWidth: contentW - 4,
        });
        curY = ((doc as any).lastAutoTable?.finalY ?? curY) + 4;
      }

      // Trace length
      const pdfG0 = matrixRows.filter((r: any) => r[dev] === 0);
      const pdfG1 = matrixRows.filter((r: any) => r[dev] === 1);
      if (pdfG0.length > 0 && pdfG1.length > 0) {
        const pdfAvg0 = (pdfG0.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / pdfG0.length).toFixed(1);
        const pdfAvg1 = (pdfG1.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / pdfG1.length).toFixed(1);
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        bodyText(`Traces: ${pdfG1.length} deviant / ${pdfG0.length} conformant  |  Mean length: ${pdfAvg1} activities (deviant) vs. ${pdfAvg0} (conformant)`, curY, 4);
        curY += 5;
      }

      // Activity duration contributions
      const pdfDurRows = durationContributions?.[dev] ?? [];
      if (pdfDurRows.length > 0) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text("Activity Duration Contribution:", margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 4;
        autoTable(doc, {
          startY: curY,
          head: [["Activity", "With deviation", "Without deviation", "Difference"]],
          body: pdfDurRows.map(row => [
            row.activity,
            row.with_deviation != null ? formatSeconds(row.with_deviation) : '—',
            row.without_deviation != null ? formatSeconds(row.without_deviation) : '—',
            row.difference != null ? `${row.difference > 0 ? '+' : ''}${formatSeconds(Math.abs(row.difference))} ${row.difference > 0 ? 'slower' : 'faster'}` : '—',
          ]),
          styles: { fontSize: 6 },
          headStyles: { fillColor: [30, 80, 180] },
          margin: { left: margin + 4 },
          tableWidth: contentW - 4,
        });
        curY = ((doc as any).lastAutoTable?.finalY ?? curY) + 4;
      }

      // Decision rules
      const pdfRulesData = allRulesData[dev];
      const pdfTopRules = (pdfRulesData?.rules ?? []).filter(r => r.precision >= 0.6).slice(0, 5);
      if (pdfTopRules.length > 0) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text("Predictive Rules (precision ≥ 60%):", margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 4;
        pdfTopRules.forEach((rule, ri) => {
          if (curY > 260) { doc.addPage('a4', 'portrait'); curY = 18; }
          const condText = rule.conditions.map(c => {
            if (Math.abs(c.value - 0.5) < 0.1) {
              const lastUs = c.feature.lastIndexOf('_');
              if (lastUs > 0) {
                const orig = c.feature.slice(0, lastUs);
                const cat = c.feature.slice(lastUs + 1);
                return c.op === '>' ? `${orig} = ${cat}` : `${orig} ≠ ${cat}`;
              }
            }
            return `${c.feature} ${c.op} ${c.value}`;
          }).join(' AND ');
          const nLines = bodyText(`Rule ${ri + 1}: ${condText}  (precision ${(rule.precision * 100).toFixed(0)}%, support ${rule.support})`, curY, 8);
          curY += nLines * 4 + 2;
        });
      }

      // Workaround context
      const wa = workaroundMap[dev];
      if (wa) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.text(`Workaround: ${wa.isWorkaround ? "Yes" : "No"}`, margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 5;
        if (wa.isWorkaround) {
          if (wa.actorRoles.length > 0) {
            const nLines = bodyText(`Actor roles: ${wa.actorRoles.join(", ")}`, curY, 8);
            curY += nLines * 4 + 2;
          }
          if (wa.misfit) {
            if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
            const nLines = bodyText(`Misfit: ${wa.misfit}`, curY, 8);
            curY += nLines * 4 + 2;
          }
          if (wa.goal) {
            if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
            const nLines = bodyText(`Goal: ${wa.goal}`, curY, 8);
            curY += nLines * 4 + 2;
          }
          const dimEntries = Object.entries(wa.goalDimensions ?? {});
          if (dimEntries.length > 0) {
            if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
            const dimText = dimEntries.map(([k, v]) => `${k}: ${v}`).join("; ");
            const nLines = bodyText(`Intended effects: ${dimText}`, curY, 8);
            curY += nLines * 4 + 2;
          }
          if (wa.patternType) {
            if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
            bodyText(`Pattern: ${wa.patternType}`, curY, 8);
            curY += 5;
          }
        }
      }

      // Risks & Opportunities
      const risksOpps = issueRisksOpportunities[dev] ?? [];
      if (risksOpps.length > 0) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("Risks & Opportunities:", margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 5;
        autoTable(doc, {
          startY: curY,
          head: [["Type", "Horizon", "Description"]],
          body: risksOpps.map(e => [e.type, e.horizon, e.description]),
          styles: { fontSize: 7 },
          headStyles: { fillColor: [66, 66, 66] },
          margin: { left: margin + 4 },
          tableWidth: contentW - 4,
        });
        curY = ((doc as any).lastAutoTable?.finalY ?? curY) + 4;
      }

      // AI Suggestion
      const suggestion = llmSuggestions[dev];
      if (suggestion) {
        if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("AI Suggestion:", margin + 4, curY);
        doc.setFont("helvetica", "normal");
        curY += 4;
        const nLines = bodyText(suggestion, curY, 8);
        curY += nLines * 4 + 4;
      }

      // Recommendation text
      const rec = reactionItems[dev];
      if (curY > 250) { doc.addPage('a4', 'portrait'); curY = 18; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("Recommendation:", margin + 4, curY);
      doc.setFont("helvetica", "normal");
      curY += 4;
      const nLines = bodyText(rec || "(no recommendation written)", curY, 8);
      curY += nLines * 4 + 8;

      // Separator
      doc.setDrawColor(220, 220, 220);
      doc.line(margin, curY - 2, pageW - margin, curY - 2);
    });

    doc.save("final-report.pdf");
    setPdfExporting(false);
  };

  if (issueList.length === 0) {
    return (
      <Box sx={{ mt: 4 }}>
        <Alert severity="warning">
          No analysis data found. Please complete the full workflow first.
        </Alert>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => navigate("/")}>Back to Start</Button>
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", margin: "0 auto", mt: 4 }}>
      <ScreenInfoBox
        whatYouSee="A consolidated summary of your entire analysis: executive statistics, an issue impact matrix, issue relationship graph, and all recommendations per issue."
        whatToDo="Review the final report. Export it as PDF to share with stakeholders. Use Back to Start to begin a new analysis."
      />

      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h5">Final Report</Typography>
        <Button variant="contained" onClick={exportPDF} disabled={pdfExporting}
  startIcon={pdfExporting ? <CircularProgress size={16} color="inherit" /> : undefined}>
  {pdfExporting ? 'Generating PDF…' : 'Export PDF'}
</Button>
      </Box>

      {/* ── 1. Executive Summary ── */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Executive Summary</Typography>
          <Box display="flex" gap={2} flexWrap="wrap">
            {[
              { label: "Issues analysed", value: issueList.length, color: "#1976d2" },
              { label: "Negative overall impact", value: negativeIssues.length, color: "#c62828" },
              { label: "Positive overall impact", value: positiveIssues.length, color: "#2e7d32" },
              { label: "Causal links defined", value: activeLinks.length, color: "#7b1fa2" },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{ flex: "1 1 140px", textAlign: "center", p: 1.5,
                border: "1px solid #e0e0e0", borderRadius: 1, backgroundColor: "#fafafa" }}>
                <Typography variant="h4" sx={{ color, fontWeight: 700 }}>{value}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{label}</Typography>
              </Box>
            ))}
          </Box>
          {negativeIssues.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" color="error.main" gutterBottom>Issues with negative overall impact:</Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {negativeIssues.map(d => (
                  <Chip key={d} label={d} size="small" color="error" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                ))}
              </Box>
            </Box>
          )}
          {positiveIssues.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="subtitle2" color="success.main" gutterBottom>Issues with positive overall impact:</Typography>
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {positiveIssues.map(d => (
                  <Chip key={d} label={d} size="small" color="success" variant="outlined" sx={{ fontSize: '0.7rem' }} />
                ))}
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Impact Overview Matrix ── */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Typography variant="h6">Issue Impact Overview</Typography>
            <Tooltip title="Each cell shows the criticality label for the measured causal effect of this issue on this dimension. Overall direction aggregates all dimensions." arrow>
              <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ backgroundColor: '#f5f5f5' }}>
                  <TableCell sx={{ fontWeight: 700, fontSize: 11 }}>Issue</TableCell>
                  {dims.map(d => (
                    <TableCell key={d} align="center" sx={{ fontWeight: 700, fontSize: 11 }}>{d.charAt(0).toUpperCase() + d.slice(1)}</TableCell>
                  ))}
                  <TableCell align="center" sx={{ fontWeight: 700, fontSize: 11 }}>Overall</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {issueList.map(dev => {
                  const score = results
                    .filter(r => r.deviation === dev && isFinite(r.ate))
                    .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
                  const dir = overallDir(score);
                  return (
                    <TableRow key={dev}>
                      <TableCell sx={{ fontSize: 11, fontWeight: 600, maxWidth: 200 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 11 }} noWrap title={dev}>
                          {dev.length > 30 ? dev.slice(0, 28) + '…' : dev}
                        </Typography>
                      </TableCell>
                      {dims.map(dim => {
                        const r = results.find(x => x.deviation === dev && x.dimension === dim);
                        const label = r && isFinite(r.ate) ? getCriticality(r.ate, criticalityMap[dim]) : null;
                        return (
                          <TableCell key={dim} align="center"
                            sx={{ fontSize: 10, backgroundColor: label ? critColor(label) : undefined,
                              color: label && ['very positive','very negative'].includes(label) ? '#fff' : '#333',
                              fontWeight: 600 }}>
                            {label ?? '–'}
                          </TableCell>
                        );
                      })}
                      <TableCell align="center">
                        <Chip
                          label={dir}
                          size="small"
                          color={dir === 'negative' ? 'error' : dir === 'positive' ? 'success' : 'default'}
                          sx={{ fontSize: '0.65rem', fontWeight: 700 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Box>
        </CardContent>
      </Card>

      {/* ── 3. Issue Relationship Graph ── */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <AccountTreeIcon sx={{ color: '#7b1fa2', fontSize: 20 }} />
            <Typography variant="h6">Issue Relationships</Typography>
            {activeLinks.length > 0 && (
              <Chip label={`${activeLinks.length} link(s)`} size="small" variant="outlined"
                sx={{ fontSize: '0.65rem', borderColor: '#ce93d8', color: '#7b1fa2' }} />
            )}
          </Box>
          {activeLinks.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              No causal relationships defined. You can add them on the Recommendations screen.
            </Typography>
          ) : (
            <>
              <ReadOnlyGraph issues={issueList} links={activeLinks} />
              <Box mt={1.5} display="flex" flexDirection="column" gap={0.5}>
                {activeLinks.map(link => (
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
                  </Box>
                ))}
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── 4. Process Model Overview (BPMN mode) ── */}
      {bpmnXml && (() => {
        // Build highlight list: one entry per activity, colored by overall direction
        const highlights: { activity: string; color: string; bg: string }[] = [];
        issueList.forEach(dev => {
          const score = results
            .filter(r => r.deviation === dev && isFinite(r.ate))
            .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
          const dir = overallDir(score);
          const color = dir === 'negative' ? '#f57c00' : dir === 'positive' ? '#2e7d32' : '#9e9e9e';
          const bg = dir === 'negative' ? 'rgba(245,124,0,0.15)' : dir === 'positive' ? 'rgba(46,125,50,0.15)' : 'rgba(158,158,158,0.12)';

          // Find original deviation columns for this issue
          const cols = Object.entries(deviationIssueMap)
            .filter(([, name]) => name === dev).map(([col]) => col);
          const toParse = cols.length > 0 ? cols : [dev];
          toParse.forEach(col => {
            const skip = col.match(/^\(Skip (.+)\)$/);
            if (skip) { highlights.push({ activity: skip[1], color, bg }); return; }
            const insert = col.match(/^\(Insert (.+)\)$/);
            if (insert) highlights.push({ activity: insert[1], color, bg });
          });
        });

        return (
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Box display="flex" alignItems="center" gap={1} mb={1}>
                <MapIcon sx={{ color: '#7b1fa2', fontSize: 20 }} />
                <Typography variant="h6">Process Model — Deviation Overview</Typography>
                <Tooltip title="All deviation activities are overlaid on the process model, colored by their overall impact direction." arrow>
                  <IconButton size="small"><InfoIcon fontSize="small" color="action" /></IconButton>
                </Tooltip>
              </Box>
              <Box display="flex" gap={1} mb={1} flexWrap="wrap">
                <Chip size="small" label="■ Negative impact" sx={{ fontSize: '0.62rem', background: 'rgba(245,124,0,0.15)', color: '#f57c00', border: '1px solid #f57c00' }} />
                <Chip size="small" label="■ Positive impact" sx={{ fontSize: '0.62rem', background: 'rgba(46,125,50,0.15)', color: '#2e7d32', border: '1px solid #2e7d32' }} />
                <Chip size="small" label="■ Neutral" sx={{ fontSize: '0.62rem', background: 'rgba(158,158,158,0.12)', color: '#757575', border: '1px solid #9e9e9e' }} />
              </Box>
              <Box sx={{ width: '100%', height: 420, border: '1px solid #eee', borderRadius: 1, overflow: 'hidden' }}>
                <BpmnOverviewViewer xml={bpmnXml} highlights={highlights} />
              </Box>
            </CardContent>
          </Card>
        );
      })()}

      {/* ── 5. Per-Issue Detail ── */}
      <Card variant="outlined" sx={{ mb: 3 }}>
        <CardContent>
          <Box display="flex" alignItems="center" gap={1} mb={1}>
            <Typography variant="h6">Per-Issue Detail</Typography>
            {rulesLoading && <CircularProgress size={14} />}
          </Box>
          {issueList.map((dev, idx) => {
            const rec = reactionItems[dev];
            const suggestion = llmSuggestions[dev];
            const score = results
              .filter(r => r.deviation === dev && isFinite(r.ate))
              .reduce((acc, r) => acc + critWeight(getCriticality(r.ate, criticalityMap[r.dimension])), 0);
            const dir = overallDir(score);
            const borderColor = dir === 'negative' ? '#f57c00' : dir === 'positive' ? '#66bb6a' : '#bdbdbd';
            const workaround = workaroundMap[dev];
            const risksOpps = issueRisksOpportunities[dev] ?? [];

            // Trace length
            const g0 = matrixRows.filter((r: any) => r[dev] === 0);
            const g1 = matrixRows.filter((r: any) => r[dev] === 1);
            const avgLen0 = g0.length > 0
              ? (g0.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g0.length).toFixed(1)
              : null;
            const avgLen1 = g1.length > 0
              ? (g1.reduce((s: number, r: any) => s + (Array.isArray(r.activities) ? r.activities.length : 0), 0) / g1.length).toFixed(1)
              : null;

            // Activity lift (top 5 by absolute deviation from 1)
            const allActivities = new Set<string>();
            matrixRows.forEach((r: any) => { if (Array.isArray(r.activities)) r.activities.forEach((a: string) => allActivities.add(a)); });
            const eps = 1e-9;
            const lifts = Array.from(allActivities).map(act => {
              const rWith = g1.length > 0 ? g1.filter((r: any) => Array.isArray(r.activities) && r.activities.includes(act)).length / g1.length : 0;
              const rWithout = g0.length > 0 ? g0.filter((r: any) => Array.isArray(r.activities) && r.activities.includes(act)).length / g0.length : 0;
              return { act, lift: rWith / (rWithout + eps) };
            }).sort((a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1)).slice(0, 5);

            // Duration contributions
            const durRows = durationContributions?.[dev] ?? [];

            // Decision rules
            const rulesData = allRulesData[dev];
            const topRules = (rulesData?.rules ?? []).filter(r => r.precision >= 0.6).slice(0, 5);
            const condLabel = (c: DevRule['conditions'][0]): string => {
              if (Math.abs(c.value - 0.5) < 0.1) {
                const lastUs = c.feature.lastIndexOf('_');
                if (lastUs > 0) {
                  const origCol = c.feature.slice(0, lastUs);
                  const cat = c.feature.slice(lastUs + 1);
                  return c.op === '>' ? `${origCol} = ${cat}` : `${origCol} ≠ ${cat}`;
                }
              }
              return `${c.feature} ${c.op} ${c.value}`;
            };

            return (
              <Box key={dev} sx={{ mb: 3, pl: 1.5, borderLeft: `4px solid ${borderColor}` }}>
                {/* Header */}
                <Box display="flex" alignItems="center" gap={1} mb={0.75}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {idx + 1}. {dev}
                  </Typography>
                  {workaround?.isWorkaround && (
                    <Chip label="Workaround" size="small"
                      sx={{ fontSize: '0.62rem', background: '#e3f2fd', color: '#1565c0' }} />
                  )}
                  <Chip
                    label={`Overall: ${dir}`}
                    color={dir === 'negative' ? 'error' : dir === 'positive' ? 'success' : 'default'}
                    size="small" sx={{ fontWeight: 700 }}
                  />
                  {g1.length > 0 && (
                    <Chip label={`${g1.length} deviant / ${g0.length} conformant traces`} size="small" variant="outlined" sx={{ fontSize: '0.62rem' }} />
                  )}
                </Box>

                {/* Per-issue process model (BPMN mode) */}
                {bpmnXml && (() => {
                  const cols = Object.entries(deviationIssueMap)
                    .filter(([, name]) => name === dev).map(([col]) => col);
                  const toParse = cols.length > 0 ? cols : [dev];
                  const issueHighlights: { activity: string; color: string; bg: string }[] = [];
                  toParse.forEach(col => {
                    const skip = col.match(/^\(Skip (.+)\)$/);
                    if (skip) { issueHighlights.push({ activity: skip[1], color: '#e65100', bg: 'rgba(230,81,0,0.18)' }); return; }
                    const insert = col.match(/^\(Insert (.+)\)$/);
                    if (insert) issueHighlights.push({ activity: insert[1], color: '#1565c0', bg: 'rgba(21,101,192,0.15)' });
                  });
                  if (issueHighlights.length === 0) return null;
                  return (
                    <Box sx={{ mb: 1.5 }}>
                      <Box display="flex" gap={0.75} mb={0.5} flexWrap="wrap">
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, alignSelf: 'center' }}>Process Model Position</Typography>
                        {issueHighlights.map(h => (
                          <Chip key={h.activity} size="small"
                            label={toParse.find(c => c.match(/^\(Skip /)) ? `Skip: ${h.activity}` : `Insert: ${h.activity}`}
                            sx={{ fontSize: '0.62rem', background: h.bg, color: h.color, border: `1px solid ${h.color}` }} />
                        ))}
                      </Box>
                      <Box sx={{ width: '100%', height: 220, border: '1px solid #eee', borderRadius: 1, overflow: 'hidden' }}>
                        <BpmnOverviewViewer xml={bpmnXml} highlights={issueHighlights} />
                      </Box>
                    </Box>
                  );
                })()}

                {/* Causal Effects */}
                {results.filter(r => r.deviation === dev && isFinite(r.ate)).length > 0 && (
                  <Box sx={{ mb: 1.5, overflowX: 'auto' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>Causal Effects (ATE)</Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontSize: 11, fontWeight: 700 }}>Dimension</TableCell>
                          <TableCell align="right" sx={{ fontSize: 11, fontWeight: 700 }}>ATE</TableCell>
                          <TableCell align="right" sx={{ fontSize: 11, fontWeight: 700 }}>Criticality</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {results.filter(r => r.deviation === dev && isFinite(r.ate)).map(r => {
                          const label = getCriticality(r.ate, criticalityMap[r.dimension]);
                          return (
                            <TableRow key={r.dimension}>
                              <TableCell sx={{ fontSize: 11 }}>{r.dimension.charAt(0).toUpperCase() + r.dimension.slice(1)}</TableCell>
                              <TableCell align="right" sx={{ fontSize: 11 }}>{r.ate.toFixed(4)}</TableCell>
                              <TableCell align="right" sx={{ fontSize: 11, backgroundColor: label ? critColor(label) : undefined, color: label && ['very positive','very negative'].includes(label) ? '#fff' : '#333', fontWeight: 600 }}>{label ?? '–'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                )}

                {/* Trace Length */}
                {avgLen0 != null && avgLen1 != null && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Mean trace length: <strong>{avgLen1} activities</strong> (deviant) vs. <strong>{avgLen0} activities</strong> (conformant)
                  </Typography>
                )}

                {/* Activity Lift */}
                {lifts.length > 0 && (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>Activity Lift (top 5)</Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontSize: 10 }}>Activity</TableCell>
                            <TableCell align="right" sx={{ fontSize: 10 }}>Lift</TableCell>
                            <TableCell align="right" sx={{ fontSize: 10 }}>Interpretation</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {lifts.map(({ act, lift }) => (
                            <TableRow key={act}>
                              <TableCell sx={{ fontSize: 10 }}>{act}</TableCell>
                              <TableCell align="right" sx={{ fontSize: 10, fontWeight: 600, color: lift > 1 ? '#f57c00' : '#1976d2' }}>{lift > 5 ? '>5×' : `${lift.toFixed(2)}×`}</TableCell>
                              <TableCell align="right" sx={{ fontSize: 10, color: 'text.secondary' }}>{lift > 1.2 ? 'more common in deviant' : lift < 0.8 ? 'less common in deviant' : 'similar in both'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Box>
                )}

                {/* Duration Contributions */}
                {durRows.length > 0 && (
                  <Box sx={{ mb: 1.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>Activity Duration Contribution</Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontSize: 10 }}>Activity</TableCell>
                            <TableCell align="right" sx={{ fontSize: 10 }}>With deviation</TableCell>
                            <TableCell align="right" sx={{ fontSize: 10 }}>Without deviation</TableCell>
                            <TableCell align="right" sx={{ fontSize: 10 }}>Difference</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {durRows.map(row => {
                            const diff = row.difference;
                            return (
                              <TableRow key={row.activity}>
                                <TableCell sx={{ fontSize: 10 }}>{row.activity}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 10 }}>{row.with_deviation != null ? formatSeconds(row.with_deviation) : '—'}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 10 }}>{row.without_deviation != null ? formatSeconds(row.without_deviation) : '—'}</TableCell>
                                <TableCell align="right" sx={{ fontSize: 10, fontWeight: diff != null ? 600 : undefined, color: diff == null ? undefined : diff > 0 ? '#c62828' : '#1565c0' }}>
                                  {diff != null ? `${diff > 0 ? '+' : ''}${formatSeconds(Math.abs(diff))} ${diff > 0 ? 'slower' : 'faster'}` : '—'}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Box>
                  </Box>
                )}

                {/* Decision Rules */}
                {topRules.length > 0 && (
                  <Box sx={{ mb: 1.5, p: 1.25, borderRadius: 1, backgroundColor: 'rgba(126,87,194,0.04)', border: '1px solid rgba(126,87,194,0.2)' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>Predictive Rules (precision ≥ 0.6)</Typography>
                    {topRules.map((rule, i) => (
                      <Box key={i} sx={{ mb: 0.75, fontSize: 11 }}>
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>Rule {i + 1}:</Typography>
                        <Typography variant="caption" sx={{ ml: 0.5 }}>{rule.conditions.map(condLabel).join(' AND ')}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>— precision {(rule.precision * 100).toFixed(0)}%, support {rule.support}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}

                {/* Workaround */}
                {workaround?.isWorkaround && (
                  <Box sx={{ mb: 1, p: 1, background: '#e3f2fd', borderRadius: 1, border: '1px solid #90caf9' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>Workaround Context</Typography>
                    {workaround.actorRoles.length > 0 && <Typography variant="caption" display="block">Actor: {workaround.actorRoles.join(', ')}</Typography>}
                    {workaround.misfit && <Typography variant="caption" display="block">Misfit: {workaround.misfit}</Typography>}
                    {workaround.goal && <Typography variant="caption" display="block">Goal: {workaround.goal}</Typography>}
                    {Object.entries(workaround.goalDimensions ?? {}).length > 0 && (
                      <Typography variant="caption" display="block">
                        Intended effects: {Object.entries(workaround.goalDimensions ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ')}
                      </Typography>
                    )}
                  </Box>
                )}

                {/* Risks & Opportunities */}
                {risksOpps.length > 0 && (
                  <Box display="flex" flexWrap="wrap" gap={0.5} mb={0.75}>
                    {risksOpps.map(e => (
                      <Chip key={e.id} size="small"
                        label={`${e.type === 'risk' ? '⚠' : '✓'} ${e.description}`}
                        sx={{ fontSize: '0.65rem', maxWidth: 300,
                          background: e.type === 'risk' ? 'rgba(211,47,47,0.07)' : 'rgba(56,142,60,0.07)',
                          color: e.type === 'risk' ? '#c62828' : '#2e7d32' }} />
                    ))}
                  </Box>
                )}

                {/* AI Suggestion */}
                {suggestion && (
                  <Box sx={{ mb: 0.75, p: 1, backgroundColor: '#f3e5f5', borderLeft: '3px solid #9c27b0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#6a0080', display: 'block' }}>AI Suggestion</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{suggestion}</Typography>
                  </Box>
                )}

                {/* Recommendation */}
                {rec ? (
                  <Box sx={{ p: 1, background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: '#1565c0', display: 'block', mb: 0.25 }}>Recommendation</Typography>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{rec}</Typography>
                  </Box>
                ) : (
                  <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic', fontSize: 12 }}>
                    No recommendation written.
                  </Typography>
                )}
              </Box>
            );
          })}
        </CardContent>
      </Card>

      <Divider sx={{ my: 2 }} />
      <Box display="flex" justifyContent="center" gap={2}>
        <Button variant="contained" onClick={exportPDF} size="large">Export PDF</Button>
        <Button variant="outlined" onClick={() => navigate("/recommendations", {
          state: location.state,
        })}>
          Back to Recommendations
        </Button>
      </Box>
    </Box>
  );
};

export default FinalReport;

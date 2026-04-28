import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Stack,
  TextField,
  Paper,
  CircularProgress,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  FormControlLabel,
  Checkbox,
  Slider,
  Tooltip,
  IconButton,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';
import { useNavigate } from 'react-router-dom';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useBottomNav } from './BottomNavContext';
import { useFileContext, ConformanceMode } from './FileContext';
import ScreenInfoBox from './ScreenInfoBox';

const API_URL = process.env.REACT_APP_API_URL || "http://localhost:1965";

const WelcomePage: React.FC = () => {
  const [mode, setMode] = useState<ConformanceMode>('bpmn');
  const [declSubMode, setDeclSubMode] = useState<'mine' | 'upload'>('mine');
  const [bpmnSubMode, setBpmnSubMode] = useState<'upload' | 'mine'>('upload');
  const [miningAlgorithm, setMiningAlgorithm] = useState<'inductive_infrequent' | 'heuristics' | 'alpha'>('inductive_infrequent');
  const [noiseThreshold, setNoiseThreshold] = useState<number>(0.2);
  const [bpmnFile, setBpmnFile] = useState<Blob | null>(null);
  const [bpmnFileName, setBpmnFileName] = useState<string>('');
  const [xesFile, setXesFile] = useState<Blob | null>(null);
  const [xesFileName, setXesFileName] = useState<string>('');
  const [declFile, setDeclFile] = useState<Blob | null>(null);
  const [declFileName, setDeclFileName] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [miningPhase, setMiningPhase] = useState<'mining' | 'computing' | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Declarative-specific state
  const [availableTemplates, setAvailableTemplates] = useState<string[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<string[]>([]);
  const [minSupport, setMinSupport] = useState<number>(0.1);
  const [minedDeclFilename, setMinedDeclFilename] = useState<string | null>(null);

  const navigate = useNavigate();
  const { setContinue, setHideBack } = useBottomNav();
  const { resetAll, setConformanceMode } = useFileContext();

  useEffect(() => {
    setHideBack(true);
    return () => setHideBack(false);
  }, [setHideBack]);

  useEffect(() => {
    if (isReady) {
      setContinue({ label: "Next", onClick: () => navigate('/log-quality') });
    } else {
      setContinue(null);
    }
    return () => setContinue(null);
  }, [isReady, navigate, setContinue]);

  const [backendReady, setBackendReady] = useState(false);

  // Poll until backend is reachable, then fetch templates
  useEffect(() => {
    let cancelled = false;
    const tryFetch = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${API_URL}/api/available-templates`);
          const data = await res.json();
          if (!cancelled) {
            setAvailableTemplates(data.templates || []);
            setSelectedTemplates(data.templates || []);
            setBackendReady(true);
          }
          return;
        } catch {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    };
    tryFetch();
    return () => { cancelled = true; };
  }, []);

  const handleFileChange = (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      setBlob: React.Dispatch<React.SetStateAction<Blob | null>>,
      setName: React.Dispatch<React.SetStateAction<string>>,
    ) => {
      const target = event.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        const file = target.files[0];
        setName(file.name);
        // Read into memory immediately so Chrome can't detect on-disk changes later
        file.arrayBuffer().then(buf => setBlob(new Blob([buf], { type: file.type })));
      }
    };

  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: ConformanceMode | null) => {
    if (newMode) {
      setMode(newMode);
      setIsReady(false);
      setErrorMsg(null);
    }
  };

  const handleDeclSubModeChange = (_: React.MouseEvent<HTMLElement>, newSub: 'mine' | 'upload' | null) => {
    if (newSub) {
      setDeclSubMode(newSub);
      setIsReady(false);
      setErrorMsg(null);
    }
  };

  const handleBpmnSubModeChange = (_: React.MouseEvent<HTMLElement>, newSub: 'upload' | 'mine' | null) => {
    if (newSub) {
      setBpmnSubMode(newSub);
      setIsReady(false);
      setErrorMsg(null);
    }
  };

  const handleTemplateToggle = (template: string) => {
    setSelectedTemplates(prev =>
      prev.includes(template)
        ? prev.filter(t => t !== template)
        : [...prev, template]
    );
  };

  const allSelected = availableTemplates.length > 0 && availableTemplates.every(t => selectedTemplates.includes(t));

  const handleSelectAll = () => {
    if (allSelected) {
      setSelectedTemplates([]);
    } else {
      setSelectedTemplates([...availableTemplates]);
    }
  };

  const handleUpload = async () => {
    if (mode === 'bpmn' && bpmnSubMode === 'upload') {
      if (!bpmnFile || !xesFile) return;
    } else if (mode === 'bpmn' && bpmnSubMode === 'mine') {
      if (!xesFile) return;
    } else if (mode === 'declarative' && declSubMode === 'upload') {
      if (!xesFile || !declFile) return;
    } else {
      if (!xesFile) return;
    }

    resetAll();
    setIsProcessing(true);
    setIsReady(false);
    setErrorMsg(null);
    let keepSpinner = false;

    // Reset backend cache before uploading
    try {
      await fetch(`${API_URL}/api/reset`, { method: 'POST' });
    } catch (e) {
      console.warn("Failed to reset backend cache:", e);
    }

    try {
      if (mode === 'bpmn' && bpmnSubMode === 'upload') {
        const formData = new FormData();
        formData.append('bpmn', bpmnFile!, bpmnFileName);
        formData.append('xes', xesFile!, xesFileName);

        const response = await fetch(`${API_URL}/upload`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        console.log("Upload response:", data);

        if (response.ok) {
          setConformanceMode('bpmn');
          setIsReady(true);
        } else {
          const msg = data.error || "Upload failed";
          console.error("Upload failed:", msg);
          if (data.traceback) console.error("Backend traceback:\n", data.traceback);
          setErrorMsg(msg);
        }
      } else if (mode === 'bpmn' && bpmnSubMode === 'mine') {
        const formData = new FormData();
        formData.append('xes', xesFile!, xesFileName);
        formData.append('algorithm', miningAlgorithm);
        formData.append('noise_threshold', String(noiseThreshold));

        const response = await fetch(`${API_URL}/upload-mine-model`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        console.log("Mine-model response:", data);

        if (response.ok) {
          setConformanceMode('bpmn');
          // Mining + alignments run fully in the background. Poll until ready.
          setMiningPhase('mining');
          const pollInterval = setInterval(async () => {
            try {
              const statusRes = await fetch(`${API_URL}/api/alignment-status`);
              const { status, error } = await statusRes.json();
              if (status === 'ready') {
                clearInterval(pollInterval);
                setMiningPhase(null);
                setIsReady(true);
                setIsProcessing(false);
              } else if (status === 'error') {
                clearInterval(pollInterval);
                setMiningPhase(null);
                setErrorMsg(error || 'Process mining failed');
                setIsProcessing(false);
              } else if (status === 'computing') {
                setMiningPhase('computing');
              } else {
                setMiningPhase('mining');
              }
            } catch (e) {
              console.warn("Polling error:", e);
            }
          }, 2000);
          // Spinner stays alive; finally block must not clear it
          keepSpinner = true;
          return;
        } else {
          const msg = data.error || "Model mining failed";
          console.error("Mining failed:", msg);
          if (data.traceback) console.error("Backend traceback:\n", data.traceback);
          setErrorMsg(msg);
        }
      } else if (mode === 'declarative' && declSubMode === 'upload') {
        // Declarative model upload mode
        const formData = new FormData();
        formData.append('xes', xesFile!, xesFileName);
        formData.append('decl', declFile!, declFileName);

        const response = await fetch(`${API_URL}/upload-declarative-model`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        console.log("Declarative model upload response:", data);

        if (response.ok) {
          setConformanceMode('declarative-model');
          setIsReady(true);
        } else {
          const msg = data.error || "Upload failed";
          console.error("Upload failed:", msg);
          if (data.traceback) console.error("Backend traceback:\n", data.traceback);
          setErrorMsg(msg);
        }
      } else {
        // Declarative mine-from-log mode
        const formData = new FormData();
        formData.append('xes', xesFile!, xesFileName);
        formData.append('templates', JSON.stringify(selectedTemplates));
        formData.append('min_support', String(minSupport));

        const response = await fetch(`${API_URL}/upload-declarative`, {
          method: "POST",
          body: formData,
        });

        const data = await response.json();
        console.log("Declarative upload response:", data);

        if (response.ok) {
          setConformanceMode('declarative');
          if (data.decl_filename) setMinedDeclFilename(data.decl_filename);
          setIsReady(true);
        } else {
          const msg = data.error || "Upload failed";
          console.error("Upload failed:", msg);
          if (data.traceback) console.error("Backend traceback:\n", data.traceback);
          setErrorMsg(msg);
        }
      }
    } catch (error) {
      console.error("Upload error:", error);
      setErrorMsg(String(error));
    } finally {
      if (!keepSpinner) setIsProcessing(false);
    }
  };

  const canUpload = mode === 'bpmn' && bpmnSubMode === 'upload'
    ? (!!bpmnFile && !!xesFile && !isProcessing)
    : mode === 'bpmn' && bpmnSubMode === 'mine'
      ? (!!xesFile && !isProcessing)
      : mode === 'declarative' && declSubMode === 'upload'
        ? (!!xesFile && !!declFile && !isProcessing)
        : (!!xesFile && selectedTemplates.length > 0 && !isProcessing);

  if (!backendReady) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 2 }}>
        <CircularProgress />
        <Typography color="text.secondary">Connecting to backend...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 800, margin: '0 auto', textAlign: 'center', p: 4 }}>
      <Box display="flex" alignItems="center" justifyContent="center" mb={1}>
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          Conformance Analysis
        </Typography>
        <Tooltip
          title="Upload your event log and process model to begin conformance analysis. You have four options:
1. Trace Alignment — Upload Model: Upload a BPMN/PNML process model and an event log. Deviations are identified by aligning each trace to the model.
2. Trace Alignment — Mine Model: Upload an event log only. A process model is automatically discovered (IMf, Heuristics, or Alpha Miner) and used for trace alignment.
3. Declarative — Mine from Log: Upload an event log only. A declarative model is mined using DECLARE templates; select constraint types and a minimum support threshold.
4. Declarative — Upload Model: Upload an event log and a .decl model file. Conformance is checked against the uploaded model."
          arrow
          placement="right"
        >
          <IconButton size="small" sx={{ ml: 1 }}>
            <InfoIcon fontSize="small" color="action" />
          </IconButton>
        </Tooltip>
      </Box>

      <ScreenInfoBox
        whatYouSee={
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {[
              ['Trace Alignment — Upload Model', 'Upload a BPMN or PNML process model + an event log. Deviations are found by aligning each trace to the model (skipped and inserted activities).'],
              ['Trace Alignment — Mine Model', 'Upload an event log only. A process model is automatically discovered (Inductive Miner, Heuristics, or Alpha Miner) and used for trace alignment.'],
              ['Declarative — Mine from Log', 'Upload an event log only. A declarative DECLARE model is mined. Choose constraint templates and a minimum support threshold.'],
              ['Declarative — Upload Model', 'Upload an event log + a pre-existing .decl model file. Conformance is checked against the uploaded constraints.'],
            ].map(([title, desc]) => (
              <Typography key={title} component="li" variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                <strong>{title}:</strong> {desc}
              </Typography>
            ))}
          </Box>
        }
        whatToDo="Select a conformance mode, upload the required files, and click Upload & Compute. Once processing completes and deviations are detected, the Next button will become active."
        example={
          mode === 'declarative' ? (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>Example DECLARE constraint violation:</Typography>
              <Box sx={{ p: 1, background: '#f5f5f5', borderRadius: 1, fontSize: 11, fontFamily: 'monospace', mb: 0.75 }}>
                {'Constraint: Response(Submit Application, Approve)\n'}
                {'Meaning:    After "Submit Application", "Approve" must eventually occur\n'}
                {'Violation:  Case-042 — "Submit Application" occurred but "Approve" never followed\n'}
                {'            → 38 cases affected (12% of log)'}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Declarative constraints capture expected ordering and co-occurrence rules. Violations indicate cases where the rule was not satisfied.
              </Typography>
            </Box>
          ) : (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75, color: '#5d4037' }}>
                Example: Trace alignment against a process model
              </Typography>

              {/* Mini BPMN process model */}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Process model:</Typography>
              <Box sx={{ overflowX: 'auto', mb: 1.5, borderRadius: 1, border: '1px solid #e0e0e0', background: '#fafafa', p: 1 }}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 462 58" width="462" height="58" style={{ display: 'block' }}>
                  <defs>
                    <marker id="ex-arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="#888"/>
                    </marker>
                  </defs>
                  {/* Start */}
                  <circle cx="16" cy="29" r="10" fill="#4caf50"/>
                  <line x1="26" y1="29" x2="35" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ex-arr)"/>
                  {/* Register */}
                  <rect x="36" y="14" width="82" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="77" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Register</text>
                  <line x1="118" y1="29" x2="127" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ex-arr)"/>
                  {/* Validate */}
                  <rect x="128" y="14" width="82" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="169" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Validate</text>
                  <line x1="210" y1="29" x2="219" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ex-arr)"/>
                  {/* Approve */}
                  <rect x="220" y="14" width="82" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="261" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Approve</text>
                  <line x1="302" y1="29" x2="311" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ex-arr)"/>
                  {/* Close */}
                  <rect x="312" y="14" width="82" height="30" rx="4" fill="#fff" stroke="#bdbdbd" strokeWidth="1.5"/>
                  <text x="353" y="33" textAnchor="middle" fontSize="10" fill="#333" fontFamily="sans-serif">Close</text>
                  <line x1="394" y1="29" x2="403" y2="29" stroke="#888" strokeWidth="1.5" markerEnd="url(#ex-arr)"/>
                  {/* End */}
                  <circle cx="416" cy="29" r="10" fill="none" stroke="#333" strokeWidth="3"/>
                  <circle cx="416" cy="29" r="5" fill="#333"/>
                </svg>
              </Box>

              {/* Alignment results */}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Alignment results per case:</Typography>

              {/* Case 017 — skip */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#c62828', display: 'block', mb: 0.4 }}>
                  Case-017 — Skip detected (Validate missing from trace)
                </Typography>
                <Box sx={{ display: 'flex', gap: '3px' }}>
                  {([
                    { label: 'Register', type: 'sync' },
                    { label: 'Validate', type: 'skip' },
                    { label: 'Approve', type: 'sync' },
                    { label: 'Close', type: 'sync' },
                  ] as { label: string; type: string }[]).map((m, i) => (
                    <Box key={i} sx={{
                      flex: 1, border: '1px solid',
                      borderColor: m.type === 'sync' ? '#a5d6a7' : '#ef9a9a',
                      borderRadius: 1,
                      background: m.type === 'sync' ? '#f1f8e9' : '#fce4ec',
                      p: '4px 2px', textAlign: 'center',
                    }}>
                      <Typography variant="caption" sx={{ fontSize: 9.5, fontWeight: 600, display: 'block',
                        color: m.type === 'sync' ? '#2e7d32' : '#c62828',
                        textDecoration: m.type === 'skip' ? 'line-through' : 'none' }}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 8.5, display: 'block',
                        color: m.type === 'sync' ? '#388e3c' : '#e53935' }}>
                        {m.type === 'sync' ? 'sync' : '↑ SKIP'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              {/* Case 031 — insert */}
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600, color: '#1565c0', display: 'block', mb: 0.4 }}>
                  Case-031 — Insertion detected (Review not in model)
                </Typography>
                <Box sx={{ display: 'flex', gap: '3px' }}>
                  {([
                    { label: 'Register', type: 'sync' },
                    { label: 'Validate', type: 'sync' },
                    { label: 'Review', type: 'insert' },
                    { label: 'Approve', type: 'sync' },
                    { label: 'Close', type: 'sync' },
                  ] as { label: string; type: string }[]).map((m, i) => (
                    <Box key={i} sx={{
                      flex: 1, border: '1px solid',
                      borderColor: m.type === 'sync' ? '#a5d6a7' : '#90caf9',
                      borderRadius: 1,
                      background: m.type === 'sync' ? '#f1f8e9' : '#e3f2fd',
                      p: '4px 2px', textAlign: 'center',
                    }}>
                      <Typography variant="caption" sx={{ fontSize: 9.5, fontWeight: 600, display: 'block',
                        color: m.type === 'sync' ? '#2e7d32' : '#1565c0' }}>
                        {m.label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: 8.5, display: 'block',
                        color: m.type === 'sync' ? '#388e3c' : '#1976d2' }}>
                        {m.type === 'sync' ? 'sync' : '↓ INSERT'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                Green = synchronous move (model and trace agree). Red = skip (required by model, absent from trace). Blue = insertion (in trace but not in model).
              </Typography>
            </Box>
          )
        }
      />

      <Stack spacing={3}>
        {/* Mode Toggle */}
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          fullWidth
          sx={{ mb: 1 }}
        >
          <ToggleButton value="bpmn">Trace Alignment</ToggleButton>
          <ToggleButton value="declarative">Declarative Conformance Checking</ToggleButton>
        </ToggleButtonGroup>

        {/* Declarative sub-mode selection */}
        {mode === 'declarative' && (
          <Paper sx={{ p: 2, backgroundColor: '#f9f9f9' }}>
            <Typography variant="subtitle2" gutterBottom color="text.secondary">
              Choose declarative approach:
            </Typography>
            <ToggleButtonGroup
              value={declSubMode}
              exclusive
              onChange={handleDeclSubModeChange}
              fullWidth
              size="small"
            >
              <ToggleButton value="mine">
                Mine Model from Log
              </ToggleButton>
              <ToggleButton value="upload">
                Upload .decl Model
              </ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {declSubMode === 'mine'
                ? "A declarative model will be automatically mined from your event log using DECLARE templates."
                : "Upload a pre-existing .decl model and check your event log for conformance against it."}
            </Typography>
          </Paper>
        )}

        {/* Trace Alignment sub-mode selection */}
        {mode === 'bpmn' && (
          <Paper sx={{ p: 2, backgroundColor: '#f9f9f9' }}>
            <Typography variant="subtitle2" gutterBottom color="text.secondary">
              Process model source:
            </Typography>
            <ToggleButtonGroup
              value={bpmnSubMode}
              exclusive
              onChange={handleBpmnSubModeChange}
              fullWidth
              size="small"
            >
              <ToggleButton value="upload">Upload Process Model</ToggleButton>
              <ToggleButton value="mine">Mine Model from Log</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {bpmnSubMode === 'upload'
                ? "Upload a BPMN or PNML process model and an event log. Deviations are computed via trace alignment."
                : "A process model is automatically discovered from your event log using the selected algorithm, then used for trace alignment."}
            </Typography>
          </Paper>
        )}

        {/* BPMN upload sub-mode: model file */}
        {mode === 'bpmn' && bpmnSubMode === 'upload' && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Upload Process Model</Typography>
            <TextField
              type="file"
              inputProps={{ accept: '.bpmn,.pnml' }}
              onChange={(e) => handleFileChange(e, setBpmnFile, setBpmnFileName)}
              fullWidth
            />
          </Paper>
        )}

        {/* BPMN mine sub-mode: algorithm selection */}
        {mode === 'bpmn' && bpmnSubMode === 'mine' && (
          <Paper sx={{ p: 3, textAlign: 'left' }}>
            <Typography variant="h6" gutterBottom>Discovery Algorithm</Typography>
            <ToggleButtonGroup
              value={miningAlgorithm}
              exclusive
              onChange={(_, v) => v && setMiningAlgorithm(v)}
              fullWidth
              size="small"
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value="inductive_infrequent">Inductive Miner Infrequent</ToggleButton>
              <ToggleButton value="heuristics">Heuristics Miner</ToggleButton>
              <ToggleButton value="alpha">Alpha Miner</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              {miningAlgorithm === 'inductive_infrequent' && "Inductive Miner Infrequent (IMf): filters infrequent behaviour below the noise threshold before discovery. Guarantees a sound, block-structured model."}
              {miningAlgorithm === 'heuristics' && "Heuristics Miner: dependency-graph-based discovery; more robust to noise. Does not guarantee soundness."}
              {miningAlgorithm === 'alpha' && "Alpha Miner: classic algorithm based on ordering relations. Sensitive to noise; does not handle loops or short-loops well."}
            </Typography>
            {(miningAlgorithm === 'inductive_infrequent') && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" gutterBottom>
                  Noise threshold: <strong>{noiseThreshold.toFixed(2)}</strong>
                  <Tooltip title="Fraction of traces that can be filtered as infrequent behaviour. Higher = more filtering, simpler model." arrow>
                    <IconButton size="small" sx={{ ml: 0.5 }}><InfoIcon sx={{ fontSize: 14 }} /></IconButton>
                  </Tooltip>
                </Typography>
                <Slider
                  value={noiseThreshold}
                  onChange={(_, v) => setNoiseThreshold(v as number)}
                  min={0.0}
                  max={0.5}
                  step={0.05}
                  valueLabelDisplay="auto"
                  marks
                />
              </Box>
            )}
          </Paper>
        )}

        {/* Event log upload (all modes) */}
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6">Upload Event Log</Typography>
          <TextField
            type="file"
            inputProps={{ accept: '.xes,.csv,.xes.gz' }}
            onChange={(e) => handleFileChange(e, setXesFile, setXesFileName)}
            fullWidth
          />
        </Paper>

        {/* Declarative upload mode: .decl model file */}
        {mode === 'declarative' && declSubMode === 'upload' && (
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6">Upload Declarative Model</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Upload a .decl file containing DECLARE constraints.
            </Typography>
            <TextField
              type="file"
              inputProps={{ accept: '.decl' }}
              onChange={(e) => handleFileChange(e, setDeclFile, setDeclFileName)}
              fullWidth
            />
          </Paper>
        )}

        {/* Declarative mine mode: template selection + min_support */}
        {mode === 'declarative' && declSubMode === 'mine' && (
          <>
            <Paper sx={{ p: 3, textAlign: 'left' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="h6">Select Constraint Templates</Typography>
                <Button size="small" variant="outlined" onClick={handleSelectAll}>
                  {allSelected ? 'De-Select All' : 'Select All'}
                </Button>
              </Box>
              <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
              }}>
                {availableTemplates.map(template => (
                  <FormControlLabel
                    key={template}
                    control={
                      <Checkbox
                        checked={selectedTemplates.includes(template)}
                        onChange={() => handleTemplateToggle(template)}
                        size="small"
                      />
                    }
                    label={<Typography variant="body2">{template}</Typography>}
                  />
                ))}
              </Box>
            </Paper>

            <Paper sx={{ p: 3, textAlign: 'left' }}>
              <Typography variant="h6" gutterBottom>Minimum Support</Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Minimum fraction of traces that must satisfy a constraint: {minSupport.toFixed(2)}
              </Typography>
              <Slider
                value={minSupport}
                onChange={(_, value) => setMinSupport(value as number)}
                min={0}
                max={1}
                step={0.01}
                valueLabelDisplay="auto"
              />
            </Paper>
          </>
        )}

        {errorMsg && (
          <Typography color="error" variant="body2">{errorMsg}</Typography>
        )}

        {isReady && minedDeclFilename && (
          <Box sx={{ mt: 1, mb: 1 }}>
            <Button
              variant="outlined"
              size="small"
              component="a"
              href={`${API_URL}/api/download-mined-decl`}
              download={minedDeclFilename}
            >
              Download mined model as .decl
            </Button>
          </Box>
        )}

        {!isReady && (
          <Box>
            <Button
              variant="contained"
              onClick={handleUpload}
              disabled={!canUpload}
              startIcon={isProcessing ? <CircularProgress size={20} /> : <UploadFileIcon />}
            >
              {isProcessing
                ? (mode === 'bpmn' && bpmnSubMode === 'mine'
                    ? (miningPhase === 'computing' ? "Computing Alignments..." : "Mining Model...")
                    : mode === 'bpmn'
                      ? "Computing Alignments..."
                      : declSubMode === 'upload'
                        ? "Checking Conformance..."
                        : "Mining Constraints...")
                : "Upload & Compute"
              }
            </Button>
            {isProcessing && (
              <LinearProgress sx={{ mt: 2, borderRadius: 1 }} />
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
};

export default WelcomePage;
